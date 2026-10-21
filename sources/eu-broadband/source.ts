// Mobile and fixed broadband prices for the EU, from Eurostat dataset isoc_pbo ("Mobile and fixed broadband internet prices by
// type of offer (least expensive)"). Format checked live on 2026-10-15 through the GitHub probe.
// One small request per answer (a whole country, every offer, a few years): no bulk download, no harvest needed.
//
// What Eurostat publishes: for each country, year and standard offer, ONE figure: the cheapest posted offer among the largest
// operators, in PPP euro per month (purchasing-power-adjusted, NOT nominal euro). So the answer is an official statistic of
// POSTED prices; it is never presented as what customers paid.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { eurostatUrl, fetchEurostat, JsonStatTable, periodRange, previousPeriod, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const DATASET = "isoc_pbo";

export const INFO: SourceInfo = {
  id: "eu-broadband",
  country: "EU27",
  category: "mobile and broadband (posted offer prices)",
  name: "Mobile and fixed broadband internet prices by type of offer, least expensive (isoc_pbo)",
  publisher: "Eurostat (European Commission)",
  what_is_recorded:
    "For each country, year and standard offer (fixed internet by speed, with or without phone and TV, or a mobile data plan): the least expensive posted offer " +
    "among the largest operators, in PPP euro per month. One published figure per cell; never an individual bill or customer.",
  price_type: "official_statistic",
  freshness: "Annual figures with a lag of about two years (newest year 2024, dataset updated May 2026); each answer states its reference year",
  licence: "Eurostat reuse policy: free reuse, including commercial use, provided the source is acknowledged (Commission Decision 2011/833/EU; compatible with CC BY 4.0)",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat, dataset isoc_pbo (mobile and fixed broadband internet prices by type of offer, least expensive, https://doi.org/10.2908/ISOC_PBO). " +
    "Reused under the Eurostat copyright notice. Prices are passed on as published; the change between years is calculated by ProofPrice.",
  homepage: "https://ec.europa.eu/eurostat/databrowser/view/isoc_pbo/default/table?lang=en",
  limits:
    "Posted prices, never what customers paid: the cheapest offer of the largest operators for a standard basket, not an average bill and not a quote. " +
    "Values are in PPP euro (purchasing power parity), so they compare countries fairly but are not nominal euro and are not what appears on a bill. " +
    "Annual, about two years behind. Some offer and country pairs are not published (shown as no figure, never zero). Country level only.",
};

/** ISO 3166 alpha-2 -> name for every country this source answers for (EU27; Greece is GR here, EL at Eurostat). */
export const COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia",
  FI: "Finland", FR: "France", DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia",
  LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania",
  SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden",
};

/** Friendly offer names -> Eurostat offer code. Any Eurostat code (e.g. FI_MBPS30-100_P) is accepted as well. */
export const OFFER_ALIASES: Record<string, string> = {
  fixed_lt12: "FI_MBPS_LT12",
  fixed_30_100: "FI_MBPS30-100",
  fixed_100_200: "FI_MBPS100-200",
  fixed_200_999: "FI_MBPS200-999",
  fixed_1gbps: "FI_GBPS_GE1",
  fixed_100_200_phone: "FI_MBPS100-200_P",
  fixed_100_200_phone_tv: "FI_MBPS100-200_PTV",
  mobile_1gb: "MI_GB1_NC",
  mobile_2gb: "MI_GB2_NC",
  mobile_5gb: "MI_GB5_NC",
  mobile_10gb: "MI_GB10_NC",
  mobile_20gb: "MI_GB20_NC",
  mobile_50gb: "MI_GB50_NC",
  mobile_unlimited: "MI_NLTD_NC",
};

export const DEFAULT_OFFER = "FI_MBPS100-200";

/** Years asked for: wide enough to reach a country that is a year behind, small enough to stay a tiny answer. */
export const WINDOW_PERIODS = 3;

/** "fixed 100-200", "FIXED_100_200", "fi_mbps100-200", "" -> the Eurostat offer code. Throws InputError listing the choices. */
export function normaliseOffer(raw?: string): string {
  const s = (raw ?? "").trim();
  if (!s) return DEFAULT_OFFER;
  const key = s.toLowerCase().replace(/[\s-]+/g, "_");
  if (OFFER_ALIASES[key]) return OFFER_ALIASES[key];
  if (/^(FI|MI)_[A-Z0-9_.\-]{2,40}$/i.test(s)) return s.toUpperCase();
  throw new InputError(`offer must be one of: ${Object.keys(OFFER_ALIASES).join(", ")}, or a Eurostat offer code such as FI_MBPS30-100_P. Default fixed_100_200.`);
}

export interface OfferPrice {
  code: string;
  label: string;
  value: number;
}

export interface BroadbandReading {
  country: string;
  countryName: string;
  offer: string;
  offerLabel: string;
  reference_period: string;
  value: number;
  flag: string | null;
  previous: { reference_period: string; value: number; change_percent: number } | null;
  otherOffers: OfferPrice[];
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** From a parsed isoc_pbo slice (one country, any offers, a few years) pick the latest year with a price for the offer. Null if none. */
export function readBroadband(table: JsonStatTable, q: { country: string; offer: string }): BroadbandReading | null {
  const geo = toEurostatGeo(q.country);
  const mine = table.rows.filter((r) => r.geo === geo && r.unit === "PPP_EUR" && typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0);
  const main = mine.filter((r) => r.offer === q.offer);
  if (!main.length) return null;
  const latest = main.reduce((a, r) => (String(r.time) > String(a.time) ? r : a));
  const period = String(latest.time);
  const value = latest.value as number;
  const prevCode = previousPeriod(period);
  const prevRow = prevCode ? main.find((r) => r.time === prevCode) : undefined;
  const previous = prevCode && prevRow && prevRow.value !== null ? { reference_period: prevCode, value: prevRow.value, change_percent: roundTo(((value - prevRow.value) / prevRow.value) * 100, 1) } : null;
  const otherOffers: OfferPrice[] = mine
    .filter((r) => r.time === period && r.offer !== q.offer)
    .map((r) => ({ code: String(r.offer), label: table.labels.offer?.[String(r.offer)] ?? String(r.offer), value: r.value as number }));
  const times = table.codes.time ?? [];
  return {
    country: q.country,
    countryName: COUNTRIES[q.country] ?? q.country,
    offer: q.offer,
    offerLabel: table.labels.offer?.[q.offer] ?? q.offer,
    reference_period: period,
    value,
    flag: typeof latest.status === "string" ? latest.status : null,
    previous,
    otherOffers,
    datasetLatest: times.length ? times[times.length - 1] : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

const ppp = (v: number) => `${v.toFixed(2)} PPP euro`;

function plainChange(pct: number, prevLabel: string): string {
  if (pct === 0) return ` That is unchanged from ${prevLabel}.`;
  return ` That is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than in ${prevLabel}.`;
}

/** The finished answer for a reading (or for no reading). Pure. */
export function broadbandAnswer(reading: BroadbandReading | null, q: { country: string; offer: string; baseUrl?: string; apiUrl?: string }): PriceAnswer {
  const query = { country: q.country, offer: q.offer };
  const method =
    "Eurostat publishes once a year, for each country, the least expensive posted offer of the largest operators for a set of standard offers " +
    `(dataset ${DATASET}), in PPP euro per month. ProofPrice returns the published figure for the latest year Eurostat holds for the country, unchanged, ` +
    "with the previous year and the country's other offers. These are posted prices of the cheapest offer, not what customers paid. " +
    "No range is calculated: Eurostat gives one figure per offer and does not say how many offers or customers are behind it.";
  const base = { source: INFO, query, measure: "average" as const, currency: "PPP_EUR", unit: "per month", method, baseUrl: q.baseUrl };

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: `Eurostat publishes no price for offer ${q.offer} in ${COUNTRIES[q.country] ?? q.country} in the last ${WINDOW_PERIODS} years.`,
    };
  }

  const r = reading;
  const notes: string[] = ["Posted price: the cheapest offer of the largest operators, in PPP euro per month (not nominal euro, not what customers paid)."];
  if (r.flag) notes.push(`Eurostat flags this figure with "${r.flag}".`);
  if (r.datasetLatest && r.reference_period < r.datasetLatest) {
    notes.push(`This is the latest figure Eurostat holds for ${r.countryName}; ${r.datasetLatest} has been published for other countries but not yet for it.`);
  }
  const extra: Record<string, unknown> = {
    country_name: r.countryName,
    offer: { code: r.offer, label: r.offerLabel },
    price_basis: "posted (cheapest offer of the largest operators)",
    currency_note: "PPP_EUR = euro adjusted for purchasing power parity, not nominal euro",
    previous_period: r.previous,
    other_offers_ppp_eur_per_month: r.otherOffers.map((o) => ({ code: o.code, label: o.label, value: o.value })),
    dataset: { code: DATASET, title: r.datasetTitle, updated: r.datasetUpdated, doi: `https://doi.org/10.2908/${DATASET.toUpperCase()}`, latest_period_in_dataset: r.datasetLatest },
    ...(q.apiUrl ? { eurostat_api_url: q.apiUrl } : {}),
  };
  return buildStatisticAnswer({
    ...base,
    value: r.value,
    period: periodRange(r.reference_period) ?? { from: null, to: null },
    reference_period: r.reference_period,
    note: notes.join(" "),
    ending: `Cheapest posted offer of the largest operators, as published by ${INFO.publisher} for ${r.reference_period}.`,
    evidence: {
      label: "Cheapest posted offer (official survey)",
      meaning:
        "The least expensive offer the largest operators post for a standard package, as collected and published by the statistics office: an asking price for the cheapest deal, not an average bill and not what customers paid.",
    },
    describe: (v) =>
      `In ${r.countryName} the cheapest posted offer of the largest operators for "${r.offerLabel}" was ${ppp(v)} per month in ${r.reference_period}.` +
      (r.previous ? plainChange(r.previous.change_percent, r.previous.reference_period) : ""),
    extra,
  });
}

export function broadbandFilters(country: string): Record<string, string | string[]> {
  return { geo: toEurostatGeo(country), unit: "PPP_EUR" };
}

export async function euBroadband(input: { country: string; offer?: string; baseUrl?: string }, o: FetchOptions = {}): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`Broadband prices are available for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  const offer = normaliseOffer(input.offer);
  const filters = broadbandFilters(country);
  const window = { lastTimePeriod: WINDOW_PERIODS };
  const table = await fetchEurostat(DATASET, filters, window, o);
  return broadbandAnswer(readBroadband(table, { country, offer }), { country, offer, baseUrl: input.baseUrl, apiUrl: eurostatUrl(DATASET, filters, window) });
}
