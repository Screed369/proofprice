// CH eggs: BLW/FOAG (Federal Office for Agriculture) "Market figures eggs - Monthly producer prices", read from the LINDAS linked-data
// service (SPARQL POST, CSV answer, no key). Format checked live on 2026-11-10 (cube
// https://agriculture.ld.admin.ch/foag/cube/Eggs/Production_Price_Month, 2026-09 is the newest month, 14 months checked).
// Every observation we use: unit/2 = Piece, currency/1 = Centime (Rappen), cost-component/1 = incl. VAT, data-method/25 = "Realized price,
// weighted average", sales-region/1 = Switzerland, value chain "Production / ex-farm (production stage)". The publisher states no count of
// eggs, farms or deliveries: every answer is an official statistic (n is NO_COUNT). Terms: opendata.swiss "Open use" (terms_by).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, retryOnce, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const ENDPOINT = "https://lindas.admin.ch/query";
const FOAG = "https://agriculture.ld.admin.ch/foag/";
const MONTH = "https://ld.admin.ch/time/month/";

export const INFO: SourceInfo = {
  id: "ch-blw-eggs",
  country: "CH (Switzerland)",
  category: "farm-gate-prices (monthly producer prices of shell eggs)",
  name: "Marktzahlen Eier: monatliche Produzentenpreise (BLW / FOAG, via LINDAS)",
  publisher: "Bundesamt für Landwirtschaft BLW (Federal Office for Agriculture FOAG), published on opendata.swiss and LINDAS",
  what_is_recorded:
    "The monthly weighted average realised ex-farm price of Swiss shell eggs, in Swiss centimes (Rappen) per egg including VAT, for all forms of production and for barn, free-range and organic eggs. " +
    "One published figure per product and month; never an individual farm, packing station or buyer.",
  price_type: "official_statistic",
  freshness: "Monthly: BLW adds the newest month during the following month, and the answer names the month it covers",
  licence: "opendata.swiss terms of use, tier 'Open use' (terms_by): commercial use allowed, the source must be named (author, title, link)",
  licence_url: "https://opendata.swiss/terms-of-use#terms_by",
  attribution:
    "Source: Federal Office for Agriculture FOAG (BLW), Market figures eggs - Monthly producer prices (https://opendata.swiss/en/dataset/marktzahlen-eier-7), Open use. " +
    "ProofPrice selects the series and calculates the changes; the FOAG has not reviewed it.",
  homepage: "https://opendata.swiss/en/dataset/marktzahlen-eier-7",
  limits:
    "A monthly weighted average price at the production stage (ex-farm, including VAT), not a shop price and not a sale. The publisher gives no number of eggs or trades behind a figure, so there is no range and no sample size. " +
    "Only the four weighted-average series below are offered; size grades, second-class eggs and the foreign producer prices in the same dataset are left out.",
};

export interface EggProduct { key: string; code: string; label: string; words: string[] }
/** BLW product numbers (https://agriculture.ld.admin.ch/foag/product/<n>); labels read from the cube on 2026-11-10. */
export const PRODUCTS: EggProduct[] = [
  { key: "eggs", code: "235", label: "Swiss shell eggs, all forms of production (weighted average)", words: ["eggs", "egg", "shell eggs", "hen eggs", "chicken eggs", "eier", "ei", "oeufs", "œufs"] },
  { key: "barn eggs", code: "234", label: "Swiss barn eggs (weighted average)", words: ["barn eggs", "barn egg", "barn", "indoor eggs"] },
  { key: "free range eggs", code: "229", label: "Swiss free-range eggs (weighted average)", words: ["free range eggs", "free-range eggs", "free range egg", "free range", "freiland eggs"] },
  { key: "organic eggs", code: "224", label: "Swiss organic eggs (weighted average)", words: ["organic eggs", "organic egg", "bio eggs", "organic"] },
];
export const EGG_KEYS: string[] = PRODUCTS.map((x) => x.key);
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

/** The product behind a free-text name, or null when it is not an egg product. "eggs" alone means all forms of production. */
export function eggProductOf(raw: unknown): EggProduct | null {
  const t = norm(raw);
  if (!t) return null;
  const exact = PRODUCTS.find((p) => p.words.includes(t) || p.key === t);
  if (exact) return exact;
  if (/\beggs?\b|\beier\b|œufs|oeufs/.test(t)) {
    if (/organic|bio/.test(t)) return PRODUCTS[3];
    if (/free.?range|freiland/.test(t)) return PRODUCTS[2];
    if (/barn/.test(t)) return PRODUCTS[1];
    return PRODUCTS[0];
  }
  return null;
}

export const startMonth = (ym: string, back: number) => shiftMonth(ym, -back);
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** SPARQL for the Swiss weighted averages (centimes per piece, incl. VAT, realised price) from `fromYm` on. */
export function buildQuery(fromYm: string, codes: string[] = PRODUCTS.map((p) => p.code)): string {
  const values = codes.map((c) => `<${FOAG}product/${c}>`).join(" ");
  return `PREFIX d: <${FOAG}dimension/>
SELECT ?product ?month ?price ?unit ?currency ?cost ?method ?region WHERE {
 GRAPH <https://lindas.admin.ch/foag/agricultural-market-data> {
  ?o a <https://cube.link/Observation> ; d:date ?month ; d:product ?product ; d:unit ?unit ; d:currency ?currency ;
     d:cost-component ?cost ; d:data-method ?method ; d:sales-region ?region ; <${FOAG}measure/price> ?price .
  VALUES ?product { ${values} }
  FILTER(STRSTARTS(STR(?o), "${FOAG}cube/Eggs/Production_Price_Month/observation/"))
  FILTER(STR(?month) >= "${MONTH}${fromYm}")
 } } ORDER BY ?product ?month`;
}

/** Minimal CSV reader (quotes, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

export interface Point { month: string; rappen: number }

/** Parse the SELECT result into monthly points per product code (oldest first). Rows that are not Swiss, in centimes, per piece, including VAT and a realised
 *  price are dropped, so a changed unit can never be read as the old one. */
export function parsePoints(csv: string): Map<string, Point[]> {
  const rows = parseCsv(csv);
  const out = new Map<string, Point[]>();
  if (rows.length === 0) return out;
  const head = rows[0].map((h) => h.trim());
  const ix = (n: string) => head.indexOf(n);
  for (const n of ["product", "month", "price", "unit", "currency", "cost", "method", "region"]) if (ix(n) < 0) throw new SourceError("BLW answer has an unexpected layout", `missing column ${n}`);
  const want: Record<string, string> = { unit: FOAG + "unit/2", currency: FOAG + "currency/1", cost: FOAG + "cost-component/1", method: FOAG + "data-method/25", region: FOAG + "sales-region/1" };
  for (const r of rows.slice(1)) {
    if (Object.entries(want).some(([k, v]) => (r[ix(k)] ?? "") !== v)) continue;
    const code = (r[ix("product")] ?? "").slice((FOAG + "product/").length);
    const month = (r[ix("month")] ?? "").replace(MONTH, "");
    const rappen = Number(r[ix("price")]);
    if (!code || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(rappen) || rappen <= 0) continue;
    if (!out.has(code)) out.set(code, []);
    out.get(code)!.push({ month, rappen });
  }
  for (const pts of out.values()) pts.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

/** CHF per egg from the published Rappen. */
export const chfPerEgg = (rappen: number) => Number((rappen / 100).toFixed(4));
export const itemName = (pr: EggProduct) => `${pr.label} (CHF per egg)`;

const change = (now: number, then: number | undefined, month: string) =>
  then ? { reference_month: month, value_rappen: then, change_percent: Math.round(((now - then) / then) * 1000) / 10 } : null;

export interface Ask { product: string; baseUrl?: string }

export function answerFor(pr: EggProduct, pts: Point[], ask: Ask, now: Date = new Date()): PriceAnswer {
  const latest = pts.length ? pts[pts.length - 1] : null;
  const base = { source: INFO, query: { country: "CH", product: pr.key }, measure: "average" as const, currency: "CHF", unit: "per egg", baseUrl: ask.baseUrl };
  if (!latest) {
    return buildStatisticAnswer({
      ...base, value: null, period: { from: null, to: null }, reference_period: "",
      method: "Switzerland (BLW egg producer prices): the latest monthly weighted average price at the production stage.",
      describe: () => "",
      note: `BLW publishes no recent producer price for ${pr.label}.`,
    });
  }
  const by = new Map(pts.map((x) => [x.month, x.rappen]));
  const mom = change(latest.rappen, by.get(shiftMonth(latest.month, -1)), shiftMonth(latest.month, -1));
  const yoy = change(latest.rappen, by.get(shiftMonth(latest.month, -12)), shiftMonth(latest.month, -12));
  const [ly, lm] = latest.month.split("-").map(Number);
  const behind = now.getUTCFullYear() * 12 + now.getUTCMonth() - (ly * 12 + (lm - 1));
  const notes = [`A monthly weighted average ex-farm price (production stage, including VAT) for ${monthWords(latest.month)}: not a shop price, not a sale.`];
  if (behind >= 5) notes.push(`Old data: the newest month BLW holds is ${monthWords(latest.month)}, ${behind} months ago.`);
  const head = chfPerEgg(latest.rappen);
  return buildStatisticAnswer({
    ...base,
    value: head,
    period: monthRange(latest.month),
    reference_period: latest.month,
    method:
      "Switzerland (BLW): the monthly weighted average realised ex-farm price of Swiss shell eggs (centimes per egg, including VAT) from the Federal Office for Agriculture. " +
      "We pass on the published average and its month, with the change on the previous month and a year earlier that we calculate from two published averages; it is a monthly average, not a sale, and no range is calculated.",
    describe: (v) =>
      `In ${monthWords(latest.month)} the weighted average ex-farm price of ${pr.label} in Switzerland was ${fmtMoney(v, "CHF")} per egg (${latest.rappen} centimes, ${fmtMoney(v * 12, "CHF")} per dozen), as published by the Federal Office for Agriculture (a monthly average at the production stage, not a shop price). ` +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from a year earlier (${yoy.value_rappen} centimes in ${monthWords(yoy.reference_month)}).`
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${yoy.value_rappen} centimes in ${monthWords(yoy.reference_month)}).`
        : "BLW holds no price for the same month a year earlier."),
    note: notes.join(" "),
    extra: {
      country_name: "Switzerland",
      product: { definition: pr.label, asked_for: ask.product, blw_product: pr.code },
      what_this_is: "Monthly weighted average realised price of Swiss shell eggs at the production stage (ex-farm, including VAT), published by the Federal Office for Agriculture. Not a shop price and not a sale.",
      reference_month: latest.month,
      reference_month_label: monthWords(latest.month),
      published_value: latest.rappen,
      published_unit: "centimes (Rappen) per egg, incl. VAT",
      price_per_dozen_chf: Number((head * 12).toFixed(2)),
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      last_12_months: pts.filter((x) => x.month > shiftMonth(latest.month, -12)).map((x) => ({ month: x.month, value: chfPerEgg(x.rappen) })),
    },
  });
}

// ---------- the requests ----------

const ATTEMPT_MS = 9000;
export interface EggOptions { post?: (query: string) => Promise<string>; now?: Date }

async function postSparql(query: string, timeoutMs = ATTEMPT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { accept: "text/csv", "content-type": "application/x-www-form-urlencoded", "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" },
      body: new URLSearchParams({ query }).toString(),
    });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", ENDPOINT);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

const fromMonth = (now: Date, back: number) => shiftMonth(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`, -back);

export async function chEggPrices(input: { product?: string; baseUrl?: string }, o: EggOptions = {}): Promise<PriceAnswer> {
  const pr = eggProductOf(input.product);
  if (!pr) throw new InputError(`For Switzerland, BLW publishes producer prices for eggs: ${EGG_KEYS.join(", ")}. "${input.product ?? ""}" is not one of them.`);
  const now = o.now ?? new Date();
  const post = o.post ?? ((q: string) => postSparql(q));
  const csv = await retryOnce(() => post(buildQuery(fromMonth(now, 17), [pr.code])));
  return answerFor(pr, parsePoints(csv).get(pr.code) ?? [], { product: String(input.product ?? ""), baseUrl: input.baseUrl }, now);
}

// ---------- daily copy (stale-if-error) ----------

/** Pure: one library row per product for the newest month that every returned product has. Each row is one published average (n is NO_COUNT). */
export function harvestRows(series: Map<string, Point[]>): HarvestResult {
  const newest = PRODUCTS.map((pr) => ({ pr, last: (series.get(pr.code) ?? []).slice(-1)[0] })).filter((s) => s.last);
  if (!newest.length) throw new SourceError("BLW returned no usable egg producer price");
  const month = newest.map((s) => s.last.month).sort().pop()!;
  const rows: DailyRow[] = newest
    .filter((s) => s.last.month === month)
    .map((s) => {
      const v = chfPerEgg(s.last.rappen);
      return { area: "CH", item: itemName(s.pr), n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  return {
    date: monthRange(month).to,
    currency: "CHF",
    unit: "per egg",
    rows,
    note: `BLW egg producer prices for ${monthWords(month)}: published monthly weighted averages at the production stage, not counts of sales (no count is published).`,
  };
}

export async function chEggHarvest(o: EggOptions = {}): Promise<HarvestResult> {
  const now = o.now ?? new Date();
  const post = o.post ?? ((q: string) => postSparql(q));
  return harvestRows(parsePoints(await retryOnce(() => post(buildQuery(fromMonth(now, 3))))));
}

/** Where a request lives in the library, without asking BLW. */
export function chEggHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const pr = eggProductOf(p.product);
  return pr ? { area: "CH", item: itemName(pr), label: `Switzerland, ${pr.label}` } : null;
}
