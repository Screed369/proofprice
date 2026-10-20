// Hong Kong hotel room rates: Culture, Sports and Tourism Bureau (CSTB), "Average achieved hotel room rate", via DATA.GOV.HK.
// One citywide monthly series in HK$, rolling five years. Format checked live on 2026-10-20 from GitHub's servers
// (probe hk-hotel-rate, 824 bytes, header "Year-Month,Average_achieved_hotel_room_rate(HKD)", rows 202108 to 202607).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const URL_RATE = "https://www.tourism.gov.hk/datagovhk/hotelroomrate/average_achieved_hotel_room_rate_en.csv";
export const TERMS_URL = "https://data.gov.hk/en/terms-and-conditions";

export const INFO: SourceInfo = {
  id: "hk-tourism-hotels",
  country: "HK (Hong Kong)",
  category: "hotels (average achieved room rate)",
  name: "Average achieved hotel room rate, monthly",
  publisher: "Culture, Sports and Tourism Bureau (CSTB), The Government of the Hong Kong SAR, via DATA.GOV.HK",
  what_is_recorded:
    "The average achieved hotel room rate in Hong Kong in HK$ per room per night for each month, a citywide figure published by the Bureau (the rate achieved, not the advertised tariff).",
  price_type: "official_statistic",
  freshness: "Monthly, 2 to 3 months behind. A rolling five years",
  licence: "DATA.GOV.HK Terms and Conditions of Use: reuse free of charge, commercial use allowed, the source must be credited.",
  licence_url: TERMS_URL,
  attribution:
    "Source: Culture, Sports and Tourism Bureau, The Government of the Hong Kong Special Administrative Region, Average Achieved Hotel Room Rate, provided through DATA.GOV.HK.",
  homepage: "https://data.gov.hk/en-data/dataset/hk-cstb-cstb-hotel-room-rate",
  limits:
    "One citywide average per month: no district, star class or hotel, no range and no count of rooms. Not a booking quote for particular dates. Only the last five years are published.",
};

export interface RateRow { month: string; rate: number } // month "YYYY-MM"

export function parseRates(text: string): RateRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !/^Year-Month,\s*Average_achieved_hotel_room_rate/i.test(lines[0])) {
    throw new SourceError("The hotel room rate file changed layout (no Year-Month header)", "");
  }
  const rows: RateRow[] = [];
  for (const line of lines.slice(1)) {
    const m = /^(\d{4})(\d{2}),\s*([\d.]+)$/.exec(line);
    if (!m) continue;
    const rate = Number(m[3]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || !Number.isFinite(rate) || rate <= 0) continue;
    rows.push({ month: `${m[1]}-${m[2]}`, rate });
  }
  if (rows.length < 12) throw new SourceError("The hotel room rate file looks empty", String(rows.length));
  rows.sort((a, b) => a.month.localeCompare(b.month));
  return rows;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
function monthRange(m: string) {
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}
const hkd = (v: number) => fmtMoney(v, "HKD");

export interface HkHotelInput { area?: string; stars?: number; baseUrl?: string }

export function hkHotelMethod(): string {
  return (
    "Hong Kong hotels: the average achieved hotel room rate in HK$ per room per night that the Culture, Sports and Tourism Bureau publishes each month for Hong Kong as a whole. " +
    "We pass on the newest month with the change on a year earlier and the last 12 months. It is an official citywide average, not a range of bookings, not a quote for particular dates and not split by district or star class."
  );
}

/** A district or star class cannot be honoured: the series is citywide only. Say so instead of answering for the wrong place. */
export function checkInput(input: HkHotelInput): void {
  if (input.area && !/^(hong kong|hk|hksar|hong kong sar|all)$/i.test(input.area.trim())) {
    throw new InputError(`Hong Kong hotel rates are published for Hong Kong as a whole only, not for '${input.area}'. Leave area out (or use "Hong Kong").`);
  }
  if (input.stars !== undefined && input.stars !== null) {
    throw new InputError("Hong Kong hotel rates are published for all hotels together, not by star class. Leave stars out.");
  }
}

export function hkHotelAnswer(rows: RateRow[], input: HkHotelInput): PriceAnswer {
  checkInput(input);
  const latest = rows[rows.length - 1];
  const month = latest.month;
  const prevMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  const prev = rows.find((r) => r.month === prevMonth);
  const yoy = prev ? { month: prevMonth, value: prev.rate, change_percent: Math.round(((latest.rate - prev.rate) / prev.rate) * 1000) / 10 } : null;
  const last12 = rows.slice(-12).map((r) => ({ month: r.month, average_achieved_rate_hkd: r.rate }));
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "HK" },
    measure: "average",
    currency: "HKD",
    unit: "per room per night",
    value: latest.rate,
    period: monthRange(month),
    reference_period: month,
    method: hkHotelMethod(),
    baseUrl: input.baseUrl,
    note: `The average achieved hotel room rate in Hong Kong for ${monthWords(month)}: a citywide monthly average published by the Bureau, not a quote for a date.`,
    describe: (v) =>
      `The average achieved hotel room rate in Hong Kong was ${hkd(v)} per room per night in ${monthWords(month)}. ` +
      (yoy ? (yoy.change_percent === 0 ? "That is unchanged from a year earlier. " : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${hkd(yoy.value)}). `) : "") +
      "This is an official citywide average, not a booking quote.",
    extra: {
      country_name: "Hong Kong",
      reference_month: month,
      reference_month_label: monthWords(month),
      change_on_year_earlier: yoy,
      last_12_months: last12,
      what_this_is: "Average achieved hotel room rate per room per night, all Hong Kong hotels, published monthly by the Culture, Sports and Tourism Bureau.",
      dataset: { name: "Average achieved hotel room rate", url: INFO.homepage, file: URL_RATE },
    },
  });
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function hkHotels(input: HkHotelInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  checkInput(input);
  return hkHotelAnswer(parseRates(await fetcher(URL_RATE)), input);
}
