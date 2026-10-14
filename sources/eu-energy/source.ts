// Household electricity and gas prices for the EU, Norway and Iceland, from Eurostat (bi-annual datasets
// nrg_pc_204 = electricity, nrg_pc_202 = natural gas). Format checked live on 2026-10-14 through the GitHub probe.
// Uses the universal JSON-stat adapter (lib/adapters/jsonstat.ts): one request per answer, no bulk download.
//
// What Eurostat publishes: for each country, half-year, consumption band, tax level and currency, ONE average price per kWh
// for household consumers (reported by national authorities under Regulation (EU) 2016/1952). There is no distribution and no
// record count, so the answer is an official statistic: value + measure "average", range fields null, sample_size null.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { eurostatUrl, fetchEurostat, JsonStatRow, JsonStatTable, periodRange, previousPeriod, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "eu-energy",
  country: "EU27 + NO + IS",
  category: "energy (household electricity and gas prices)",
  name: "Electricity and gas prices for household consumers, bi-annual data (nrg_pc_204, nrg_pc_202)",
  publisher: "Eurostat (European Commission)",
  what_is_recorded:
    "For each country, half-year (semester), consumption band and tax level: the average price per kWh charged to household consumers, " +
    "reported to Eurostat by national authorities under Regulation (EU) 2016/1952. One published figure per cell; never individual bills or suppliers.",
  price_type: "official_statistic",
  freshness: "Updated twice a year (half-yearly figures); each answer states its reference period, and the newest half-year Eurostat holds for the country is returned",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0); Eurostat authorises reuse for commercial and non-commercial purposes provided the source is acknowledged",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat, datasets nrg_pc_204 (electricity prices for household consumers, bi-annual data, https://doi.org/10.2908/NRG_PC_204) " +
    "and nrg_pc_202 (gas prices for household consumers, bi-annual data, https://doi.org/10.2908/NRG_PC_202). Reused under the Eurostat copyright notice (CC BY 4.0). " +
    "Prices are passed on as published; the percentage change between half-years is calculated by ProofPrice.",
  homepage: "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table?lang=en",
  limits:
    "Averages for standard household consumption bands, not a quote or offer from any supplier and not business tariffs. " +
    "Published once per half-year, so figures lag the market by several months. Eurostat does not say how many households or bills stand behind a figure, " +
    "and some figures are flagged provisional or estimated. Gas is not available for every country (none for CY, IS, MT or NO, and currently none recent for FI).",
};

// ---------- what we know about the two datasets ----------

export type Energy = "electricity" | "gas";
export type Taxes = "all" | "excl_vat" | "none";

export interface Band {
  code: string; // Eurostat nrg_cons code
  letter: string; // Eurostat band name: DA..DE for electricity, D1..D3 for gas
  help: string; // plain description of the annual consumption
}

interface Dataset {
  code: string; // Eurostat dataset code
  word: string; // "electricity" / "natural gas"
  defaultBand: string; // Eurostat code of the standard band
  bands: Band[]; // standard household bands, smallest consumer first; the all-bands total comes first
  allBands: string; // Eurostat code of the all-bands total
}

export const DATASETS: Record<Energy, Dataset> = {
  electricity: {
    code: "nrg_pc_204",
    word: "electricity",
    defaultBand: "KWH2500-4999",
    allBands: "TOT_KWH",
    bands: [
      { code: "TOT_KWH", letter: "ALL", help: "all consumption bands together" },
      { code: "KWH_LT1000", letter: "DA", help: "under 1,000 kWh a year" },
      { code: "KWH1000-2499", letter: "DB", help: "1,000 to 2,499 kWh a year" },
      { code: "KWH2500-4999", letter: "DC", help: "2,500 to 4,999 kWh a year" },
      { code: "KWH5000-14999", letter: "DD", help: "5,000 to 14,999 kWh a year" },
      { code: "KWH_GE15000", letter: "DE", help: "15,000 kWh a year or more" },
    ],
  },
  gas: {
    code: "nrg_pc_202",
    word: "natural gas",
    defaultBand: "GJ20-199",
    allBands: "TOT_GJ",
    bands: [
      { code: "TOT_GJ", letter: "ALL", help: "all consumption bands together" },
      { code: "GJ_LT20", letter: "D1", help: "under 20 GJ a year (under about 5,600 kWh)" },
      { code: "GJ20-199", letter: "D2", help: "20 to 199 GJ a year (about 5,600 to 55,000 kWh)" },
      { code: "GJ_GE200", letter: "D3", help: "200 GJ a year or more (about 55,600 kWh and over)" },
    ],
  },
};

/** ISO 3166 alpha-2 -> name, for every country this source answers for (EU27 + Norway + Iceland). */
export const COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia",
  FI: "Finland", FR: "France", DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia",
  LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania",
  SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden", NO: "Norway", IS: "Iceland",
};

export const TAX_LEVELS: Record<Taxes, { code: string; label: string; short: string }> = {
  all: { code: "I_TAX", label: "All taxes and levies included", short: "all taxes and levies included" },
  excl_vat: { code: "X_VAT", label: "Excluding VAT and other recoverable taxes and levies", short: "excluding VAT and other recoverable taxes and levies" },
  none: { code: "X_TAX", label: "Excluding taxes and levies", short: "excluding all taxes and levies" },
};

const TAX_ORDER: Taxes[] = ["all", "excl_vat", "none"];

/** Half-years Eurostat is asked for. Wide enough to cover a country that is one or two releases behind. */
export const WINDOW_PERIODS = 4;

/** Eurostat's own flags for individual figures. */
const FLAG_MEANING: Record<string, string> = {
  p: "provisional", e: "estimated", s: "a Eurostat estimate", b: "a break in the time series", d: "defined differently from other figures (see Eurostat metadata)",
  u: "of low reliability", r: "revised", f: "a forecast", n: "not significant", i: "described in Eurostat metadata",
};

// ---------- parameter handling (pure) ----------

export function bandsOf(energy: Energy): Band[] {
  return DATASETS[energy].bands;
}

/** "dc", "DC", "KWH2500-4999", "all" -> the Band. Empty -> the standard band. Throws InputError listing the choices. */
export function normaliseBand(energy: Energy, raw?: string): Band {
  const ds = DATASETS[energy];
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return ds.bands.find((b) => b.code === ds.defaultBand)!;
  if (s === "ALL" || s === "TOTAL" || s === "TOT") return ds.bands[0];
  const hit = ds.bands.find((b) => b.code.toUpperCase() === s || b.letter === s);
  if (hit) return hit;
  throw new InputError(
    `consumption_band for ${energy} must be one of: ${ds.bands.map((b) => `${b.letter} (${b.code})`).join(", ")}. Default ${ds.bands.find((b) => b.code === ds.defaultBand)!.letter}.`,
  );
}

export function normaliseEnergy(raw?: string): Energy {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["electricity", "electric", "power", "electricity price", "electricity prices"].includes(s)) return "electricity";
  if (["gas", "natural gas", "mains gas", "gas price", "gas prices"].includes(s)) return "gas";
  throw new InputError('energy must be "electricity" or "gas".');
}

export function normaliseTaxes(raw?: string): Taxes {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s || s === "all" || s === "incl" || s === "included") return "all";
  if (s === "excl_vat" || s === "ex_vat" || s === "excluding_vat") return "excl_vat";
  if (s === "none" || s === "excl_tax" || s === "excl_taxes" || s === "no_tax" || s === "net") return "none";
  throw new InputError('taxes must be "all" (all taxes and levies included, default), "excl_vat" (excluding VAT and other recoverable taxes) or "none" (excluding all taxes and levies).');
}

/** Currency code of the "national currency" series for a country and half-year; "EUR" for euro-area members at that time. */
export function nationalCurrency(country: string, period: string): string {
  const own: Record<string, string> = { CZ: "CZK", DK: "DKK", HU: "HUF", IS: "ISK", NO: "NOK", PL: "PLN", RO: "RON", SE: "SEK" };
  if (own[country]) return own[country];
  if (country === "BG") return period >= "2026-S1" ? "EUR" : "BGN"; // Bulgaria joined the euro on 1 January 2026
  if (country === "HR") return period >= "2023-S1" ? "EUR" : "HRK"; // Croatia joined the euro on 1 January 2023
  return "EUR";
}

/** "2026-S1" -> "the first half of 2026". Anything else is returned as given. */
export function periodWords(code: string): string {
  const m = /^(\d{4})-S([12])$/.exec(code);
  return m ? `the ${m[2] === "1" ? "first" : "second"} half of ${m[1]}` : code;
}

// ---------- reading the Eurostat cube (pure) ----------

export interface BandPrice {
  band: string;
  code: string;
  label: string;
  value: number;
}

export interface EnergyReading {
  country: string;
  countryName: string;
  energy: Energy;
  band: Band;
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
 * From a parsed nrg_pc_20x slice (one country, all bands, tax levels I_TAX/X_VAT/X_TAX, currencies EUR + NAC, unit KWH)
 * pick the answer: the latest half-year that has a price for the chosen band and tax level, and the context around it.
 * Returns null when Eurostat holds no such price.
 */
export function readEnergy(table: JsonStatTable, q: { country: string; energy: Energy; band: Band; taxes: Taxes }): EnergyReading | null {
  const ds = DATASETS[q.energy];
  const tax = TAX_LEVELS[q.taxes].code;
  const geo = toEurostatGeo(q.country);
  const mine = table.rows.filter((r) => r.unit === "KWH" && r.geo === geo);
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
  const currency = nationalCurrency(q.country, period);
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

/** The finished answer for a reading (or for no reading). Pure. */
export function energyAnswer(reading: EnergyReading | null, q: { country: string; energy: Energy; band: Band; taxes: Taxes; baseUrl?: string; apiUrl?: string }): PriceAnswer {
  const ds = DATASETS[q.energy];
  const query = { country: q.country, energy: q.energy, consumption_band: q.band.code, taxes: q.taxes };
  const method =
    `Eurostat publishes, twice a year, the average price per kWh charged to household consumers in each country (dataset ${ds.code}), ` +
    "by consumption band and tax level, as reported by national authorities. ProofPrice returns the published figure for the latest half-year Eurostat holds for the country, unchanged, " +
    "with the same band at the other tax levels, every band, the national-currency figure and the previous half-year. " +
    "No range is calculated: Eurostat gives one average and does not say how many households or bills are behind it.";
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per kWh", method, baseUrl: q.baseUrl };

  if (!reading) {
    const none = buildStatisticAnswer({
      ...base,
      value: null,
      period: { from: null, to: null },
      reference_period: "",
      describe: () => "",
    });
    const name = COUNTRIES[q.country] ?? q.country;
    return {
      ...none,
      summary: `Eurostat publishes no ${ds.word} price for households in ${name} for consumption band ${q.band.letter} (${q.band.help}) at this tax level in the last ${WINDOW_PERIODS} half-years.`,
    };
  }

  const r = reading;
  const range = periodRange(r.reference_period);
  const notes: string[] = [];
  if (r.flag) notes.push(`Eurostat flags this figure as ${FLAG_MEANING[r.flag] ?? `"${r.flag}"`}.`);
  if (r.datasetLatest && r.reference_period < r.datasetLatest) {
    notes.push(`This is the latest figure Eurostat holds for ${r.countryName}; ${r.datasetLatest} has been published for other countries but not yet for it.`);
  }
  const byTax: Record<string, number> = {};
  if (r.priceByTaxLevel.all !== undefined) byTax.all_taxes_included = r.priceByTaxLevel.all;
  if (r.priceByTaxLevel.excl_vat !== undefined) byTax.excluding_vat = r.priceByTaxLevel.excl_vat;
  if (r.priceByTaxLevel.none !== undefined) byTax.excluding_all_taxes = r.priceByTaxLevel.none;

  const extra: Record<string, unknown> = {
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
      `In ${r.countryName} the average household price of ${ds.word} was ${eur(v)} per kWh in ${periodWords(r.reference_period)} ` +
      `(${TAX_LEVELS[r.taxes].short}; annual consumption band ${r.band.letter}, ${r.band.help}).` +
      (r.previous ? plainChange(r.previous.change_percent, periodWords(r.previous.reference_period)) : ""),
    extra,
  });
}

function eur(v: number): string {
  return `€${v.toFixed(4)}`;
}

// ---------- the request ----------

export function energyFilters(country: string): Record<string, string | string[]> {
  return { geo: toEurostatGeo(country), unit: "KWH", currency: ["EUR", "NAC"], tax: ["I_TAX", "X_VAT", "X_TAX"] };
}

export async function euEnergy(
  input: { country: string; energy: string; consumption_band?: string; taxes?: string; baseUrl?: string },
  o: FetchOptions = {},
): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`Household energy prices are available for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  const energy = normaliseEnergy(input.energy);
  const band = normaliseBand(energy, input.consumption_band);
  const taxes = normaliseTaxes(input.taxes);
  const filters = energyFilters(country);
  const window = { lastTimePeriod: WINDOW_PERIODS };
  const table = await fetchEurostat(DATASETS[energy].code, filters, window, o);
  const reading = readEnergy(table, { country, energy, band, taxes });
  return energyAnswer(reading, { country, energy, band, taxes, baseUrl: input.baseUrl, apiUrl: eurostatUrl(DATASETS[energy].code, filters, window) });
}
