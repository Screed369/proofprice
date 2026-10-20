// Australia domestic airfares: BITRE "Real CPI-adjusted domestic discount airfares" on data.gov.au (CKAN datastore, CC BY 2.5 AU).
// Format checked live on 2026-10-20 from GitHub's servers (Verifier probes vr-bitre, vr-bitreds):
//   GET https://data.gov.au/data/api/3/action/datastore_search?resource_id=b1e7267d-2884-4416-b3d6-6a669fc4e423&sort=YearMonth%20desc&limit=6&filters={"Route":"Melbourne - Sydney"}
//   -> {success, result:{records:[{_id, Year, Month, YearMonth:"202609", Port1, Port2, Route:"Melbourne - Sydney", "$Value":"198", "$Real":"198"}], total}} (all values are text).
// What a figure is: the CHEAPEST advertised "best discount" RETURN fare (AUD, incl. taxes, excl. baggage surcharges) that BITRE collects from airline
// websites 3 weeks before a departure on the last Thursday of the month, returning 2 weeks later. One observation per route per month: a posted
// price, not a price paid. The only honest range is across months, so the answer is the median/10th-90th percentile of the last N months of one route.

import { ckanSearch } from "../../lib/adapters/ckan";
import type { FetchOptions } from "../../lib/adapters/common";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const SITE = "https://data.gov.au/data";
export const RESOURCE_ID = "b1e7267d-2884-4416-b3d6-6a669fc4e423";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/2.5/au/";

export const INFO: SourceInfo = {
  id: "au-bitre-airfares",
  country: "AU (domestic routes)",
  category: "airfares (cheapest advertised return fare)",
  name: "BITRE Real CPI-adjusted domestic discount airfares",
  publisher: "Bureau of Infrastructure and Transport Research Economics (BITRE), Australian Government",
  what_is_recorded:
    "For about 70 domestic routes, the cheapest available return fare found on airline websites three weeks before a departure on the last Thursday of the month (return two weeks later), in Australian dollars including taxes, excluding baggage surcharges. One observation per route per month since January 2010.",
  price_type: "posted_price",
  freshness: "Monthly; the newest month is usually the one just ended",
  licence: "Creative Commons Attribution 2.5 Australia (CC BY 2.5 AU)",
  licence_url: LICENCE_URL,
  attribution: "Source: Bureau of Infrastructure and Transport Research Economics (BITRE), Australian Government, via data.gov.au. Licensed under CC BY 2.5 AU. Medians and ranges are own calculations by ProofPrice from the monthly observations.",
  homepage: "https://www.bitre.gov.au/resource/aviation/domestic-airfares",
  limits:
    "Advertised cheapest fares, not fares paid: they are the lowest discount return fare on one booking date pattern (about 3 weeks ahead, last Thursday of the month). " +
    "There is one observation per route per month, so the range spreads over months (seasonality and sales), not over travellers. Return trips, not one way. " +
    "Flexible, peak-date, last-minute and business fares cost more. Domestic routes between Australian cities only.",
};

/** Common airport codes and spellings -> the port names BITRE uses. */
const ALIASES: Record<string, string> = {
  syd: "Sydney", sydney: "Sydney",
  mel: "Melbourne", mlb: "Melbourne", melbourne: "Melbourne", tul: "Melbourne",
  bne: "Brisbane", brisbane: "Brisbane",
  per: "Perth", perth: "Perth",
  adl: "Adelaide", adelaide: "Adelaide",
  cbr: "Canberra", canberra: "Canberra",
  ool: "Gold Coast", "gold coast": "Gold Coast", goldcoast: "Gold Coast",
  drw: "Darwin", darwin: "Darwin",
  hba: "Hobart", hobart: "Hobart",
  cns: "Cairns", cairns: "Cairns",
  tsv: "Townsville", townsville: "Townsville",
  ltb: "Launceston", lst: "Launceston", launceston: "Launceston",
  asp: "Alice Springs", "alice springs": "Alice Springs",
  ntl: "Newcastle", newcastle: "Newcastle",
  mky: "Mackay", mackay: "Mackay",
  rok: "Rockhampton", rockhampton: "Rockhampton",
  mcy: "Sunshine Coast", "sunshine coast": "Sunshine Coast",
  alh: "Albany", alb: "Albury", albury: "Albury",
  bme: "Broome", broome: "Broome",
  kgi: "Kalgoorlie", kalgoorlie: "Kalgoorlie",
  pha: "Port Hedland", "port hedland": "Port Hedland",
  plo: "Port Lincoln", "port lincoln": "Port Lincoln",
};

const titleCase = (s: string) => s.replace(/\b([a-z])([a-z']*)/g, (_m, a: string, b: string) => a.toUpperCase() + b);

/** "SYD", "sydney airport", "Gold Coast" -> the BITRE port name. Unknown names are title-cased and tried as given. */
export function portName(input: string): string {
  const k = input.trim().toLowerCase().replace(/[.,]/g, "").replace(/\b(airport|international|domestic|city|nsw|vic|qld|wa|sa|tas|nt|act)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!k) throw new InputError("AU airfares need a departure and an arrival city or airport code, for example from=Sydney, to=Melbourne.");
  return ALIASES[k] ?? titleCase(k);
}

export interface FareRow {
  yearMonth: string; // "202609"
  route: string;
  nominal: number; // AUD, return, as advertised that month
  real: number | null; // AUD in latest-month dollars (CPI-adjusted)
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

/** Datastore records -> fare rows, newest first, one per month. Skips rows with no usable price. */
export function parseFares(records: Record<string, any>[]): FareRow[] {
  const byMonth = new Map<string, FareRow>();
  for (const r of records) {
    const ym = String(r.YearMonth ?? "");
    const nominal = toNum(r["$Value"]);
    if (!/^\d{6}$/.test(ym) || nominal === null || nominal <= 0) continue;
    if (!byMonth.has(ym)) byMonth.set(ym, { yearMonth: ym, route: String(r.Route ?? ""), nominal, real: toNum(r["$Real"]) });
  }
  return [...byMonth.values()].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

export const monthLabel = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
const r0 = (v: number) => Math.round(v);

export function answerFromFares(rows: FareRow[], opts: { from: string; to: string; months: number; baseUrl?: string }): PriceAnswer {
  const window = rows.slice(0, opts.months);
  const s = summarise(window.map((r) => r.nominal));
  const newest = window[0];
  const oldest = window[window.length - 1];
  const route = newest?.route || `${opts.from} - ${opts.to}`;
  return buildAnswer({
    source: INFO,
    query: { country: "AU", from: opts.from, to: opts.to, months: opts.months },
    summary: s,
    currency: "AUD",
    unit: "per return trip",
    period: window.length ? { from: monthLabel(oldest.yearMonth), to: monthLabel(newest.yearMonth) } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the monthly cheapest advertised return fares for ${route} over the last ${opts.months} months, from BITRE's domestic discount airfares series. ` +
      "Each month is one observation: the lowest discount return fare found on airline websites 3 weeks before a departure on the last Thursday of the month (return 2 weeks later). Advertised fares, not fares paid; the range reflects months, not travellers.",
    describe: (x) =>
      `Cheapest advertised return fare ${route}: median ${r0(x.median)} AUD, typical months between ${r0(x.low)} and ${r0(x.high)} AUD over the last ${opts.months} months. Advertised discount fares, not what travellers paid.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          route,
          latest_month: { month: monthLabel(newest.yearMonth), aud_return: newest.nominal, aud_return_cpi_adjusted: newest.real },
          recent_months: window.slice(0, 12).map((r) => ({ month: monthLabel(r.yearMonth), aud_return: r.nominal })),
          basis: "Cheapest advertised discount return fare, collected 3 weeks before departure on the last Thursday of each month. Posted price, not paid.",
        }
      : undefined,
  });
}

export async function auAirfares(input: { from?: string; to?: string; quarters?: number; baseUrl?: string }, o: FetchOptions = {}): Promise<PriceAnswer> {
  if (!input.from || !input.to) throw new InputError("AU airfares need both from and to (a city or airport code), for example from=Sydney, to=Melbourne.");
  const a = portName(input.from);
  const b = portName(input.to);
  if (a === b) throw new InputError("from and to are the same place; give two different cities or airport codes.");
  const quarters = Math.min(20, Math.max(1, Math.round(input.quarters ?? 4)));
  const months = quarters * 3;
  const res = await ckanSearch(
    SITE,
    { resourceId: RESOURCE_ID, filters: { Route: [`${a} - ${b}`, `${b} - ${a}`] }, sort: "YearMonth desc", limit: months * 2, includeTotal: false },
    o,
  );
  const rows = parseFares(res.records);
  if (rows.length === 0) {
    return buildAnswer({
      source: INFO,
      query: { country: "AU", from: input.from, to: input.to, months },
      summary: null,
      currency: "AUD",
      unit: "per return trip",
      period: { from: null, to: null },
      method: "BITRE's domestic discount airfares series covers about 70 routes between Australian cities.",
      describe: () => "",
      baseUrl: input.baseUrl,
    });
  }
  return answerFromFares(rows, { from: a, to: b, months, baseUrl: input.baseUrl });
}
