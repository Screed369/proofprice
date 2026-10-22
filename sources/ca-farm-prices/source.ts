// Canada: monthly prices received by farmers for crops and livestock, by province, from Statistics Canada table 32-10-0077-01
// ("Farm product prices, crops and livestock"; CANSIM 002-0043), read through the key-free Web Data Service (WDS).
// Formats checked live on 2026-10-18 through a Vercel preview (see fixtures.ts). Dimensions: 1 Geography (ten provinces; there is NO
// Canada total), 2 Farm products (46 members, a few terminated). Monthly since January 1980. The unit differs by product (per metric tonne
// for grains and oilseeds, per hundredweight for cattle, hogs and potatoes, per kilolitre for milk, per dozen for eggs) and is NOT a
// dimension: it is a property of each series, so we read it from WDS (getSeriesInfoFromVector -> memberUomCode, getCodeSets -> name).
// Statistics Canada publishes ONE average per product, province and month: no distribution and no count, so every answer is an official
// statistic (value + measure "average", range fields null, sample_size null). A request is four small calls, cached in memory.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import {
  CubeDimension, CubeMember, DataSeries, Poster, WDS_BASE, WDS_USER_AGENT, changePercent, coordinate, dimension, latestPeriods, loadCubeMeta, memberByName,
  monthOf, monthRange, monthWords, monthsBehind, newestUsable, roundTo, shiftMonth, usable, wdsPost,
} from "../_ca-statcan/wds";
import { OPEN_LICENCE_TEXT, OPEN_LICENCE_URL, openLicenceAttribution, openLicenceNotice } from "../_ca-statcan/licence";
import { plain, provinceFor } from "../_ca-statcan/geo";

export const PRODUCT_ID = 32100077;
export const TABLE_NAME = "Table 32-10-0077-01 Farm product prices, crops and livestock";

export const INFO: SourceInfo = {
  id: "ca-farm-prices",
  country: "CA (Canada)",
  category: "farm-gate prices (monthly prices received by farmers, by province)",
  name: "Farm product prices, crops and livestock (Statistics Canada table 32-10-0077-01)",
  publisher: "Statistics Canada",
  what_is_recorded:
    "For about 35 crops and livestock products (wheat, durum, oats, barley, soybeans, corn, canola, flaxseed, lentils, potatoes, cattle, hogs, lambs, chickens, turkeys, milk, eggs ...) the average price farmers received each month in each of the ten provinces, " +
    "from Statistics Canada's farm product price survey and administrative data. One published average per product, province and month; never a farm or a sale.",
  price_type: "official_statistic",
  freshness:
    "Monthly, not live: Statistics Canada publishes each month's averages about six weeks after the month ends (August 2026 was released on 9 October 2026), and every answer states its reference month",
  licence: OPEN_LICENCE_TEXT,
  licence_url: OPEN_LICENCE_URL,
  attribution: openLicenceAttribution(TABLE_NAME),
  homepage: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210007701",
  limits:
    "A monthly average price received by farmers for one product in one province, not a range and not the price on one farm: Statistics Canada gives no distribution and no count of sales. " +
    "There is no Canada total in this table, so a province is needed. Not every product is published for every province or month (confidential or too unreliable figures are blank). " +
    "Prices are in Canadian dollars in the unit Statistics Canada states for each series (per metric tonne, per hundredweight, per kilolitre, per dozen); we do not convert hundredweights because the table does not define the weight. " +
    "Grain prices are what farmers received at delivery, not futures or export prices. Figures are revised.",
};

// ---------- the products: everyday words -> the table's member names ----------

export interface ProductDef {
  /** The table's own member name; the live table is matched on it, so a renamed product is noticed. */
  label: string;
  words: string[];
}
const P = (label: string, words: string): ProductDef => ({ label, words: words.split("|").map((w) => w.trim()) });

/** The live (not terminated) products of table 32-10-0077-01 on 2026-10-18. The first definition that lists a word is the default for it. */
export const PRODUCTS: ProductDef[] = [
  P("Wheat (except durum wheat)", "wheat|spring wheat|bread wheat|common wheat"),
  P("Wheat (except durum wheat), milling", "milling wheat|wheat milling"),
  P("Wheat (except durum wheat), other", "feed wheat|other wheat|wheat other"),
  P("Durum wheat", "durum|durum wheat"),
  P("Oats", "oats|oat"),
  P("Barley", "barley"),
  P("Barley for animal feed", "feed barley|barley for feed|barley for animal feed"),
  P("Barley for malt and other human consumption", "malt barley|malting barley|barley for malt"),
  P("Soybeans", "soybeans|soybean|soya|soya beans|soy"),
  P("Corn for grain", "corn|grain corn|maize|corn for grain"),
  P("Flaxseed", "flaxseed|flax"),
  P("Canola (including rapeseed)", "canola|rapeseed|canola seed"),
  P("Rye", "rye"),
  P("Lentils", "lentils|lentil"),
  P("Dry peas", "dry peas|peas|field peas"),
  P("Canary seeds", "canary seed|canary seeds"),
  P("Fresh potatoes", "potatoes|potato|fresh potatoes"),
  P("Fresh potatoes for seed", "seed potatoes"),
  P("Fresh potatoes for table consumption", "table potatoes"),
  P("Fresh potatoes for processing", "processing potatoes|potatoes for processing|french fry potatoes"),
  P("Cattle for slaughter", "cattle|beef cattle|slaughter cattle|cattle for slaughter|beef"),
  P("Cows for slaughter", "cows|cull cows|cows for slaughter"),
  P("Steers for slaughter", "steers|slaughter steers|steers for slaughter"),
  P("Heifers for slaughter", "heifers|slaughter heifers|heifers for slaughter"),
  P("Calves for slaughter", "calves|veal calves|calves for slaughter"),
  P("Lambs", "lambs|lamb|sheep"),
  P("Cattle for feeding", "feeder cattle|cattle for feeding|stockers"),
  P("Steers for feeding", "feeder steers|steers for feeding"),
  P("Heifers for feeding", "feeder heifers|heifers for feeding"),
  P("Calves for feeding", "feeder calves|calves for feeding"),
  P("Hogs", "hogs|hog|pigs|pig|pork"),
  P("Chickens for meat", "chickens|chicken|broilers|chicken for meat"),
  P("Turkeys for meat", "turkeys|turkey|turkey for meat"),
  P("Unprocessed milk from bovine", "milk|cow milk|raw milk|unprocessed milk|dairy"),
  P("Eggs in shell", "eggs|egg|eggs in shell"),
];

/** A short comma-separated list of everyday words, for the parameter notes. */
export const exampleProducts = (max: number) =>
  PRODUCTS.map((p) => p.words[0]).filter((w, i, a) => a.indexOf(w) === i).slice(0, max).join(", ");

export function matchProduct(query: string): { primary: ProductDef | null; related: ProductDef[] } {
  const q = plain(query);
  if (!q) return { primary: null, related: [] };
  const has = (w: string) => PRODUCTS.find((p) => p.words.map(plain).includes(w));
  let primary = has(q) ?? (q.endsWith("s") ? has(q.slice(0, -1)) : has(`${q}s`)) ?? null;
  if (!primary) {
    // "ontario wheat price" / "price of wheat": the longest known word inside the text, on word boundaries.
    let best: { p: ProductDef; len: number } | null = null;
    for (const p of PRODUCTS) {
      for (const w of p.words.map(plain)) {
        if (w.length >= 3 && ` ${q} `.includes(` ${w} `) && (!best || w.length > best.len)) best = { p, len: w.length };
      }
    }
    primary = best?.p ?? null;
  }
  if (!primary) return { primary: null, related: [] };
  const stem = plain(primary.label).split(" ")[0];
  const related = PRODUCTS.filter((p) => p !== primary && plain(p.label).split(" ")[0] === stem);
  return { primary, related };
}

// ---------- regions ----------

/** Big cities -> their province, so "Saskatoon" is answered with Saskatchewan and says so. Keys are plain(). */
const CITY_PROVINCE: Record<string, string> = {
  toronto: "Ontario", ottawa: "Ontario", london: "Ontario", guelph: "Ontario", hamilton: "Ontario", windsor: "Ontario",
  montreal: "Quebec", "quebec city": "Quebec", sherbrooke: "Quebec", "trois rivieres": "Quebec",
  vancouver: "British Columbia", victoria: "British Columbia", kelowna: "British Columbia", abbotsford: "British Columbia",
  calgary: "Alberta", edmonton: "Alberta", "red deer": "Alberta", lethbridge: "Alberta",
  winnipeg: "Manitoba", brandon: "Manitoba", regina: "Saskatchewan", saskatoon: "Saskatchewan",
  halifax: "Nova Scotia", moncton: "New Brunswick", fredericton: "New Brunswick", charlottetown: "Prince Edward Island", "saint johns": "Newfoundland and Labrador",
};

export function resolveProvince(geo: CubeDimension, region: string): { member: CubeMember; note?: string } {
  const published = geo.members.filter((m) => !m.terminated);
  const names = published.map((m) => m.name).join("; ");
  const raw = region.trim();
  const q = plain(raw).replace(/ canada$/, "");
  const direct = published.find((m) => plain(m.name) === q);
  if (direct) return { member: direct };
  const prov = provinceFor(raw);
  if (prov) {
    const m = published.find((x) => plain(x.name) === plain(prov.name));
    if (m) return { member: m };
  }
  const bits = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const lastProv = bits.length > 1 ? provinceFor(bits[bits.length - 1]) : undefined;
  const provName = lastProv?.name ?? CITY_PROVINCE[plain(bits[0] ?? "")];
  const m = provName ? published.find((x) => plain(x.name) === plain(provName)) : undefined;
  if (m) return { member: m, note: `Statistics Canada publishes provincial averages, not local ones: '${raw}' is answered with the ${m.name} average.` };
  throw new InputError(`'${raw}' is not a region in this table. Statistics Canada publishes the ten provinces: ${names}. Give one of them (a city such as Saskatoon is answered with its province).`);
}

// ---------- units: read from WDS ----------

/** GET a WDS method (getCodeSets is GET only). Tests inject a fake. */
export type Getter = (path: string) => Promise<unknown>;
export const wdsGet: Getter = (path) => fetchJson(`${WDS_BASE}/${path}`, { headers: { "user-agent": WDS_USER_AGENT } }, 20000);

const UOM_TTL_MS = 24 * 3600 * 1000;
let namesCache: { at: number; names: Map<number, string> } | null = null;
export function clearFarmCache(): void {
  namesCache = null;
}
async function uomNames(get: Getter): Promise<Map<number, string>> {
  if (get !== wdsGet) return parseUomNames(await get("getCodeSets"));
  if (namesCache && Date.now() - namesCache.at < UOM_TTL_MS) return namesCache.names;
  const names = parseUomNames(await get("getCodeSets"));
  namesCache = { at: Date.now(), names };
  return names;
}

/** memberUomCode -> English name ("Dollars per metric tonne"), from getCodeSets. */
export function parseUomNames(json: unknown): Map<number, string> {
  const list = (json as any)?.object?.uom;
  if (!Array.isArray(list)) throw new SourceError("Statistics Canada did not return its unit-of-measure list");
  const out = new Map<number, string>();
  for (const u of list) if (typeof u?.memberUomCode === "number" && typeof u?.memberUomEn === "string") out.set(u.memberUomCode, u.memberUomEn);
  return out;
}

/** vectorId -> memberUomCode, from getSeriesInfoFromVector. */
export function parseSeriesUoms(json: unknown): Map<number, number> {
  if (!Array.isArray(json)) throw new SourceError("Statistics Canada did not return the series description");
  const out = new Map<number, number>();
  for (const item of json) {
    const o = item?.object ?? item;
    const v = Number(o?.vectorId);
    const c = Number(o?.memberUomCode);
    if (Number.isFinite(v) && v > 0 && Number.isFinite(c)) out.set(v, c);
  }
  return out;
}

export interface Unit {
  code: number;
  /** "per metric tonne" */
  unit: string;
  /** The published wording: "Dollars per metric tonne" */
  published: string;
}

export function unitFrom(code: number | undefined, names: Map<number, string>): Unit | null {
  if (code === undefined) return null;
  const published = names.get(code);
  if (!published) return null;
  const m = /^dollars\s+(per .+)$/i.exec(published.trim());
  if (!m) return null;
  return { code, unit: m[1].toLowerCase(), published };
}

/** A per-kilogram or per-litre figure where the unit allows an exact conversion (not hundredweights, whose weight the table does not define). */
export function perSmallUnit(value: number, unit: string): { unit: string; value: number } | null {
  if (unit === "per metric tonne") return { unit: "per kilogram", value: roundTo(value / 1000, 3) };
  if (unit === "per kilolitre") return { unit: "per litre", value: roundTo(value / 1000, 3) };
  return null;
}

// ---------- the reading (pure) ----------

export interface FarmPoint {
  month: string;
  value: number;
}

export interface FarmReading {
  region: { id: number; name: string };
  month: string; // YYYY-MM
  value: number;
  status: number;
  previous: FarmPoint | null;
  yearAgo: FarmPoint | null;
  last12: FarmPoint[];
  releaseTime: string | null;
  tableEnd: string | null;
  /** Other provinces that publish the same product for the same month in the same unit. */
  others: { region: string; value: number }[];
}

export function readFarm(
  series: DataSeries[],
  regions: { id: number; name: string }[],
  askedId: number,
  units: Map<number, Unit | null>,
  tableEnd: string | null,
): FarmReading | null {
  const idx = regions.findIndex((r) => r.id === askedId);
  const head = series[idx];
  const latest = newestUsable(head);
  if (!head || !latest) return null;
  const month = monthOf(latest.period);
  const at = (m: string): FarmPoint | null => {
    const p = head.points.find((x) => monthOf(x.period) === m);
    return usable(p) ? { month: m, value: p.value } : null;
  };
  const last12: FarmPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const p = at(shiftMonth(month, -i));
    if (p) last12.push(p);
  }
  const headUnit = head.vectorId ? units.get(head.vectorId)?.code : undefined;
  const others: { region: string; value: number }[] = [];
  regions.forEach((r, i) => {
    if (r.id === askedId) return;
    const s = series[i];
    const p = s?.points.find((x) => monthOf(x.period) === month);
    const u = s?.vectorId ? units.get(s.vectorId)?.code : undefined;
    if (usable(p) && u !== undefined && u === headUnit) others.push({ region: r.name, value: p.value });
  });
  return {
    region: regions[idx],
    month,
    value: latest.value,
    status: latest.status,
    previous: at(shiftMonth(month, -1)),
    yearAgo: at(shiftMonth(month, -12)),
    last12,
    releaseTime: latest.releaseTime,
    tableEnd,
    others,
  };
}

export function caFarmMethod(): string {
  return (
    "Canada (farm-gate prices): Statistics Canada's monthly average price received by farmers for crops and livestock in each province (table 32-10-0077-01). " +
    "We read the latest months through the Web Data Service and pass on the published average for the product and province, in the unit Statistics Canada states for that series; " +
    "no range is calculated. It is a monthly average, not a sale and not a futures or export price."
  );
}

const cad = (v: number) => (v >= 100 ? `CA$${v.toFixed(2)}` : fmtMoney(v, "CAD"));

export interface CaFarmQuery {
  product: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function caFarmAnswer(
  reading: FarmReading | null,
  def: ProductDef | null,
  related: ProductDef[],
  unit: Unit | null,
  q: CaFarmQuery,
  ctx: { regionAsked: { id: number; name: string }; regionNote?: string; tableTitle?: string },
): PriceAnswer {
  const regionName = reading?.region.name ?? ctx.regionAsked.name;
  const query: Record<string, unknown> = { country: "CA", product: q.product, region: regionName };
  const base = { source: INFO, query, measure: "average" as const, currency: "CAD", method: caFarmMethod(), baseUrl: q.baseUrl };

  if (!def || !reading || !unit) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: def
        ? `Statistics Canada publishes no recent price received by farmers for "${def.label}" in ${regionName}. Try another province or a related product.`
        : `Statistics Canada's farm price table has no product "${q.product}". Try one of: ${exampleProducts(40)}.`,
      extra: {
        ...(def ? { other_definitions: related.map((d) => ({ product: d.words[0], definition: d.label })) } : { available_products: PRODUCTS.map((p) => p.words[0]) }),
        ...(ctx.regionNote ? { region_note: ctx.regionNote } : {}),
      },
    };
  }

  const r = reading;
  const today = q.today ?? new Date();
  const behind = monthsBehind(r.month, today);
  const change = (from: FarmPoint | null) =>
    from ? { reference_month: from.month, value: from.value, change_percent: changePercent(r.value, from.value), change_amount: roundTo(r.value - from.value, 2) } : null;
  const mom = change(r.previous);
  const yoy = change(r.yearAgo);
  const small = perSmallUnit(r.value, unit.unit);
  const notes: string[] = [
    `A monthly average price received by farmers for ${monthWords(r.month)}, in the unit Statistics Canada states (${unit.published.toLowerCase()}): not a sale, not a futures or export price and not a live price.`,
  ];
  if (unit.unit === "per hundredweight") notes.push("The hundredweight is Statistics Canada's own unit and is not converted here because the table does not define its weight.");
  if (r.status === 7) notes.push("Statistics Canada marks this figure E: use with caution.");
  if (r.tableEnd && r.month < r.tableEnd) notes.push(`Statistics Canada has no newer price for this product and province than ${monthWords(r.month)} (the table's newest month is ${monthWords(r.tableEnd)}).`);
  if (behind >= 4) notes.push(`Old data: the newest price Statistics Canada holds for this product and province is from ${monthWords(r.month)}, ${behind} months ago.`);
  if (ctx.regionNote) notes.push(ctx.regionNote);

  return buildStatisticAnswer({
    ...base,
    value: r.value,
    unit: unit.unit,
    period: monthRange(r.month),
    reference_period: r.month,
    note: notes.join(" "),
    describe: (v) =>
      `In ${r.region.name} farmers received on average ${cad(v)} ${unit.unit} for ${def.label.toLowerCase()} in ${monthWords(r.month)}` +
      (small ? ` (${fmtMoney(small.value, "CAD")} ${small.unit})` : "") +
      `, as published by Statistics Canada (a monthly average, not a sale or a live price). ` +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from a year earlier (${cad(yoy.value)} in ${monthWords(yoy.reference_month)}).`
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${cad(yoy.value)} in ${monthWords(yoy.reference_month)}).`
        : "Statistics Canada holds no price for the same month a year earlier.") +
      (behind >= 4 ? ` Old data: ${behind} months old.` : ""),
    extra: {
      country_name: "Canada",
      region: { name: r.region.name, wds_member_id: r.region.id },
      product: { definition: def.label, asked_for: q.product },
      unit: { value_unit: unit.unit, published_wording: unit.published, ...(small ? { converted: small } : {}) },
      what_this_is: "Monthly average price received by farmers in the province, published by Statistics Canada. Not a sale, not a futures or export price and not a live price.",
      reference_month: r.month,
      reference_month_label: monthWords(r.month),
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      ...(yoy ? {} : { change_on_year_earlier_unavailable: "Statistics Canada holds no price for this product and province in the same month a year earlier." }),
      last_12_months: r.last12,
      other_provinces_same_month: r.others,
      other_definitions: related.map((d) => ({ product: d.words[0], definition: d.label })),
      dataset: { name: ctx.tableTitle ?? "Farm product prices, crops and livestock", table: "32-10-0077-01", url: INFO.homepage, released: r.releaseTime },
      attribution_notice: openLicenceNotice(TABLE_NAME, monthWords(r.month)),
      ...(ctx.regionNote ? { region_note: ctx.regionNote } : {}),
    },
  });
}

// ---------- the request ----------

export async function caFarmPrices(input: CaFarmQuery, post: Poster = wdsPost, get: Getter = wdsGet): Promise<PriceAnswer> {
  const productText = input.product?.trim();
  if (!productText) throw new InputError("product is required: a crop or animal product such as 'wheat', 'canola', 'hogs', 'milk' or 'eggs'.");

  const meta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const products = dimension(meta, 2, "Farm products");
  const regions = geo.members.filter((g) => !g.terminated).map((g) => ({ id: g.id, name: g.name }));

  const m = matchProduct(productText);
  if (!m.primary) {
    return caFarmAnswer(null, null, [], null, input, { regionAsked: regions[0], tableTitle: meta.title });
  }
  const member = memberByName(products, m.primary.label);
  if (!member || member.terminated) throw new SourceError(`Statistics Canada changed table 32-10-0077-01 (no product "${m.primary.label}"); this source needs updating.`);

  const coords = regions.map((g) => coordinate([g.id, member.id]));
  const series = await latestPeriods(PRODUCT_ID, coords, 14, post);

  const raw = (input.region ?? "").trim();
  if (!raw) {
    // No Canada total exists: say which provinces publish the product and what they got.
    const probe = regions
      .map((r, i) => ({ r, p: newestUsable(series[i]) }))
      .filter((x) => x.p)
      .map((x) => `${x.r.name} ${x.p!.value} (${monthWords(monthOf(x.p!.period))})`);
    throw new InputError(
      `Canada: Statistics Canada publishes farm prices by province only, with no Canada total. Give region, one of: ${regions.map((r) => r.name).join("; ")}.` +
        (probe.length ? ` Latest published for ${m.primary.label}: ${probe.join("; ")}.` : ` It publishes no recent price for ${m.primary.label} in any province.`),
    );
  }
  const asked = resolveProvince(geo, raw);
  const vectors = series.filter((s) => s.ok && s.vectorId && s.points.length).map((s) => ({ vectorId: s.vectorId as number }));
  const uomByVector = vectors.length ? parseSeriesUoms(await post("getSeriesInfoFromVector", vectors)) : new Map<number, number>();
  const names = await uomNames(get);
  const units = new Map<number, Unit | null>();
  for (const [v, c] of uomByVector) units.set(v, unitFrom(c, names));

  const reading = readFarm(series, regions, asked.member.id, units, meta.endDate);
  const headVector = series[regions.findIndex((r) => r.id === asked.member.id)]?.vectorId;
  const unit = headVector ? units.get(headVector) ?? null : null;
  if (reading && !unit) throw new SourceError("Statistics Canada returned a price without a unit this source understands; it needs updating.");
  return caFarmAnswer(reading, m.primary, m.related, unit, input, { regionAsked: asked.member, regionNote: asked.note, tableTitle: meta.title });
}

// ---------- daily copy (stale-if-error) ----------

/** The library item for one product: its table name and the unit Statistics Canada states for it, so a stored copy reads on its own ("Durum wheat (per metric tonne)"). */
export const farmItem = (label: string, unit: string) => `${label} (${unit})`;

export interface FarmSeriesRef {
  region: string;
  product: string;
  unit: string | null;
  data: DataSeries | undefined;
}

/** Pure: one library row per product and province for the newest month any series has; series that lag behind it, or have no known unit, are left out.
 *  Each row is one published average: n is NO_COUNT (no count of sales is published) and the range fields repeat the figure. */
export function farmHarvestRows(series: FarmSeriesRef[]): HarvestResult {
  const latest = series.filter((s) => s.unit).map((s) => ({ ...s, point: newestUsable(s.data) })).filter((s) => s.point);
  if (!latest.length) throw new SourceError("Statistics Canada table 32-10-0077-01 returned no usable farm price");
  const month = latest.map((s) => monthOf(s.point!.period)).sort().pop()!;
  const rows = latest
    .filter((s) => monthOf(s.point!.period) === month)
    .map((s) => ({
      area: s.region,
      item: farmItem(s.product, s.unit!),
      n: NO_COUNT,
      median: s.point!.value,
      low: s.point!.value,
      high: s.point!.value,
      min: s.point!.value,
      max: s.point!.value,
    }));
  return {
    date: monthRange(month).to,
    currency: "CAD",
    unit: "per unit named in the product (per metric tonne, per hundredweight, per kilolitre, per dozen)",
    rows,
    note: `Statistics Canada table 32-10-0077-01: average prices received by farmers for ${monthWords(month)}, by product and province (the unit is in the product's name). Published averages, not counts of sales (no count is published).`,
  };
}

export async function caFarmHarvest(post: Poster = wdsPost, get: Getter = wdsGet): Promise<HarvestResult> {
  const meta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const products = dimension(meta, 2, "Farm products");
  const regions = geo.members.filter((g) => !g.terminated);
  const wanted: { region: string; product: string; coord: string }[] = [];
  for (const def of PRODUCTS) {
    const member = memberByName(products, def.label);
    if (!member || member.terminated) continue; // a product the table no longer has: the live answer reports it
    for (const g of regions) wanted.push({ region: g.name, product: def.label, coord: coordinate([g.id, member.id]) });
  }
  const got: DataSeries[] = [];
  for (let i = 0; i < wanted.length; i += 50) got.push(...(await latestPeriods(PRODUCT_ID, wanted.slice(i, i + 50).map((w) => w.coord), 2, post)));
  const vectors = got.filter((s) => s.ok && s.vectorId && s.points.length).map((s) => ({ vectorId: s.vectorId as number }));
  const uomByVector = new Map<number, number>();
  for (let i = 0; i < vectors.length; i += 100) for (const [v, c] of parseSeriesUoms(await post("getSeriesInfoFromVector", vectors.slice(i, i + 100)))) uomByVector.set(v, c);
  const names = parseUomNames(await get("getCodeSets"));
  return farmHarvestRows(
    wanted.map((w, i) => {
      const vec = got[i]?.vectorId;
      const code = vec ? uomByVector.get(vec) : undefined;
      return { region: w.region, product: w.product, unit: unitFrom(code, names)?.unit ?? null, data: got[i] };
    }),
  );
}

/** Where a request lives in the library, without asking Statistics Canada: provinces and units come from the rows of our newest stored day. */
export function farmHistoryKey(
  p: { product?: string; region?: string },
  rows: { area: string; item: string }[],
): { area: string; item: string; label: string } | null {
  const def = matchProduct(p.product ?? "").primary;
  if (!def || !(p.region ?? "").trim() || !rows.length) return null;
  const areas = [...new Set(rows.map((r) => r.area))];
  const members: CubeMember[] = areas.map((name, i) => ({ id: i + 1, name, parent: null, terminated: false }));
  try {
    const region = resolveProvince({ position: 1, name: "Geography", members }, p.region!).member;
    const item = rows.find((r) => r.area === region.name && r.item.startsWith(`${def.label} (per `))?.item;
    if (!item) return null;
    return { area: region.name, item, label: `${region.name} (${def.label})` };
  } catch {
    return null;
  }
}
