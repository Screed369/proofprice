// Singapore hotel room rates: Singapore Department of Statistics / Singapore Tourism Board, "Hotel Statistics, Annual"
// (SingStat table M550111) via data.gov.sg. One national annual series for gazetted hotels, S$ per room night.
// Format checked live on 2026-10-23 from GitHub's servers (probe sgh1, 1,856 bytes, 5 rows by DataSeries, one column per year 2008-2025).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const URL_ROWS = "https://api-production.data.gov.sg/v2/public/api/datasets/d_a728577abbe4ff3f3409b9129be28a53/list-rows?limit=30";
export const LICENCE_URL = "https://developers.data.gov.sg/open-data-licence";

export const INFO: SourceInfo = {
  id: "sg-stb-hotels",
  country: "SG (Singapore)",
  category: "hotels (average room rate)",
  name: "Hotel Statistics, Annual (average room rate of gazetted hotels)",
  publisher: "Singapore Department of Statistics / Singapore Tourism Board, via data.gov.sg",
  what_is_recorded:
    "The average room rate of Singapore's gazetted hotels in S$ per room night for each year: total room revenue divided by room nights sold, so what guests paid on average, not the tariff on the door.",
  price_type: "official_statistic",
  freshness: "Annual, published about 8 months after the year ends (2025 appeared in September 2026)",
  licence: "Singapore Open Data Licence v1.0: use of the datasets is allowed commercially and non-commercially, with attribution and no implied endorsement.",
  licence_url: LICENCE_URL,
  attribution: "Source: Singapore Department of Statistics / Singapore Tourism Board, Hotel Statistics, Annual, via data.gov.sg, under the Singapore Open Data Licence v1.0.",
  homepage: "https://data.gov.sg/datasets/d_a728577abbe4ff3f3409b9129be28a53/view",
  limits:
    "One national average per year for gazetted hotels: no month, area, star class or hotel, and no range. Not a booking quote for particular dates. Short-term rentals are not included.",
};

export interface SgRow { series: string; years: Record<string, number> }
export interface SgHotelData { rate: Record<string, number>; hotels: Record<string, number>; occupancy: Record<string, number> }

function numbers(row: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    if (!/^\d{4}$/.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

export function parseRows(json: any): SgHotelData {
  const rows: any[] = json?.data?.rows;
  if (!Array.isArray(rows) || !rows.length) throw new SourceError("The Singapore hotel statistics file changed layout (no rows)", "");
  const find = (re: RegExp) => rows.find((r) => re.test(String(r?.DataSeries ?? "")));
  const rate = numbers(find(/^average room rate$/i));
  if (Object.keys(rate).length < 5) throw new SourceError("The Singapore hotel statistics file changed layout (no Average Room Rate series)", "");
  return { rate, hotels: numbers(find(/number of gazetted hotels/i)), occupancy: numbers(find(/average occupancy rate/i)) };
}

const sgd = (v: number) => fmtMoney(v, "SGD");

export interface SgHotelInput { area?: string; stars?: number; year?: string; baseUrl?: string }

export function sgHotelMethod(): string {
  return (
    "Singapore hotels: the average room rate in S$ per room night that the Singapore Department of Statistics and the Singapore Tourism Board publish each year for gazetted hotels as a whole (room revenue divided by room nights sold). " +
    "We pass on the latest year with the change on the year before and the last five years; the number of hotels behind it is the sample size. It is an official national average, not a range of bookings and not a quote for particular dates."
  );
}

/** Only a national annual figure exists: a district, star class or month is refused, never answered with the national figure. */
export function checkInput(input: SgHotelInput): void {
  if (input.area && !/^(singapore|sg|all|national|whole country)$/i.test(input.area.trim())) {
    throw new InputError(`Singapore hotel rates are published for Singapore as a whole only, not for '${input.area}'. Leave area out (or use "Singapore").`);
  }
  if (input.stars !== undefined && input.stars !== null) {
    throw new InputError("Singapore hotel rates are published for all gazetted hotels together, not by star class. Leave stars out.");
  }
  if (input.year && !/^\d{4}$/.test(input.year.trim())) {
    throw new InputError("year must be a four-digit year such as 2024 (annual figures only).");
  }
}

export function sgHotelAnswer(data: SgHotelData, input: SgHotelInput): PriceAnswer {
  checkInput(input);
  const years = Object.keys(data.rate).sort();
  const year = input.year ? input.year.trim() : years[years.length - 1];
  const value = data.rate[year];
  if (value === undefined) {
    throw new InputError(`No Singapore hotel room rate is published for ${year}. Years available: ${years[0]} to ${years[years.length - 1]}.`);
  }
  const prevYear = String(Number(year) - 1);
  const prev = data.rate[prevYear];
  const yoy = prev ? { year: prevYear, value: prev, change_percent: Math.round(((value - prev) / prev) * 1000) / 10 } : null;
  const lastFive = years.filter((y) => y <= year).slice(-5).map((y) => ({ year: y, average_room_rate_sgd: data.rate[y] }));
  const hotels = data.hotels[year];
  const occ = data.occupancy[year];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SG", ...(input.year ? { year } : {}) },
    measure: "average",
    currency: "SGD",
    unit: "per room night",
    value,
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: year,
    sample_size: hotels ?? null,
    method: sgHotelMethod(),
    baseUrl: input.baseUrl,
    note: `The average room rate of Singapore's gazetted hotels for ${year}: a national annual average, not a quote for a date.`,
    describe: (v) =>
      `The average room rate of Singapore's gazetted hotels was ${sgd(v)} per room night in ${year}` +
      (hotels ? ` (${hotels} hotels)` : "") + ". " +
      (yoy ? (yoy.change_percent === 0 ? "That is unchanged from the year before. " : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than in ${prevYear} (${sgd(yoy.value)}). `) : "") +
      "This is an official national average, not a booking quote.",
    extra: {
      country_name: "Singapore",
      reference_year: year,
      hotels_counted: hotels ?? null,
      average_occupancy_percent: occ ?? null,
      change_on_year_earlier: yoy,
      last_five_years: lastFive,
      what_this_is: "Average room rate (room revenue divided by room nights sold) of gazetted hotels in Singapore, S$ per room night, published yearly.",
      dataset: { name: "Hotel Statistics, Annual (SingStat table M550111)", url: INFO.homepage },
    },
  });
}

async function fetchJson(url: string, timeoutMs = 25000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)", accept: "application/json" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.json();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function sgHotels(input: SgHotelInput, fetcher: (url: string) => Promise<any> = fetchJson): Promise<PriceAnswer> {
  checkInput(input);
  return sgHotelAnswer(parseRows(await fetcher(URL_ROWS)), input);
}
