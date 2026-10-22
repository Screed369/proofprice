// Business (non-household) electricity and gas prices for the EU, EFTA and candidate countries, from Eurostat (bi-annual datasets
// nrg_pc_205 = electricity, nrg_pc_203 = natural gas, "for non-household consumers"). Format checked live on 2026-10-21 through the
// GitHub probe (see fixtures.ts). Same JSON-stat/SDMX adapter as sources/eu-energy (lib/adapters/jsonstat.ts): one request per answer.
//
// What Eurostat publishes: for each country, half-year, annual-consumption band (electricity IA..IG, gas I1..I6), tax level and currency,
// ONE average price per kWh for non-household (business) consumers, reported by national authorities under Regulation (EU) 2016/1952.
// There is no distribution and no record count, so the answer is an official statistic: value + measure "average", range fields null,
// sample_size null. Gas has no all-bands total (TOT_GJ is empty in kWh), electricity has one (TOT_KWH).
//
// Licence: Eurostat allows reuse "for commercial or non-commercial purposes ... provided the source is acknowledged", but not
// commercial reuse of data for countries other than EU Member States, EFTA Member States and official EU acceding and candidate
// countries; so this source answers only for those (categories/energy/business.ts).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { eurostatUrl, fetchEurostat, JsonStatRow, JsonStatTable, periodRange, previousPeriod, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { EU_BUSINESS_COUNTRIES } from "../../categories/energy/business";
import { nationalCurrency, normaliseEnergy, normaliseTaxes, periodWords, TAX_LEVELS, WINDOW_PERIODS } from "../eu-energy/source";
import type { Energy, Taxes } from "../eu-energy/source";

export const COUNTRIES = EU_BUSINESS_COUNTRIES;

export const INFO: SourceInfo = {
  id: "eu-energy-business",
  country: "EU27 + NO + IS + candidate countries (business)",
  category: "energy (business electricity and gas prices)",
  name: "Electricity and gas prices for non-household consumers, bi-annual data (nrg_pc_205, nrg_pc_203)",
  publisher: "Eurostat (European Commission)",
  what_is_recorded:
    "For each country, half-year (semester), annual-consumption band and tax level: the average price per kWh charged to non-household (business) consumers, " +
    "reported to Eurostat by national authorities under Regulation (EU) 2016/1952. One published figure per cell; never individual bills or suppliers.",
  price_type: "official_statistic",
  freshness: "Updated twice a year (half-yearly figures); each answer states its reference period, and the newest half-year Eurostat holds for the country is returned",
  licence:
    'Eurostat copyright notice: reuse of Eurostat material "for commercial or non-commercial purposes is authorised provided the source is acknowledged" (editorial content under CC BY 4.0). ' +
    "Commercial reuse covers data for EU Member States, EFTA Member States and official EU acceding and candidate countries only, so this source answers for those countries only",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat, datasets nrg_pc_205 (electricity prices for non-household consumers, bi-annual data, https://doi.org/10.2908/NRG_PC_205) " +
    "and nrg_pc_203 (gas prices for non-household consumers, bi-annual data, https://doi.org/10.2908/NRG_PC_203). Reused under the Eurostat copyright notice. " +
    "Prices are passed on as published; the percentage change between half-years is calculated by ProofPrice.",
  homepage: "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_205/default/table?lang=en",
  limits:
    "Official averages for annual-consumption bands of non-household (business) consumers, not a quote, tariff or offer from any supplier and not household prices. " +
    "Published once per half-year, so figures lag the market by several months. Eurostat does not say how many consumers or invoices stand behind a figure, " +
    "and some figures are flagged provisional or estimated. Not every country reports every band, and gas has no all-bands total. " +
    "Business prices are shown excluding VAT and other recoverable taxes by default, because businesses normally reclaim VAT.",
};

// ---------- what we know about the two datasets ----------

export interface BusinessBand {
  code: string; // Eurostat nrg_cons code
  letter: string; // Eurostat band name: IA..IG for electricity, I1..I6 for gas
  help: string; // plain description of the annual consumption
  /** Lower and upper end of the band in MWh a year (null = no limit): lets another source (GB) map its own bands onto these. */
  mwh: [number | null, number | null];
}

interface BusinessDataset {
  code: string;
  word: string;
  defaultBand: string; // code of the reference band
  allBands: string | null; // code of the all-bands total, if Eurostat has one
  bands: BusinessBand[];
}

export const DATASETS: Record<Energy, BusinessDataset> = {
  electricity: {
    code: "nrg_pc_205",
    word: "electricity",
    defaultBand: "MWH500-1999",
    allBands: "TOT_KWH",
    bands: [
      { code: "TOT_KWH", letter: "ALL", help: "all consumption bands together", mwh: [null, null] },
      { code: "MWH_LT20", letter: "IA", help: "under 20 MWh a year", mwh: [0, 20] },
      { code: "MWH20-499", letter: "IB", help: "20 to 499 MWh a year", mwh: [20, 500] },
      { code: "MWH500-1999", letter: "IC", help: "500 to 1,999 MWh a year", mwh: [500, 2000] },
      { code: "MWH2000-19999", letter: "ID", help: "2,000 to 19,999 MWh a year", mwh: [2000, 20000] },
      { code: "MWH20000-69999", letter: "IE", help: "20,000 to 69,999 MWh a year", mwh: [20000, 70000] },
      { code: "MWH70000-149999", letter: "IF", help: "70,000 to 149,999 MWh a year", mwh: [70000, 150000] },
      { code: "MWH_GE150000", letter: "IG", help: "150,000 MWh a year or more", mwh: [150000, null] },
    ],
  },
  gas: {
    code: "nrg_pc_203",
    word: "natural gas",
    defaultBand: "GJ10000-99999",
    allBands: null,
    bands: [
      { code: "GJ_LT1000", letter: "I1", help: "under 1,000 GJ a year (under about 278 MWh)", mwh: [0, 278] },
      { code: "GJ1000-9999", letter: "I2", help: "1,000 to 9,999 GJ a year (about 278 to 2,777 MWh)", mwh: [278, 2778] },
      { code: "GJ10000-99999", letter: "I3", help: "10,000 to 99,999 GJ a year (about 2,778 to 27,777 MWh)", mwh: [2778, 27778] },
      { code: "GJ100000-999999", letter: "I4", help: "100,000 to 999,999 GJ a year (about 27,778 to 277,777 MWh)", mwh: [27778, 277778] },
      { code: "GJ1000000-3999999", letter: "I5", help: "1,000,000 to 3,999,999 GJ a year (about 277,778 to 1,111,111 MWh)", mwh: [277778, 1111112] },
      { code: "GJ_GE4000000", letter: "I6", help: "4,000,000 GJ a year or more (about 1,111,112 MWh and over)", mwh: [1111112, null] },
    ],
  },
};

const TAX_ORDER: Taxes[] = ["all", "excl_vat", "none"];

/** Currency of the "national currency" series for the candidate countries (EU members and NO, IS are handled by eu-energy's nationalCurrency). */
const CANDIDATE_CURRENCY: Record<string, string> = { AL: "ALL", BA: "BAM", GE: "GEL", MD: "MDL", ME: "EUR", MK: "MKD", RS: "RSD", TR: "TRY", UA: "UAH" };

export function businessCurrency(country: string, period: string): string {
  return CANDIDATE_CURRENCY[country] ?? nationalCurrency(country, period);
}

const FLAG_MEANING: Record<string, string> = {
  p: "provisional", e: "estimated", s: "a Eurostat estimate", b: "a break in the time series", d: "defined differently from other figures (see Eurostat metadata)",
  u: "of low reliability", r: "revised", f: "a forecast", n: "not significant", i: "described in Eurostat metadata",
};

// ---------- parameter handling (pure) ----------

export function bandsOf(energy: Energy): BusinessBand[] {
  return DATASETS[energy].bands;
}

export function defaultBand(energy: Energy): BusinessBand {
  const ds = DATASETS[energy];
  return ds.bands.find((b) => b.code === ds.defaultBand)!;
}

/** "ic", "IC", "MWH500-1999", "all" -> the band. Empty -> the reference band (IC electricity, I3 gas). Throws InputError listing the choices. */
export function normaliseBusinessBand(energy: Energy, raw?: string): BusinessBand {
  const ds = DATASETS[energy];
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return defaultBand(energy);
  if (ds.allBands && (s === "ALL" || s === "TOTAL" || s === "TOT")) return ds.bands.find((b) => b.code === ds.allBands)!;
  const hit = ds.bands.find((b) => b.code.toUpperCase() === s || b.letter === s);
  if (hit) return hit;
  throw new InputError(
    `consumption_band for business ${energy} must be one of: ${ds.bands.map((b) => `${b.letter} (${b.code})`).join(", ")}. Default ${defaultBand(energy).letter}.`,
  );
}

// ---------- reading the Eurostat cube (pure) ----------

export interface BandPrice {
  band: string;
  code: string;
  label: string;
  value: number;
}

export interface BusinessReading {
  country: string;
  countryName: string;
  energy: Energy;
  band: BusinessBand;
  taxes: Taxes;
  reference_period: string;
  value: number;
  flag: string | null;
  priceByTaxLevel: Partial<Record<Taxes, number>>;
  national: { currency: string; price: number } | null;
  previous: { reference_period: string; value: number; change_percent: number } | null;
  allBands: BandPrice[];
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

function cell(rows: JsonStatRow[], where: Record<string, string>): JsonStatRow | undefined {
  return rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * From a parsed nrg_pc_205 / nrg_pc_203 slice (one country, all bands, tax levels I_TAX/X_VAT/X_TAX, currencies EUR + NAC, unit KWH)
 * pick the answer: the latest half-year that has a price for the chosen band and tax level, and the context around it.
 * Returns null when Eurostat holds no such price.
 */
export function readBusinessEnergy(table: JsonStatTable, q: { country: string; energy: Energy; band: BusinessBand; taxes: Taxes }): BusinessReading | null {
  const ds = DATASETS[q.energy];
  const tax = TAX_LEVELS[q.taxes].code;
  const geo = toEurostatGeo(q.country);
  const mine = table.rows.filter((r) => r.unit === "KWH" && r.geo === geo && typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0);
  const main = mine.filter((r) => r.nrg_cons === q.band.code && r.tax === tax && r.currency === "EUR");
  if (!main.length) return null;
  const latest = main.reduce((a, r) => (String(r.time) > String(a.time) ? r : a));
  const period = String(latest.time);
  const value = latest.value as number;

  const priceByTaxLevel: Partial<Record<Taxes, number>> = {};
  for (const t of TAX_ORDER) {
    const r = cell(mine, { nrg_cons: q.band.code, tax: TAX_LEVELS[t].code, currency: "EUR", time: period });
    if (r && r.value !== null) priceByTaxLevel[t] = r.value;
  }

  const nac = cell(mine, { nrg_cons: q.band.code, tax, currency: "NAC", time: period });
  const currency = businessCurrency(q.country, period);
  const national = nac && nac.value !== null && currency !== "EUR" ? { currency, price: nac.value } : null;

  const prevCode = previousPeriod(period);
  const prevRow = prevCode ? cell(main, { time: prevCode }) : undefined;
  const previous =
    prevCode && prevRow && prevRow.value !== null && prevRow.value > 0
      ? { reference_period: prevCode, value: prevRow.value, change_percent: roundTo(((value - prevRow.value) / prevRow.value) * 100, 1) }
      : null;

  const allBands: BandPrice[] = [];
  for (const b of ds.bands) {
    const r = cell(mine, { nrg_cons: b.code, tax, currency: "EUR", time: period });
    if (r && r.value !== null) allBands.push({ band: b.letter, code: b.code, label: table.labels.nrg_cons?.[b.code] ?? b.code, value: r.value });
  }

  const times = table.codes.time ?? [];
  return {
    country: q.country,
    countryName: COUNTRIES[q.country] ?? q.country,
    energy: q.energy,
    band: q.band,
    taxes: q.taxes,
    reference_period: period,
    value,
    flag: typeof latest.status === "string" ? latest.status : null,
    priceByTaxLevel,
    national,
    previous,
    allBands,
    datasetLatest: times.length ? times[times.length - 1] : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

function plainChange(pct: number, prevLabel: string): string {
  if (pct === 0) return ` That is unchanged from ${prevLabel}.`;
  return ` That is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than in ${prevLabel}.`;
}

function eur(v: number): string {
  return `€${v.toFixed(4)}`;
}

/** The finished answer for a reading (or for no reading). Pure. */
export function businessAnswer(
  reading: BusinessReading | null,
  q: { country: string; energy: Energy; band: BusinessBand; taxes: Taxes; baseUrl?: string; apiUrl?: string },
): PriceAnswer {
  const ds = DATASETS[q.energy];
  const query = { country: q.country, sector: "business", energy: q.energy, consumption_band: q.band.code, taxes: q.taxes };
  const method =
    `Eurostat publishes, twice a year, the average price per kWh charged to non-household (business) consumers in each country (dataset ${ds.code}), ` +
    "by annual-consumption band and tax level, as reported by national authorities. ProofPrice returns the published figure for the latest half-year Eurostat holds for the country, unchanged, " +
    "with the same band at the other tax levels, every band, the national-currency figure and the previous half-year. " +
    "No range is calculated: Eurostat gives one average and does not say how many consumers or invoices are behind it.";
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per kWh", method, baseUrl: q.baseUrl };

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const name = COUNTRIES[q.country] ?? q.country;
    return {
      ...none,
      summary: `Eurostat publishes no ${ds.word} price for businesses in ${name} for consumption band ${q.band.letter} (${q.band.help}) at this tax level in the last ${WINDOW_PERIODS} half-years. Try another band: not every country reports every band.`,
    };
  }

  const r = reading;
  const range = periodRange(r.reference_period);
  const notes: string[] = [];
  if (r.flag) notes.push(`Eurostat flags this figure as ${FLAG_MEANING[r.flag] ?? `"${r.flag}"`}.`);
  if (r.datasetLatest && r.reference_period < r.datasetLatest) {
    notes.push(`This is the latest figure Eurostat holds for ${r.countryName}; ${r.datasetLatest} has been published for other countries but not yet for it.`);
  }
  if (r.taxes === "all") notes.push("This includes VAT, which businesses can normally reclaim; the 'excluding VAT' figure is the usual business price.");
  const byTax: Record<string, number> = {};
  if (r.priceByTaxLevel.all !== undefined) byTax.all_taxes_included = r.priceByTaxLevel.all;
  if (r.priceByTaxLevel.excl_vat !== undefined) byTax.excluding_vat = r.priceByTaxLevel.excl_vat;
  if (r.priceByTaxLevel.none !== undefined) byTax.excluding_all_taxes = r.priceByTaxLevel.none;

  const extra: Record<string, unknown> = {
    sector: "business",
    energy: q.energy,
    country_name: r.countryName,
    consumption_band: { code: r.band.code, band: r.band.letter, label: r.allBands.find((b) => b.code === r.band.code)?.label ?? r.band.code, annual_consumption: r.band.help },
    taxes: { level: r.taxes, code: TAX_LEVELS[r.taxes].code, label: TAX_LEVELS[r.taxes].label },
    reference_period_label: periodWords(r.reference_period),
    price_by_tax_level_eur_per_kwh: byTax,
    ...(r.national ? { national_currency: { currency: r.national.currency, price: r.national.price, unit: "per kWh" } } : {}),
    previous_period: r.previous,
    all_bands_eur_per_kwh: r.allBands.map((b) => ({ band: b.band, code: b.code, label: b.label, value: b.value })),
    ...(r.flag ? { data_flag: { code: r.flag, meaning: FLAG_MEANING[r.flag] ?? r.flag } } : {}),
    dataset: {
      code: ds.code,
      title: r.datasetTitle,
      updated: r.datasetUpdated,
      doi: `https://doi.org/10.2908/${ds.code.toUpperCase()}`,
      latest_period_in_dataset: r.datasetLatest,
    },
    ...(q.apiUrl ? { eurostat_api_url: q.apiUrl } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: r.value,
    period: range ?? { from: null, to: null },
    reference_period: r.reference_period,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${r.countryName} the official average price paid by businesses (non-household consumers) for ${ds.word} in annual consumption band ${r.band.letter} (${r.band.help}) was ${eur(v)} per kWh in ${periodWords(r.reference_period)} ` +
      `(${TAX_LEVELS[r.taxes].short}).` +
      (r.previous ? plainChange(r.previous.change_percent, periodWords(r.previous.reference_period)) : ""),
    extra,
  });
}

// ---------- the request ----------

export function businessFilters(country: string): Record<string, string | string[]> {
  return { geo: toEurostatGeo(country), unit: "KWH", currency: ["EUR", "NAC"], tax: ["I_TAX", "X_VAT", "X_TAX"] };
}

export async function euBusinessEnergy(
  input: { country: string; energy: string; consumption_band?: string; taxes?: string; baseUrl?: string },
  o: FetchOptions = {},
): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) {
    throw new InputError(`Business energy prices from Eurostat are available for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  }
  const energy = normaliseEnergy(input.energy);
  const band = normaliseBusinessBand(energy, input.consumption_band);
  // Businesses normally reclaim VAT, so the business default is "excluding VAT and other recoverable taxes".
  const taxes = input.taxes ? normaliseTaxes(input.taxes) : "excl_vat";
  const filters = businessFilters(country);
  const window = { lastTimePeriod: WINDOW_PERIODS };
  const table = await fetchEurostat(DATASETS[energy].code, filters, window, o);
  const reading = readBusinessEnergy(table, { country, energy, band, taxes });
  return businessAnswer(reading, { country, energy, band, taxes, baseUrl: input.baseUrl, apiUrl: eurostatUrl(DATASETS[energy].code, filters, window) });
}
