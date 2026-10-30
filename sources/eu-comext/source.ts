// EU member states: border prices (customs unit values) from Eurostat's Comext database, dataset DS-045409 "EU trade since 1988 by HS2-4-6 and CN8".
// Key-free JSON-stat API, checked live on 2026-10-30 through the GitHub probe:
//   GET https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409?format=JSON&lang=en&freq=M&reporter=DE&partner=WORLD&product=1001&flow=1
//       &indicators=VALUE_IN_EUROS&indicators=QUANTITY_IN_100KG&time=2026-06
//   -> {"class":"dataset","id":["freq","reporter","partner","product","flow","indicators","time"],"size":[1,1,1,1,1,2,1],
//       "value":{"1":3342854.64,"0":71425923}, ...}  (index 0 = VALUE_IN_EUROS = EUR 71,425,923; index 1 = QUANTITY_IN_100KG = 3,342,854.64 x 100 kg)
//   so Germany imported wheat (HS 1001) in June 2026 at 71,425,923 / 334,285,464 kg = EUR 0.2137 per kg.
// Product codes: HS 4 or 6 digits or CN 8 digits all work (1001, 100199, 10019099). partner=WORLD is the total of all partners; a partner is an ISO 2-letter code.
// A cell with no trade comes back with an empty dimension (size 0) and value {}. Flow 1 = import, 2 = export.
// Licence: Eurostat's copyright notice allows reuse, commercial or not, with the source acknowledged. Some parts of the trade data carry extra limits
// (Austrian 8-digit CN lines, Swiss and Liechtenstein data, partners outside the EU/EFTA/candidate countries), and the Licence Checker could not clear
// it for paid use, so this source stays on the FREE TIER (Simon, 29 Oct 2026) and Austria is not served.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { parseJsonStat } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "eu-comext",
  country: "EU member states (FR, DE, ES, IT, NL, BE, IE, PL, PT, DK, SE)",
  category: "border prices (customs unit values)",
  name: "Eurostat Comext: EU trade in goods (customs value per kilogram)",
  publisher: "Eurostat (European Commission), Comext database DS-045409",
  what_is_recorded:
    "For each month, reporting country, partner country and goods code (HS or CN), the value in euros that traders declared to customs and the quantity in 100 kg, for imports and exports. " +
    "We divide value by weight. Customs statistics only, never an individual trader or consignment.",
  price_type: "official_statistic",
  freshness: "Monthly: Eurostat publishes each month's trade statistics about 2.5 months after the month ends; our figures are read live and each answer states its months",
  licence:
    "Eurostat copyright notice: reuse of Eurostat data \"for commercial or non-commercial purposes is authorised provided the source is acknowledged\" and any changes are indicated (Commission Decision 2011/833/EU). " +
    "The notice carries trade-data exceptions (Austrian 8-digit CN lines, Swiss and Liechtenstein data, partners outside the EU, EFTA and candidate countries). ProofPrice has not cleared this source for paid use: free tier only.",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat (Comext, DS-045409). Unit values are calculated by ProofPrice from Eurostat's published value and quantity; Eurostat has no responsibility for the derived figures.",
  homepage: "https://ec.europa.eu/eurostat/web/international-trade-in-goods/database",
  limits:
    "A customs value, not a shelf price: it is the value declared at the border per kilogram of net weight (imports include carriage and insurance to the border, exports do not), before duty, tax, inland transport, retail margin or brand. " +
    "A goods code groups different products (the cheese code covers cheddar and parmesan), so the average moves with the mix of what is shipped. Small or lumpy shipments can swing one month, so ask for more months. " +
    "Goods sold by number, not by weight, can give odd per-kg values. Eurostat marks recent months as provisional. No count of shipments is published. " +
    "A partner is the country of origin (imports) or destination (exports) as the reporting country records it; with partner left out, all partners are added together.",
};

export const API = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
/** Months, newest first, that are searched for the newest published month when the caller gives no period. */
export const LOOKBACK = 9;
/** The newest month Eurostat can have published is about this many months before the current one. */
export const LAG_MONTHS = 2;

export const REPORTERS: Record<string, { name: string; currency: string }> = {
  FR: { name: "France", currency: "EUR" },
  DE: { name: "Germany", currency: "EUR" },
  ES: { name: "Spain", currency: "EUR" },
  IT: { name: "Italy", currency: "EUR" },
  NL: { name: "the Netherlands", currency: "EUR" },
  BE: { name: "Belgium", currency: "EUR" },
  IE: { name: "Ireland", currency: "EUR" },
  PL: { name: "Poland", currency: "EUR" },
  PT: { name: "Portugal", currency: "EUR" },
  DK: { name: "Denmark", currency: "EUR" },
  SE: { name: "Sweden", currency: "EUR" },
};

// ---------- products: everyday words -> HS codes ----------

export interface Item {
  key: string;
  code: string;
  label: string;
  words: string[];
}
const I = (key: string, code: string, label: string, words: string): Item => ({ key, code, label, words: words.split("|") });

export const ITEMS: Item[] = [
  I("diesel", "271019", "Gas oil and other medium or heavy petroleum oils, mostly diesel (HS 2710.19)", "diesel|gas oil|gasoil|heating oil|fuel oil"),
  I("petrol", "271012", "Light petroleum oils, mostly motor spirit (HS 2710.12)", "petrol|gasoline|motor spirit|unleaded"),
  I("crude oil", "2709", "Crude petroleum oil (HS 2709)", "crude oil|crude|oil|petroleum"),
  I("natural gas", "2711", "Petroleum gases and gaseous hydrocarbons, mostly natural gas and LPG (HS 2711)", "natural gas|lng|lpg|gas"),
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
  I("olive oil", "1509", "Olive oil (HS 1509)", "olive oil|olive"),
  I("beef", "0201", "Fresh or chilled beef (HS 0201)", "beef"),
  I("pork", "0203", "Fresh, chilled or frozen pork (HS 0203)", "pork"),
  I("chicken", "0207", "Poultry meat, mostly chicken (HS 0207)", "chicken|poultry|turkey"),
  I("milk", "0401", "Milk and cream, not concentrated (HS 0401)", "milk|cream"),
  I("butter", "0405", "Butter and dairy spreads (HS 0405)", "butter"),
  I("cheese", "0406", "Cheese and curd (HS 0406)", "cheese"),
  I("wine", "2204", "Wine of fresh grapes (HS 2204)", "wine"),
  I("whisky", "220830", "Whiskies (HS 2208.30)", "whisky|whiskey|scotch"),
  I("beer", "2203", "Beer made from malt (HS 2203)", "beer"),
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
}

/** "wheat" -> HS 1001; "1001", "10.01", "0808 10" or "08081050" -> that code. Comext takes 4, 6 or 8 digits. */
export function resolveProduct(input: string): Product {
  const raw = input.trim();
  const digits = raw.replace(/[\s.\-]/g, "");
  if (/^\d+$/.test(digits)) {
    if (![4, 6, 8].includes(digits.length)) throw new InputError("product must be a customs code of 4, 6 or 8 digits (HS/CN, for example 1001 for wheat, 271019 for diesel or 04061030 for mozzarella), or an everyday word such as 'wheat'.");
    const known = ITEMS.find((i) => i.code === digits);
    return { code: digits, label: known ? known.label : `Goods under customs code ${digits}` };
  }
  const w = plain(raw);
  const item = ITEMS.find((i) => plain(i.key) === w || i.words.includes(w)) ?? ITEMS.find((i) => i.words.some((x) => x.length > 3 && ` ${w} `.includes(` ${x} `)));
  if (!item) throw new InputError(`product not recognised: "${input}". Give a customs code of 4, 6 or 8 digits, or one of: ${ITEMS.map((i) => i.key).join(", ")}.`);
  return { code: item.code, label: item.label };
}

// ---------- months ----------

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const thisMonth = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

// ---------- partner ----------

const PARTNER_ALIASES: Record<string, string> = {
  UK: "GB", "UNITED KINGDOM": "GB", BRITAIN: "GB", "GREAT BRITAIN": "GB", USA: "US", "UNITED STATES": "US", AMERICA: "US", CHINA: "CN", GERMANY: "DE", FRANCE: "FR", SPAIN: "ES",
  ITALY: "IT", NETHERLANDS: "NL", BELGIUM: "BE", IRELAND: "IE", POLAND: "PL", PORTUGAL: "PT", DENMARK: "DK", SWEDEN: "SE", NORWAY: "NO", SWITZERLAND: "CH", TURKEY: "TR",
  INDIA: "IN", JAPAN: "JP", BRAZIL: "BR", ARGENTINA: "AR", UKRAINE: "UA", RUSSIA: "RU", CANADA: "CA", AUSTRALIA: "AU", "NEW ZEALAND": "NZ", MOROCCO: "MA", EGYPT: "EG",
  "SOUTH AFRICA": "ZA", MEXICO: "MX", VIETNAM: "VN", THAILAND: "TH", INDONESIA: "ID", MALAYSIA: "MY",
};

/** An ISO 2-letter code or a common country name -> the Comext partner code. Throws InputError for anything else. */
export function resolvePartner(input: string): string {
  const up = input.trim().toUpperCase();
  const code = PARTNER_ALIASES[up] ?? (/^[A-Z]{2}$/.test(up) ? up : undefined);
  if (!code) throw new InputError(`partner not recognised: "${input}". Give a 2-letter country code such as DE, US, CN or BR, or leave partner out for all partners.`);
  return code;
}

// ---------- parsing ----------

export interface MonthCell {
  month: string;
  eur: number;
  kg: number;
}

/** Monthly value (EUR) and quantity (100 kg -> kg) from a DS-045409 answer. A month is kept only when both are present and positive. */
export function parseMonths(json: unknown): MonthCell[] {
  const t = parseJsonStat(json);
  if (!t.ids.includes("indicators") || !t.ids.includes("time")) throw new SourceError("Unexpected response from Eurostat Comext (no indicators or time dimension)");
  const byMonth = new Map<string, { eur?: number; q?: number }>();
  for (const r of t.rows) {
    const m = String(r.time);
    const cur = byMonth.get(m) ?? {};
    if (r.indicators === "VALUE_IN_EUROS") cur.eur = r.value as number;
    else if (r.indicators === "QUANTITY_IN_100KG") cur.q = r.value as number;
    byMonth.set(m, cur);
  }
  const out: MonthCell[] = [];
  for (const [month, c] of byMonth) {
    if (c.eur !== undefined && c.q !== undefined && c.eur > 0 && c.q > 0) out.push({ month, eur: c.eur, kg: c.q * 100 });
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : 1));
}

export interface Summary {
  unit: number;
  low: number;
  high: number;
  eur: number;
  kg: number;
  months: MonthCell[];
}

/** Value-weighted unit value over the months, plus the cheapest and dearest single month. */
export function summarise(cells: MonthCell[]): Summary | null {
  if (!cells.length) return null;
  const eur = cells.reduce((a, c) => a + c.eur, 0);
  const kg = cells.reduce((a, c) => a + c.kg, 0);
  const units = cells.map((c) => c.eur / c.kg);
  return { unit: eur / kg, low: Math.min(...units), high: Math.max(...units), eur, kg, months: cells };
}

// ---------- fetching ----------

export function comextUrl(o: { reporter: string; partner: string; code: string; flow: 1 | 2; months: string[] }): string {
  const q = [
    "format=JSON", "lang=en", "freq=M",
    `reporter=${o.reporter}`, `partner=${o.partner}`, `product=${o.code}`, `flow=${o.flow}`,
    "indicators=VALUE_IN_EUROS", "indicators=QUANTITY_IN_100KG",
    ...o.months.map((m) => `time=${m}`),
  ];
  return `${API}?${q.join("&")}`;
}

export interface Io {
  get(url: string): Promise<unknown>;
}
export const liveIo: Io = { get: (url) => fetchJson(url, { headers: { "user-agent": UA, accept: "application/json" } }, 25000) };

export interface Request {
  country: string;
  product: string;
  direction: "imports" | "exports";
  partner?: string;
  period?: string;
  months?: number;
  baseUrl?: string;
}

const EUR_KG = (v: number) => `€${v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toFixed(4)}`;
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export async function comextBorderPrice(req: Request, io: Io = liveIo, now = new Date()): Promise<PriceAnswer> {
  const country = req.country.trim().toUpperCase();
  const rep = REPORTERS[country];
  if (!rep) throw new InputError(`country must be one of ${Object.keys(REPORTERS).join(", ")}.`);
  const product = resolveProduct(req.product);
  const direction = req.direction;
  const flow: 1 | 2 = direction === "imports" ? 1 : 2;
  const months = req.months ?? 1;
  const partnerCode = req.partner ? resolvePartner(req.partner) : "WORLD";
  if (partnerCode === country) throw new InputError("partner cannot be the same country as the reporting country.");
  if (req.period && req.period >= thisMonth(now)) throw new InputError(`period must be a month Eurostat has already published: before ${thisMonth(now)}.`);

  // With a period, ask for exactly those months. Without, ask for the last LOOKBACK published months and keep the newest `months` that hold data.
  const end = req.period ?? addMonths(thisMonth(now), -LAG_MONTHS);
  const wanted = req.period ? Array.from({ length: months }, (_, i) => addMonths(end, -i)) : Array.from({ length: LOOKBACK + months - 1 }, (_, i) => addMonths(end, -i));
  const json = await io.get(comextUrl({ reporter: country, partner: partnerCode, code: product.code, flow, months: wanted }));
  let cells = parseMonths(json);
  if (!req.period) {
    // the newest month with data, then `months` consecutive months ending there
    const newest = cells.length ? cells[cells.length - 1].month : null;
    cells = newest ? cells.filter((c) => c.month <= newest && c.month >= addMonths(newest, -(months - 1))) : [];
  }
  const s = summarise(cells);
  const from = s ? s.months[0].month : addMonths(end, -(months - 1));
  const to = s ? s.months[s.months.length - 1].month : end;
  const span = from === to ? to : `${from} to ${to}`;
  const flowWord = direction === "imports" ? "imported" : "exported";
  const partnerName = req.partner ? (partnerCode.length === 2 ? partnerCode : req.partner) : null;
  const where = partnerName ? (direction === "imports" ? ` from ${req.partner!.trim()}` : ` to ${req.partner!.trim()}`) : "";
  const query = { country, product: req.product, direction, ...(req.partner ? { partner: req.partner } : {}), ...(req.period ? { period: req.period } : {}), ...(req.months ? { months: req.months } : {}) };
  const multi = !!s && s.months.length > 1;
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value: s ? s.unit : null,
    measure: "average",
    currency: rep.currency,
    unit: "per kg",
    period: { from, to },
    reference_period: span,
    sample_size: null,
    min: multi ? s!.low : null,
    max: multi ? s!.high : null,
    method:
      `Eurostat's Comext database holds, for each month, reporting country, partner and goods code, the value declared to customs (euros) and the quantity (100 kg). ` +
      `We add up value and weight for ${lc(product.label)} ${flowWord} by ${rep.name}${where} over ${span} and divide: the figure is a value-weighted average customs value per kilogram. ` +
      (multi ? "The lowest and highest are the cheapest and dearest single month in the period. " : "") +
      "It is a customs value, not a shelf price, and Eurostat publishes no count of shipments.",
    describe: (v) =>
      `${rep.name.charAt(0).toUpperCase() + rep.name.slice(1)} ${flowWord} ${lc(product.label)}${where} at an average customs value of ${EUR_KG(v)} per kg over ${span}` +
      (s ? ` (${Math.round(s.kg / 1000).toLocaleString("en-GB")} tonnes, €${Math.round(s.eur / 1e6).toLocaleString("en-GB")} million).` : "."),
    note: "Customs value per kilogram at the border, not a shelf price.",
    baseUrl: req.baseUrl,
    ending: "Source: Eurostat (Comext). A customs value per kg, not a shelf price.",
    evidence: { label: "Customs statistics (declared value divided by quantity)", meaning: "Official trade values and quantities declared at the border, divided by us; not a shop or wholesale price." },
    extra: {
      measure_detail: "customs value per kg (declared value / quantity)",
      goods: { code: product.code, description: product.label },
      direction,
      partner: partnerCode,
      value_eur: s ? Math.round(s.eur) : null,
      net_mass_tonnes: s ? Math.round(s.kg / 1000) : null,
      monthly: s ? s.months.map((c) => ({ month: c.month, eur_per_kg: Number((c.eur / c.kg).toPrecision(4)) })) : [],
    },
  });
  answer.notice = `${answer.notice} Customs value, not a shelf price: the value declared at the border per kilogram, before duty, inland transport and retail margin.`;
  if (!s) {
    answer.summary = `Eurostat records no ${flowWord} trade with a quantity in ${lc(product.label)}${where} by ${rep.name} for ${span}. Try more months, a shorter goods code or all partners.`;
  }
  return answer;
}
