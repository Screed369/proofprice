// World Food Programme food prices (HDX "Global WFP food prices"): market-survey prices of staple foods in about 98 mostly
// developing countries, one row per market, commodity and month. The files are big (about 36 MB per year), so we never read
// them per request: the daily collector (harvest) downloads the two newest yearly files from the Humanitarian Data Exchange,
// keeps each market's newest observation, and stores one aggregate per country and food in the price library. Requests are
// answered from there. Posted market-survey prices in US dollars (WFP's own conversion), not receipts and not what one person paid.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { MIN_PUBLISH, NO_COUNT } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "un-wfp-food-prices",
  country: "About 50 countries (mostly Africa, Asia and the Middle East; see countries)",
  category: "groceries (market-survey prices of staple foods)",
  name: "WFP Price Database via the Humanitarian Data Exchange (HDX)",
  publisher: "World Food Programme (WFP), published on HDX by OCHA",
  what_is_recorded:
    "The price of one staple food (rice, wheat, maize, beans, oil, sugar, bread, vegetables, meat, milk and more) in one market in one month, recorded by WFP and partner market surveys, in local currency and in US dollars.",
  price_type: "posted_price",
  freshness: "WFP files are updated about monthly (HDX file last modified 2026-10-12); the newest observation in a country is often 1 to 5 months old; our copy is refreshed daily",
  licence: "CC BY-IGO 3.0 (Creative Commons Attribution for Intergovernmental Organisations)",
  licence_url: "https://creativecommons.org/licenses/by/3.0/igo/",
  attribution:
    "World Food Programme, Price Database, via the Humanitarian Data Exchange (HDX), CC BY-IGO 3.0. Changed by ProofPrice: we take each market's newest price and report the median and 10th to 90th percentile across markets.",
  homepage: "https://data.humdata.org/dataset/global-wfp-food-prices",
  limits:
    "Prices WFP's surveys recorded in markets (retail or wholesale as labelled), not receipts and not what one buyer paid. Figures are in US dollars at the conversion WFP publishes, so local currency is not given. " +
    "Only observations flagged 'actual' count (not aggregates or forecasts); non-food rows (wages, fuel, exchange rates) are left out. " +
    "A range needs the newest survey of 5 or more markets inside two months of the country's latest survey; markets are not weighted by population, so it is a spread of market prices, not a national average. " +
    "Countries whose latest survey is more than nine months older than the newest in the file are left out.",
};

/** ISO 3166 alpha-2 -> WFP's alpha-3 and the English name. Only countries WFP surveys; a country with no usable data answers 'no matches'. */
export const COUNTRIES: Record<string, { iso3: string; name: string }> = {
  AF: { iso3: "AFG", name: "Afghanistan" }, AM: { iso3: "ARM", name: "Armenia" }, BD: { iso3: "BGD", name: "Bangladesh" },
  BF: { iso3: "BFA", name: "Burkina Faso" }, BI: { iso3: "BDI", name: "Burundi" }, BJ: { iso3: "BEN", name: "Benin" },
  BO: { iso3: "BOL", name: "Bolivia" }, CD: { iso3: "COD", name: "Democratic Republic of the Congo" }, CF: { iso3: "CAF", name: "Central African Republic" },
  CG: { iso3: "COG", name: "Republic of the Congo" }, CI: { iso3: "CIV", name: "Cote d'Ivoire" }, CM: { iso3: "CMR", name: "Cameroon" },
  CO: { iso3: "COL", name: "Colombia" }, CV: { iso3: "CPV", name: "Cabo Verde" }, DJ: { iso3: "DJI", name: "Djibouti" },
  EC: { iso3: "ECU", name: "Ecuador" }, EG: { iso3: "EGY", name: "Egypt" }, ET: { iso3: "ETH", name: "Ethiopia" },
  GE: { iso3: "GEO", name: "Georgia" }, GH: { iso3: "GHA", name: "Ghana" }, GM: { iso3: "GMB", name: "Gambia" },
  GN: { iso3: "GIN", name: "Guinea" }, GT: { iso3: "GTM", name: "Guatemala" }, GW: { iso3: "GNB", name: "Guinea-Bissau" },
  HN: { iso3: "HND", name: "Honduras" }, HT: { iso3: "HTI", name: "Haiti" }, ID: { iso3: "IDN", name: "Indonesia" },
  IN: { iso3: "IND", name: "India" }, IQ: { iso3: "IRQ", name: "Iraq" }, IR: { iso3: "IRN", name: "Iran" },
  JO: { iso3: "JOR", name: "Jordan" }, KE: { iso3: "KEN", name: "Kenya" }, KG: { iso3: "KGZ", name: "Kyrgyzstan" },
  KH: { iso3: "KHM", name: "Cambodia" }, LA: { iso3: "LAO", name: "Laos" }, LB: { iso3: "LBN", name: "Lebanon" },
  LK: { iso3: "LKA", name: "Sri Lanka" }, LR: { iso3: "LBR", name: "Liberia" }, LS: { iso3: "LSO", name: "Lesotho" },
  MG: { iso3: "MDG", name: "Madagascar" }, ML: { iso3: "MLI", name: "Mali" }, MM: { iso3: "MMR", name: "Myanmar" },
  MR: { iso3: "MRT", name: "Mauritania" }, MW: { iso3: "MWI", name: "Malawi" }, MZ: { iso3: "MOZ", name: "Mozambique" },
  NA: { iso3: "NAM", name: "Namibia" }, NE: { iso3: "NER", name: "Niger" }, NG: { iso3: "NGA", name: "Nigeria" },
  NI: { iso3: "NIC", name: "Nicaragua" }, NP: { iso3: "NPL", name: "Nepal" }, PE: { iso3: "PER", name: "Peru" },
  PH: { iso3: "PHL", name: "Philippines" }, PK: { iso3: "PAK", name: "Pakistan" }, PS: { iso3: "PSE", name: "State of Palestine" },
  RW: { iso3: "RWA", name: "Rwanda" }, SD: { iso3: "SDN", name: "Sudan" }, SL: { iso3: "SLE", name: "Sierra Leone" },
  SN: { iso3: "SEN", name: "Senegal" }, SO: { iso3: "SOM", name: "Somalia" }, SS: { iso3: "SSD", name: "South Sudan" },
  SV: { iso3: "SLV", name: "El Salvador" }, SY: { iso3: "SYR", name: "Syria" }, SZ: { iso3: "SWZ", name: "Eswatini" },
  TD: { iso3: "TCD", name: "Chad" }, TG: { iso3: "TGO", name: "Togo" }, TJ: { iso3: "TJK", name: "Tajikistan" },
  TL: { iso3: "TLS", name: "Timor-Leste" }, TR: { iso3: "TUR", name: "Turkey" }, TZ: { iso3: "TZA", name: "Tanzania" },
  UA: { iso3: "UKR", name: "Ukraine" }, UG: { iso3: "UGA", name: "Uganda" }, YE: { iso3: "YEM", name: "Yemen" },
  ZM: { iso3: "ZMB", name: "Zambia" }, ZW: { iso3: "ZWE", name: "Zimbabwe" },
};
/** Countries with 5 or more recent markets in the first collection (18 Oct 2026); the others in COUNTRIES had no usable survey. Add a code here when the library shows one. */
export const LISTED: string[] = "AF AM BD BF BI BJ BO CD CF CI CM DJ ET GM GN GW HT ID IN IQ JO KG LA LB LR LS ML MM MR MW MZ NE NG NP PH PK RW SD SL SN SO SS TD TG TL TZ UA UG YE ZW".split(" ");
const BY_ISO3 = new Map(Object.entries(COUNTRIES).map(([c, v]) => [v.iso3, c]));

export const ASOF_ITEM = "_asof"; // per-country row whose value is the date (YYYYMMDD) of the country's newest survey
export const WINDOW_DAYS = 62; // a market counts when its newest price is within this many days of the country's newest survey
export const MAX_LAG_DAYS = 270; // a country whose newest survey is older than this behind the file's newest is left out
export const STALE_AFTER_DAYS = 7; // our library copy (not the survey date) older than this is flagged

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };
export const PACKAGE_URL = "https://data.humdata.org/api/3/action/package_show?id=global-wfp-food-prices";

/** One CSV line into cells ("" inside quotes is a quote). */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cell = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

export interface Obs { iso3: string; date: string; market: string; item: string; usd: number }

const REQUIRED = ["countryiso3", "date", "admin1", "market", "market_id", "category", "commodity", "unit", "priceflag", "pricetype", "usdprice"] as const;

/** Item key stored in the library: "Rice (high quality)|KG|Retail". Commas inside names become "/", so the key is one CSV cell. */
export function itemKey(commodity: string, unit: string, pricetype: string): string {
  return `${commodity.trim().replace(/\s*,\s*/g, "/")}|${unit.trim()}|${pricetype.trim()}`;
}

/** Read one yearly file. Columns are found by header name. Keeps priceflag 'actual', food rows only, with a positive USD price. */
export function parseWfp(text: string, onObs: (o: Obs) => void): { rows: number; kept: number } {
  const first = text.indexOf("\n");
  if (first < 0) throw new SourceError("WFP file is empty");
  const head = splitLine(text.slice(0, first).replace(/^﻿/, "").trim()).map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const k of REQUIRED) {
    idx[k] = head.indexOf(k);
    if (idx[k] < 0) throw new SourceError(`WFP file has a new layout: column ${k} is missing`);
  }
  let rows = 0, kept = 0, pos = first + 1;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, "");
    pos = end + 1;
    if (!line) continue;
    rows++;
    const c = line.includes('"') ? splitLine(line) : line.split(",");
    if (c.length < head.length) continue;
    if (c[idx.priceflag].trim().toLowerCase() !== "actual") continue;
    if (c[idx.category].trim().toLowerCase() === "non-food") continue;
    const usd = Number(c[idx.usdprice]);
    const date = c[idx.date].trim();
    if (!Number.isFinite(usd) || usd <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const commodity = c[idx.commodity].trim(), unit = c[idx.unit].trim(), type = c[idx.pricetype].trim();
    if (!commodity || !unit || !type) continue;
    const market = (c[idx.market_id].trim() || `${c[idx.admin1].trim()}/${c[idx.market].trim()}`);
    onObs({ iso3: c[idx.countryiso3].trim().toUpperCase(), date, market, item: itemKey(commodity, unit, type), usd });
    kept++;
  }
  return { rows, kept };
}

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** Keep, for every market and food, the newest observation. Feed it every observation of every file. */
export class Newest {
  private map = new Map<string, Obs>();
  add(o: Obs): void {
    const k = `${o.iso3}\u0000${o.item}\u0000${o.market}`;
    const cur = this.map.get(k);
    if (!cur || o.date > cur.date) this.map.set(k, o);
  }
  get size(): number { return this.map.size; }
  all(): Obs[] { return [...this.map.values()]; }
}

export interface Built { rows: DailyRow[]; countries: string[]; fileNewest: string | null; dropped: { unmapped: number; tooOld: string[] } }

/** Library rows: area = ISO3, item = "<food>|<unit>|<Retail|Wholesale>" (median across markets, n = markets), plus one "_asof" row per country. */
export function buildRows(obs: Obs[]): Built {
  const newestByCountry = new Map<string, string>();
  let unmapped = 0;
  const mapped: Obs[] = [];
  for (const o of obs) {
    if (!BY_ISO3.has(o.iso3)) { unmapped++; continue; }
    mapped.push(o);
    if (o.date > (newestByCountry.get(o.iso3) ?? "")) newestByCountry.set(o.iso3, o.date);
  }
  const fileNewest = [...newestByCountry.values()].sort().pop() ?? null;
  const tooOld: string[] = [];
  const live = new Set<string>();
  for (const [iso3, d] of newestByCountry) {
    if (fileNewest && dayNumber(fileNewest) - dayNumber(d) > MAX_LAG_DAYS) tooOld.push(iso3);
    else live.add(iso3);
  }
  const recs: { area: string; item: string; price: number }[] = [];
  for (const o of mapped) {
    if (!live.has(o.iso3)) continue;
    const c = newestByCountry.get(o.iso3)!;
    if (dayNumber(c) - dayNumber(o.date) > WINDOW_DAYS) continue;
    recs.push({ area: o.iso3, item: o.item, price: o.usd });
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  const countries = [...new Set(rows.map((r) => r.area))].sort();
  for (const iso3 of countries) {
    const v = Number(newestByCountry.get(iso3)!.replace(/-/g, ""));
    rows.push({ area: iso3, item: ASOF_ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { rows, countries, fileNewest, dropped: { unmapped, tooOld: tooOld.sort() } };
}

/** The yearly files listed by the HDX package_show reply, newest year first: [{year, url}]. */
export function yearlyFiles(pkg: unknown): { year: number; url: string }[] {
  const res = (pkg as any)?.result?.resources;
  if (!Array.isArray(res)) throw new SourceError("HDX package reply has no resources");
  const out: { year: number; url: string }[] = [];
  for (const r of res) {
    const url = String(r?.download_url ?? r?.url ?? "");
    const m = /wfp_food_prices_global_(\d{4})\.csv$/.exec(url);
    if (m) out.push({ year: Number(m[1]), url });
  }
  return out.sort((a, b) => b.year - a.year);
}

export async function wfpHarvest(): Promise<HarvestResult> {
  const pkg = await fetchJson(PACKAGE_URL, { headers: UA }, 30000);
  const files = yearlyFiles(pkg).slice(0, 2);
  if (!files.length) throw new SourceError("HDX lists no wfp_food_prices_global_<year>.csv file any more");
  const newest = new Newest();
  let rows = 0, kept = 0;
  for (const f of files) {
    const res = await fetch(f.url, { headers: UA });
    if (!res.ok) throw new SourceError(`HDX returned HTTP ${res.status} for the ${f.year} WFP file`);
    const text = new TextDecoder("utf-8").decode(Buffer.from(await res.arrayBuffer()));
    const r = parseWfp(text, (o) => newest.add(o));
    rows += r.rows; kept += r.kept;
  }
  const built = buildRows(newest.all());
  if (!built.rows.length) throw new SourceError(`WFP files held no usable priced markets (${rows} rows read, ${kept} kept)`);
  return {
    date: new Date().toISOString().slice(0, 10),
    currency: "USD",
    unit: "per unit named in the item",
    rows: built.rows,
    note: `${files.map((f) => f.year).join("+")}: ${rows} rows read, ${kept} kept; ${built.countries.length} countries with figures; file newest ${built.fileNewest}; ` +
      `${built.dropped.tooOld.length} countries too old (${built.dropped.tooOld.join(" ")}); ${built.dropped.unmapped} observations in countries we do not list.`,
  };
}

// ---------- answering ----------

export interface Def { key: string; name: string; unit: string; type: string; n: number; row: DailyRow }

export function parseKey(key: string): { name: string; unit: string; type: string } | null {
  const p = key.split("|");
  if (p.length !== 3) return null;
  return { name: p[0], unit: p[1], type: p[2] };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "retail", "wholesale", "per", "kg", "in"]);

/** Foods WFP recorded for a country, best match first. A word the food name does not contain scores 0 and is left out. */
export function matchItems(defs: Def[], query: string): Def[] {
  const q = norm(query);
  const wholesale = /\bwholesale\b/.test(q);
  const words = q.split(" ").filter((w) => w && !STOP.has(w)).map(stem);
  if (!words.length) return [];
  const scored: { d: Def; s: number }[] = [];
  for (const d of defs) {
    const nameWords = norm(d.name).split(" ").map(stem);
    let s = 0;
    if (nameWords.join(" ") === words.join(" ")) s = 100;
    else if (nameWords.join(" ").startsWith(words.join(" "))) s = 60;
    else if (words.every((w) => nameWords.includes(w))) s = 40;
    if (!s) continue;
    s += (d.type.toLowerCase() === "wholesale") === wholesale ? 30 : 0;
    scored.push({ d, s });
  }
  return scored.sort((a, b) => b.s - a.s || b.d.n - a.d.n || a.d.key.localeCompare(b.d.key)).map((x) => x.d);
}

export function defsFor(rows: DailyRow[], iso3: string): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== iso3 || r.item === ASOF_ITEM || r.n < MIN_PUBLISH) continue;
    const k = parseKey(r.item);
    if (k) out.push({ key: r.item, ...k, n: r.n, row: r });
  }
  return out;
}

export function asOfDate(rows: DailyRow[], iso3: string): string | null {
  const r = rows.find((x) => x.area === iso3 && x.item === ASOF_ITEM);
  const s = r ? String(Math.round(r.median)) : "";
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
}

function methodText() {
  return (
    "Median and 10th–90th percentile, across markets, of the newest price each market recorded for the food in the WFP Price Database (market surveys, converted to US dollars by WFP), " +
    "counting markets whose newest price is within two months of the country's latest survey. Posted market-survey prices, not receipts; n is the number of markets."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function wfpAnswerFromRows(day: LibraryDay, input: { country: string; item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const country = (input.country ?? "").toUpperCase();
  const c = COUNTRIES[country];
  if (!c) throw new InputError(`country must be one of: ${Object.keys(COUNTRIES).join(", ")}`);
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: a staple food in plain words such as 'rice', 'wheat flour', 'maize', 'beans', 'sugar' or 'cooking oil'.");
  if (input.region) throw new InputError("region must be left out: WFP figures are for the whole country (a spread across its markets).");
  const defs = defsFor(day.rows, c.iso3);
  const asOf = asOfDate(day.rows, c.iso3);
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country, item }, summary: null, currency: "USD", unit: "per unit", period: { from: null, to: null },
      method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  if (!defs.length || !asOf) {
    return empty(`No WFP market survey for ${c.name} has 5 or more recent markets in our copy (surveys are often months old, and some countries have none). Try another country from the list.`);
  }
  const hits = matchItems(defs, item);
  if (!hits.length) {
    const names = [...new Set(defs.map((d) => d.name))].sort().slice(0, 25);
    return empty(`No food matching '${item}' has 5 or more markets in ${c.name}. Foods held: ${names.join("; ")}.`);
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const from = isoOf(dayNumber(asOf) - WINDOW_DAYS);
  const label = `${best.name}, ${best.type.toLowerCase()}, per ${best.unit}`;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${d.type.toLowerCase()}, per ${d.unit}`);
  return buildAnswer({
    source: INFO,
    query: { country, item: label },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "USD",
    unit: `per ${best.unit}`,
    period: { from, to: asOf },
    method: methodText(),
    describe: (x) =>
      `WFP market surveys in ${c.name} put ${best.name} (${best.type.toLowerCase()}, per ${best.unit}) at a median of ${fmtMoney(x.median, "USD")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "USD")}–${fmtMoney(x.high, "USD")} across the markets surveyed, in US dollars at WFP's conversion. ` +
      `These are market-survey prices, not receipts, and the newest survey in ${c.name} is from ${asOf}.` +
      (stale ? ` Our copy was collected ${ageDays} days ago.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      markets: r.n,
      latest_survey: asOf,
      currency_note: "US dollars at the conversion WFP publishes, not local currency.",
      ...(others.length ? { other_definitions: others } : {}),
      ...(stale ? { stale: true, days_since_collected: ageDays } : {}),
    },
  });
}

export async function wfpFoodPrices(input: { country: string; item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the WFP price file daily; data appears after the next collection.");
  return wfpAnswerFromRows(day, input);
}

export function wfpHistoryKey(p: { country?: string; item?: string }): { area: string; item: string; label: string } | null {
  try {
    const c = COUNTRIES[String(p.country ?? "").toUpperCase()];
    const day = readLatestDay(INFO.id);
    if (!c || !day || !p.item) return null;
    const best = matchItems(defsFor(day.rows, c.iso3), String(p.item))[0];
    return best ? { area: c.iso3, item: best.key, label: `${best.name}, ${best.type.toLowerCase()}, ${c.name}` } : null;
  } catch {
    return null;
  }
}
