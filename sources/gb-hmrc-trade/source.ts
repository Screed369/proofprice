// United Kingdom: border prices (customs unit values) from HMRC's Overseas Trade Statistics through the UK Trade Info OData API
// (https://api.uktradeinfo.com/OTS, key-free, OGL v3.0, 60 requests a minute). Format checked live on 2026-10-22 through the GitHub probe:
//   GET /OTS?$filter=MonthId eq 202506 and FlowTypeId eq 1&$skip=100000&$top=400 -> {"@odata.context":..,"value":[{"MonthId":202506,
//   "FlowTypeId":1,"SuppressionIndex":0,"CommodityId":76151080,"CommoditySitcId":69743,"CountryId":5,"PortId":7,"Value":111175.0,
//   "NetMass":8320.0,"SuppUnit":0.0}, ...]}
// One row = one commodity (CommodityId = the 8 digit CN code as a whole number, so 08081050 is 8081050), one partner country, one port,
// one month. Value is pounds sterling, NetMass is kilograms (HMRC's documentation states quantity in kg). FlowTypeId: 1 EU imports,
// 2 EU exports, 3 non-EU imports, 4 non-EU exports. Negative CommodityId values are totals and are never selected (the filter asks for a
// code range). The Country table (CountryId, CountryName) is read at run time; its code field, if any, is used, otherwise names are matched.
//
// The unit value is value divided by net weight, summed over the lines asked for: a value-weighted average. The range is the 10th to 90th
// percentile of the individual lines' unit values, each weighted by its kilograms. It is a customs value (what the importer or exporter
// declared at the border), never a shelf price. HMRC publishes no record count per figure: answers carry sample_size null.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "gb-hmrc-trade",
  country: "GB (United Kingdom)",
  category: "border prices (customs unit values)",
  name: "UK Overseas Trade Statistics (customs value per kilogram)",
  publisher: "HM Revenue and Customs (HMRC), UK Trade Info",
  what_is_recorded:
    "For each month, goods code (CN commodity), partner country and port of the UK, the value in pounds sterling that traders declared to customs and the net weight in kilograms, for imports and exports. " +
    "We divide value by weight. Customs statistics only, never an individual trader or consignment.",
  price_type: "official_statistic",
  freshness: "Monthly: HMRC publishes each month's trade statistics about six weeks after the month ends; our figures are read live and each answer states its months",
  licence:
    "Open Government Licence v3.0. The UK Trade Info API documentation says: \"All content is available under the Open Government Licence v3.0, except where otherwise stated.\" " +
    "The OGL v3.0 lets you copy, publish, distribute and adapt the information and use it commercially, provided you acknowledge the source.",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: HM Revenue and Customs, UK Overseas Trade Statistics, https://www.uktradeinfo.com . " +
    "Unit values are calculated by ProofPrice from HMRC's published value and net mass; HMRC does not endorse them.",
  homepage: "https://www.uktradeinfo.com/api-documentation/",
  limits:
    "A customs value, not a shelf price: it is the value declared at the border (imports are valued at the border including carriage and insurance, exports without) per kilogram of net weight, before duty, tax, transport inland, retail margin or brand. " +
    "A goods code groups different products (a code for cheese covers cheddar and parmesan), so the average moves with the mix of what is shipped. Small or lumpy shipments can swing a single month, so ask for more months. " +
    "HMRC suppresses or adjusts some lines for confidentiality and publishes recent months as provisional. Goods sold by number, not by weight, can give odd per-kg values. " +
    "Lines with no recorded weight are left out. No count of shipments is published.",
};

export const API = "https://api.uktradeinfo.com";
export const PAGE = 40000;
/** Most pages one request will read (40,000 lines each). A broader question is refused with advice to narrow it. */
export const MAX_PAGES = 4;
export const MIN_LINES = 5;
export const COUNTRY = "GB";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

// ---------- products: everyday words -> HS/CN code prefixes ----------

export interface Item {
  key: string;
  /** HS/CN code prefix, 4 to 8 digits. */
  code: string;
  label: string;
  words: string[];
}
const I = (key: string, code: string, label: string, words: string): Item => ({ key, code, label, words: words.split("|") });

export const ITEMS: Item[] = [
  I("diesel", "271019", "Gas oil and other medium or heavy petroleum oils, mostly diesel (HS 2710.19)", "diesel|gas oil|gasoil|derv|heating oil|fuel oil"),
  I("petrol", "271012", "Light petroleum oils, mostly motor spirit (HS 2710.12)", "petrol|gasoline|motor spirit|unleaded"),
  I("crude oil", "2709", "Crude petroleum oil (HS 2709)", "crude oil|crude|oil|petroleum"),
  I("wheat", "1001", "Wheat and meslin (HS 1001)", "wheat|meslin"),
  I("barley", "1003", "Barley (HS 1003)", "barley"),
  I("maize", "1005", "Maize / corn (HS 1005)", "maize|corn"),
  I("rice", "1006", "Rice (HS 1006)", "rice"),
  I("sugar", "1701", "Cane or beet sugar (HS 1701)", "sugar"),
  I("coffee", "0901", "Coffee (HS 0901)", "coffee"),
  I("tea", "0902", "Tea (HS 0902)", "tea"),
  I("cocoa", "1801", "Cocoa beans (HS 1801)", "cocoa|cocoa beans|cacao"),
  I("apples", "0808", "Apples, pears and quinces (HS 0808)", "apples|apple|pears"),
  I("bananas", "0803", "Bananas (HS 0803)", "bananas|banana"),
  I("oranges", "0805", "Citrus fruit: oranges, lemons, limes (HS 0805)", "oranges|orange|lemons|citrus"),
  I("tomatoes", "0702", "Fresh or chilled tomatoes (HS 0702)", "tomatoes|tomato"),
  I("potatoes", "0701", "Fresh or chilled potatoes (HS 0701)", "potatoes|potato"),
  I("beef", "0201", "Fresh or chilled beef (HS 0201)", "beef"),
  I("pork", "0203", "Fresh, chilled or frozen pork (HS 0203)", "pork"),
  I("chicken", "0207", "Poultry meat, mostly chicken (HS 0207)", "chicken|poultry|turkey"),
  I("milk", "0401", "Milk and cream, not concentrated (HS 0401)", "milk|cream"),
  I("butter", "0405", "Butter and dairy spreads (HS 0405)", "butter"),
  I("cheese", "0406", "Cheese and curd (HS 0406)", "cheese"),
  I("wine", "2204", "Wine of fresh grapes (HS 2204)", "wine"),
  I("whisky", "220830", "Whiskies (HS 2208.30)", "whisky|whiskey|scotch"),
  I("timber", "4407", "Wood sawn or chipped lengthwise (HS 4407)", "timber|sawn wood|lumber|softwood|wood"),
  I("steel", "7208", "Flat-rolled iron or steel, hot-rolled, wide (HS 7208)", "steel|flat steel|steel coil"),
  I("copper", "7403", "Refined copper and copper alloys, unwrought (HS 7403)", "copper"),
  I("aluminium", "7601", "Unwrought aluminium (HS 7601)", "aluminium|aluminum"),
  I("cement", "2523", "Cement (HS 2523)", "cement"),
  I("fertiliser", "3102", "Mineral or chemical nitrogen fertilisers (HS 3102)", "fertiliser|fertilizer|nitrogen fertiliser"),
  I("cotton", "5201", "Cotton, not carded or combed (HS 5201)", "cotton"),
];

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface Product {
  code: string;
  label: string;
  /** Set when the product is one of ITEMS (so the price library can stand in if HMRC is down). */
  key: string | null;
}

/** "wheat" -> HS 1001; "1001", "10.01", "0808 10" or "08081050" -> that code. Throws InputError otherwise. */
export function resolveProduct(input: string): Product {
  const raw = input.trim();
  const digits = raw.replace(/[\s.\-]/g, "");
  if (/^\d+$/.test(digits)) {
    if (digits.length < 4 || digits.length > 8) throw new InputError("product must be a customs code of 4 to 8 digits (HS/CN, for example 1001 for wheat or 271019 for diesel), or an everyday word such as 'wheat'. Codes shorter than 4 digits cover too many goods.");
    const known = ITEMS.find((i) => i.code === digits);
    return { code: digits, label: known ? known.label : `Goods under customs code ${digits}`, key: known ? known.key : null };
  }
  const w = plain(raw);
  const item = ITEMS.find((i) => plain(i.key) === w || i.words.includes(w)) ?? ITEMS.find((i) => i.words.some((x) => x.length > 3 && ` ${w} `.includes(` ${x} `)));
  if (!item) throw new InputError(`product not recognised: "${input}". Give a customs code of 4 to 8 digits, or one of: ${ITEMS.map((i) => i.key).join(", ")}.`);
  return { code: item.code, label: item.label, key: item.key };
}

/** The OData range of CommodityId for a code prefix: CommodityId is the 8 digit CN code as a whole number (08081050 -> 8081050). */
export function commodityRange(code: string): { low: number; high: number } {
  return { low: Number(code.padEnd(8, "0")), high: Number(code.padEnd(8, "9")) };
}

// ---------- months ----------

export const ym = (month: string): number => Number(month.replace("-", ""));
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const thisMonth = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

// ---------- partners ----------

export interface Country {
  id: number;
  name: string;
  alpha2: string | null;
}

/** The Country table as {value:[{CountryId, CountryName, ...}]}. A two-letter code field (any property whose name has "alpha" or "iso") is used when present. */
export function parseCountries(json: unknown): Country[] {
  const rows = Array.isArray((json as any)?.value) ? ((json as any).value as any[]) : [];
  const out: Country[] = [];
  for (const r of rows) {
    const id = Number(r?.CountryId);
    const name = typeof r?.CountryName === "string" ? r.CountryName.trim() : "";
    if (!Number.isFinite(id) || id <= 0 || !name) continue;
    let alpha: string | null = null;
    for (const [k, v] of Object.entries(r)) {
      if (/alpha|iso/i.test(k) && typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim())) alpha = v.trim().toUpperCase();
    }
    out.push({ id, name, alpha2: alpha });
  }
  return out;
}

/** HMRC names for partners people ask about (matched after removing punctuation and case). The first name is the one we print. */
export const PARTNER_NAMES: Record<string, string[]> = {
  US: ["united states", "usa", "united states of america"], CN: ["china"], DE: ["germany"], FR: ["france"], NL: ["netherlands", "holland"],
  IE: ["irish republic", "ireland"], BE: ["belgium"], ES: ["spain"], IT: ["italy"], PL: ["poland"], NO: ["norway"], SE: ["sweden"], DK: ["denmark"],
  CH: ["switzerland"], IN: ["india"], BR: ["brazil"], AU: ["australia"], NZ: ["new zealand"], CA: ["canada"], JP: ["japan"], KR: ["korea south", "south korea"],
  TR: ["turkey", "turkiye"], ZA: ["south africa"], AE: ["united arab emirates", "uae"], SA: ["saudi arabia"], UA: ["ukraine"], RU: ["russia"],
  PT: ["portugal"], AT: ["austria"], FI: ["finland"], CZ: ["czechia", "czech republic"], HU: ["hungary"], RO: ["romania"], GR: ["greece"],
  AR: ["argentina"], CL: ["chile"], PE: ["peru"], CO: ["colombia"], KE: ["kenya"], MA: ["morocco"], EG: ["egypt"], VN: ["vietnam"], TH: ["thailand"],
  ID: ["indonesia"], MY: ["malaysia"], SG: ["singapore"], HK: ["hong kong"], TW: ["taiwan"], MX: ["mexico"], IL: ["israel"], QA: ["qatar"],
};

export interface Partner {
  id: number;
  name: string;
  code: string | null;
}

/** An ISO code or a name -> the HMRC country. Throws InputError when HMRC has no such country. */
export function resolvePartner(input: string, countries: Country[]): Partner {
  const raw = input.trim();
  const up = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(up)) {
    const byAlpha = countries.find((c) => c.alpha2 === up);
    if (byAlpha) return { id: byAlpha.id, name: byAlpha.name, code: up };
    const names = (PARTNER_NAMES[up] ?? []).map(plain);
    const byName = countries.find((c) => names.includes(plain(c.name)));
    if (byName) return { id: byName.id, name: byName.name, code: up };
    throw new InputError(`partner "${input}" is not a country code we can match to HMRC's list. Give the country's name as HMRC writes it (for example Germany), or a code such as DE, US, CN, FR, NL, IE.`);
  }
  const w = plain(raw);
  const exact = countries.find((c) => plain(c.name) === w);
  if (exact) return { id: exact.id, name: exact.name, code: exact.alpha2 ?? Object.entries(PARTNER_NAMES).find(([, v]) => v.map(plain).includes(w))?.[0] ?? null };
  const viaAlias = Object.entries(PARTNER_NAMES).find(([, v]) => v.map(plain).includes(w));
  if (viaAlias) return resolvePartner(viaAlias[0], countries);
  const loose = countries.filter((c) => plain(c.name).startsWith(w) && w.length >= 4);
  if (loose.length === 1) return { id: loose[0].id, name: loose[0].name, code: loose[0].alpha2 };
  throw new InputError(`partner "${input}" not recognised. Give a country code such as DE, US, CN, FR, NL or IE, or a country name as HMRC writes it.`);
}

// ---------- reading the API (pure parts first) ----------

export interface Line {
  month: number;
  flow: number;
  commodity: number;
  country: number;
  value: number;
  kg: number;
}

/** The lines of an OTS response with a positive value and a positive net mass (the only ones that have a unit value). */
export function parseLines(json: unknown): { lines: Line[]; rows: number } {
  const rows = Array.isArray((json as any)?.value) ? ((json as any).value as any[]) : null;
  if (!rows) throw new SourceError("HMRC returned an unexpected answer (no value list)");
  const lines: Line[] = [];
  for (const r of rows) {
    const value = Number(r?.Value);
    const kg = Number(r?.NetMass);
    if (!(value > 0) || !(kg > 0)) continue;
    lines.push({ month: Number(r.MonthId), flow: Number(r.FlowTypeId), commodity: Number(r.CommodityId), country: Number(r.CountryId), value, kg });
  }
  return { lines, rows: rows.length };
}

/** Weighted percentile (p in 0..1) of values by weights; the smallest value whose cumulative weight reaches p of the total. */
export function weightedPercentile(pairs: { v: number; w: number }[], p: number): number {
  const s = [...pairs].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= p * total) return x.v;
  }
  return s[s.length - 1].v;
}

export interface Summary {
  /** Customs lines used. */
  lines: number;
  value: number;
  kg: number;
  /** GBP per kg. */
  unit: number;
  low: number;
  high: number;
  partners: { id: number; value: number; kg: number; unit: number }[];
}

export function summarise(lines: Line[]): Summary | null {
  if (lines.length < MIN_LINES) return null;
  const value = lines.reduce((a, l) => a + l.value, 0);
  const kg = lines.reduce((a, l) => a + l.kg, 0);
  const pairs = lines.map((l) => ({ v: l.value / l.kg, w: l.kg }));
  const by = new Map<number, { value: number; kg: number }>();
  for (const l of lines) {
    const e = by.get(l.country) ?? { value: 0, kg: 0 };
    e.value += l.value;
    e.kg += l.kg;
    by.set(l.country, e);
  }
  const partners = [...by.entries()]
    .map(([id, e]) => ({ id, value: e.value, kg: e.kg, unit: e.value / e.kg }))
    .sort((a, b) => b.value - a.value);
  return { lines: lines.length, value, kg, unit: value / kg, low: weightedPercentile(pairs, 0.1), high: weightedPercentile(pairs, 0.9), partners };
}

export function filterFor(o: { from: string; to: string; direction: "imports" | "exports"; code: string; partnerId?: number }): string {
  const { low, high } = commodityRange(o.code);
  const flows = o.direction === "imports" ? "(FlowTypeId eq 1 or FlowTypeId eq 3)" : "(FlowTypeId eq 2 or FlowTypeId eq 4)";
  const months = o.from === o.to ? `MonthId eq ${ym(o.from)}` : `MonthId ge ${ym(o.from)} and MonthId le ${ym(o.to)}`;
  return `${months} and ${flows} and CommodityId ge ${low} and CommodityId le ${high}${o.partnerId ? ` and CountryId eq ${o.partnerId}` : ""}`;
}

export function otsUrl(filter: string, skip: number): string {
  return `${API}/OTS?$filter=${encodeURIComponent(filter)}&$select=MonthId,FlowTypeId,CommodityId,CountryId,Value,NetMass&$top=${PAGE}${skip ? `&$skip=${skip}` : ""}`;
}

export interface Io {
  get(url: string): Promise<unknown>;
}
export const liveIo: Io = { get: (url) => fetchJson(url, { headers: { "user-agent": UA, accept: "application/json" } }, 25000) };

/** All lines for a filter, page by page. Refuses a question that needs more than MAX_PAGES pages. */
export async function readLines(filter: string, io: Io = liveIo): Promise<Line[]> {
  const out: Line[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { lines, rows } = parseLines(await io.get(otsUrl(filter, page * PAGE)));
    out.push(...lines);
    if (rows < PAGE) return out;
  }
  throw new InputError(`That question covers more than ${MAX_PAGES * PAGE} customs lines. Give a longer goods code (6 or 8 digits), fewer months, or a partner country.`);
}

/** The newest month HMRC has published: the first month, counting back from last month, that has any line. */
export async function latestMonth(io: Io = liveIo, now = new Date()): Promise<string> {
  for (let back = 1; back <= 8; back++) {
    const m = addMonths(thisMonth(now), -back);
    const json: any = await io.get(`${API}/OTS?$filter=${encodeURIComponent(`MonthId eq ${ym(m)} and FlowTypeId eq 1`)}&$select=MonthId&$top=1`);
    if (Array.isArray(json?.value) && json.value.length > 0) return m;
  }
  throw new SourceError("HMRC has no trade statistics for the last eight months");
}

export async function readCountries(io: Io = liveIo): Promise<Country[]> {
  const list = parseCountries(await io.get(`${API}/Country?$top=1000`));
  if (!list.length) throw new SourceError("HMRC's country list could not be read");
  return list;
}

// ---------- the answer ----------

const money = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
const GBP_KG = (v: number) => `£${money(v).toLocaleString("en-GB")}`;

export interface Request {
  product: string;
  direction: "imports" | "exports";
  partner?: string;
  period?: string;
  months?: number;
  baseUrl?: string;
}

export async function hmrcBorderPrice(req: Request, io: Io = liveIo, now = new Date()): Promise<PriceAnswer> {
  const product = resolveProduct(req.product);
  const direction = req.direction;
  const months = req.months ?? 1;
  const to = req.period ?? (await latestMonth(io, now));
  if (req.period && ym(req.period) >= ym(thisMonth(now))) throw new InputError(`period must be a month HMRC has already published: before ${thisMonth(now)}.`);
  const from = addMonths(to, -(months - 1));
  let partner: Partner | null = null;
  let countries: Country[] = [];
  try {
    countries = await readCountries(io);
  } catch (e) {
    if (req.partner) throw e;
  }
  if (req.partner) partner = resolvePartner(req.partner, countries);
  const lines = await readLines(filterFor({ from, to, direction, code: product.code, partnerId: partner?.id }), io);
  const s = summarise(lines);
  const nameOf = (id: number) => countries.find((c) => c.id === id)?.name ?? `country ${id}`;
  const span = from === to ? to : `${from} to ${to}`;
  const flowWord = direction === "imports" ? "imported" : "exported";
  const where = partner ? (direction === "imports" ? ` from ${partner.name}` : ` to ${partner.name}`) : "";
  const query = { country: COUNTRY, product: req.product, direction, ...(req.partner ? { partner: req.partner } : {}), ...(req.period ? { period: req.period } : {}), ...(req.months ? { months: req.months } : {}) };
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value: s ? s.unit : null,
    measure: "average",
    currency: "GBP",
    unit: "per kg",
    period: { from, to },
    reference_period: span,
    sample_size: null,
    low: s ? s.low : null,
    high: s ? s.high : null,
    method:
      `HM Revenue and Customs publishes, for each month, commodity code, partner country and port, the value declared to customs and the net weight. We add up the value and the net weight for ${product.label.toLowerCase()} ` +
      `${flowWord}${where} over ${span} (${s ? s.lines : lines.length} customs lines with a recorded weight) and divide: the figure is a value-weighted average customs value per kilogram. ` +
      "The range is the 10th to 90th percentile of the unit values of the individual lines, each weighted by its kilograms (so it describes where 80% of the weight was priced). It is a customs value, not a shelf price.",
    describe: (v) =>
      `The UK ${flowWord} ${product.label.toLowerCase()}${where} at an average customs value of ${GBP_KG(v)} per kg over ${span}` +
      (s ? ` (middle 80% of the weight between ${GBP_KG(s.low)} and ${GBP_KG(s.high)} per kg; ${Math.round(s.kg / 1000).toLocaleString("en-GB")} tonnes, £${Math.round(s.value / 1e6).toLocaleString("en-GB")} million).` : "."),
    note: "Customs value per kilogram at the border, not a shelf price.",
    baseUrl: req.baseUrl,
    ending: "Source: HM Revenue and Customs, UK Overseas Trade Statistics (Open Government Licence v3.0). A customs value per kg, not a shelf price.",
    evidence: { label: "Customs statistics (declared value divided by net weight)", meaning: "Official trade values and weights declared at the border, divided by us; not a shop or wholesale price." },
    extra: {
      measure_detail: "customs value per kg (declared value / net mass)",
      goods: { code: product.code, description: product.label },
      direction,
      customs_lines: s ? s.lines : lines.length,
      value_gbp: s ? Math.round(s.value) : null,
      net_mass_tonnes: s ? Math.round(s.kg / 1000) : null,
      ...(partner ? { partner: { name: partner.name, code: partner.code } } : {}),
      ...(s && !partner && countries.length
        ? { top_partners: s.partners.slice(0, 5).map((p) => ({ partner: nameOf(p.id), value_gbp: Math.round(p.value), net_mass_tonnes: Math.round(p.kg / 1000), unit_value_gbp_per_kg: money(p.unit) })) }
        : {}),
    },
  });
  answer.notice = `${answer.notice} Customs value, not a shelf price: this is the value declared at the UK border per kilogram of net weight, before duty, inland transport and retail margin.`;
  if (!s) {
    answer.summary =
      lines.length === 0
        ? `HMRC records no ${flowWord} trade with a weight in ${product.label.toLowerCase()}${where} for ${span}.`
        : `Only ${lines.length} customs lines with a weight exist for ${product.label.toLowerCase()}${where} in ${span}; ProofPrice gives no figure from fewer than ${MIN_LINES}. Try more months, a shorter goods code or all partners.`;
  }
  return answer;
}

// ---------- the daily collector ----------

/** Items and directions the collector keeps in the library (area = direction, item = key). */
export function libraryKey(p: { product: string; direction: string }): { area: string; item: string; label: string } | null {
  let prod: Product;
  try {
    prod = resolveProduct(p.product);
  } catch {
    return null;
  }
  if (!prod.key) return null;
  return { area: p.direction, item: prod.key, label: `${prod.key}, UK ${p.direction}, all partners` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The newest month for every curated item and both directions, all partners: the unit value, with the 10th and 90th percentile as low and high. */
export async function hmrcHarvest(io: Io = liveIo, pauseMs = 1100, now = new Date()): Promise<HarvestResult> {
  const month = await latestMonth(io, now);
  const date = `${month}-01`;
  const held = readLatestDay(INFO.id);
  if (held && held.date === date && held.rows.length) {
    // Same month already collected: HMRC does not change it daily, so keep the rows and do not ask HMRC for 60 big answers again.
    return { date, currency: "GBP", unit: "per kg", rows: held.rows.map(({ date: _d, ...r }) => r as DailyRow), note: `HMRC customs unit values for ${month}, unchanged since the last collection.` };
  }
  const rows: DailyRow[] = [];
  const skipped: string[] = [];
  for (const item of ITEMS) {
    for (const direction of ["imports", "exports"] as const) {
      try {
        await sleep(pauseMs);
        const s = summarise(await readLines(filterFor({ from: month, to: month, direction, code: item.code }), io));
        if (!s) {
          skipped.push(`${item.key}/${direction}`);
          continue;
        }
        rows.push({ area: direction, item: item.key, n: NO_COUNT, median: s.unit, low: s.low, high: s.high, min: s.low, max: s.high });
      } catch (e: any) {
        skipped.push(`${item.key}/${direction}: ${String(e?.message ?? e).slice(0, 60)}`);
      }
    }
  }
  if (!rows.length) throw new SourceError(`No HMRC unit value could be read for ${month} (${skipped.slice(0, 5).join("; ")})`);
  return {
    date,
    currency: "GBP",
    unit: "per kg",
    rows,
    note: `HMRC customs unit values (value / net mass, all partners) for ${month}: ${rows.length} item-directions; low and high are the 10th and 90th percentile of customs lines weighted by kg. ${skipped.length} left out (fewer than ${MIN_LINES} lines or not readable). HMRC publishes no count: the library stores none.`,
  };
}
