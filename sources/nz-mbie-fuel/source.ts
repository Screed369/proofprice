// New Zealand fuel: MBIE's weekly fuel price monitoring. One CSV ("weekly-table.csv", long format, every week since 2004) with the national
// "Adjusted retail price" of Regular Petrol (91), Premium Petrol 95R and Diesel in NZD cents per litre. The file is about 3 MB, so we
// read it once per request (the CDN caches answers for 10 minutes) and take the newest week; no library history is kept.
// Format checked live on 2026-10-14 from GitHub's servers and a Vercel deployment (see fixtures/weekly-table-sample.csv, rows copied from it).
// Note the path is case-sensitive: .../Data-Files/Energy/Weekly-fuel-price-monitoring/weekly-table.csv (the lower-case path is a 404).

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_URL =
  "https://www.mbie.govt.nz/building-and-energy/energy-and-natural-resources/energy-statistics-and-modelling/energy-statistics/weekly-fuel-price-monitoring";
export const CSV_URL = "https://www.mbie.govt.nz/assets/Data-Files/Energy/Weekly-fuel-price-monitoring/weekly-table.csv";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

export const INFO: SourceInfo = {
  id: "nz-mbie-fuel",
  country: "NZ (New Zealand)",
  category: "fuel (weekly national retail price)",
  name: "Weekly fuel price monitoring (weekly-table.csv)",
  publisher: "Ministry of Business, Innovation and Employment (MBIE), New Zealand",
  what_is_recorded:
    "For each week since April 2004, the national 'Adjusted retail price' of Regular Petrol (91), Premium Petrol 95R and Diesel in New Zealand cents per litre, with the price components MBIE monitors (importer cost, taxes, importer margin). Provisional for the most recent weeks.",
  price_type: "official_statistic",
  freshness: "Weekly (Fridays), using the previous week's data; the newest weeks are marked Provisional by MBIE and revised",
  licence:
    'MBIE, Weekly fuel price monitoring page, "Use of this data": "This work is licensed under a Creative Commons Attribution 4.0 New Zealand Licence"',
  licence_url: LICENCE_URL,
  attribution:
    "Source: Ministry of Business, Innovation and Employment (MBIE), Weekly fuel price monitoring. Licensed under a Creative Commons Attribution 4.0 New Zealand Licence. " +
    "Figures are passed on as published (converted from cents to dollars per litre); the changes are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "A national weekly average, not a pump price at a station: there is no town, region or station detail and no range or sample size. " +
    "The series is MBIE's 'Adjusted retail price' (a monitoring estimate built from importer price boards and adjusted by MBIE, see its methodology), so it can differ from what one station charges. " +
    "MBIE publishes Regular Petrol (91) and Premium Petrol 95R only; there is no separate 98 or E10 series. The newest weeks are provisional.",
};

export interface FuelPoint {
  week: string; // "2026w41"
  date: string; // YYYY-MM-DD (the Friday of the week)
  fuel: string; // "Diesel" | "Regular Petrol" | "Premium Petrol 95R"
  centsPerLitre: number;
  status: string; // "Final" | "Provisional"
}

/** Split one CSV line into fields, honouring double quotes. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(f);
      f = "";
    } else f += c;
  }
  out.push(f);
  return out;
}

/** The 'Adjusted retail price' rows of the weekly table, oldest first. Throws SourceError when the layout is not the one we know. */
export function parseWeekly(text: string): FuelPoint[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines.length ? splitLine(lines[0]).map((h) => h.trim().toLowerCase()) : [];
  const want = ["week", "date", "fuel", "variable", "value", "unit", "status"];
  if (want.some((w, i) => head[i] !== w)) {
    throw new SourceError("MBIE changed the layout of the weekly fuel price table (expected Week, Date, Fuel, Variable, Value, Unit, Status); this source needs updating.");
  }
  const out: FuelPoint[] = [];
  for (const l of lines.slice(1)) {
    const c = splitLine(l);
    if (c[3] !== "Adjusted retail price" || c[5] !== "NZD c/L") continue;
    const v = Number(c[4]);
    if (!Number.isFinite(v) || v <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(c[1])) continue;
    out.push({ week: c[0], date: c[1], fuel: c[2], centsPerLitre: v, status: c[6] });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const SERIES: Record<string, { mbie: string; label: string }> = {
  diesel: { mbie: "Diesel", label: "diesel" },
  petrol95: { mbie: "Premium Petrol 95R", label: "Premium petrol 95R" },
  petrol98: { mbie: "Premium Petrol 95R", label: "Premium petrol 95R" },
};
const REGULAR = { mbie: "Regular Petrol", label: "Regular petrol 91" };

const dollars = (c: number) => Math.round(c * 10) / 1000; // cents -> dollars, rounded to 0.1 cent
const nzd = (d: number) => `$${d.toFixed(3)}`;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

export interface Change {
  from: string;
  value: number;
  absolute: number;
  percent: number;
}

/** The point for the same fuel closest to `days` days before `latest` (within 4 days), as a change. */
export function changeFrom(points: FuelPoint[], latest: FuelPoint, days: number): Change | null {
  let best: FuelPoint | null = null;
  for (const p of points) {
    if (p.fuel !== latest.fuel || p.date >= latest.date) continue;
    const gap = Math.abs(daysBetween(latest.date, p.date) - days);
    if (gap <= 4 && (!best || gap < Math.abs(daysBetween(latest.date, best.date) - days))) best = p;
  }
  if (!best) return null;
  return {
    from: best.date,
    value: dollars(best.centsPerLitre),
    absolute: Math.round((latest.centsPerLitre - best.centsPerLitre) * 10) / 1000,
    percent: Math.round(((latest.centsPerLitre - best.centsPerLitre) / best.centsPerLitre) * 1000) / 10,
  };
}

const move = (c: Change | null, what: string) =>
  c ? `${c.percent > 0 ? "up" : c.percent < 0 ? "down" : "unchanged"}${c.percent === 0 ? "" : ` ${Math.abs(c.percent)}%`} on ${what} (${nzd(c.value)} on ${c.from})` : `no figure for ${what}`;

export interface NzFuelInput {
  fuel?: string;
  town?: string;
  area?: string;
  postcode?: string;
  baseUrl?: string;
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

export function answerFromPoints(points: FuelPoint[], input: NzFuelInput): PriceAnswer {
  const fuel = input.fuel ?? "";
  const series = SERIES[fuel];
  if (!series) throw new InputError("New Zealand: fuel must be diesel or petrol95 (MBIE publishes Premium Petrol 95R, which also answers petrol98).");
  const mine = points.filter((p) => p.fuel === series.mbie);
  const latest = mine[mine.length - 1];
  const place = input.town || input.area || input.postcode;
  const query = { country: "NZ", fuel, ...(place ? { place } : {}) };
  if (!latest) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "NZD", unit: "per litre",
      period: { from: null, to: null }, reference_period: "n/a", method: METHOD, describe: () => "", baseUrl: input.baseUrl,
    });
  }
  const value = dollars(latest.centsPerLitre);
  const week = changeFrom(mine, latest, 7);
  const year = changeFrom(mine, latest, 364);
  const others: Record<string, { price_nzd_per_litre: number; status: string }> = {};
  for (const s of [{ mbie: "Diesel", label: "diesel" }, REGULAR, { mbie: "Premium Petrol 95R", label: "premium petrol 95r" }]) {
    const p = [...points].reverse().find((x) => x.fuel === s.mbie && x.date === latest.date);
    if (p) others[s.label.toLowerCase().replace(/\s+/g, "_")] = { price_nzd_per_litre: dollars(p.centsPerLitre), status: p.status };
  }
  const provisional = latest.status !== "Final";
  const note =
    (provisional ? "Provisional: MBIE revises the most recent weeks. " : "") +
    (place ? `MBIE publishes one national price only; '${place}' is answered with the New Zealand average. ` : "") +
    (fuel === "petrol98" ? "MBIE has no 98 series; this is Premium Petrol 95R. " : "") +
    (fuel === "petrol95" || fuel === "petrol98" ? "Regular Petrol (91) is in extra.other_fuels." : "");
  return buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "NZD",
    unit: "per litre",
    period: { from: latest.date, to: latest.date },
    reference_period: `week ${latest.week} (Friday ${latest.date})`,
    method: METHOD,
    note: note.trim() || undefined,
    describe: (v) =>
      `The national average retail price of ${series.label} in New Zealand was ${nzd(v)} NZD per litre in the week of ${latest.date}${provisional ? " (provisional)" : ""}, ` +
      `${move(week, "the week before")} and ${move(year, "a year earlier")}.`,
    baseUrl: input.baseUrl,
    extra: {
      week: latest.week,
      status: latest.status,
      change_on_week: week,
      change_on_year: year,
      other_fuels: others,
      ...(place ? { place_note: "national figure only" } : {}),
    },
  });
}

export const METHOD =
  "New Zealand fuel: MBIE's weekly 'Adjusted retail price' (national average, NZD cents per litre, shown here in dollars) for the newest week, with the change on the week before and on the same week a year earlier. " +
  "An official monitoring statistic for the whole country, not a station price; the newest weeks are provisional.";

export async function nzFuel(input: NzFuelInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  return answerFromPoints(parseWeekly(await fetcher(CSV_URL)), input);
}
