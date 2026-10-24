// Chile ODEPA "Precios al Consumidor" (Oficina de Estudios y Politicas Agrarias, Ministry of Agriculture): each week ODEPA staff record the shelf price of
// everyday foods (bread, milk, eggs, meat, fruit, vegetables, pantry goods) in shops and street markets of 9 regions and publish, for every region, sector
// (town or zone), type of shop, product and unit, the minimum, maximum and average price in Chilean pesos. These are POSTED shelf prices (not receipts, not what one
// shopper paid) and the publisher does not say how many quotes sit behind each average.
// The portal is CKAN: one datastore table per year (about 265 000 rows in 2026). We never read it per request: the daily collector (harvest) asks the datastore for the
// newest 4 weeks, keeps for every monitored point (region + sector + shop type) and product its newest weekly average, and stores one aggregate per region and product
// across those points. "n" is the number of monitored points, not a number of shops or sales; answers say so.

import { ckanAll, ckanPackage, ckanSearch } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "cl-odepa-groceries",
  country: "Chile",
  category: "groceries (weekly shop shelf prices of everyday food)",
  name: "Precios al Consumidor (ODEPA)",
  publisher: "Oficina de Estudios y Politicas Agrarias (ODEPA), Ministerio de Agricultura, via datos.odepa.gob.cl",
  what_is_recorded:
    "The shelf price of one food product and unit (for example 'Leche Fluida Entera, caja de 1 litro') recorded by ODEPA staff in supermarkets, butchers, bakeries and street markets of one sector (town or zone) in one week, as a minimum, maximum and average, in Chilean pesos.",
  price_type: "posted_price",
  freshness: "Weekly (newest completed week)",
  licence: "Creative Commons Attribution (CC BY), as stated by the publisher's open-data portal",
  licence_url: "https://opendefinition.org/licenses/cc-by/",
  attribution:
    "Source: ODEPA (Oficina de Estudios y Politicas Agrarias, Chile), Precios al Consumidor, datos.odepa.gob.cl, CC BY. Accessed by ProofPrice; changed by ProofPrice: for each product and unit we take the newest weekly average of every monitored point over 4 weeks and report the median and 10th to 90th percentile across points, by region. Not endorsed by ODEPA.",
  homepage: "https://datos.odepa.gob.cl/dataset/precios-consumidor",
  limits:
    "Posted shelf prices that ODEPA staff recorded, not receipts and not what one shopper paid. Only 9 of Chile's 16 regions are monitored. ODEPA publishes an average per sector and shop type " +
    "without saying how many quotes are behind it, so the sample size we report is the number of monitored points (a sector and shop type with an average), and a region needs 5 or more. " +
    "Brands are pooled. Points with an average more than 4 times above or below the product's national median are dropped as entry errors.",
};

export const SITE = "https://datos.odepa.gob.cl";
export const PACKAGE = "precios-consumidor";
export const WEEKS = 4; // newest weeks read: a monitored point counts with its newest average in this window
export const KEEP_ITEMS = 150; // products (name + unit) kept in the library: the ones priced at the most monitored points
export const OUTLIER_FACTOR = 4;
export const STALE_AFTER_DAYS = 14;

/** Plain-text normalisation: lower case, no accents, single spaces. */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** "11890,000000" -> 11890; "2850" -> 2850; junk -> NaN. */
export function parseNumber(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!s) return NaN;
  return Number(s.replace(",", "."));
}

/** "Región de Ñuble" -> "Ñuble", "Región Metropolitana de Santiago" -> "Metropolitana de Santiago", "Región del Biobío" -> "Biobío". */
export function regionName(raw: string): string {
  const s = raw.trim().replace(/^regi[oó]n\s+(del?\s+|de\s+la\s+)?/i, "");
  return s || raw.trim();
}

/** Product + unit key stored in the library. ODEPA names fruit and vegetables "Species|Variety|Quality": the bars become " / " so the key stays one cell. */
export function itemKey(product: string, unit: string): string {
  const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, " ").replace(/\s*\|\s*/g, " / ");
  return `${clean(product)}|${clean(unit)}`;
}

/** The unit as a phrase: "$/kilo" -> "kilo", "$/Caja de 1 Litro" -> "Caja de 1 Litro". */
export function unitPhrase(unit: string): string {
  return unit.replace(/^\$\s*\/\s*/, "").trim() || unit.trim();
}

export interface OdepaRow {
  Fecha_inicio?: string;
  [k: string]: unknown;
}

export interface Seen { week: string; price: number; item: string; region: string }

/** Keeps, for every monitored point (region + sector + shop type) and item, the newest weekly average. */
export class Newest {
  private map = new Map<string, Seen>();
  newestWeek = "";
  rows = 0;
  kept = 0;
  add(point: string, item: string, region: string, week: string, price: number): void {
    this.kept++;
    if (week > this.newestWeek) this.newestWeek = week;
    const k = `${point}\u0000${item}`;
    const cur = this.map.get(k);
    if (!cur || week > cur.week) this.map.set(k, { week, price, item, region });
  }
  get size(): number { return this.map.size; }
  entries(): Seen[] { return [...this.map.values()]; }
}

/** Read datastore records (field names as ODEPA publishes them) into the collector's memory. Rows without a positive average, a date, a product or a region are skipped. */
export function readRecords(records: Record<string, any>[], into: Newest): void {
  for (const r of records) {
    into.rows++;
    const price = parseNumber(r["Precio promedio"]);
    const week = String(r["Fecha inicio"] ?? "").slice(0, 10);
    const product = String(r["Producto"] ?? "").trim(), unit = String(r["Unidad"] ?? "").trim();
    const region = regionName(String(r["Region"] ?? ""));
    if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !product || !unit || !region) continue;
    const point = [region, r["Sector"], r["Tipo de punto monitoreo"]].map((x) => String(x ?? "").trim().toLowerCase()).join("~");
    into.add(point, itemKey(product, unit), region, week, price);
  }
}

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

export interface Built { rows: DailyRow[]; date: string | null; items: number; regions: string[]; dropped: { outliers: number } }

/** Library rows for the newest week: area = region (or ALL), item = "<product>|<unit>"; n = monitored points. Keeps the KEEP_ITEMS products found at the most points. */
export function buildRows(entries: Seen[], newestWeek: string, keepItems = KEEP_ITEMS): Built {
  if (!newestWeek) return { rows: [], date: null, items: 0, regions: [], dropped: { outliers: 0 } };
  const cutoff = dayNumber(newestWeek) - 7 * (WEEKS - 1);
  const recent = entries.filter((e) => dayNumber(e.week) >= cutoff);
  const perItem = new Map<string, number[]>();
  for (const e of recent) {
    const a = perItem.get(e.item);
    if (a) a.push(e.price); else perItem.set(e.item, [e.price]);
  }
  const top = [...perItem].filter(([, p]) => p.length >= MIN_PUBLISH).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, keepItems);
  const medians = new Map<string, number>();
  for (const [key, prices] of top) {
    const s = [...prices].sort((a, b) => a - b);
    medians.set(key, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  }
  let outliers = 0;
  const recs: { area: string; item: string; price: number }[] = [];
  for (const e of recent) {
    const med = medians.get(e.item);
    if (med === undefined) continue;
    if (e.price > med * OUTLIER_FACTOR || e.price < med / OUTLIER_FACTOR) { outliers++; continue; }
    recs.push({ area: e.region, item: e.item, price: e.price });
  }
  const rows = aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH);
  const regions = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  // the figures describe the newest week; its Friday is the last day the prices were recorded
  return { rows, date: isoOf(dayNumber(newestWeek) + 4), items: new Set(rows.map((r) => r.item)).size, regions, dropped: { outliers } };
}

/** Yearly datastore tables of the dataset, newest year first: [{ year, id }]. Names read "Detalle de Precios Consumidor año 2026". */
export function yearTables(resources: { id: string; name: string; datastoreActive: boolean }[]): { year: number; id: string }[] {
  const out: { year: number; id: string }[] = [];
  for (const r of resources) {
    if (!r.datastoreActive) continue;
    const m = /(20\d{2})\s*$/.exec(r.name.trim());
    if (m) out.push({ year: Number(m[1]), id: r.id });
  }
  return out.sort((a, b) => b.year - a.year);
}

/** The (year, week number) pairs to read, newest first: week 2 of 2026 is followed by week 1, then weeks 52 and 51 of 2025. */
export function weeksToRead(year: number, week: number, count = WEEKS): { year: number; week: number }[] {
  const out: { year: number; week: number }[] = [];
  let y = year, w = week;
  for (let i = 0; i < count; i++) {
    out.push({ year: y, week: w });
    w--;
    if (w < 1) { y--; w = 52; }
  }
  return out;
}

export async function odepaHarvest(): Promise<HarvestResult> {
  const pkg = await ckanPackage(SITE, PACKAGE, { timeoutMs: 60000 });
  const tables = yearTables(pkg.resources);
  if (!tables.length) throw new SourceError("ODEPA dataset lists no yearly price tables (layout changed?)");
  const newestTable = tables[0];
  // the newest rows tell us which week is current (an upload can add several regions of one week at a time)
  const head = await ckanSearch(SITE, { resourceId: newestTable.id, limit: 500, sort: "_id desc", fields: ["Anio", "Semana", "Fecha inicio"], includeTotal: false }, { timeoutMs: 60000 });
  let best: { year: number; week: number; date: string } | null = null;
  for (const r of head.records) {
    const date = String(r["Fecha inicio"] ?? "").slice(0, 10);
    const year = Number(r["Anio"]), week = Number(r["Semana"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(year > 2000) || !(week >= 1)) continue;
    if (!best || date > best.date) best = { year, week, date };
  }
  if (!best) throw new SourceError("ODEPA price table returned no recent rows");
  const newest = new Newest();
  let weeksRead = 0;
  for (const w of weeksToRead(best.year, best.week)) {
    const table = tables.find((t) => t.year === w.year);
    if (!table) continue;
    const got = await ckanAll(SITE, { resourceId: table.id, filters: { Anio: String(w.year), Semana: String(w.week) }, sort: "_id asc", includeTotal: false }, { pageSize: 32000, maxRows: 50000, timeoutMs: 90000 });
    if (got.rows.length) weeksRead++;
    readRecords(got.rows, newest);
  }
  const built = buildRows(newest.entries(), newest.newestWeek);
  if (!built.rows.length || !built.date) throw new SourceError(`ODEPA tables held no usable prices (${newest.rows} rows read, ${newest.kept} kept)`);
  return {
    date: built.date,
    currency: "CLP",
    unit: "per unit named in the item",
    rows: built.rows,
    note: `${weeksRead} weeks, ${newest.rows} rows read, ${newest.kept} kept, ${newest.size} monitored points and products; newest week starts ${newest.newestWeek}; ${built.items} products, ${built.regions.length} regions; ${built.dropped.outliers} outlier averages dropped.`,
  };
}

// ---------- matching (Spanish names; English words through a small gloss) ----------
export const GLOSS: Record<string, string> = {
  leche: "milk", huevo: "egg eggs", pollo: "chicken", arroz: "rice", azucar: "sugar", aceite: "oil", pan: "bread", marraqueta: "bread", hallulla: "bread roll",
  papa: "potato potatoes", tomate: "tomato tomatoes", cebolla: "onion onions", zanahoria: "carrot carrots", lechuga: "lettuce", palta: "avocado", limon: "lemon lime",
  manzana: "apple apples", platano: "banana bananas", naranja: "orange oranges", pera: "pear pears", uva: "grape grapes", frutilla: "strawberry strawberries",
  sandia: "watermelon", durazno: "peach", melon: "melon", zapallo: "pumpkin squash", pepino: "cucumber", pimiento: "pepper capsicum", choclo: "corn", ajo: "garlic",
  queso: "cheese", mantequilla: "butter", margarina: "margarine", yoghurt: "yogurt yoghurt", carne: "meat beef", vacuno: "beef", cerdo: "pork", cordero: "lamb",
  harina: "flour", fideos: "pasta noodles spaghetti", lenteja: "lentils", lentejas: "lentils", porotos: "beans", garbanzos: "chickpeas", sal: "salt", cafe: "coffee", te: "tea",
  atun: "tuna", jurel: "mackerel", merluza: "hake", salmon: "salmon", entera: "whole full fat", descremada: "skimmed skim", polvo: "powder powdered", fluida: "fresh liquid",
  blanco: "white", color: "brown coloured colored", grande: "large", primera: "first grade", segunda: "second grade", charqui: "jerky", pavo: "turkey",
  cerveza: "beer", vino: "wine", jugo: "juice", bebida: "soft drink soda", agua: "water", chocolate: "chocolate", galletas: "biscuits cookies cookies", cereal: "cereal",
};
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "kg", "in", "chile", "how", "much", "is", "for", "retail", "de", "del", "la", "el", "un", "una", "precio", "precios", "kilo"]);
const QUERY_SYNONYMS: Record<string, string> = { eggs: "egg", chilies: "chilli", potatoes: "potato", tomatoes: "tomato", huevos: "huevo", paltas: "palta" };

export interface Def { key: string; name: string; unit: string; n: number; row: DailyRow }

export function parseKey(key: string): { name: string; unit: string } | null {
  const p = key.split("|");
  return p.length === 2 ? { name: p[0], unit: p[1] } : null;
}

function wordsOf(name: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(name).split(" ").filter(Boolean)) {
    out.add(stem(w));
    const g = GLOSS[w] ?? GLOSS[stem(w)];
    if (g) for (const e of g.split(" ")) out.add(stem(e));
  }
  return out;
}

/** Products matching a question in English or Spanish, best first: every query word must be a word of the name or its English gloss; shorter names (more generic) rank higher. */
export function matchItems(defs: Def[], query: string): Def[] {
  const words = norm(query).split(" ").filter((w) => w && !STOP.has(w)).map((w) => stem(QUERY_SYNONYMS[w] ?? w));
  if (!words.length) return [];
  const scored: { d: Def; s: number }[] = [];
  for (const d of defs) {
    const own = norm(d.name).split(" ").filter(Boolean);
    const has = wordsOf(d.name);
    if (!words.every((w) => has.has(w))) continue;
    scored.push({ d, s: 100 - 4 * Math.max(0, own.length - words.length) });
  }
  return scored.sort((a, b) => b.s - a.s || b.d.n - a.d.n || a.d.key.localeCompare(b.d.key)).map((x) => x.d);
}

export function defsFor(rows: DailyRow[], area: string): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== area || r.n < MIN_PUBLISH) continue;
    const k = parseKey(r.item);
    if (k) out.push({ key: r.item, ...k, n: r.n, row: r });
  }
  return out;
}

const REGION_ALIASES: Record<string, string> = {
  rm: "metropolitana", santiago: "metropolitana", "region metropolitana": "metropolitana", "gran santiago": "metropolitana",
  "arica": "arica y parinacota", "bio bio": "biobio", araucania: "la araucania",
};

/** The library's region name for what the caller typed, or null. */
export function resolveRegion(rows: DailyRow[], region: string): string | null {
  const regions = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q0 = norm(region).replace(/^region (de |del |de la )?/, "");
  const q = REGION_ALIASES[q0] ?? q0;
  if (!q) return null;
  return regions.find((s) => norm(s) === q) ?? regions.find((s) => norm(s).includes(q)) ?? null;
}

function methodText() {
  return (
    "Median and 10th–90th percentile, across monitored points (a sector and shop type), of each point's newest weekly average price for the product and unit in ODEPA's Precios al Consumidor over the last 4 weeks, in Chilean pesos. " +
    "Posted shelf prices recorded by ODEPA staff, not receipts; brands are pooled; n is the number of monitored points (5 or more needed), not a number of shops or sales."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function odepaAnswerFromRows(day: LibraryDay, input: { item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday food in plain words such as 'milk', 'eggs', 'bread', 'tomato', 'potato', 'chicken' or 'leche'.");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let place = "Chile (monitored regions)";
  if (region) {
    const r = resolveRegion(day.rows, region);
    if (!r) {
      const regions = [...new Set(day.rows.map((x) => x.area))].filter((a) => a !== NATIONAL).sort();
      throw new InputError(`region '${region}' has no figures in our copy (not one of the regions ODEPA monitors, or no product at 5 or more points there). Regions with figures: ${regions.join(", ")}. Leave region out for the figure across all monitored regions.`);
    }
    area = r;
    place = r;
  }
  const from = isoOf(dayNumber(day.date) - 4 - 7 * (WEEKS - 1));
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country: "CL", item, ...(region ? { region } : {}) }, summary: null, currency: "CLP", unit: "per unit",
      period: { from, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  const hits = matchItems(defsFor(day.rows, area), item);
  if (!hits.length) {
    const all = matchItems(defsFor(day.rows, NATIONAL), item);
    const names = [...new Set(defsFor(day.rows, NATIONAL).map((d) => d.name))].sort().slice(0, 30);
    return empty(
      area !== NATIONAL && all.length
        ? `Fewer than 5 monitored points in ${place} priced '${item}' in the last 4 weeks. Leave region out for the figure across all monitored regions.`
        : `No product matching '${item}' is priced at 5 or more monitored points in our copy. Products held include: ${names.join("; ")}.`,
    );
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${unitPhrase(d.unit)}`);
  return buildAnswer({
    source: INFO,
    query: { country: "CL", item: `${best.name}, ${unitPhrase(best.unit)}`, ...(region ? { region: place } : {}) },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "CLP",
    unit: `per ${unitPhrase(best.unit)}`,
    period: { from, to: day.date },
    method: methodText(),
    describe: (x) =>
      `ODEPA shelf prices in ${place} put ${best.name} (${unitPhrase(best.unit)}) at a median of ${fmtMoney(x.median, "CLP")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "CLP")}–${fmtMoney(x.high, "CLP")} across monitored points. ` +
      `These are posted shelf prices recorded by ODEPA staff, not receipts; newest prices are from the week ending ${day.date}.` +
      (stale ? ` The newest data is ${ageDays} days old.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      monitored_points: r.n,
      area: place,
      ...(others.length ? { other_definitions: others } : {}),
      ...(stale ? { stale: true, days_since_newest: ageDays } : {}),
    },
  });
}

export async function odepaPrices(input: { item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the ODEPA price tables daily; data appears after the next collection.");
  return odepaAnswerFromRows(day, input);
}

export function odepaHistoryKey(p: { item?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const area = p.region ? resolveRegion(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchItems(defsFor(day.rows, area), String(p.item))[0];
    return best ? { area, item: best.key, label: `${best.name}, ${area === NATIONAL ? "Chile" : area}` } : null;
  } catch {
    return null;
  }
}
