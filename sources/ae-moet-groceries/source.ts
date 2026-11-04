// United Arab Emirates essential-goods shelf prices: the Ministry of Economy and Tourism (MoET) "Essential Goods Prices Platform".
// One public page holds a table: 18 essential commodities (bread, chicken, oils, milk, eggs, rice, sugar, flour, pulses) x about 13 retail outlets.
// Each cell is "<price> AED" over "<pack size> <KG|L|PCS>", i.e. the posted shelf price of one pack. We turn every cell into a price per kg, per litre
// or per piece and report the median and 10th-90th percentile across the outlets. POSTED shelf prices (not receipts), in dirhams.
// The page carries one snapshot ("Last Updated"), so the daily collector (harvest) keeps the history; requests read the page live and fall back to our copy.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ae-moet-groceries",
  country: "United Arab Emirates",
  category: "groceries (essential goods shelf prices)",
  name: "Essential Goods Prices Platform (Ministry of Economy and Tourism)",
  publisher: "Ministry of Economy and Tourism (MoET), United Arab Emirates",
  what_is_recorded:
    "The posted shelf price, in dirhams (AED), of one pack of an essential commodity (bread, chicken, cooking oil, milk, eggs, pulses, rice, sugar, flour) in one UAE retail outlet or co-operative, as shown on the Ministry's platform.",
  price_type: "posted_price",
  freshness: "Monthly (the page states its own 'Last Updated' date)",
  licence: "UNVERIFIED: the Ministry's open-data policy page could not be read (it is a JavaScript page). Served on the free tier only.",
  licence_url: "https://www.moet.gov.ae/en/open-data-policy",
  attribution: "Source: UAE Ministry of Economy and Tourism, Essential Goods Prices Platform (https://www.moet.gov.ae/en/essential-goods-prices-platform). Changed by ProofPrice: we convert each pack price to a price per kg, litre or piece and report the median and 10th to 90th percentile across outlets.",
  homepage: "https://www.moet.gov.ae/en/essential-goods-prices-platform",
  limits:
    "Posted shelf prices that the Ministry shows for about 18 commodities and 13 outlets, not receipts and not what one shopper paid; promotions are not separated. Brands and pack sizes differ between outlets, so the range is a spread over outlets, " +
    "converted to a price per kg, litre or piece. Each figure needs 5 or more outlet prices. The page holds the latest snapshot only; history builds from our own daily copy.",
};

export const PAGE_URL = "https://www.moet.gov.ae/en/essential-goods-prices-platform";
export const STALE_AFTER_DAYS = 70; // the platform updates about monthly
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)", "accept-language": "en" };

export type Unit = "kg" | "L" | "piece";
export interface Commodity { name: string; unit: Unit; prices: { outlet: string; price: number; pack: number; unitPrice: number }[] }
export interface Page { date: string | null; outlets: string[]; commodities: Commodity[] }

const clean = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const UNITS: Record<string, Unit> = { KG: "kg", L: "L", PCS: "piece" };
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "Last Updated: Nov 02, 2026 | 12:00 AM" -> "2026-11-02", or null. */
export function parseUpdated(html: string): string | null {
  const m = /Last Updated:?\s*(?:<[^>]*>\s*)*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/i.exec(html);
  const mm = m && MONTHS[m[1].toLowerCase()];
  return m && mm ? `${m[3]}-${mm}-${m[2].padStart(2, "0")}` : null;
}

/** The price table: header row = No, Commodity, Units, then one column per outlet; each data row has a data-category attribute. Tolerant of whitespace and extra markup. */
export function parsePage(html: string): Page {
  const start = html.indexOf('class="price-table"');
  if (start < 0) throw new SourceError("The Ministry's price page has a new layout: no price table found");
  const table = html.slice(start, html.indexOf("</table>", start) > 0 ? html.indexOf("</table>", start) : undefined);
  const head = table.slice(0, table.indexOf("</thead>") > 0 ? table.indexOf("</thead>") : 0);
  const heads = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => clean(m[1]));
  const outlets = heads.slice(3);
  if (outlets.length < 3) throw new SourceError("The Ministry's price page has a new layout: outlet columns not found");
  const commodities: Commodity[] = [];
  for (const rm of table.matchAll(/<tr[^>]*data-category="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rm[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const unitText = clean(/commodity-unit[^>]*>([\s\S]*?)</i.exec(cells[2])?.[1] ?? clean(cells[2])).toUpperCase();
    const unit = UNITS[unitText];
    const name = clean(rm[1]);
    if (!unit || !name) continue;
    const prices: Commodity["prices"] = [];
    cells.slice(3).forEach((cell, i) => {
      const badges = [...cell.matchAll(/badge-num[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => clean(m[1]));
      const p = /^([\d.,]+)\s*AED$/i.exec(badges[0] ?? "");
      const q = new RegExp(`^([\\d.,]+)\\s*${unitText}$`, "i").exec(badges[1] ?? "");
      if (!p || !q || !outlets[i]) return; // '-' = outlet does not list the item
      const price = Number(p[1].replace(/,/g, "")), pack = Number(q[1].replace(/,/g, ""));
      if (!(price > 0) || !(pack > 0)) return;
      prices.push({ outlet: outlets[i], price, pack, unitPrice: price / pack });
    });
    commodities.push({ name, unit, prices });
  }
  if (!commodities.length) throw new SourceError("The Ministry's price page has a new layout: no commodity rows found");
  return { date: parseUpdated(html), outlets, commodities };
}

const unitLabel = (u: Unit) => (u === "kg" ? "per kg" : u === "L" ? "per litre" : "per piece");
export const itemKey = (name: string, unit: Unit): string => `${name.replace(/[|:,]/g, " ").replace(/\s+/g, " ").trim()}|${unit}`;

/** Library rows (area ALL only: one price per outlet, so an outlet alone never reaches 5). Only commodities with 5+ outlet prices. */
export function buildRows(page: Page): DailyRow[] {
  const recs = page.commodities.flatMap((c) => c.prices.map((p) => ({ area: NATIONAL, item: itemKey(c.name, c.unit), price: p.unitPrice })));
  return aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
}

export async function fetchPage(): Promise<{ page: Page; html: string }> {
  const res = await fetch(PAGE_URL, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new SourceError(`The Ministry's price page returned HTTP ${res.status}`);
  const html = await res.text();
  return { page: parsePage(html), html };
}

export async function moetHarvest(): Promise<HarvestResult> {
  const { page } = await fetchPage();
  const rows = buildRows(page);
  if (rows.length < 5) throw new SourceError(`The Ministry's page held only ${rows.length} commodities with 5 or more outlet prices (expected about 18)`);
  return {
    date: page.date ?? new Date().toISOString().slice(0, 10),
    currency: "AED",
    unit: "per kg, per litre or per piece (named in the item)",
    rows,
    note: `${page.commodities.length} commodities, ${page.outlets.length} outlets, ${page.commodities.reduce((a, c) => a + c.prices.length, 0)} shelf prices.`,
  };
}

// ---------- matching ----------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "in", "uae", "dubai", "emirates", "how", "much", "is", "for", "and",]);
const SYNONYMS: Record<string, string> = { yoghurt: "yogurt", bread: "bread", chicken: "chicken", rice: "rice", sugar: "sugar", flour: "flour", egg: "egg", milk: "milk", oil: "oil", chickpea: "chickpea", lentil: "lentil" };

export interface Def { name: string; unit: Unit; row: DailyRow }

/** Commodities matching the question, best first. Every query word (stop words removed) must appear in the commodity name; exact name first, then larger n. */
export function matchItems(defs: Def[], query: string): Def[] {
  const full = norm(query).split(" ").filter(Boolean);
  const words = full.filter((w) => !STOP.has(w)).map((w) => stem(SYNONYMS[w] ?? w));
  const qs = words.length ? words : full.map(stem);
  if (!qs.length) return [];
  return defs
    .map((d) => {
      const nw = norm(d.name).split(" ").map(stem);
      const hit = qs.every((w) => nw.includes(w));
      const exact = hit && norm(d.name).split(" ").filter((w) => !STOP.has(w)).length === qs.length ? 1 : 0;
      return { d, hit, exact };
    })
    .filter((x) => x.hit)
    .sort((a, b) => b.exact - a.exact || b.d.row.n - a.d.row.n || a.d.name.localeCompare(b.d.name))
    .map((x) => x.d);
}

export function defsFromRows(rows: DailyRow[]): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== NATIONAL || r.n < MIN_PUBLISH) continue;
    const [name, unit] = r.item.split("|");
    if (name && (unit === "kg" || unit === "L" || unit === "piece")) out.push({ name, unit, row: r });
  }
  return out;
}

const METHOD =
  "United Arab Emirates (posted shelf prices): the Ministry of Economy and Tourism's Essential Goods Prices Platform lists the price of one pack of each essential commodity in about 13 outlets; " +
  "each is converted to a price per kg, per litre or per piece, and the answer is the median and 10th–90th percentile across outlets, in dirhams. Posted prices, not receipts; n is the number of outlet prices (5 or more needed).";

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);

export function answerFromRows(day: { date: string; rows: DailyRow[] }, input: { item?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an essential commodity such as 'eggs', 'milk', 'rice', 'sugar', 'flour', 'chicken', 'bread' or 'cooking oil'.");
  const defs = defsFromRows(day.rows);
  const hits = matchItems(defs, /oil/i.test(item) && !/(canola|corn|sunflower)/i.test(item) ? item + " oil" : item);
  if (!hits.length) {
    const names = [...new Set(defs.map((d) => d.name))].sort();
    return buildAnswer({
      source: INFO, query: { country: "AE", item }, summary: null, currency: "AED", unit: "per kg",
      period: { from: day.date, to: day.date }, method: METHOD, describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: `No commodity matching '${item}' has 5 or more outlet prices. Commodities held: ${names.join("; ")}.` },
    });
  }
  const best = hits[0], r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${unitLabel(d.unit)}`);
  return buildAnswer({
    source: INFO,
    query: { country: "AE", item: `${best.name}, ${unitLabel(best.unit)}` },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "AED",
    unit: unitLabel(best.unit),
    period: { from: day.date, to: day.date },
    method: METHOD,
    describe: (x) =>
      `UAE Ministry of Economy and Tourism posted shelf prices put ${best.name} ${unitLabel(best.unit)} at a median of ${fmtMoney(x.median, "AED")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "AED")}–${fmtMoney(x.high, "AED")} across ${r.n} outlet prices. Posted prices, not receipts; page updated ${day.date}.` +
      (stale ? ` The page was last updated ${ageDays} days ago.` : ""),
    baseUrl: input.baseUrl,
    extra: { outlet_prices: r.n, ...(others.length ? { other_definitions: others } : {}), ...(stale ? { stale_source: true, days_since_updated: ageDays } : {}) },
  });
}

export async function moetPrices(input: { item?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const { page } = await fetchPage();
  return answerFromRows({ date: page.date ?? new Date().toISOString().slice(0, 10), rows: buildRows(page) }, input);
}

export function moetHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  if (!p.item) return null;
  // Library rows exist only for the commodities in the page; we resolve against the fixed list of known names.
  const best = matchItems(KNOWN.map((k) => ({ name: k.name, unit: k.unit, row: { area: NATIONAL, item: "", n: 99, median: 0, low: 0, high: 0, min: 0, max: 0 } })), p.item)[0];
  return best ? { area: NATIONAL, item: itemKey(best.name, best.unit), label: `${best.name} ${unitLabel(best.unit)}, United Arab Emirates` } : null;
}

/** The 18 commodities seen on the page on 2026-11-04 (used only to map a history question to a library key). */
export const KNOWN: { name: string; unit: Unit }[] = [
  ["White Bread Slices", "kg"], ["Whole Chicken (Fresh)", "kg"], ["Canola Oil", "L"], ["Corn Oil", "L"], ["Sunflower Oil", "L"], ["Fresh Whole Milk", "L"],
  ["Powdered Milk", "kg"], ["Yogurt", "kg"], ["Brown Eggs", "piece"], ["White Eggs", "piece"], ["Beans (Dry and Canned)", "kg"], ["Fava Beans (Dry and Canned)", "kg"],
  ["White Chickpeas (Dry and Canned)", "kg"], ["Green Lentils (Dry and Canned)", "kg"], ["Red Lentils (Dry and Canned)", "kg"], ["Basmati Rice", "kg"],
  ["Pure White Sugar Grains", "kg"], ["First and Second Grade Flour", "kg"],
].map(([name, unit]) => ({ name: name as string, unit: unit as Unit }));
