// Singapore household electricity: the SP Group tariff for Low Tension (domestic) supplies, annual, cents per kWh excluding GST.
// Format checked live on 2026-10-22 through the GitHub probe: plain GET, no key, CKAN-style datastore_search on data.gov.sg,
// resource d_d610f8ed1864daa6c7e790318bbc3323 (17 rows; fields DataSeries, 2025 ... 2012 as numeric text, _id). The row
// "Low Tension Supplies - Domestic" holds the household tariff (2025 = 27.82, 2024 = 29.67 cents per kWh). A regulated POSTED
// tariff, not a count of paid bills. Annual only: the latest year column is the latest tariff year.

import { ckanSearch } from "../../lib/adapters";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const RESOURCE_ID = "d_d610f8ed1864daa6c7e790318bbc3323";
export const SITE = "https://data.gov.sg/api/action";
export const DOMESTIC_ROW = "Low Tension Supplies - Domestic";

export const INFO: SourceInfo = {
  id: "sg-sp-tariff",
  country: "SG",
  category: "energy (household electricity tariff)",
  name: "SP Group electricity tariff, Low Tension supplies (domestic), annual",
  publisher: "SP Group, published by Singapore's Department of Statistics (SingStat) on data.gov.sg",
  what_is_recorded:
    "The published electricity tariff for domestic (household) Low Tension supplies, in cents per kWh excluding GST, one figure per calendar year. A regulated tariff, not individual bills.",
  price_type: "posted_price",
  freshness: "Annual: the newest full calendar year (2025 was published in 2025-10); each answer states the year",
  licence: "Singapore Open Data Licence (worldwide, perpetual, royalty-free, non-exclusive use of the datasets, commercially or non-commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from \"Electricity Tariff Of SP Group\" (SP Group, via SingStat) accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence). " +
    "ProofPrice converts cents to dollars and computes the year-on-year change.",
  homepage: "https://data.gov.sg/datasets/d_d610f8ed1864daa6c7e790318bbc3323/view",
  limits:
    "A published annual tariff for domestic Low Tension supplies, not a count of paid bills, not an offer and not a quote. Excludes GST (9% from 2024) and the fixed monthly charges; the open-market retail plans that Singapore households can choose are not in it. Electricity only (no gas). No sample size.",
};

export interface Series {
  label: string;
  /** Year -> cents per kWh. */
  byYear: Record<number, number>;
}

/** Pure: pick the domestic row out of a datastore_search record list. */
export function parseDomestic(records: Record<string, any>[]): Series {
  const row = records.find((r) => String(r?.DataSeries ?? "").trim() === DOMESTIC_ROW);
  if (!row) throw new SourceError(`SP Group tariff table has no "${DOMESTIC_ROW}" row; this source needs updating.`);
  const byYear: Record<number, number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!/^(19|20)\d{2}$/.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) byYear[Number(k)] = n;
  }
  if (Object.keys(byYear).length < 2) throw new SourceError("SP Group tariff row has fewer than two yearly figures; this source needs updating.");
  return { label: DOMESTIC_ROW, byYear };
}

export function normaliseBand(raw?: string): void {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "standard" || s === "domestic" || s === "household") return;
  throw new InputError('consumption_band for SG: the tariff is one flat rate for domestic supplies, so leave it out or use "standard".');
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export interface SgInput {
  energy?: string;
  consumption_band?: string;
  baseUrl?: string;
}

const METHOD =
  "Singapore electricity: SP Group's published tariff for domestic Low Tension supplies (cents per kWh, excluding GST), the latest calendar year in the SingStat table on data.gov.sg, converted to Singapore dollars. " +
  "A posted tariff, not a count of paid bills; GST and fixed monthly charges are not included.";

/** Pure: build the answer from a parsed series. */
export function answerFromSeries(series: Series, input: SgInput): PriceAnswer {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("SG: only electricity is available (no gas). Use energy=electricity.");
  normaliseBand(input.consumption_band);
  const years = Object.keys(series.byYear).map(Number).sort((a, b) => b - a);
  const year = years[0];
  const prev = years.find((y) => y === year - 1);
  const cents = series.byYear[year];
  const prevCents = prev !== undefined ? series.byYear[prev] : null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SG", energy: "electricity", year },
    value: r4(cents / 100),
    measure: "average",
    currency: "SGD",
    unit: "per kWh (SP Group domestic Low Tension tariff, excluding GST and fixed charges)",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method: METHOD,
    describe: (v) => `SP Group's published tariff for domestic supplies in Singapore was SGD ${v.toFixed(4)} per kWh (${cents} cents) in ${year}, excluding GST.`,
    note: "Published annual tariff, not a paid bill. Excludes GST and fixed charges.",
    baseUrl: input.baseUrl,
    extra: {
      series: DOMESTIC_ROW,
      cents_per_kwh: cents,
      previous_year: prev ?? null,
      previous_cents_per_kwh: prevCents,
      change_pct: prevCents ? Math.round(((cents - prevCents) / prevCents) * 1000) / 10 : null,
      gst_included: false,
    },
  });
}

export async function sgElectricity(input: SgInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("SG: only electricity is available (no gas). Use energy=electricity.");
  normaliseBand(input.consumption_band);
  const records = fetcher ? await fetcher() : (await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 50 })).records;
  return answerFromSeries(parseDomestic(records), input);
}
