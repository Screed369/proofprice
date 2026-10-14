// Farmland prices and rents for the EU, Norway and Italy/Belgium (older data), from Eurostat's annual cubes
// apri_lprc = "Agricultural land prices by region" and apri_lrnt = "Agricultural land renting prices for one year by region".
// Format checked live on 2026-10-14 through the GitHub probe. Uses the universal JSON-stat adapter (lib/adapters/jsonstat.ts):
// one small request per answer (one country or one region, 15 years), no bulk download.
//
// What Eurostat publishes: for each country or region (NUTS code), year and land type, ONE average price (or rent) per hectare,
// in euro and in national currency, as reported by national authorities. There is no distribution and no record count, so the
// answer is an official statistic: value + measure "average", range fields null, sample_size null.
// Land data arrive late: on 2026-10-14 the newest year in both cubes is 2024, and some countries are years behind or have stopped.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { eurostatUrl, fetchEurostat, JsonStatRow, JsonStatTable, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { REGIONS } from "./regions";

export const INFO: SourceInfo = {
  id: "eu-land-prices",
  country: "EU member states (most), Norway (rent only)",
  category: "land-prices (farmland prices and rents)",
  name: "Agricultural land prices by region (apri_lprc) and agricultural land renting prices for one year by region (apri_lrnt)",
  publisher: "Eurostat (European Commission)",
  what_is_recorded:
    "For each country or region (NUTS code), year and land type: the average price per hectare of agricultural land, or the average rent paid for one year per hectare, " +
    "in euro and in national currency, reported to Eurostat by national authorities. One published figure per cell; never individual sales, leases, farms or parcels.",
  price_type: "official_statistic",
  freshness:
    "Annual. Eurostat publishes land data with a lag of about two years (on 2026-10-14 the newest year is 2024) and some countries are further behind; each answer states its reference year and flags old figures",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0); Eurostat authorises reuse for commercial and non-commercial purposes provided the source is acknowledged",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat, datasets apri_lprc (agricultural land prices by region, https://doi.org/10.2908/APRI_LPRC) " +
    "and apri_lrnt (agricultural land renting prices for one year by region, https://doi.org/10.2908/APRI_LRNT). " +
    "Reused under the Eurostat copyright notice (CC BY 4.0). Figures are passed on as published; the percentage change between years is calculated by ProofPrice.",
  homepage: "https://ec.europa.eu/eurostat/databrowser/view/apri_lprc/default/table?lang=en",
  limits:
    "National or regional averages per hectare, not a valuation of any field or farm and not an asking price. Definitions and sources differ between countries " +
    "(see Eurostat's metadata for apri_lpr), so levels are not strictly comparable across borders. Published about two years late; some countries are older still " +
    "(Belgium sale prices end in 2014, Italy's in 2020, Germany publishes none). Not every country reports every land type, and some figures are provisional or estimated.",
};

// ---------- what we know about the two datasets ----------

export type Measure = "price" | "rent";

interface Dataset {
  code: string; // Eurostat dataset code
  title: string; // Eurostat title
  word: string; // what the figure is, for sentences
  perUnit: string; // the unit shown in the answer
}

export const DATASETS: Record<Measure, Dataset> = {
  price: { code: "apri_lprc", title: "Agricultural land prices by region", word: "price", perUnit: "per hectare" },
  rent: { code: "apri_lrnt", title: "Agricultural land renting prices for one year by region", word: "rent", perUnit: "per hectare per year" },
};

export interface LandType {
  key: string; // our name
  code: string; // Eurostat agriprod code
  label: string; // Eurostat's label
  phrase: string; // for sentences: "arable land"
  measures: Measure[]; // which dataset has it
  aliases: string[];
}

export const LAND_TYPES: LandType[] = [
  { key: "arable", code: "ARA", label: "Arable land", phrase: "arable land", measures: ["price", "rent"], aliases: ["arable land", "cropland", "crop land", "farmland arable"] },
  {
    key: "permanent grassland", code: "J0000", label: "Permanent grassland", phrase: "permanent grassland", measures: ["price", "rent"],
    aliases: ["grassland", "permanent pasture", "pasture", "meadow", "grass", "permanent_grassland"],
  },
  {
    key: "arable or grassland", code: "ARA_J0000", label: "Arable land and/or permanent grassland", phrase: "arable land and/or permanent grassland", measures: ["rent"],
    aliases: ["all", "all agricultural land", "agricultural land", "farmland", "arable and grassland", "arable and/or grassland", "arable_or_grassland", "any"],
  },
  { key: "irrigable arable", code: "ARAIB", label: "Irrigable arable land", phrase: "irrigable arable land", measures: ["price"], aliases: ["irrigated", "irrigable", "irrigable arable land", "irrigated arable"] },
  {
    key: "non-irrigable arable", code: "ARAXIB", label: "Non-irrigable arable land", phrase: "non-irrigable arable land", measures: ["price"],
    aliases: ["non irrigable arable", "non-irrigable", "non irrigable", "dry arable", "rainfed", "non-irrigable arable land"],
  },
];

/** The land types tried when none is asked for: the first one with a recent figure wins. */
const DEFAULT_CHAIN: Record<Measure, string[]> = {
  price: ["arable", "permanent grassland"],
  rent: ["arable or grassland", "arable", "permanent grassland"],
};

/** ISO 3166 alpha-2 -> name, for every country this source holds a figure for (GR is Eurostat's EL). */
export const COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CZ: "Czechia", DK: "Denmark", EE: "Estonia", FI: "Finland", FR: "France",
  GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia", LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands",
  NO: "Norway", PL: "Poland", PT: "Portugal", RO: "Romania", SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden",
};

/** Years asked for from Eurostat. Wide enough that a country that stopped reporting years ago still shows its last figure. */
export const WINDOW_YEARS = 15;

/** Eurostat's own flags for individual figures. */
const FLAG_MEANING: Record<string, string> = {
  p: "provisional", e: "estimated", s: "a Eurostat estimate", b: "a break in the time series", d: "defined differently from other figures (see Eurostat's metadata)",
  u: "of low reliability", r: "revised", f: "a forecast", n: "not significant", i: "described in Eurostat's metadata", c: "confidential",
};
/** The same flags in two or three words, for the parenthesis in the summary sentence. */
const FLAG_SHORT: Record<string, string> = { d: "defined differently", b: "series break", u: "low reliability", s: "Eurostat estimate", i: "see Eurostat notes" };
const flagShort = (f: string) => FLAG_SHORT[f] ?? FLAG_MEANING[f] ?? f;

// ---------- parameter handling (pure) ----------

export function normaliseMeasure(raw?: string): Measure {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["price", "prices", "sale", "sale price", "sales", "purchase", "buy", "buying", "value", "land price", "land prices"].includes(s)) return "price";
  if (["rent", "rents", "rental", "renting", "lease", "leasing", "rent price", "land rent", "land rents", "renting price"].includes(s)) return "rent";
  throw new InputError('measure must be "price" (what farmland sells for per hectare) or "rent" (what it costs to rent per hectare for a year).');
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[\s_/]+/g, " ").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");

/** "grassland", "ARA", "arable land" -> the LandType. Empty -> null (the default chain applies). Throws InputError listing the choices. */
export function normaliseLandType(measure: Measure, raw?: string): LandType | null {
  const s = slug(raw ?? "");
  if (!s) return null;
  const hit = LAND_TYPES.find((t) => slug(t.key) === s || slug(t.code) === s || slug(t.label) === s || t.aliases.some((a) => slug(a) === s));
  const choices = LAND_TYPES.filter((t) => t.measures.includes(measure)).map((t) => `"${t.key}" (${t.label})`).join(", ");
  if (!hit) throw new InputError(`land_type for ${measure} must be one of: ${choices}. Leave it out for the usual one.`);
  if (!hit.measures.includes(measure)) throw new InputError(`Eurostat has no "${hit.key}" figure for ${measure}. For ${measure}, land_type can be: ${choices}.`);
  return hit;
}

/** A region (NUTS code) for a country, as the Eurostat geo code. Null/undefined -> the whole country. */
export function normaliseRegion(country: string, raw?: string): string | null {
  const s = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (!/^[A-Z]{2}[A-Z0-9]{0,3}$/.test(s)) {
    throw new InputError(`region must be a NUTS code such as ES51 or IE05 (two letters for the country, then up to three letters or digits), not "${raw}".`);
  }
  const geo = toEurostatGeo(s.slice(0, 2)) + s.slice(2); // GR43 -> EL43
  const want = toEurostatGeo(country);
  if (!geo.startsWith(want)) throw new InputError(`Region ${s} is not in ${COUNTRIES[country] ?? country}: its code must start with ${want}.`);
  return geo === want ? null : geo;
}

export function regionsOf(country: string): Array<{ code: string; name: string }> {
  return (REGIONS[toEurostatGeo(country)] ?? []).map(([code, name]) => ({ code, name }));
}

/** Currency of the "national currency" series for a country and year; "EUR" for euro-area members in that year. */
export function nationalCurrency(country: string, year: number): string {
  const own: Record<string, string> = { CZ: "CZK", DK: "DKK", HU: "HUF", NO: "NOK", PL: "PLN", RO: "RON", SE: "SEK" };
  if (own[country]) return own[country];
  if (country === "BG") return year >= 2026 ? "EUR" : "BGN"; // Bulgaria joined the euro on 1 January 2026
  if (country === "HR") return year >= 2023 ? "EUR" : "HRK"; // Croatia joined the euro on 1 January 2023
  return "EUR";
}

// ---------- reading the Eurostat cube (pure) ----------

export interface YearValue {
  year: number;
  value: number;
  flag: string | null;
  /** True when the euro figure is the national-currency figure of a euro-area country (Eurostat left the euro column empty). */
  viaNational?: boolean;
}

export interface LandTypeFigure extends YearValue {
  land_type: string;
  code: string;
  label: string;
}

export interface LandReading {
  country: string;
  countryName: string;
  geo: string; // Eurostat geo code asked for (country or region)
  regionName: string | null;
  measure: Measure;
  landType: LandType;
  usedDefault: boolean; // the land type was chosen by us, not asked for
  year: number;
  value: number;
  flag: string | null;
  previous: { year: number; value: number; change_percent: number } | null;
  history: YearValue[]; // oldest first
  national: { currency: string; price: number } | null;
  otherLandTypes: LandTypeFigure[]; // every land type with a figure for this place, each at its own latest year
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

export interface LandMiss {
  reason: "no_place" | "no_land_type" | "no_figures";
  available: LandTypeFigure[]; // what Eurostat does hold for this place (all land types), if anything
  datasetLatest: string | null;
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function seriesOf(rows: JsonStatRow[], unit: string, geo: string, code: string): YearValue[] {
  return rows
    .filter((r) => r.unit === unit && r.geo === geo && r.agriprod === code)
    .map((r) => ({ year: Number(r.time), value: r.value as number, flag: typeof r.status === "string" && r.status ? r.status : null }))
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => a.year - b.year);
}

/** The euro series. Where Eurostat has no euro figure for a year but the country already used the euro, its national-currency figure is in euro. */
function euroSeries(rows: JsonStatRow[], country: string, geo: string, code: string): YearValue[] {
  const eur = seriesOf(rows, "EUR_HA", geo, code);
  const have = new Set(eur.map((e) => e.year));
  const extra = seriesOf(rows, "NAC_HA", geo, code)
    .filter((n) => !have.has(n.year) && nationalCurrency(country, n.year) === "EUR")
    .map((n) => ({ ...n, viaNational: true }));
  return [...eur, ...extra].sort((a, b) => a.year - b.year);
}

/**
 * From a parsed apri_lprc / apri_lrnt slice (one country or region, every land type, units EUR_HA and NAC_HA) pick the answer:
 * the latest year that has a figure for the chosen land type (or, with no land type asked for, the first of the usual ones that is
 * recent), plus the context around it. Returns what Eurostat does hold when there is nothing to answer with.
 */
export function readLand(
  table: JsonStatTable,
  q: { country: string; measure: Measure; geo: string; landType: LandType | null },
): LandReading | LandMiss {
  const types = LAND_TYPES.filter((t) => t.measures.includes(q.measure));
  const datasetLatest = table.codes.time?.length ? table.codes.time[table.codes.time.length - 1] : null;
  const mine = table.rows.filter((r) => r.geo === q.geo);
  if (!mine.length) return { reason: "no_place", available: [], datasetLatest };

  const figure = (t: LandType): LandTypeFigure | null => {
    const s = euroSeries(mine, q.country, q.geo, t.code);
    const last = s[s.length - 1];
    return last ? { land_type: t.key, code: t.code, label: t.label, ...last } : null;
  };
  const available = types.map(figure).filter((f): f is LandTypeFigure => f !== null);

  let chosen: LandType | null = null;
  let usedDefault = false;
  if (q.landType) {
    chosen = available.some((f) => f.code === q.landType!.code) ? q.landType : null;
    if (!chosen) return { reason: "no_land_type", available, datasetLatest };
  } else {
    usedDefault = true;
    const chain = DEFAULT_CHAIN[q.measure].map((k) => available.find((f) => f.land_type === k)).filter((f): f is LandTypeFigure => !!f);
    if (!chain.length) return { reason: available.length ? "no_land_type" : "no_figures", available, datasetLatest };
    const freshest = Math.max(...chain.map((f) => f.year));
    const pick = chain.find((f) => f.year >= freshest - 1)!;
    chosen = types.find((t) => t.code === pick.code)!;
  }

  const history = euroSeries(mine, q.country, q.geo, chosen.code);
  const latest = history[history.length - 1];
  const prev = history.find((h) => h.year === latest.year - 1); // only the year just before: a gap means a break, not a change
  const previous = prev && prev.value > 0 ? { year: prev.year, value: prev.value, change_percent: roundTo(((latest.value - prev.value) / prev.value) * 100, 1) } : null;

  const nac = seriesOf(mine, "NAC_HA", q.geo, chosen.code).find((h) => h.year === latest.year);
  const currency = nationalCurrency(q.country, latest.year);
  const national = nac && currency !== "EUR" ? { currency, price: nac.value } : null;

  return {
    country: q.country,
    countryName: COUNTRIES[q.country] ?? q.country,
    geo: q.geo,
    regionName: q.geo !== toEurostatGeo(q.country) ? table.labels.geo?.[q.geo] ?? q.geo : null,
    measure: q.measure,
    landType: chosen,
    usedDefault,
    year: latest.year,
    value: latest.value,
    flag: latest.flag,
    previous,
    history,
    national,
    otherLandTypes: available.filter((f) => f.code !== chosen!.code),
    datasetLatest,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

export function isReading(x: LandReading | LandMiss | null): x is LandReading {
  return !!x && "value" in x;
}

// ---------- the answer (pure) ----------

const money = (v: number) => `€${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

function plainChange(pct: number, year: number): string {
  if (pct === 0) return ` That is unchanged from ${year}.`;
  return ` That is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than in ${year}.`;
}

/** How far behind the calendar the figure is, in plain words, and how much to trust it as "current". */
export function ageOf(year: number, now: Date): { years: number; level: "usual" | "older" | "very_old"; sentence: string } {
  const years = Math.max(0, now.getUTCFullYear() - year);
  if (years <= 2) {
    return { years, level: "usual", sentence: `Eurostat publishes land data about two years late, so ${year} is the newest year you can expect.` };
  }
  if (years <= 5) {
    return { years, level: "older", sentence: `This is ${years} years old, older than the usual two-year lag: treat it as a guide to the level, not today's price.` };
  }
  return {
    years,
    level: "very_old",
    sentence: `WARNING: this figure is ${years} years old (the country has not reported a newer one to Eurostat). Do not use it as a current price.`,
  };
}

function placeOf(r: { countryName: string; regionName: string | null; geo: string }): string {
  return r.regionName ? `${r.regionName} (${r.geo}), ${r.countryName}` : r.countryName;
}

export function landAnswer(
  result: LandReading | LandMiss | null,
  q: { country: string; measure: Measure; landType: LandType | null; region: string | null; baseUrl?: string; apiUrl?: string; now?: Date },
): PriceAnswer {
  const ds = DATASETS[q.measure];
  const now = q.now ?? new Date();
  const query: Record<string, unknown> = { country: q.country, measure: q.measure, ...(q.landType ? { land_type: q.landType.key } : {}), ...(q.region ? { region: q.region } : {}) };
  const method =
    `Eurostat publishes, once a year, the average ${q.measure === "price" ? "price of agricultural land" : "rent paid for one year for agricultural land"} per hectare for each country and region, ` +
    `by land type (dataset ${ds.code}), as reported by national authorities. ProofPrice returns the published figure for the latest year Eurostat holds for the place and land type, unchanged, ` +
    "with the previous year, the history, the national-currency figure and the other land types. No range is calculated: Eurostat gives one average and does not say how many sales or leases are behind it.";
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: ds.perUnit, method, baseUrl: q.baseUrl };

  if (!isReading(result)) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const name = COUNTRIES[q.country] ?? q.country;
    const place = q.region ? `region ${q.region} of ${name}` : name;
    const miss = result ?? { reason: "no_figures" as const, available: [], datasetLatest: null };
    const what = q.landType ? q.landType.phrase : "agricultural land";
    let summary: string;
    if (miss.reason === "no_place") {
      summary = q.region
        ? `Eurostat holds no land ${q.measure} for ${place} (${ds.code}). Try the country as a whole, or one of its regions listed in extra.regions_available.`
        : `Eurostat holds no land ${q.measure} for ${name} in the last ${WINDOW_YEARS} years (${ds.code}).`;
    } else if (miss.reason === "no_land_type") {
      summary =
        `Eurostat holds no ${what} ${q.measure} for ${place}. It does hold: ` +
        (miss.available.length ? miss.available.map((a) => `${a.land_type} (${a.year})`).join(", ") : "nothing for other land types");
      summary += ".";
    } else {
      summary = `Eurostat holds no land ${q.measure} for ${place} in the last ${WINDOW_YEARS} years (${ds.code}).`;
    }
    const regionsList = regionsOf(q.country);
    return {
      ...none,
      summary,
      extra: {
        country_name: name,
        dataset: { code: ds.code, title: ds.title, latest_period_in_dataset: miss.datasetLatest, doi: `https://doi.org/10.2908/${ds.code.toUpperCase()}` },
        ...(miss.available.length ? { available_land_types: miss.available.map((a) => ({ land_type: a.land_type, label: a.label, year: a.year, value_eur_per_hectare: a.value })) } : {}),
        ...(regionsList.length ? { regions_available: regionsList } : {}),
        ...(q.apiUrl ? { eurostat_api_url: q.apiUrl } : {}),
      },
    };
  }

  const r = result;
  const age = ageOf(r.year, now);
  const notes: string[] = [];
  if (r.flag) notes.push(`Eurostat flags this figure as ${FLAG_MEANING[r.flag] ?? `"${r.flag}"`}.`);
  if (r.previous && r.history.find((h) => h.year === r.previous!.year)?.flag === "b") notes.push(`Eurostat flags ${r.previous.year} as a break in the series, so the change may not be like for like.`);
  if (r.history.find((h) => h.year === r.year)?.viaNational) notes.push(`Eurostat's euro column is empty for ${r.year}; the figure is the national-currency one, and ${r.countryName} uses the euro.`);
  if (r.usedDefault) notes.push(`No land_type was asked for, so ${r.landType.phrase} is shown.`);
  if (age.level !== "usual") notes.push(age.sentence);

  const regionsList = r.regionName ? [] : regionsOf(q.country);
  const extra: Record<string, unknown> = {
    country_name: r.countryName,
    ...(r.regionName ? { region: { code: r.geo, name: r.regionName } } : {}),
    land_type: { key: r.landType.key, code: r.landType.code, label: r.landType.label, chosen_by: r.usedDefault ? "default" : "request" },
    reference_year: r.year,
    data_age: { years_behind: age.years, level: age.level, note: age.sentence },
    previous_year: r.previous,
    history_eur_per_hectare: r.history.map((h) => ({ year: h.year, value: h.value, ...(h.flag ? { flag: h.flag } : {}) })),
    ...(r.national ? { national_currency: { currency: r.national.currency, price: r.national.price, unit: ds.perUnit } } : {}),
    other_land_types: r.otherLandTypes.map((o) => ({ land_type: o.land_type, label: o.label, year: o.year, value_eur_per_hectare: o.value, ...(o.flag ? { flag: o.flag } : {}) })),
    ...(r.flag ? { data_flag: { code: r.flag, meaning: FLAG_MEANING[r.flag] ?? r.flag } } : {}),
    ...(regionsList.length ? { regions_available: regionsList } : {}),
    dataset: {
      code: ds.code,
      title: r.datasetTitle,
      updated: r.datasetUpdated,
      doi: `https://doi.org/10.2908/${ds.code.toUpperCase()}`,
      latest_period_in_dataset: r.datasetLatest,
    },
    ...(q.apiUrl ? { eurostat_api_url: q.apiUrl } : {}),
  };

  const answer = buildStatisticAnswer({
    ...base,
    value: r.value,
    period: { from: `${r.year}-01-01`, to: `${r.year}-12-31` },
    reference_period: String(r.year),
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      q.measure === "price"
        ? `In ${placeOf(r)} the average price of ${r.landType.phrase} was ${money(v)} per hectare in ${r.year}${r.flag ? ` (${flagShort(r.flag)})` : ""}.` +
          (r.previous ? plainChange(r.previous.change_percent, r.previous.year) : "") +
          ` ${age.sentence}`
        : `In ${placeOf(r)} the average rent for ${r.landType.phrase} was ${money(v)} per hectare per year in ${r.year}${r.flag ? ` (${flagShort(r.flag)})` : ""}.` +
          (r.previous ? plainChange(r.previous.change_percent, r.previous.year) : "") +
          ` ${age.sentence}`,
    extra,
  });
  // Old figures are not "high confidence" as a current price, whatever the publisher's own reliability.
  return age.level === "usual" ? answer : { ...answer, confidence: age.level === "older" ? "medium" : "low" };
}

// ---------- the request ----------

export function landFilters(geo: string): Record<string, string | string[]> {
  return { geo, unit: ["EUR_HA", "NAC_HA"] };
}

export async function euLandPrices(
  input: { country: string; measure: string; land_type?: string; region?: string; baseUrl?: string; now?: Date },
  o: FetchOptions = {},
): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`Farmland prices and rents are available for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  const measure = normaliseMeasure(input.measure);
  const landType = normaliseLandType(measure, input.land_type);
  const region = normaliseRegion(country, input.region);
  const geo = region ?? toEurostatGeo(country);
  const filters = landFilters(geo);
  const window = { lastTimePeriod: WINDOW_YEARS };
  const table = await fetchEurostat(DATASETS[measure].code, filters, window, o);
  const result = readLand(table, { country, measure, geo, landType });
  return landAnswer(result, { country, measure, landType, region, baseUrl: input.baseUrl, apiUrl: eurostatUrl(DATASETS[measure].code, filters, window), now: input.now });
}
