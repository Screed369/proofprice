// World Bank "Food Prices for Nutrition" (FPN 5.0, World Bank DataBank source 88): the modelled cost of the cheapest healthy diet
// per person per day, one national figure per country and year (2017 onwards), in local currency units (LCU) and in 2021 PPP dollars.
// Formats checked live on 2026-10-18 through the GitHub probe (see fixtures.ts). One small GET per request, no key:
//   https://api.worldbank.org/v2/sources/88/country/<ISO3>/series/<CoHD_..._LCU>;<CoHD_..._PPP>/time/all?format=json&per_page=500
// WARNING: the usual /v2/country/<c>/indicator/<i>?source=88 form fails ("indicator not found"); only the /sources/88/... form works.
// The World Bank gives one modelled figure, no distribution and no record count, so every answer is an official statistic
// (value + measure "average", range fields null, sample_size null) with confidence "low" because it is a model, not a transaction.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "wb-fpn-diet-costs",
  country: "About 90 countries worldwide",
  category: "diet-costs (modelled cost of a healthy diet per person per day)",
  name: "Food Prices for Nutrition 5.0: cost of a healthy diet (World Bank)",
  publisher: "World Bank, Development Data Group, with Tufts University (Food Prices for Nutrition project)",
  what_is_recorded:
    "For each country and year since 2017, the modelled cost of the cheapest set of foods that meets a healthy-diet standard, per person per day, in local currency and in PPP dollars, " +
    "plus the cost of fruit, vegetables, animal-source foods, legumes/nuts/seeds, oils/fats and starchy staples within that diet. Built from the food price survey of the International Comparison Program; one published national figure per country and year.",
  price_type: "official_statistic",
  freshness: "Roughly yearly: version 5.0 was last updated on 2026-07-21 and holds 2017 to 2025; every answer states its year",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), per the World Bank Data Catalog record 0061222",
  licence_url: "https://datacatalog.worldbank.org/public-licenses?fragment=cc",
  attribution:
    "Source: World Bank, Food Prices for Nutrition (FPN 5.0), https://databank.worldbank.org/source/food-prices-for-nutrition, licensed CC BY 4.0. " +
    "Figures are passed on as published; the change on the previous year is calculated by ProofPrice.",
  homepage: "https://databank.worldbank.org/source/food-prices-for-nutrition",
  limits:
    "A modelled estimate of the least-cost healthy diet for the whole country, not a shop price, not a receipt and not what any household paid. " +
    "There is no range and no count of prices behind a figure, and it uses 2021 food price survey data and PPP factors carried forward. " +
    "Local-currency figures are in the country's own currency at the prices of that year. Food-group figures are blank for some countries and years.",
};

// ---------- countries: ISO2 -> World Bank code, name, currency ----------

export interface CountryDef {
  iso3: string;
  name: string;
  currency: string; // ISO 4217 code of the local currency unit the World Bank reports
}
const C = (iso3: string, name: string, currency: string): CountryDef => ({ iso3, name, currency });

/** Countries we answer for. Currencies are the national currency of the whole 2017-2025 series (so Croatia and Bulgaria, which changed currency in 2023 and 2026, are left out). */
export const COUNTRIES: Record<string, CountryDef> = {
  IE: C("IRL", "Ireland", "EUR"), GB: C("GBR", "United Kingdom", "GBP"), FR: C("FRA", "France", "EUR"), ES: C("ESP", "Spain", "EUR"),
  PT: C("PRT", "Portugal", "EUR"), IT: C("ITA", "Italy", "EUR"), DE: C("DEU", "Germany", "EUR"), NL: C("NLD", "Netherlands", "EUR"),
  BE: C("BEL", "Belgium", "EUR"), AT: C("AUT", "Austria", "EUR"), PL: C("POL", "Poland", "PLN"), DK: C("DNK", "Denmark", "DKK"),
  SE: C("SWE", "Sweden", "SEK"), NO: C("NOR", "Norway", "NOK"), FI: C("FIN", "Finland", "EUR"), GR: C("GRC", "Greece", "EUR"),
  LU: C("LUX", "Luxembourg", "EUR"), CH: C("CHE", "Switzerland", "CHF"), IS: C("ISL", "Iceland", "ISK"), CZ: C("CZE", "Czechia", "CZK"),
  HU: C("HUN", "Hungary", "HUF"), RO: C("ROU", "Romania", "RON"), SK: C("SVK", "Slovakia", "EUR"), SI: C("SVN", "Slovenia", "EUR"),
  EE: C("EST", "Estonia", "EUR"), LV: C("LVA", "Latvia", "EUR"), LT: C("LTU", "Lithuania", "EUR"), CY: C("CYP", "Cyprus", "EUR"),
  MT: C("MLT", "Malta", "EUR"), TR: C("TUR", "Turkey", "TRY"), UA: C("UKR", "Ukraine", "UAH"),
  US: C("USA", "United States", "USD"), CA: C("CAN", "Canada", "CAD"), MX: C("MEX", "Mexico", "MXN"), BR: C("BRA", "Brazil", "BRL"),
  AR: C("ARG", "Argentina", "ARS"), CL: C("CHL", "Chile", "CLP"), CO: C("COL", "Colombia", "COP"), PE: C("PER", "Peru", "PEN"),
  AU: C("AUS", "Australia", "AUD"), NZ: C("NZL", "New Zealand", "NZD"), SG: C("SGP", "Singapore", "SGD"), JP: C("JPN", "Japan", "JPY"),
  KR: C("KOR", "South Korea", "KRW"), TW: C("TWN", "Taiwan", "TWD"), HK: C("HKG", "Hong Kong", "HKD"), CN: C("CHN", "China", "CNY"),
  IN: C("IND", "India", "INR"), ID: C("IDN", "Indonesia", "IDR"), TH: C("THA", "Thailand", "THB"), VN: C("VNM", "Vietnam", "VND"),
  MY: C("MYS", "Malaysia", "MYR"), PH: C("PHL", "Philippines", "PHP"), PK: C("PAK", "Pakistan", "PKR"), BD: C("BGD", "Bangladesh", "BDT"),
  LK: C("LKA", "Sri Lanka", "LKR"), AE: C("ARE", "United Arab Emirates", "AED"), SA: C("SAU", "Saudi Arabia", "SAR"), IL: C("ISR", "Israel", "ILS"),
  EG: C("EGY", "Egypt", "EGP"), MA: C("MAR", "Morocco", "MAD"), ZA: C("ZAF", "South Africa", "ZAR"), NG: C("NGA", "Nigeria", "NGN"),
  KE: C("KEN", "Kenya", "KES"), GH: C("GHA", "Ghana", "GHS"), TZ: C("TZA", "Tanzania", "TZS"), UG: C("UGA", "Uganda", "UGX"), ET: C("ETH", "Ethiopia", "ETB"),
};

// ---------- food groups: everyday words -> the World Bank series prefix ----------

export interface GroupDef {
  key: string; // series prefix ("" = the whole diet)
  label: string;
  words: string[];
}
const G = (key: string, label: string, words: string): GroupDef => ({ key, label, words: words.split("|").map((w) => w.trim()) });

export const GROUPS: GroupDef[] = [
  G("", "healthy diet (whole)", "|all|total|whole|diet|healthy diet|whole diet|overall"),
  G("f", "fruit", "fruit|fruits"),
  G("v", "vegetables", "vegetable|vegetables|veg|veggies"),
  G("asf", "animal-source foods", "animal foods|animal source foods|animal-source foods|animal|meat|dairy|fish|eggs|protein|milk"),
  G("lns", "legumes, nuts and seeds", "legumes and nuts|legumes|nuts|seeds|beans|pulses|legumes nuts and seeds|legumes, nuts and seeds"),
  G("of", "oils and fats", "oils and fats|oils|fats|oil|fat|cooking oil"),
  G("ss", "starchy staples", "starchy staples|starchy|staples|grains|cereals|bread|rice|potatoes|starch"),
];

export const GROUP_HELP =
  "food_group is one of 'fruit', 'vegetables', 'animal foods' (meat, dairy, fish, eggs), 'legumes and nuts', 'oils and fats' or 'starchy staples' (grains, bread, rice, potatoes); leave out for the whole healthy diet";

export function matchGroup(raw?: string): GroupDef {
  const w = (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!w) return GROUPS[0];
  const hit = GROUPS.find((g) => g.words.includes(w) || g.label.toLowerCase() === w);
  if (!hit) throw new InputError(`food_group must be one of: fruit, vegetables, animal foods, legumes and nuts, oils and fats, starchy staples (or leave it out for the whole healthy diet). Got '${raw}'.`);
  return hit;
}

/** Series ids for a group: local-currency and PPP. */
export function seriesFor(g: GroupDef): { lcu: string; ppp: string } {
  const mid = g.key ? `${g.key}_` : "";
  return { lcu: `CoHD_${mid}LCU`, ppp: `CoHD_${mid}PPP` };
}

export function requestUrl(iso3: string, g: GroupDef, base = "https://api.worldbank.org"): string {
  const s = seriesFor(g);
  return `${base}/v2/sources/88/country/${iso3}/series/${s.lcu};${s.ppp}/time/all?format=json&per_page=500`;
}

// ---------- parsing (pure) ----------

export interface Cell {
  iso3: string;
  country: string;
  series: string;
  year: number;
  value: number | null;
}

/** The World Bank reply -> one Cell per country, series and year. Values may be null. Throws SourceError on a shape we do not know. */
export function parseFpn(json: unknown): { cells: Cell[]; lastUpdated: string | null } {
  const j = json as any;
  if (Array.isArray(j) && j[0]?.message) {
    const msg = j[0].message?.[0]?.value ?? "unknown error";
    throw new SourceError("The World Bank API refused the request", String(msg).slice(0, 200));
  }
  const data = j?.source?.data;
  if (!Array.isArray(data)) throw new SourceError("The World Bank API reply has no data section", JSON.stringify(j ?? null).slice(0, 200));
  const cells: Cell[] = [];
  for (const row of data) {
    const v: Record<string, { id: string; value: string }> = {};
    for (const x of row?.variable ?? []) v[x.concept] = x;
    const year = Number(String(v.Time?.id ?? "").replace(/^YR/, ""));
    if (!v.Country || !v.Series || !Number.isFinite(year)) continue;
    const value = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
    cells.push({ iso3: v.Country.id, country: v.Country.value, series: v.Series.id, year, value });
  }
  return { cells, lastUpdated: typeof j.lastupdated === "string" ? j.lastupdated : null };
}

export interface YearRow {
  year: number;
  local: number | null;
  ppp: number | null;
}

/** Cells of one country -> one row per year (newest first), with the two series side by side. */
export function byYear(cells: Cell[], iso3: string, series: { lcu: string; ppp: string }): YearRow[] {
  const years = new Map<number, YearRow>();
  for (const c of cells) {
    if (c.iso3 !== iso3) continue;
    if (c.series !== series.lcu && c.series !== series.ppp) continue;
    const r = years.get(c.year) ?? { year: c.year, local: null, ppp: null };
    if (c.series === series.lcu) r.local = c.value;
    else r.ppp = c.value;
    years.set(c.year, r);
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

export function changePct(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;
}

const money = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

// ---------- the answer ----------

export interface Ask {
  country: string;
  food_group?: string;
  year?: number;
  baseUrl?: string;
}

export type Fetcher = (url: string) => Promise<unknown>;
const live: Fetcher = (url) => fetchJson(url, { headers: { accept: "application/json" } }, 15000);

export const wbMethod = (group: GroupDef) =>
  `World Bank Food Prices for Nutrition 5.0: modelled national cost of the ${group.label}, per person per day, in local currency and 2021 PPP dollars; passed on as published, with the change on the previous year calculated by ProofPrice. A model, not a list of sales.`;

export async function wbDietCost(ask: Ask, fetcher: Fetcher = live): Promise<PriceAnswer> {
  const cc = String(ask.country ?? "").toUpperCase();
  const def = COUNTRIES[cc];
  if (!def) throw new InputError(`Not yet available for ${cc}. Countries: ${Object.keys(COUNTRIES).join(", ")}.`);
  const group = matchGroup(ask.food_group);
  if (ask.year !== undefined && (!Number.isInteger(ask.year) || ask.year < 2017 || ask.year > 2100)) throw new InputError("year must be a four-digit year from 2017, for example 2023.");
  const series = seriesFor(group);
  const { cells, lastUpdated } = parseFpn(await fetcher(requestUrl(def.iso3, group)));
  const rows = byYear(cells, def.iso3, series).filter((r) => r.local !== null);
  const query: Record<string, unknown> = { country: cc, ...(group.key ? { food_group: group.label } : {}), ...(ask.year ? { year: ask.year } : {}) };

  const wanted = ask.year ? rows.find((r) => r.year === ask.year) : rows[0];
  const usable = wanted;
  if (!usable) {
    const years = rows.map((r) => r.year);
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: def.currency, unit: "per person per day",
      period: { from: null, to: null }, reference_period: ask.year ? String(ask.year) : "latest", method: wbMethod(group),
      describe: () => "", baseUrl: ask.baseUrl,
      extra: { available_years: years, reason: years.length ? `No ${group.label} figure for ${def.name} in ${ask.year}.` : `The World Bank holds no ${group.label} figure for ${def.name}.` },
    });
  }

  const prior = rows.find((r) => r.year === usable.year - 1);
  const change = prior ? changePct(usable.local as number, prior.local as number) : null;
  const history = rows.slice(0, 9).map((r) => ({ year: r.year, local: r.local, ppp_dollars: r.ppp }));
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value: usable.local,
    measure: "average",
    currency: def.currency,
    unit: "per person per day",
    period: { from: `${usable.year}-01-01`, to: `${usable.year}-12-31` },
    reference_period: String(usable.year),
    method: wbMethod(group),
    note: "Modelled estimate of the least-cost healthy diet, not a shop price or a receipt.",
    describe: (v) =>
      `The cheapest healthy diet in ${def.name} was modelled at about ${fmtMoney(v, def.currency)} per person per day in ${usable.year}` +
      (usable.ppp !== null ? ` (${money(usable.ppp)} PPP dollars)` : "") +
      (group.key ? `, of which ${group.label} cost this amount` : "") +
      (change !== null ? `; ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${usable.year - 1}` : "") + ".",
    baseUrl: ask.baseUrl,
    extra: {
      modelled: true,
      food_group: group.label,
      local_currency_per_person_per_day: usable.local,
      ppp_dollars_per_person_per_day: usable.ppp,
      change_on_previous_year_percent: change,
      history,
      data_updated: lastUpdated,
      food_groups: GROUPS.filter((g) => g.key).map((g) => g.label),
    },
  });
  return { ...answer, confidence: "low" };
}
