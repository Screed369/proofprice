// Singapore piped town gas: City Energy's regulated tariffs (General, Bulk A, Bulk B), annual, cents per kWh excluding GST,
// published by SingStat on data.gov.sg. Format checked live on 2026-11-09 (plain GET, no key, CKAN datastore_search),
// resource d_9835e2085751e6b9c3efae9fdf2b9c5c: 3 rows (DataSeries, then one text-number column per year 2025 ... 2003, _id).
// 2025: General 22.52, Bulk A 21.26, Bulk B 20.63 cents per kWh. A POSTED tariff, not a count of paid bills.

import { ckanSearch } from "../../lib/adapters";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const RESOURCE_ID = "d_9835e2085751e6b9c3efae9fdf2b9c5c";
export const SITE = "https://data.gov.sg/api/action";

export type Band = "general" | "bulk_a" | "bulk_b";
export const ROWS: Record<Band, string> = {
  general: "Piped Town Gas Tariff - General Tariff",
  bulk_a: "Piped Town Gas Tariff - Bulk Tariff A",
  bulk_b: "Piped Town Gas Tariff - Bulk Tariff B",
};
const LABEL: Record<Band, string> = { general: "General tariff", bulk_a: "Bulk tariff A", bulk_b: "Bulk tariff B" };

export const INFO: SourceInfo = {
  id: "sg-town-gas",
  country: "SG",
  category: "energy (piped town gas tariff)",
  name: "Piped town gas tariffs (General, Bulk A, Bulk B), annual",
  publisher: "City Energy, published by Singapore's Department of Statistics (SingStat) on data.gov.sg",
  what_is_recorded:
    "The published piped town gas tariff in cents per kWh excluding GST, one figure per calendar year, for the General tariff and two Bulk tariffs. A regulated tariff, not individual bills.",
  price_type: "posted_price",
  freshness: "Annual: the newest full calendar year (2025 was published in 2026-05); each answer states the year",
  licence: "Singapore Open Data Licence v1.0 (worldwide, perpetual, royalty-free, non-exclusive use of the datasets, commercially or non-commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from \"Piped Town Gas Tariff\" (SingStat / City Energy Pte Ltd) accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence). " +
    "ProofPrice converts cents to dollars and computes the year-on-year change.",
  homepage: "https://data.gov.sg/datasets/d_9835e2085751e6b9c3efae9fdf2b9c5c/view",
  limits:
    "A published annual piped town gas tariff, not a count of paid bills, not an offer and not a quote. Excludes GST and fixed charges. Town gas only (not LPG cylinders, not electricity). The General tariff is the standard tariff; the publisher does not label it 'household'. No sample size.",
};

export interface Series {
  band: Band;
  label: string;
  /** Year -> cents per kWh. */
  byYear: Record<number, number>;
}

/** Pure: normalise the consumption_band input. Empty, standard, household and general mean the General tariff. */
export function normaliseBand(raw?: string): Band {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s || s === "standard" || s === "household" || s === "general" || s === "general_tariff") return "general";
  if (s === "bulk_a" || s === "a" || s === "bulk_tariff_a") return "bulk_a";
  if (s === "bulk_b" || s === "b" || s === "bulk_tariff_b") return "bulk_b";
  throw new InputError('consumption_band for SG gas: use "general" (default), "bulk_a" or "bulk_b".');
}

/** Pure: pick one tariff row out of a datastore_search record list. */
export function parseTariff(records: Record<string, any>[], band: Band): Series {
  const want = ROWS[band];
  const row = records.find((r) => String(r?.DataSeries ?? "").trim() === want);
  if (!row) throw new SourceError(`Town gas table has no "${want}" row; this source needs updating.`);
  const byYear: Record<number, number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!/^(19|20)\d{2}$/.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) byYear[Number(k)] = n;
  }
  if (Object.keys(byYear).length < 2) throw new SourceError("Town gas tariff row has fewer than two yearly figures; this source needs updating.");
  return { band, label: want, byYear };
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export interface SgGasInput {
  energy?: string;
  consumption_band?: string;
  baseUrl?: string;
}

const METHOD =
  "Singapore piped town gas: City Energy's published tariff (cents per kWh, excluding GST), the latest calendar year in the SingStat table on data.gov.sg, converted to Singapore dollars. " +
  "A posted tariff, not a count of paid bills; GST and fixed charges are not included.";

/** Pure: build the answer from a parsed series. */
export function answerFromSeries(series: Series, input: SgGasInput): PriceAnswer {
  const years = Object.keys(series.byYear).map(Number).sort((a, b) => b - a);
  const year = years[0];
  const prev = years.find((y) => y === year - 1);
  const cents = series.byYear[year];
  const prevCents = prev !== undefined ? series.byYear[prev] : null;
  const name = LABEL[series.band];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SG", energy: "gas", consumption_band: series.band, year },
    value: r4(cents / 100),
    measure: "average",
    currency: "SGD",
    unit: `per kWh (piped town gas, ${name}, excluding GST and fixed charges)`,
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method: METHOD,
    describe: (v) => `The published piped town gas ${name} in Singapore was SGD ${v.toFixed(4)} per kWh (${cents} cents) in ${year}, excluding GST.`,
    note: "Published annual tariff, not a paid bill. Excludes GST and fixed charges.",
    baseUrl: input.baseUrl,
    extra: {
      series: series.label,
      band: series.band,
      cents_per_kwh: cents,
      previous_year: prev ?? null,
      previous_cents_per_kwh: prevCents,
      change_pct: prevCents ? Math.round(((cents - prevCents) / prevCents) * 1000) / 10 : null,
      gst_included: false,
    },
  });
}

export async function sgGas(input: SgGasInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const energy = (input.energy ?? "").toString().toLowerCase();
  if (energy !== "gas" && energy !== "natural gas" && energy !== "mains gas") throw new InputError("SG town gas: use energy=gas.");
  const band = normaliseBand(input.consumption_band);
  const records = fetcher ? await fetcher() : (await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 20 })).records;
  return answerFromSeries(parseTariff(records, band), input);
}
