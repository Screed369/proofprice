// United Kingdom: the weekly road fuel prices published by the Department for Energy Security and Net Zero (DESNZ) on gov.uk.
// Formats checked live on 2026-10-14 (newest row dated Monday 12 October 2026).
//
// What is published: one national figure per week: the average UK retail ("pump") price of ULSP (ultra low sulphur unleaded petrol)
// and ULSD (ultra low sulphur diesel) in pence per litre, with the duty rate (pence per litre) and VAT rate that apply, in one CSV
// (2018 to now, one row per week, dates are Mondays) next to an Excel workbook and an XML file. The gov.uk page is marked
// "Accredited official statistics". The CSV's address changes every week (gov.uk issues a new file id), so the collector finds it
// through the gov.uk Content API (GET /api/content/government/statistics/weekly-road-fuel-prices, key-free), whose
// details.attachments lists the files with their titles and addresses.
//
// The collector (harvest) reads the CSV once a day, keeps the newest week in the price library (area "ALL"), and requests are answered from there.
// Library rows (GBP per litre; the CSV's pence divided by 100):
//   item "petrol95" (ULSP) | "diesel" (ULSD)          the newest week
//   item "<fuel>@YYYY-MM-DD"                           the price in the week of that earlier date (previous week, a year earlier)
//   item "<fuel>:duty"                                 the fuel duty rate that week, GBP per litre
//   item "<fuel>:vat"                                  the VAT rate that week, percent
// A published figure does not come from counting records, so it is stored with median = low = high = min = max = the figure and n = 5.
// That n is a placeholder to pass the library's "at least 5" gate, NOT a count of records (the answers carry sample_size null).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";

export const PAGE_URL = "https://www.gov.uk/government/statistics/weekly-road-fuel-prices";
export const CONTENT_API = "https://www.gov.uk/api/content/government/statistics/weekly-road-fuel-prices";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "gb-desnz-fuel",
  country: "GB (United Kingdom)",
  category: "fuel (national average pump prices)",
  name: "Weekly road fuel prices",
  publisher: "Department for Energy Security and Net Zero (DESNZ), United Kingdom",
  what_is_recorded:
    "The average UK retail (\"pump\") price of unleaded petrol (ULSP) and diesel (ULSD) in pence per litre, one national figure per week, with the duty rate and VAT rate that apply. " +
    "The gov.uk page describes it as \"Road fuel price statistics providing average UK retail 'pump' prices on a weekly basis\" and marks it \"Accredited official statistics\". Each row of the table is dated a Monday.",
  price_type: "official_statistic",
  freshness: "Weekly: one national figure each week, usually available the same week",
  licence:
    "Open Government Licence v3.0. The gov.uk page states: \"All content is available under the Open Government Licence v3.0, except where otherwise stated\". © Crown copyright",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Energy Security and Net Zero, Weekly road fuel prices. " +
    "The price is converted from pence to pounds per litre and the change on the previous week and a year earlier is calculated by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "One average for the whole United Kingdom per week, not the price at a station, town or postcode: an area or postcode in a request is answered with the national figure and says so. " +
    "Only unleaded petrol (ULSP, asked for as petrol95) and diesel (ULSD, diesel) are published; premium petrol, E10 as a separate grade, LPG and electric charging are not. " +
    "DESNZ gives no range and no number of stations. In the history tool, sample_size is a placeholder (5), not a count of stations.",
};

// ---------- fuels ----------

export type GbFuel = "petrol95" | "diesel";
export const FUEL_INFO: Record<GbFuel, { label: string; short: string }> = {
  petrol95: { label: "unleaded petrol (ULSP)", short: "ULSP" },
  diesel: { label: "diesel (ULSD)", short: "ULSD" },
};

// ---------- finding the file ----------

export interface Attachment {
  title?: string;
  url?: string;
  content_type?: string;
}

/** CSV addresses from the Content API's details.attachments, the table with the most recent years first. */
export function csvCandidates(content: any): string[] {
  const list: Attachment[] = Array.isArray(content?.details?.attachments) ? content.details.attachments : [];
  const csvs = list
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => typeof a?.url === "string" && (/\.csv(\?|$)/i.test(a.url) || a.content_type === "text/csv"))
    .map(({ a, i }) => ({ url: a.url as string, i, last: Math.max(0, ...(String(a.title ?? "").match(/\d{4}/g) ?? []).map(Number)) }));
  csvs.sort((x, y) => y.last - x.last || x.i - y.i);
  return csvs.map((c) => c.url);
}

// ---------- reading the CSV (pure) ----------

export interface DesnzWeek {
  date: string; // YYYY-MM-DD
  ulsp: number; // pence per litre
  ulsd: number;
  ulspDuty: number | null; // pence per litre
  ulsdDuty: number | null;
  ulspVat: number | null; // percent
  ulsdVat: number | null;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

function isoDate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

const num = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Parse the weekly CSV: "Date, ULSP ... Pump price in pence/litre, ULSD ... Pump price ..., duty rates, VAT rates". Oldest first. */
export function parseDesnzCsv(text: string): DesnzWeek[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new SourceError("The DESNZ road fuel CSV is empty; this source needs updating.");
  const head = splitCsv(lines[0]).map((h) => h.trim());
  const find = (fuel: "ULSP" | "ULSD", what: RegExp): number => head.findIndex((h) => h.startsWith(fuel) && what.test(h));
  const cDate = head.findIndex((h) => h.toLowerCase() === "date");
  const cP = find("ULSP", /pump price/i);
  const cD = find("ULSD", /pump price/i);
  if ([cDate, cP, cD].some((i) => i < 0)) {
    throw new SourceError("The DESNZ road fuel CSV has a new layout (no Date, ULSP or ULSD pump price columns); this source needs updating.");
  }
  if (!/pence\s*\/\s*litre/i.test(head[cP]) || !/pence\s*\/\s*litre/i.test(head[cD])) {
    throw new SourceError("The DESNZ road fuel CSV no longer says pence/litre; this source needs updating.");
  }
  const cPDuty = find("ULSP", /duty rate/i);
  const cDDuty = find("ULSD", /duty rate/i);
  const cPVat = find("ULSP", /vat/i);
  const cDVat = find("ULSD", /vat/i);
  const weeks: DesnzWeek[] = [];
  for (const line of lines.slice(1)) {
    const f = splitCsv(line);
    const date = isoDate(f[cDate] ?? "");
    const ulsp = num(f[cP]);
    const ulsd = num(f[cD]);
    if (!date || ulsp === null || ulsd === null || ulsp <= 0 || ulsd <= 0) continue;
    weeks.push({
      date,
      ulsp,
      ulsd,
      ulspDuty: cPDuty >= 0 ? num(f[cPDuty]) : null,
      ulsdDuty: cDDuty >= 0 ? num(f[cDDuty]) : null,
      ulspVat: cPVat >= 0 ? num(f[cPVat]) : null,
      ulsdVat: cDVat >= 0 ? num(f[cDVat]) : null,
    });
  }
  weeks.sort((a, b) => a.date.localeCompare(b.date));
  if (weeks.length < 52) throw new SourceError(`The DESNZ road fuel CSV has only ${weeks.length} usable weeks; the file may have changed.`);
  const last = weeks[weeks.length - 1];
  for (const p of [last.ulsp, last.ulsd]) {
    if (p < 50 || p > 500) throw new SourceError(`The newest DESNZ pump price (${p}) is not a plausible pence-per-litre figure; the file may have changed.`);
  }
  return weeks;
}

// ---------- the library rows ----------

const dayMs = 86400000;
const dayOf = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / dayMs);
const gbp = (pence: number) => Math.round(pence * 1000) / 100000; // pence -> pounds without float noise (the CSV has at most 2 decimals)

/** The week before the newest (or the closest earlier within 14 days if a week is missing). */
export function previousOf(weeks: DesnzWeek[]): DesnzWeek | null {
  const last = weeks[weeks.length - 1];
  if (!last) return null;
  const d = dayOf(last.date);
  return [...weeks].reverse().find((w) => dayOf(w.date) < d && d - dayOf(w.date) <= 14) ?? null;
}

/** The week closest to 52 weeks (364 days) before the newest, within 4 days. */
export function yearEarlierOf(weeks: DesnzWeek[]): DesnzWeek | null {
  const last = weeks[weeks.length - 1];
  if (!last) return null;
  const target = dayOf(last.date) - 364;
  let best: DesnzWeek | null = null;
  for (const w of weeks) {
    const off = Math.abs(dayOf(w.date) - target);
    if (off <= 4 && (!best || off < Math.abs(dayOf(best.date) - target))) best = w;
  }
  return best;
}

export function desnzRows(weeks: DesnzWeek[]): DailyRow[] {
  const last = weeks[weeks.length - 1];
  if (!last) return [];
  const rows: DailyRow[] = [];
  const put = (item: string, v: number) => rows.push({ area: NATIONAL, item, n: 5, median: v, low: v, high: v, min: v, max: v });
  const earlier = [previousOf(weeks), yearEarlierOf(weeks)].filter((w): w is DesnzWeek => !!w);
  const fuels: { item: GbFuel; price: (w: DesnzWeek) => number; duty: number | null; vat: number | null }[] = [
    { item: "petrol95", price: (w) => w.ulsp, duty: last.ulspDuty, vat: last.ulspVat },
    { item: "diesel", price: (w) => w.ulsd, duty: last.ulsdDuty, vat: last.ulsdVat },
  ];
  for (const f of fuels) {
    put(f.item, gbp(f.price(last)));
    for (const w of earlier) put(`${f.item}@${w.date}`, gbp(f.price(w)));
    if (f.duty !== null) put(`${f.item}:duty`, gbp(f.duty));
    if (f.vat !== null) put(`${f.item}:vat`, f.vat);
  }
  return rows;
}

export function desnzResult(weeks: DesnzWeek[]): HarvestResult {
  const last = weeks[weeks.length - 1];
  const prev = previousOf(weeks);
  const year = yearEarlierOf(weeks);
  return {
    date: last.date,
    currency: "GBP",
    unit: "per litre",
    rows: desnzRows(weeks),
    note:
      `DESNZ Weekly road fuel prices, week dated ${last.date}: UK average pump prices of ULSP (petrol95) and ULSD (diesel), pounds per litre (pence/100), area ALL. ` +
      `"<item>@<date>" = the price in the week of that earlier date (${prev ? `previous week ${prev.date}` : "no previous week"}, ${year ? `year earlier ${year.date}` : "no year-earlier week"}); ` +
      "<item>:duty = duty rate in pounds per litre; <item>:vat = VAT percent. Published values, not counts of records (n=5 is a placeholder).",
  };
}

// ---------- the collector ----------

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

async function downloadText(url: string, tries = 3): Promise<string> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.text();
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.cause?.code ?? e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** The daily collector: find the weekly CSV through the gov.uk Content API, read it once, keep the newest week. */
export async function desnzHarvest(): Promise<HarvestResult> {
  const content = await fetchJson(CONTENT_API, { headers: { "user-agent": UA } }, 30000);
  const urls = csvCandidates(content);
  if (!urls.length) throw new SourceError("The gov.uk page for the weekly road fuel prices lists no CSV file; it may have changed and this source needs updating.");
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return desnzResult(parseDesnzCsv(await downloadText(url)));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new SourceError("No usable DESNZ road fuel CSV found");
}

// ---------- answering ----------

export interface GbInput {
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
}

interface LibLike {
  date: string;
  rows: { area: string; item: string; median: number }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const pence = (pounds: number) => round2(pounds * 100);

/** A week older than this many days is flagged as old data (a weekly release has been missed). */
export const OLD_AFTER_DAYS = 14;

function changeSentence(pct: number, label: string): string {
  return pct === 0 ? `unchanged on ${label}` : `${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than ${label}`;
}

/** Pure: the answer for one fuel from the library's newest week. */
export function desnzAnswer(lib: LibLike, input: GbInput, now = new Date()): PriceAnswer {
  const fuel = input.fuel as GbFuel;
  if (fuel !== "petrol95" && fuel !== "diesel") {
    throw new InputError("fuel must be petrol95 (unleaded petrol, ULSP) or diesel (ULSD) for the United Kingdom; premium petrol, E85, LPG and CNG are not published.");
  }
  const info = FUEL_INFO[fuel];
  const get = (item: string): number | null => lib.rows.find((r) => r.area === NATIONAL && r.item === item)?.median ?? null;
  const dated = (item: string) => lib.rows.filter((r) => r.area === NATIONAL && r.item.startsWith(`${item}@`)).map((r) => ({ date: r.item.slice(item.length + 1), value: r.median }));
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query: Record<string, unknown> = { country: "GB", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const method =
    "The Department for Energy Security and Net Zero publishes every week the average UK retail (pump) price of unleaded petrol (ULSP) and diesel (ULSD) in pence per litre. " +
    "ProofPrice returns the published national figure for the newest week it holds, converted to pounds per litre, with the change on the previous week and on a year earlier calculated from DESNZ's own weekly table. " +
    "No range is calculated and DESNZ gives no number of stations.";
  const base = { source: INFO, query, measure: "average" as const, currency: "GBP", unit: "per litre", method, baseUrl: input.baseUrl };

  const value = get(fuel);
  if (value === null) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `The DESNZ weekly table of ${longDate(lib.date)} carries no ${info.label} price.` };
  }

  const list = dated(fuel);
  const d0 = dayOf(lib.date);
  const prev = [...list].filter((x) => dayOf(x.date) < d0 && d0 - dayOf(x.date) <= 14).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const year = list.filter((x) => Math.abs(dayOf(x.date) - (d0 - 364)) <= 4).sort((a, b) => Math.abs(dayOf(a.date) - (d0 - 364)) - Math.abs(dayOf(b.date) - (d0 - 364)))[0] ?? null;
  const chg = (then: { date: string; value: number } | null) =>
    then
      ? {
          date: then.date,
          price_gbp_per_litre: then.value,
          price_pence_per_litre: pence(then.value),
          change_percent: round1(((value - then.value) / then.value) * 100),
          change_pence_per_litre: round2((value - then.value) * 100),
        }
      : null;
  const prevChange = chg(prev);
  const yearChange = chg(year);
  const ageDays = Math.round((now.getTime() - Date.parse(lib.date + "T00:00:00Z")) / dayMs);
  const old = ageDays > OLD_AFTER_DAYS;
  const duty = get(`${fuel}:duty`);
  const vat = get(`${fuel}:vat`);
  const other: GbFuel = fuel === "diesel" ? "petrol95" : "diesel";
  const otherValue = get(other);

  const phrases = [
    prevChange && changeSentence(prevChange.change_percent, `the previous week (${longDate(prevChange.date)})`),
    yearChange && changeSentence(yearChange.change_percent, `a year earlier (${longDate(yearChange.date)})`),
  ].filter(Boolean);
  const notes: string[] = [];
  if (asked.length) {
    notes.push(`You asked about ${asked.join(", ")}. DESNZ publishes one average for the whole United Kingdom, so this is the UK national average, not a price for that place.`);
  }
  if (old) notes.push(`This is old data: the newest week we hold is dated ${longDate(lib.date)}, ${ageDays} days ago, and a more recent one may have been published.`);

  return buildStatisticAnswer({
    ...base,
    value,
    period: { from: lib.date, to: lib.date },
    reference_period: lib.date,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      (asked.length ? `The United Kingdom is covered by one national average only (you asked about ${asked.join(", ")}). ` : "") +
      `The average UK pump price of ${info.label} was ${pence(v)} pence per litre (£${v.toFixed(4)}) in DESNZ's weekly road fuel prices for the week dated ${longDate(lib.date)}` +
      (phrases.length ? `, ${phrases.join(" and ")}` : "") +
      "." +
      (old ? ` This is old data: ${ageDays} days have passed since that week.` : ""),
    extra: {
      fuel,
      product: info.label,
      scope: "UK national average (one figure for the whole United Kingdom; no area, town or postcode figures)",
      week_dated: lib.date,
      price_pence_per_litre: pence(value),
      price_gbp_per_litre: round4(value),
      change_on_previous_week: prevChange,
      change_on_year_earlier: yearChange,
      ...(duty !== null ? { fuel_duty_pence_per_litre: pence(duty) } : {}),
      ...(vat !== null ? { vat_percent: vat } : {}),
      ...(otherValue !== null ? { [`${other}_price_pence_per_litre`]: pence(otherValue) } : {}),
      data_age_days: ageDays,
      ...(old ? { stale_warning: `The newest DESNZ weekly figure we hold is dated ${lib.date}, ${ageDays} days ago.` } : {}),
      ...(asked.length ? { asked_place: asked.join(", "), answered_as: "UK national average" } : {}),
      source_file: "DESNZ weekly road fuel prices, CSV 2018 to now (gov.uk)",
    },
  });
}

export async function desnzFuelNow(input: GbInput, now = new Date()): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Not yet available: the DESNZ weekly fuel prices appear after the next collection (the price library has no data for this source yet).");
  return desnzAnswer(lib, input, now);
}

export function desnzHistoryKey(p: { fuel: string }): { area: string; item: string; label: string } | null {
  if (p.fuel !== "petrol95" && p.fuel !== "diesel") return null;
  return { area: NATIONAL, item: p.fuel, label: "the United Kingdom (national average)" };
}
