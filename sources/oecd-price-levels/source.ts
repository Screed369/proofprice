// OECD / Eurostat purchasing power parity (PPP) programme: price level indices by country and spending group.
// Dataflow OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1 "PPP detailed results, 2022 onwards" on the OECD SDMX API. Key-free plain GET, CSV with labels.
// Formats checked live on 2026-10-20 through the GitHub probe (see fixtures.ts). One GET per request:
//   <base>/public/rest/data/OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1/.A.PL+PPP.<CATEGORY>..<BASE>?lastNObservations=5&format=csvfilewithlabels
//   One GET per spending group and comparison area returns every country (index + PPP rate, last years); we pick the country and rank it.
//   The OECD API limits each IP address to about 20 queries an hour, so replies are kept in memory for 6 hours (see cached()).
//   Do NOT send an Accept header: the OECD answered HTTP 500 to 'accept: text/csv' from Vercel; format=csvfilewithlabels in the URL is enough.
// MEASURE PL = price level index (IX; comparison area = 100); MEASURE PPP = national currency per US dollar (XDC_USD) or per euro (XDC_EUR).
// An index is an official statistic from a price survey, never a price people paid, so every answer is price_type "official_statistic"
// (range fields null, sample_size null) with confidence "medium".

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "oecd-price-levels",
  country: "38 OECD countries plus Bulgaria, Cyprus, Malta, Romania and some Balkan states",
  category: "price-levels (price level index from the PPP survey)",
  name: "OECD / Eurostat PPP programme: price level indices by spending group",
  publisher: "OECD Statistics Directorate, with Eurostat (Eurostat-OECD PPP Programme, itself part of the World Bank's International Comparison Program)",
  what_is_recorded:
    "For each country and year since 2022, the price level index of household consumption and its groups (food, housing, transport, health, clothing, restaurants and more, about 50 headings), " +
    "compared with the OECD average, the USA or the EU average (= 100), and the PPP rate in national currency per US dollar. Built from shop and service price surveys run by the national statistics offices.",
  price_type: "official_statistic",
  freshness: "Yearly: the newest published year was 2024 at the last check (2022 onwards); every answer states its year",
  licence: "OECD Terms and Conditions: data may be used for any purpose including commercial use, with credit to the OECD",
  licence_url: "https://www.oecd.org/en/about/terms-conditions.html",
  attribution:
    "Source: OECD (2026), Purchasing power parities detailed results (dataflow DSD_PPP@DF_PPP), https://sdmx.oecd.org, used under the OECD Terms and Conditions. " +
    "Figures are passed on as published; ranks and the percentage gap to the comparison average are calculated by ProofPrice.",
  homepage: "https://www.oecd.org/en/data/indicators/purchasing-power-parities-ppp.html",
  limits:
    "A price LEVEL INDEX for the whole country from an international price survey, not a shop price, not a receipt and not what any household paid. " +
    "There is no range and no count of prices behind a figure. It compares countries in one year; it does not say what a given product costs. " +
    "Aggregate headings can differ in definition from national statistics. Croatia is left out because its 2024 series is not comparable after the euro changeover.",
};

// ---------- countries: ISO2 -> OECD code and name ----------

export interface CountryDef { iso3: string; name: string }
const C = (iso3: string, name: string): CountryDef => ({ iso3, name });

export const COUNTRIES: Record<string, CountryDef> = {
  AU: C("AUS", "Australia"), AT: C("AUT", "Austria"), BE: C("BEL", "Belgium"), CA: C("CAN", "Canada"), CL: C("CHL", "Chile"),
  CO: C("COL", "Colombia"), CR: C("CRI", "Costa Rica"), CZ: C("CZE", "Czechia"), DK: C("DNK", "Denmark"), EE: C("EST", "Estonia"),
  FI: C("FIN", "Finland"), FR: C("FRA", "France"), DE: C("DEU", "Germany"), GR: C("GRC", "Greece"), HU: C("HUN", "Hungary"),
  IS: C("ISL", "Iceland"), IE: C("IRL", "Ireland"), IL: C("ISR", "Israel"), IT: C("ITA", "Italy"), JP: C("JPN", "Japan"),
  KR: C("KOR", "South Korea"), LV: C("LVA", "Latvia"), LT: C("LTU", "Lithuania"), LU: C("LUX", "Luxembourg"), MX: C("MEX", "Mexico"),
  NL: C("NLD", "Netherlands"), NZ: C("NZL", "New Zealand"), NO: C("NOR", "Norway"), PL: C("POL", "Poland"), PT: C("PRT", "Portugal"),
  SK: C("SVK", "Slovakia"), SI: C("SVN", "Slovenia"), ES: C("ESP", "Spain"), SE: C("SWE", "Sweden"), CH: C("CHE", "Switzerland"),
  TR: C("TUR", "Turkey"), GB: C("GBR", "United Kingdom"), US: C("USA", "United States"),
  BG: C("BGR", "Bulgaria"), CY: C("CYP", "Cyprus"), MT: C("MLT", "Malta"), RO: C("ROU", "Romania"), AL: C("ALB", "Albania"),
  BA: C("BIH", "Bosnia and Herzegovina"), MK: C("MKD", "North Macedonia"), ME: C("MNE", "Montenegro"), RS: C("SRB", "Serbia"),
};
const NAME_BY_ISO3: Record<string, string> = Object.fromEntries(Object.values(COUNTRIES).map((c) => [c.iso3, c.name]));

// ---------- spending groups: everyday words -> OECD ANALYTICAL_CATEGORIES code ----------

export interface SpendDef { code: string; label: string; words: string[] }
const S = (code: string, label: string, words: string): SpendDef => ({ code, label, words: words.split("|").map((w) => w.trim()) });

export const SPENDS: SpendDef[] = [
  S("A01", "all household consumption", "|all|overall|total|everything|general|cost of living|household consumption|consumption|actual individual consumption|prices"),
  S("A0101", "food and non-alcoholic beverages", "food|groceries|grocery|food and drink|food and non-alcoholic beverages|supermarket"),
  S("A01010102", "meat", "meat|beef|pork|lamb|chicken|poultry"),
  S("A01010103", "fish and seafood", "fish|seafood|fish and seafood"),
  S("A01010104", "milk, dairy products and eggs", "dairy|milk|eggs|cheese|milk and dairy|dairy and eggs"),
  S("A01010101", "cereals and cereal products", "bread|cereals|bread and cereals|grains|rice|pasta|flour"),
  S("A01010105", "oils and fats", "oils|fats|oils and fats|butter|cooking oil"),
  S("A01010106", "fruit and nuts", "fruit|fruits|nuts|fruit and nuts"),
  S("A01010107", "vegetables, tubers and pulses", "vegetables|veg|potatoes|pulses|beans"),
  S("A01010108", "sugar, confectionery and desserts", "sugar|sweets|confectionery|chocolate|desserts"),
  S("A010102", "non-alcoholic beverages", "soft drinks|non-alcoholic beverages|non alcoholic beverages|juice|water|coffee|tea|drinks"),
  S("A010201", "alcoholic beverages", "alcohol|alcoholic beverages|beer|wine|spirits"),
  S("A010203", "tobacco", "tobacco|cigarettes|smoking"),
  S("A0103", "clothing and footwear", "clothing|clothes|footwear|shoes|fashion|clothing and footwear"),
  S("A0104", "housing, water, electricity, gas and other fuels", "housing|rent|utilities|energy|electricity|gas|water|housing and utilities|housing, water, electricity and gas"),
  S("A0105", "furnishings, household equipment and routine household maintenance", "furnishings|furniture|household equipment|household|home|appliances|home goods"),
  S("A0106", "health", "health|healthcare|medical|medicine|medicines|hospital|doctor"),
  S("A0107", "transport", "transport|transportation|travel|getting around|fuel and transport"),
  S("A010701", "purchase of vehicles", "cars|vehicles|car|new cars|vehicle purchase|car purchase"),
  S("A0108", "information and communication", "communication|information and communication|phones|telecoms|internet|broadband|mobile"),
  S("A0109", "recreation, sport and culture", "recreation|leisure|sport|culture|entertainment|recreation and culture"),
  S("A0110", "education services", "education|schooling|tuition|education services"),
  S("A0111", "restaurants and accommodation services", "restaurants|hotels|restaurants and hotels|eating out|dining|accommodation|restaurants and accommodation"),
  S("A0112", "miscellaneous goods and services", "miscellaneous|other|insurance|personal care"),
  S("P0101", "consumer goods", "goods|consumer goods"),
  S("P0201", "consumer services", "services|consumer services"),
  S("A0", "gross domestic product (whole economy)", "gdp|gross domestic product|whole economy|economy"),
];

export const SPEND_HELP =
  "spend is one of 'food', 'meat', 'fish', 'dairy', 'bread and cereals', 'oils and fats', 'fruit', 'vegetables', 'sugar', 'soft drinks', 'alcohol', 'tobacco', 'clothing', 'housing' (rent, water, energy), " +
  "'furnishings', 'health', 'transport', 'cars', 'communication', 'recreation', 'education', 'restaurants and hotels', 'goods' or 'services'; leave out for all household consumption";

export function matchSpend(raw?: string): SpendDef {
  const w = (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!w) return SPENDS[0];
  const hit = SPENDS.find((g) => g.words.includes(w) || g.label.toLowerCase() === w || g.code.toLowerCase() === w);
  if (!hit) throw new InputError(`spend must be one of: food, meat, fish, dairy, bread and cereals, oils and fats, fruit, vegetables, sugar, soft drinks, alcohol, tobacco, clothing, housing, furnishings, health, transport, cars, communication, recreation, education, restaurants and hotels, goods, services (or leave it out for all household consumption). Got '${raw}'.`);
  return hit;
}

// ---------- the comparison area ----------

export interface BaseDef { code: string; label: string; ppp_unit: string; ppp_label: string }
export const BASES: Record<string, BaseDef> = {
  OECD: { code: "OECD", label: "the OECD average", ppp_unit: "XDC_USD", ppp_label: "US dollar" },
  USA: { code: "USA", label: "the United States", ppp_unit: "XDC_USD", ppp_label: "US dollar" },
  EU: { code: "EU27_2020", label: "the EU-27 average", ppp_unit: "XDC_EUR", ppp_label: "euro" },
};
export function matchBase(raw?: string): BaseDef {
  const w = (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w || w === "oecd") return BASES.OECD;
  if (["usa", "us", "unitedstates", "america", "usd", "dollar"].includes(w)) return BASES.USA;
  if (["eu", "eu27", "eu272020", "europe", "europeanunion", "euro"].includes(w)) return BASES.EU;
  throw new InputError(`compare_to must be OECD, USA or EU. Got '${raw}'.`);
}

// ---------- requests ----------

const DATAFLOW = "OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1";
export const OECD_BASE = "https://sdmx.oecd.org";
export const allCountriesUrl = (spend: SpendDef, base: BaseDef, host = OECD_BASE) =>
  `${host}/public/rest/data/${DATAFLOW}/.A.PL+PPP.${spend.code}..${base.code}?lastNObservations=5&format=csvfilewithlabels`;

// ---------- parsing (pure) ----------

/** Minimal CSV reader: quoted fields, commas and doubled quotes inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export interface Obs { area: string; measure: string; category: string; categoryName: string; unit: string; base: string; year: number; value: number; status: string }

/** The OECD CSV with labels -> one Obs per data row. Throws SourceError when the columns are not the ones we know. */
export function parseObs(csv: string): Obs[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const head = rows[0];
  const need = ["REF_AREA", "MEASURE", "ANALYTICAL_CATEGORIES", "Analytical categories", "UNIT_MEASURE", "BASE_REF_AREA", "TIME_PERIOD", "OBS_VALUE"];
  const idx: Record<string, number> = {};
  head.forEach((h, i) => { idx[h] = i; });
  const missing = need.filter((n) => idx[n] === undefined);
  if (missing.length) throw new SourceError("The OECD reply has columns we do not know", `missing ${missing.join(", ")}; got ${head.slice(0, 12).join("|")}`.slice(0, 250));
  const out: Obs[] = [];
  for (const r of rows.slice(1)) {
    const value = Number(r[idx.OBS_VALUE]);
    const year = Number(r[idx.TIME_PERIOD]);
    if (!Number.isFinite(value) || r[idx.OBS_VALUE] === "" || !Number.isFinite(year)) continue;
    out.push({
      area: r[idx.REF_AREA], measure: r[idx.MEASURE], category: r[idx.ANALYTICAL_CATEGORIES], categoryName: r[idx["Analytical categories"]],
      unit: r[idx.UNIT_MEASURE], base: r[idx.BASE_REF_AREA], year, value, status: idx.OBS_STATUS !== undefined ? r[idx.OBS_STATUS] ?? "" : "",
    });
  }
  return out;
}

export interface YearRow { year: number; index: number | null; ppp: number | null }

/** Obs of one country -> one row per year (newest first) with the price level index and the PPP rate side by side. */
export function byYear(obs: Obs[], iso3: string, spend: SpendDef, base: BaseDef): YearRow[] {
  const years = new Map<number, YearRow>();
  for (const o of obs) {
    if (o.area !== iso3 || o.category !== spend.code || o.base !== base.code) continue;
    const r = years.get(o.year) ?? { year: o.year, index: null, ppp: null };
    if (o.measure === "PL" && o.unit === "IX") r.index = o.value;
    else if (o.measure === "PPP" && o.unit === base.ppp_unit) r.ppp = o.value;
    years.set(o.year, r);
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

/** Countries only (aggregates such as OECD, EA20, EU27_2020 and Croatia are left out), newest year of the file, sorted dearest first. */
export function rankTable(obs: Obs[]): { year: number | null; table: { iso3: string; name: string; index: number }[] } {
  const rows = obs.filter((o) => o.measure === "PL" && o.unit === "IX" && NAME_BY_ISO3[o.area]);
  const year = rows.length ? Math.max(...rows.map((r) => r.year)) : null;
  const table = rows.filter((r) => r.year === year).map((r) => ({ iso3: r.area, name: NAME_BY_ISO3[r.area], index: r.value })).sort((a, b) => b.index - a.index);
  return { year, table };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
export function gapPct(index: number): number { return round1(index - 100); }

// ---------- the answer ----------

export interface Ask { country: string; spend?: string; compare_to?: string; baseUrl?: string }
export type Fetcher = (url: string) => Promise<string>;

async function liveText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

const CACHE = new Map<string, { at: number; text: string }>();
const TTL_MS = 6 * 3600 * 1000;
/** Keeps the (large, rarely changing) OECD reply for six hours so a busy instance asks the OECD only a few times an hour. */
export async function cached(url: string, fetcher: Fetcher, now = Date.now()): Promise<string> {
  const hit = CACHE.get(url);
  if (hit && now - hit.at < TTL_MS) return hit.text;
  const text = await fetcher(url);
  if (CACHE.size > 60) CACHE.clear();
  CACHE.set(url, { at: now, text });
  return text;
}
export function clearCache(): void { CACHE.clear(); }

export const oecdMethod = (spend: SpendDef, base: BaseDef) =>
  `OECD/Eurostat PPP programme: price level index for ${spend.label}, with ${base.label} = 100, from the international price survey; passed on as published, with the percentage gap and the rank among surveyed countries calculated by ProofPrice. An index, not a list of prices.`;

export async function oecdPriceLevel(ask: Ask, fetcher: Fetcher = liveText): Promise<PriceAnswer> {
  const cc = String(ask.country ?? "").toUpperCase();
  const def = COUNTRIES[cc];
  if (!def) throw new InputError(`Not yet available for ${cc}. Countries: ${Object.keys(COUNTRIES).join(", ")}.`);
  const spend = matchSpend(ask.spend);
  const base = matchBase(ask.compare_to);
  const obs = parseObs(await cached(allCountriesUrl(spend, base), fetcher));
  const rows = byYear(obs, def.iso3, spend, base).filter((r) => r.index !== null);
  const query: Record<string, unknown> = { country: cc, ...(ask.spend ? { spend: spend.label } : {}), ...(ask.compare_to ? { compare_to: base.code } : {}) };
  const unit = `price level index (${base.label} = 100)`;
  const latest = rows[0];
  if (!latest) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "INDEX", unit, period: { from: null, to: null }, reference_period: "latest",
      method: oecdMethod(spend, base), describe: () => "", baseUrl: ask.baseUrl,
      extra: { reason: `The OECD holds no ${spend.label} price level for ${def.name} against ${base.label}.` },
    });
  }
  const { year: rankYear, table } = rankTable(obs);
  const pos = rankYear === latest.year ? table.findIndex((t) => t.iso3 === def.iso3) : -1;
  const rank = pos >= 0 ? { place: pos + 1, of: table.length, dearest: table[0].name, cheapest: table[table.length - 1].name } : null;
  const gap = gapPct(latest.index as number);
  const history = rows.map((r) => ({ year: r.year, price_level_index: r.index, ppp_national_currency_per_unit: r.ppp }));
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value: latest.index,
    measure: "average",
    currency: "INDEX",
    unit,
    period: { from: `${latest.year}-01-01`, to: `${latest.year}-12-31` },
    reference_period: String(latest.year),
    method: oecdMethod(spend, base),
    note: "A price level index from the PPP survey, not a shop price or a receipt.",
    describe: (v) =>
      `Prices for ${spend.label} in ${def.name} were at an index of ${round1(v)} in ${latest.year} (${base.label} = 100), ` +
      (gap === 0 ? `the same as ${base.label}` : `${Math.abs(gap)}% ${gap > 0 ? "above" : "below"} ${base.label}`) +
      (rank ? `; ${rank.place === 1 ? "the dearest" : `number ${rank.place} most expensive`} of ${rank.of} countries surveyed.` : "."),
    baseUrl: ask.baseUrl,
    extra: {
      index: true,
      spending_group: spend.label,
      oecd_category_code: spend.code,
      comparison_area: base.label,
      price_level_index: latest.index,
      percent_above_comparison: gap,
      ppp_national_currency_per_unit: latest.ppp,
      ppp_unit: `national currency per ${base.ppp_label}`,
      rank,
      history,
      spending_groups: SPENDS.map((s) => s.label),
    },
  });
  return { ...answer, confidence: "medium" };
}
