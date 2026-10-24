// Belgium (Flanders): the fixed-price electricity and gas OFFERS that suppliers listed in the Flemish regulator's price comparison
// (V-test), from the regulator's monthly open-data workbook. Read on 2026-10-24 through the GitHub probe:
//   page   https://www.vlaamsenutsregulator.be/cijfers/v-test-data-en-energieprijscurves  (links the workbook, a month folder and a VersionId)
//   file   https://assets.vlaamsenutsregulator.be/2026-10/202610-v-test-data-exclbtw%20v2_0.xlsx?VersionId=...   (4.0 MB, 5 sheets)
// Sheets: Info; "Producten var-dyn (excl. btw)" (2025) and "Var-dyn (excl. btw) (2026)" (variable and dynamic products: formulas, NOT read here);
// "Producten vast (excl. btw)" (2025) and "Vast (excl. btw) (2026)" (fixed-price products, 10 columns, read here):
//   Jaar | Maand (jan feb mrt apr mei jun jul aug sep okt nov dec) | Segment (Woning = home, Onderneming = business) | Energietype (Elektriciteit, Gas)
//   | Contracttype (Afname = supply to the customer; Injectie/Teruglevering = feed-in) | Handelsnaam (supplier) | Productnaam | Vast/variabel/dynamisch
//   | Prijsonderdeel (one price component per row) | Prijs (number).
// Price components used: "Enkelvoudige meter dagtarief (c€/kWh)" (energy cost, single meter), "Kosten groene stroom (c€/kWh)", "Kosten WKK (c€/kWh)",
// "Vaste vergoeding (€)" (fixed fee per year). All excl. VAT, excl. grid fees, taxes and levies (the workbook's Info sheet says so).
// A posted OFFER of a supplier, never a price any household paid.

import { unzipAll, parseSharedStrings, parseSheetXml, type Cell } from "../../categories/rent/xlsx";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, retryOnce } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";
import { percentile, MIN_PUBLISH } from "../../lib/stats";

export const PAGE_URL = "https://www.vlaamsenutsregulator.be/cijfers/v-test-data-en-energieprijscurves";
const BRON = "Bron: Vlaamse Nutsregulator (VREG), V-test open data. Bevat overheidsinformatie, verkregen onder de modellicentie voor gratis hergebruik Vlaanderen v1.0.";

export const INFO: SourceInfo = {
  id: "be-vreg-energy",
  country: "BE (Flanders)",
  category: "energy (supplier offers, fixed-price products)",
  name: "Fixed-price electricity and gas offers for homes in Flanders (VREG V-test open data)",
  publisher: "Vlaamse Nutsregulator (VREG, the Flemish energy regulator)",
  what_is_recorded:
    "Every fixed-price electricity and gas product for homes that suppliers listed in the Flemish V-test price comparison in a month: the energy cost per kWh for a single meter (day tariff), " +
    "the green-certificate and combined-heat-and-power certificate costs, and the fixed fee per year. Excluding VAT, grid fees, taxes and levies.",
  price_type: "posted_price",
  freshness: "Monthly (the regulator refreshes the workbook around the middle of each month); each answer states the month it is for",
  licence:
    "Modellicentie voor gratis hergebruik Vlaanderen v1.0 (Flemish government free-reuse model licence): worldwide, free, non-exclusive right to reuse for any lawful purpose, " +
    "including commercial exploitation, with attribution and without suggesting that we act on behalf of the regulator. Read on the regulator's disclaimer page on 2026-10-24.",
  licence_url: "https://www.vlaamsenutsregulator.be/disclaimer",
  attribution:
    `${BRON} The median, the range, the change on the previous month and the ranking of suppliers are calculated by ProofPrice from the listed offers. ProofPrice is not the Vlaamse Nutsregulator and does not act on its behalf.`,
  homepage: "https://www.vlaamsenutsregulator.be/cijfers/v-test-data-en-energieprijscurves",
  limits:
    "Posted OFFERS of suppliers (the price they ask a new customer), not prices customers paid, and not a quote. Fixed-price products only: variable and dynamic products are priced by formulas and are not included. " +
    "Energy cost only: no grid fees, taxes, levies or VAT, so it is not a household's bill per kWh. One product is one record, so a supplier with several products counts several times. " +
    "Homes only (not businesses), supply to the customer only (not feed-in). Flanders only: Wallonia and Brussels have other regulators.",
};

export type Energy = "electricity" | "gas";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface Offer {
  year: number;
  month: number; // 1-12
  energy: Energy;
  supplier: string;
  product: string;
  /** c EUR per kWh (day tariff, green certificates, CHP certificates) or EUR per year (fixed fee). */
  component: "day" | "green" | "chp" | "fee";
  price: number;
}

const COMPONENT = (label: string): Offer["component"] | null => {
  if (/^Enkelvoudige meter dagtarief/i.test(label)) return "day";
  if (/^Kosten groene stroom/i.test(label)) return "green";
  if (/^Kosten WKK/i.test(label)) return "chp";
  if (/^Vaste vergoeding \(€\)/i.test(label)) return "fee";
  return null;
};

const text = (c: Cell | undefined) => (c === null || c === undefined ? "" : String(c)).trim();

/** Pure: the fixed-price home supply offers from the sheets of the workbook ("Vast" sheets with the 10 expected columns). */
export function parseOffers(sheets: { name: string; rows: Cell[][] }[]): Offer[] {
  const out: Offer[] = [];
  let seenSheet = false;
  for (const sheet of sheets) {
    if (!/vast/i.test(sheet.name) || /var/i.test(sheet.name)) continue;
    const head = (sheet.rows[0] ?? []).map(text);
    const want = ["Jaar", "Maand", "Segment", "Energietype", "Contracttype", "Handelsnaam", "Productnaam", "Vast/variabel/dynamisch", "Prijsonderdeel", "Prijs"];
    if (want.some((w, i) => head[i] !== w)) {
      throw new SourceError(`The columns of the VREG fixed-price sheet "${sheet.name}" changed (${head.slice(0, 10).join(" | ")}); this source needs updating.`);
    }
    seenSheet = true;
    for (const r of sheet.rows.slice(1)) {
      if (text(r[2]) !== "Woning" || text(r[4]) !== "Afname" || text(r[7]) !== "Vast") continue;
      const et = text(r[3]);
      const energy: Energy | null = et === "Elektriciteit" ? "electricity" : et === "Gas" ? "gas" : null;
      const component = COMPONENT(text(r[8]));
      const month = MONTHS[text(r[1]).toLowerCase()];
      const year = Number(text(r[0]));
      const price = typeof r[9] === "number" ? r[9] : Number(text(r[9]));
      if (!energy || !component || !month || !Number.isFinite(year) || !Number.isFinite(price) || price < 0) continue;
      out.push({ year, month, energy, supplier: text(r[5]), product: text(r[6]), component, price });
    }
  }
  if (!seenSheet) throw new SourceError("The VREG workbook has no fixed-price (\"Vast\") sheet any more; this source needs updating.");
  return out;
}

// ---------- fetching ----------

async function get(url: string, kind: "text" | "binary", timeoutMs: number): Promise<string | Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return kind === "text" ? await res.text() : Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** Pure: the workbook link on the V-test data page (the month folder and the VersionId change, so it is read from the page every time). */
export function workbookUrl(html: string): string {
  for (const m of html.matchAll(/href="(https:\/\/assets\.vlaamsenutsregulator\.be\/[^"]*?v-test-data-exclbtw[^"]*?\.xlsx[^"]*)"/gi)) {
    return m[1].replace(/&amp;/g, "&").replace(/ /g, "%20");
  }
  throw new SourceError("The VREG V-test data page no longer links the open-data workbook; this source needs updating.");
}

/** Pure: sheets of an .xlsx, reading only the fixed-price ones (the variable-product sheets are 30 MB of XML and not used). */
export function readFixedSheets(buf: Buffer): { name: string; rows: Cell[][] }[] {
  const files = unzipAll(buf);
  const wb = files.get("xl/workbook.xml")?.toString("utf8");
  if (!wb) throw new SourceError("Not an Excel workbook (xl/workbook.xml missing)");
  const rels = new Map<string, string>();
  for (const m of (files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "").matchAll(/<Relationship\s[^>]*?\/?>/g)) {
    const id = /\sId="([^"]*)"/.exec(m[0])?.[1];
    const target = /\sTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const out: { name: string; rows: Cell[][] }[] = [];
  let index = 0;
  for (const m of wb.matchAll(/<sheet\s[^>]*?\/?>/g)) {
    index++;
    const name = (/\sname="([^"]*)"/.exec(m[0])?.[1] ?? "").replace(/&amp;/g, "&");
    if (!/vast/i.test(name) || /var/i.test(name)) continue;
    const rid = /\sr:id="([^"]*)"/.exec(m[0])?.[1];
    const xml = files.get((rid && rels.get(rid)) || `xl/worksheets/sheet${index}.xml`)?.toString("utf8");
    if (xml) out.push({ name, rows: parseSheetXml(xml, shared) });
  }
  return out;
}

export type Loader = () => Promise<Offer[]>;

/** Page -> workbook link -> workbook -> offers. Two attempts inside the 20 s answer budget. */
export async function loadOffers(): Promise<Offer[]> {
  return retryOnce(async () => {
    const html = (await get(PAGE_URL, "text", 5000)) as string;
    const buf = (await get(workbookUrl(html), "binary", 9000)) as Buffer;
    return parseOffers(readFixedSheets(buf));
  });
}

// ---------- the figure ----------

export function normaliseEnergy(raw?: string): Energy {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "electricity" || s === "gas") return s;
  throw new InputError('energy must be "electricity" or "gas".');
}

const ym = (o: { year: number; month: number }) => o.year * 12 + o.month;
const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month]} ${year}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function median(values: number[]): number | null {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? percentile(s, 0.5) : null;
}

/** One value per product (supplier + product name) for one component, energy and month; the lowest if a product is listed twice. */
function perProduct(offers: Offer[], energy: Energy, component: Offer["component"], year: number, month: number): Map<string, { supplier: string; product: string; price: number }> {
  const m = new Map<string, { supplier: string; product: string; price: number }>();
  for (const o of offers) {
    if (o.energy !== energy || o.component !== component || o.year !== year || o.month !== month) continue;
    const k = `${o.supplier}\u0000${o.product}`;
    const prev = m.get(k);
    if (!prev || o.price < prev.price) m.set(k, { supplier: o.supplier, product: o.product, price: o.price });
  }
  return m;
}

/** The newest month that has day-tariff offers for this energy. */
export function latestMonth(offers: Offer[], energy: Energy): { year: number; month: number } | null {
  let best: { year: number; month: number } | null = null;
  for (const o of offers) if (o.energy === energy && o.component === "day" && (!best || ym(o) > ym(best))) best = { year: o.year, month: o.month };
  return best;
}

export function beMethod(): string {
  return (
    "The Flemish energy regulator (VREG) publishes every product that suppliers listed in its V-test price comparison, month by month, as an open-data workbook. " +
    "We read the fixed-price products for homes (supply to the customer) of the newest month and take the single-meter energy cost per kWh of each product, excluding VAT, grid fees, taxes and levies. " +
    "The answer is the median and the 10th to 90th percentile of those listed offers, one per product. These are suppliers' posted offers, not prices customers paid."
  );
}

/** Pure: the answer for one energy from the parsed offers. */
export function offersAnswer(offers: Offer[], q: { energy: Energy; baseUrl?: string }): PriceAnswer {
  const query = { country: "BE", energy: q.energy, supplier_offers: true };
  const latest = latestMonth(offers, q.energy);
  const unit = "per kWh, energy cost excl. VAT, grid fees and taxes";
  if (!latest) {
    return buildAnswer({ source: INFO, query, summary: null, currency: "EUR", unit, period: { from: null, to: null }, method: beMethod(), baseUrl: q.baseUrl, describe: () => "" });
  }
  const { year, month } = latest;
  const day = perProduct(offers, q.energy, "day", year, month);
  const eur = [...day.values()].map((p) => p.price / 100).sort((a, b) => a - b);
  const summary = eur.length
    ? { count: eur.length, median: percentile(eur, 0.5), low: percentile(eur, 0.1), high: percentile(eur, 0.9), min: eur[0], max: eur[eur.length - 1] }
    : null;
  const prevYm = ym(latest) - 1;
  const py = Math.floor((prevYm - 1) / 12);
  const pm = prevYm - py * 12;
  const prevDay = perProduct(offers, q.energy, "day", py, pm);
  const prevMedian = prevDay.size >= MIN_PUBLISH ? median([...prevDay.values()].map((p) => p.price / 100)) : null;
  const changePct = prevMedian && summary ? Math.round(((summary.median - prevMedian) / prevMedian) * 1000) / 10 : null;

  // cheapest product per supplier, cheapest supplier first (companies and their listed products, no personal data)
  const bySupplier = new Map<string, { product: string; price: number; products: number }>();
  for (const p of day.values()) {
    const cur = bySupplier.get(p.supplier);
    if (!cur) bySupplier.set(p.supplier, { product: p.product, price: p.price, products: 1 });
    else {
      cur.products++;
      if (p.price < cur.price) { cur.product = p.product; cur.price = p.price; }
    }
  }
  const suppliers = [...bySupplier.entries()]
    .map(([supplier, v]) => ({ supplier, cheapest_product: v.product, cheapest_eur_per_kwh: r4(v.price / 100), products_listed: v.products }))
    .sort((a, b) => a.cheapest_eur_per_kwh - b.cheapest_eur_per_kwh)
    .slice(0, 15);

  const fee = median([...perProduct(offers, q.energy, "fee", year, month).values()].map((p) => p.price));
  const green = q.energy === "electricity" ? median([...perProduct(offers, q.energy, "green", year, month).values()].map((p) => p.price / 100)) : null;
  const chp = q.energy === "electricity" ? median([...perProduct(offers, q.energy, "chp", year, month).values()].map((p) => p.price / 100)) : null;

  const label = monthLabel(year, month);
  return buildAnswer({
    source: INFO,
    query,
    summary,
    currency: "EUR",
    unit,
    period: { from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)) },
    method: beMethod(),
    baseUrl: q.baseUrl,
    evidence: {
      label: "Suppliers' posted fixed-price offers (not a receipt)",
      meaning: "The price per kWh that each supplier's fixed-price product for homes was listed at in the Flemish V-test in the month. An offer to a new customer, before grid fees, taxes and VAT; not what anyone paid.",
    },
    describe: (s) =>
      `Fixed-price ${q.energy} offers for homes in Flanders in ${label}: median energy cost ${r4(s.median)} EUR per kWh (${r2(s.median * 100)} cents), 10th to 90th percentile ${r4(s.low)} to ${r4(s.high)} EUR, ` +
      `across ${s.count} listed products, excluding VAT, grid fees, taxes and levies.` +
      (changePct !== null ? ` The median is ${changePct === 0 ? "unchanged" : `${Math.abs(changePct)}% ${changePct > 0 ? "higher" : "lower"}`} than in the previous month.` : ""),
    extra: {
      energy: q.energy,
      meter: "single meter, day tariff",
      reference_period_label: label,
      products_listed: day.size,
      suppliers_listed: bySupplier.size,
      fixed_fee_median_eur_per_year: fee === null ? null : r2(fee),
      ...(q.energy === "electricity"
        ? { green_certificate_cost_median_eur_per_kwh: green === null ? null : r4(green), chp_certificate_cost_median_eur_per_kwh: chp === null ? null : r4(chp), certificate_costs_note: "Listed by the regulator as separate lines; not added to the headline figure." }
        : {}),
      previous_period: prevMedian === null ? null : { reference_period: monthLabel(py, pm), median_eur_per_kwh: r4(prevMedian), products_listed: prevDay.size, median_change_percent: changePct },
      cheapest_suppliers: suppliers,
      price_basis: "posted offers of suppliers (fixed-price products for homes, supply to the customer), one record per product, excluding VAT, grid fees, taxes and levies",
      attribution_notice: BRON,
    },
  });
}

export async function beOffers(input: { energy?: string; baseUrl?: string }, loader: Loader = loadOffers): Promise<PriceAnswer> {
  const energy = normaliseEnergy(input.energy);
  return offersAnswer(await loader(), { energy, baseUrl: input.baseUrl });
}

// ---------- daily collector copy (harvest) and history keys ----------
// The collector stores, once a day, the newest month's fixed-price day-tariff offers as one aggregate row per energy (area ALL), dated by the first
// day of the month they are for (referenceDates). If the regulator's site cannot be reached, runCategory answers from this copy for up to 7 days.
// Aggregates only; each row is a median over at least 5 listed products.

export function harvestFromOffers(offers: Offer[]): HarvestResult {
  const rows: DailyRow[] = [];
  let date = "";
  for (const energy of ["electricity", "gas"] as Energy[]) {
    const latest = latestMonth(offers, energy);
    if (!latest) continue;
    const prices = [...perProduct(offers, energy, "day", latest.year, latest.month).values()].map((p) => p.price / 100).sort((a, b) => a - b);
    if (prices.length < MIN_PUBLISH) continue;
    const d = iso(latest.year, latest.month, 1);
    if (!date || d > date) date = d;
    rows.push({ area: NATIONAL, item: energy, n: prices.length, median: r4(percentile(prices, 0.5)), low: r4(percentile(prices, 0.1)), high: r4(percentile(prices, 0.9)), min: r4(prices[0]), max: r4(prices[prices.length - 1]) });
  }
  if (!rows.length || !date) throw new SourceError("The VREG workbook holds no month with at least 5 fixed-price home offers; this source needs updating.");
  return {
    date,
    currency: "EUR",
    unit: "per kWh, energy cost excl. VAT, grid fees and taxes",
    rows,
    note: "Flemish regulator (VREG) V-test open data: median of the fixed-price home electricity and gas offers (single-meter energy cost) listed in the newest month. Posted offers, not prices paid.",
  };
}

export async function beHarvest(loader: Loader = loadOffers): Promise<HarvestResult> {
  return harvestFromOffers(await loader());
}

export function beHistoryKey(p: { energy?: string }): { area: string; item: string; label: string } | null {
  try {
    return { area: NATIONAL, item: normaliseEnergy(p.energy), label: "Flanders, fixed-price home offers" };
  } catch {
    return null;
  }
}
