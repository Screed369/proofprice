// World Bank International Comparison Program (ICP) 2021: price level indices, PPPs and spending per head, by country and spending heading.
// API "ICP 2021" = World Bank source 90, key-free plain GET, JSON. Formats checked live on 2026-10-21 through the GitHub probe (see fixtures.ts).
//   One country and one heading (17 rows, about 5 KB):
//     https://api.worldbank.org/v2/sources/90/country/<ISO3>/series/<SERIES>/time/YR2021?format=json
//   source.data[] rows: variable[] = [{concept:Country,id},{concept:Classification,id,value},{concept:Series,id,value},{concept:Time,id}] and value (number or null).
//   Classification PX.WL = price level index (World = 100); PPPGlob = PPP (US$ = 1); PCAP.PP = expenditure per head, PPP-based (US$).
//   Do NOT use /v2/country/all/indicator/<id>?source=90 (answers "indicator not found").
// 2021 is the only benchmark year (2022 and 2023 columns exist but are empty), so there is no history and nothing to harvest.
// An index is an official statistic from an international price survey, never a price people paid: price_type "official_statistic",
// range fields null, sample_size null, confidence "medium".
// Countries already served by the OECD/Eurostat source (oecd-price-levels) are left to it, so no request is ever ambiguous.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "wb-icp-price-levels",
  country: "About 130 economies outside the OECD source, including Brazil, India, China, Singapore, Taiwan, the United Arab Emirates, Indonesia, Thailand, Saudi Arabia, Egypt, Nigeria and South Africa",
  category: "price-levels (price level index from the International Comparison Program)",
  name: "World Bank International Comparison Program 2021: price level indices by spending heading",
  publisher: "World Bank, International Comparison Program (ICP), 2021 benchmark round",
  what_is_recorded:
    "For each economy, the 2021 price level index (World = 100) of household consumption and its main headings (food, bread and cereals, meat, fish, dairy and eggs, oils, fruit, vegetables, " +
    "clothing, housing, health, transport, communication, recreation, education, restaurants and hotels and more), the PPP rate (national currency per US dollar) and spending per head at PPP. " +
    "Built from price surveys run by national statistics offices for the World Bank's ICP.",
  price_type: "official_statistic",
  freshness: "Benchmark year 2021 (published 2024); the ICP runs a new round about every three years, every answer states its year",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), World Bank data catalogue dataset 0066092, classified as Public; commercial use allowed with attribution",
  licence_url: "https://datacatalog.worldbank.org/search/dataset/0066092/international-comparison-program-2021",
  attribution:
    "Source: World Bank, International Comparison Program (ICP) 2021, https://data.worldbank.org, licensed under CC BY 4.0. " +
    "Figures are passed on as published; the percentage gap to the United States is calculated by ProofPrice.",
  homepage: "https://www.worldbank.org/en/programs/icp",
  limits:
    "A price LEVEL INDEX for a whole economy in one benchmark year (2021) from an international price survey: not a shop price, not a receipt and not what any household paid. " +
    "There is no range, no count of prices behind a figure and no history. It compares economies; it does not say what a given product costs. " +
    "Small territories are left out; Russia is published under the World Bank code RUT. 2021 prices predate recent inflation.",
};

// ---------- economies: ISO2 -> World Bank ICP code (ISO3) and name ----------

export interface CountryDef { iso3: string; name: string }
const C = (iso3: string, name: string): CountryDef => ({ iso3, name });

export const COUNTRIES: Record<string, CountryDef> = {
  AF: C("AFG", "Afghanistan"),
  AO: C("AGO", "Angola"),
  AE: C("ARE", "United Arab Emirates"),
  AR: C("ARG", "Argentina"),
  AM: C("ARM", "Armenia"),
  AG: C("ATG", "Antigua and Barbuda"),
  AZ: C("AZE", "Azerbaijan"),
  BI: C("BDI", "Burundi"),
  BJ: C("BEN", "Benin"),
  BF: C("BFA", "Burkina Faso"),
  BD: C("BGD", "Bangladesh"),
  BH: C("BHR", "Bahrain"),
  BS: C("BHS", "Bahamas"),
  BY: C("BLR", "Belarus"),
  BZ: C("BLZ", "Belize"),
  BO: C("BOL", "Bolivia"),
  BR: C("BRA", "Brazil"),
  BB: C("BRB", "Barbados"),
  BN: C("BRN", "Brunei"),
  BT: C("BTN", "Bhutan"),
  BW: C("BWA", "Botswana"),
  CF: C("CAF", "Central African Republic"),
  CN: C("CHN", "China"),
  CI: C("CIV", "Cote d'Ivoire"),
  CM: C("CMR", "Cameroon"),
  CD: C("COD", "Democratic Republic of the Congo"),
  CG: C("COG", "Republic of the Congo"),
  KM: C("COM", "Comoros"),
  CV: C("CPV", "Cabo Verde"),
  DJ: C("DJI", "Djibouti"),
  DM: C("DMA", "Dominica"),
  DO: C("DOM", "Dominican Republic"),
  DZ: C("DZA", "Algeria"),
  EC: C("ECU", "Ecuador"),
  EG: C("EGY", "Egypt"),
  ER: C("ERI", "Eritrea"),
  ET: C("ETH", "Ethiopia"),
  FJ: C("FJI", "Fiji"),
  GA: C("GAB", "Gabon"),
  GE: C("GEO", "Georgia"),
  GH: C("GHA", "Ghana"),
  GN: C("GIN", "Guinea"),
  GM: C("GMB", "Gambia"),
  GW: C("GNB", "Guinea-Bissau"),
  GQ: C("GNQ", "Equatorial Guinea"),
  GD: C("GRD", "Grenada"),
  GT: C("GTM", "Guatemala"),
  GY: C("GUY", "Guyana"),
  HK: C("HKG", "Hong Kong"),
  HN: C("HND", "Honduras"),
  HR: C("HRV", "Croatia"),
  HT: C("HTI", "Haiti"),
  ID: C("IDN", "Indonesia"),
  IN: C("IND", "India"),
  IR: C("IRN", "Iran"),
  IQ: C("IRQ", "Iraq"),
  JM: C("JAM", "Jamaica"),
  JO: C("JOR", "Jordan"),
  KZ: C("KAZ", "Kazakhstan"),
  KE: C("KEN", "Kenya"),
  KG: C("KGZ", "Kyrgyzstan"),
  KH: C("KHM", "Cambodia"),
  KN: C("KNA", "Saint Kitts and Nevis"),
  KW: C("KWT", "Kuwait"),
  LA: C("LAO", "Laos"),
  LB: C("LBN", "Lebanon"),
  LR: C("LBR", "Liberia"),
  LY: C("LBY", "Libya"),
  LC: C("LCA", "Saint Lucia"),
  LK: C("LKA", "Sri Lanka"),
  LS: C("LSO", "Lesotho"),
  MO: C("MAC", "Macao"),
  MA: C("MAR", "Morocco"),
  MD: C("MDA", "Moldova"),
  MG: C("MDG", "Madagascar"),
  MV: C("MDV", "Maldives"),
  ML: C("MLI", "Mali"),
  MM: C("MMR", "Myanmar"),
  MN: C("MNG", "Mongolia"),
  MZ: C("MOZ", "Mozambique"),
  MR: C("MRT", "Mauritania"),
  MU: C("MUS", "Mauritius"),
  MW: C("MWI", "Malawi"),
  MY: C("MYS", "Malaysia"),
  NA: C("NAM", "Namibia"),
  NE: C("NER", "Niger"),
  NG: C("NGA", "Nigeria"),
  NI: C("NIC", "Nicaragua"),
  NP: C("NPL", "Nepal"),
  OM: C("OMN", "Oman"),
  PK: C("PAK", "Pakistan"),
  PA: C("PAN", "Panama"),
  PE: C("PER", "Peru"),
  PH: C("PHL", "Philippines"),
  PY: C("PRY", "Paraguay"),
  PS: C("PSE", "Palestine (West Bank and Gaza)"),
  QA: C("QAT", "Qatar"),
  RU: C("RUT", "Russia"),
  RW: C("RWA", "Rwanda"),
  SA: C("SAU", "Saudi Arabia"),
  SD: C("SDN", "Sudan"),
  SN: C("SEN", "Senegal"),
  SG: C("SGP", "Singapore"),
  SL: C("SLE", "Sierra Leone"),
  SV: C("SLV", "El Salvador"),
  SO: C("SOM", "Somalia"),
  SS: C("SSD", "South Sudan"),
  ST: C("STP", "Sao Tome and Principe"),
  SR: C("SUR", "Suriname"),
  SZ: C("SWZ", "Eswatini"),
  SC: C("SYC", "Seychelles"),
  SY: C("SYR", "Syria"),
  TD: C("TCD", "Chad"),
  TG: C("TGO", "Togo"),
  TH: C("THA", "Thailand"),
  TJ: C("TJK", "Tajikistan"),
  TM: C("TKM", "Turkmenistan"),
  TL: C("TLS", "Timor-Leste"),
  TT: C("TTO", "Trinidad and Tobago"),
  TN: C("TUN", "Tunisia"),
  TW: C("TWN", "Taiwan"),
  TZ: C("TZA", "Tanzania"),
  UG: C("UGA", "Uganda"),
  UA: C("UKR", "Ukraine"),
  UY: C("URY", "Uruguay"),
  UZ: C("UZB", "Uzbekistan"),
  VC: C("VCT", "Saint Vincent and the Grenadines"),
  VN: C("VNM", "Vietnam"),
  XK: C("XKX", "Kosovo"),
  ZA: C("ZAF", "South Africa"),
  ZM: C("ZMB", "Zambia"),
  ZW: C("ZWE", "Zimbabwe"),
};

// ---------- spending headings: everyday words -> ICP series ----------

export interface SpendDef { series: string; label: string; words: string[] }
const S = (series: string, label: string, words: string): SpendDef => ({ series, label, words: words.split("|").map((w) => w.trim()) });

export const SPENDS: SpendDef[] = [
  S("9100000", "all household consumption", "|all|overall|total|everything|general|cost of living|household consumption|consumption|households|prices"),
  S("1101000", "food and non-alcoholic beverages", "food and drink|food and non-alcoholic beverages|supermarket|groceries|grocery"),
  S("1101100", "food", "food"),
  S("1101110", "bread and cereals", "bread|cereals|bread and cereals|grains|rice|pasta|flour"),
  S("1101120", "meat", "meat|beef|pork|lamb|chicken|poultry"),
  S("1101130", "fish and seafood", "fish|seafood|fish and seafood"),
  S("1101140", "milk, cheese and eggs", "dairy|milk|eggs|cheese|milk and dairy|dairy and eggs|milk, cheese and eggs"),
  S("1101150", "oils and fats", "oils|fats|oils and fats|butter|cooking oil"),
  S("1101160", "fruit", "fruit|fruits"),
  S("1101170", "vegetables", "vegetables|veg|potatoes|pulses|beans"),
  S("1101180", "sugar, jam, honey, chocolate and confectionery", "sugar|sweets|confectionery|chocolate|honey|jam"),
  S("1101200", "non-alcoholic beverages", "soft drinks|non-alcoholic beverages|non alcoholic beverages|juice|water|coffee|tea|drinks"),
  S("1102100", "alcoholic beverages", "alcohol|alcoholic beverages|beer|wine|spirits"),
  S("1102200", "tobacco", "tobacco|cigarettes|smoking"),
  S("1103000", "clothing and footwear", "clothing|clothes|footwear|shoes|fashion|clothing and footwear"),
  S("9060000", "housing, water, electricity, gas and other fuels", "housing|rent|utilities|energy|electricity|gas|water|housing and utilities|housing, water, electricity and gas"),
  S("1105000", "furnishings, household equipment and household maintenance", "furnishings|furniture|household equipment|household|home|appliances|home goods"),
  S("9080000", "health", "health|healthcare|medical|medicine|medicines|hospital|doctor"),
  S("1107000", "transport", "transport|transportation|travel|getting around|fuel and transport"),
  S("1107100", "purchase of vehicles", "cars|vehicles|car|new cars|vehicle purchase|car purchase"),
  S("1107300", "transport services", "transport services|public transport|taxis|bus|train"),
  S("1108000", "communication", "communication|information and communication|phones|telecoms|internet|broadband|mobile"),
  S("9110000", "recreation and culture", "recreation|leisure|sport|culture|entertainment|recreation and culture"),
  S("9120000", "education", "education|schooling|tuition|education services"),
  S("1111000", "restaurants and hotels", "restaurants|hotels|restaurants and hotels|eating out|dining|accommodation"),
  S("9140000", "miscellaneous goods and services", "miscellaneous|other|insurance|personal care"),
  S("1000000", "gross domestic product (whole economy)", "gdp|gross domestic product|whole economy|economy"),
];

export const SPEND_HELP =
  "spend is one of 'food', 'bread and cereals', 'meat', 'fish', 'dairy', 'oils and fats', 'fruit', 'vegetables', 'sugar', 'soft drinks', 'alcohol', 'tobacco', 'clothing', 'housing' (rent, water, energy), " +
  "'furnishings', 'health', 'transport', 'cars', 'communication', 'recreation', 'education', 'restaurants and hotels' or 'gdp'; leave out for all household consumption";

export function matchSpend(raw?: string): SpendDef {
  const w = (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!w) return SPENDS[0];
  const hit = SPENDS.find((g) => g.words.includes(w) || g.label.toLowerCase() === w || g.series === w);
  if (!hit) throw new InputError(`spend must be one of: food, bread and cereals, meat, fish, dairy, oils and fats, fruit, vegetables, sugar, soft drinks, alcohol, tobacco, clothing, housing, furnishings, health, transport, cars, communication, recreation, education, restaurants and hotels, gdp (or leave it out for all household consumption). Got '${raw}'.`);
  return hit;
}

/** compare_to: this source measures against the world average (default) and also states the gap to the United States. */
export function checkCompare(raw?: string): void {
  const w = (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w || ["world", "global", "icp", "worldaverage"].includes(w)) return;
  throw new InputError(`compare_to must be 'World' for this country (index World = 100; the gap to the United States is always included). Got '${raw}'.`);
}

// ---------- requests ----------

export const WB_BASE = "https://api.worldbank.org";
export const countryUrl = (iso3: string, series: string, host = WB_BASE) =>
  `${host}/v2/sources/90/country/${iso3}/series/${series}/time/YR2021?format=json`;

// ---------- parsing (pure) ----------

export interface Figures { index: number | null; ppp: number | null; perHeadPpp: number | null }

/** The World Bank JSON for one country and one heading -> the three measures we pass on. Throws SourceError on another shape. */
export function parseIcp(json: any): Figures {
  const rows = json?.source?.data;
  if (!Array.isArray(rows)) throw new SourceError("The World Bank reply has a shape we do not know", String(JSON.stringify(json ?? null)).slice(0, 250));
  const out: Figures = { index: null, ppp: null, perHeadPpp: null };
  for (const r of rows) {
    const cls = (r?.variable ?? []).find((v: any) => v?.concept === "Classification")?.id;
    const value = typeof r?.value === "number" && Number.isFinite(r.value) ? r.value : null;
    if (cls === "PX.WL") out.index = value;
    else if (cls === "PPPGlob") out.ppp = value;
    else if (cls === "PCAP.PP") out.perHeadPpp = value;
  }
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
export function gapPct(index: number, base: number): number { return round1((index / base - 1) * 100); }

// ---------- the answer ----------

export interface Ask { country: string; spend?: string; compare_to?: string; baseUrl?: string }
export type Fetcher = (url: string) => Promise<any>;

async function liveJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", accept: "application/json" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.json();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

const CACHE = new Map<string, { at: number; json: any }>();
const TTL_MS = 24 * 3600 * 1000;
/** The 2021 benchmark never changes, so a reply is kept for a day (the United States reply is asked for with every question). */
export async function cached(url: string, fetcher: Fetcher, now = Date.now()): Promise<any> {
  const hit = CACHE.get(url);
  if (hit && now - hit.at < TTL_MS) return hit.json;
  const json = await fetcher(url);
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(url, { at: now, json });
  return json;
}
export function clearCache(): void { CACHE.clear(); }

export const icpMethod = (spend: SpendDef) =>
  `World Bank International Comparison Program 2021: price level index for ${spend.label} (World = 100) from the international price survey; passed on as published, with the gap to the United States calculated by ProofPrice. An index, not a list of prices.`;

export async function icpPriceLevel(ask: Ask, fetcher: Fetcher = liveJson): Promise<PriceAnswer> {
  const cc = String(ask.country ?? "").toUpperCase();
  const def = COUNTRIES[cc];
  if (!def) throw new InputError(`Not yet available for ${cc}. Countries: ${Object.keys(COUNTRIES).join(", ")}.`);
  const spend = matchSpend(ask.spend);
  checkCompare(ask.compare_to);
  const [own, us] = await Promise.all([
    cached(countryUrl(def.iso3, spend.series), fetcher),
    cached(countryUrl("USA", spend.series), fetcher),
  ]);
  const mine = parseIcp(own);
  const usa = parseIcp(us);
  const query: Record<string, unknown> = { country: cc, ...(ask.spend ? { spend: spend.label } : {}) };
  const unit = "price level index (World = 100)";
  if (mine.index === null) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "INDEX", unit, period: { from: null, to: null }, reference_period: "2021",
      method: icpMethod(spend), describe: () => "", baseUrl: ask.baseUrl,
      extra: { reason: `The World Bank ICP holds no 2021 ${spend.label} price level for ${def.name}.` },
    });
  }
  const gapUs = usa.index !== null ? gapPct(mine.index, usa.index) : null;
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value: mine.index,
    measure: "average",
    currency: "INDEX",
    unit,
    period: { from: "2021-01-01", to: "2021-12-31" },
    reference_period: "2021",
    method: icpMethod(spend),
    note: "A price level index from the ICP 2021 survey, not a shop price or a receipt.",
    describe: (v) =>
      `Prices for ${spend.label} in ${def.name} were at an index of ${round1(v)} in 2021 (world average = 100)` +
      (gapUs === null ? "." : gapUs === 0 ? ", the same as the United States." : `, ${Math.abs(gapUs)}% ${gapUs > 0 ? "above" : "below"} the United States.`),
    baseUrl: ask.baseUrl,
    extra: {
      index: true,
      spending_group: spend.label,
      icp_series: spend.series,
      comparison_area: "the world average (World = 100)",
      price_level_index: round1(mine.index),
      price_level_index_united_states: usa.index !== null ? round1(usa.index) : null,
      percent_vs_united_states: gapUs,
      ppp_national_currency_per_us_dollar: mine.ppp !== null ? round2(mine.ppp) : null,
      expenditure_per_head_ppp_usd: mine.perHeadPpp !== null ? Math.round(mine.perHeadPpp) : null,
      spending_groups: SPENDS.map((s) => s.label),
    },
  });
  return { ...answer, confidence: "medium" };
}
