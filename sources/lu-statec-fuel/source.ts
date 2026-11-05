// Luxembourg fuel: monthly average pump prices of E10 petrol, diesel B7 and LPG (STATEC figures, published by the Ministry of the Economy,
// Energy Directorate-General, on data.public.lu, licence CC0 1.0). Format checked live on 2026-11-05 (plain GET, no key; 584 bytes, 10 rows):
//   https://data.public.lu/fr/datasets/r/d3a17cf8-5afc-4bf5-8222-9519e343d29d  (302 to download.data.public.lu/.../comparaisonprix-carburants-par-motorisation.csv)
//   Intervalle,Essence_E10,Diesel_B7,Hydrogene,LPG,Electricie_Fournisseur,Recharge_AC,Recharge_DC     (UTF-8 with BOM, CRLF)
//   Oct-26,1.805,2.066,9.95,0.915,0.211,0.565,0.693
// Units (dataset text): E10, diesel and LPG in EUR per litre including all taxes; hydrogen EUR per kg. Month label "Oct-26" = October 2026.
// Fixture: fixtures/comparaison-prix-carburants-2026-11-04.csv (the whole file, unchanged).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const DATA_URL = "https://data.public.lu/fr/datasets/r/d3a17cf8-5afc-4bf5-8222-9519e343d29d";
export const DATASET_PAGE = "https://data.public.lu/fr/datasets/comparaison-des-prix-de-carburants-par-motorisation/";

export const INFO: SourceInfo = {
  id: "lu-statec-fuel",
  country: "LU (Luxembourg)",
  category: "fuel (monthly national average pump price)",
  name: "Comparison of fuel prices by drive type: monthly average prices (Ministry of the Economy, data.public.lu)",
  publisher: "Ministère de l'Économie, Direction générale Énergie (Luxembourg); petrol, diesel and LPG prices from STATEC",
  what_is_recorded:
    "Each month, the national average pump price in euro per litre, all taxes included, of E10 petrol, diesel B7 and LPG in Luxembourg (prices from STATEC), " +
    "with the hydrogen price per kg. One published average per fuel and month; never an individual station.",
  price_type: "official_statistic",
  freshness: "Monthly; the month is named in every answer",
  licence: "CC0 1.0 (public domain dedication), as stated on the dataset record on data.public.lu (licence id cc-zero).",
  licence_url: DATASET_PAGE,
  attribution:
    "Source: Ministère de l'Économie, Direction générale Énergie (Luxembourg), 'Comparaison des prix de carburants par motorisation', petrol, diesel and LPG prices from STATEC, " +
    "via data.public.lu (CC0 1.0). Figures are passed on as published; changes on earlier months are calculated by ProofPrice. Not an official publication of the Ministry or STATEC.",
  homepage: DATASET_PAGE,
  limits:
    "A monthly national average, not a station price and not a receipt: no town, station or range, and no record count is published. " +
    "ProofPrice answers E10 from this file; diesel, petrol 95 and LPG for Luxembourg come from the weekly EU Oil Bulletin, which is fresher. The newest month can lag.",
};

export interface Month {
  /** "2026-10" */
  label: string;
  from: string;
  to: string;
  /** EUR per litre incl. taxes */
  e10?: number;
  diesel?: number;
  lpg?: number;
  /** EUR per kg */
  hydrogen?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, feb: 2, fev: 2, févr: 2, mar: 3, mars: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6,
  jul: 7, juil: 7, aug: 8, aou: 8, août: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, déc: 12,
};

/** "Oct-26" -> { label: "2026-10", from: "2026-10-01", to: "2026-10-31" } */
export function parseMonthLabel(s: string): { label: string; from: string; to: string } | null {
  const m = /^([A-Za-zéûÉ]+)\.?-(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  const last = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const mm = String(mo).padStart(2, "0");
  return { label: `${year}-${mm}`, from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

export function parseMonths(csvText: string): Month[] {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new SourceError("Luxembourg fuel file is empty");
  const head = lines[0].split(",").map((h) => h.trim());
  const ix = (n: string) => head.indexOf(n);
  const [iM, iE, iD, iH, iL] = ["Intervalle", "Essence_E10", "Diesel_B7", "Hydrogene", "LPG"].map(ix);
  if (iM < 0 || iE < 0 || iD < 0 || iL < 0) throw new SourceError("Luxembourg fuel file has an unexpected layout", head.join(","));
  const num = (v: string | undefined) => {
    const n = Number((v ?? "").trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const out: Month[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    const m = parseMonthLabel(f[iM] ?? "");
    if (!m) continue;
    out.push({ ...m, e10: num(f[iE]), diesel: num(f[iD]), lpg: num(f[iL]), hydrogen: iH >= 0 ? num(f[iH]) : undefined });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  if (!out.some((m) => m.e10 !== undefined)) throw new SourceError("Luxembourg fuel file holds no E10 price");
  return out;
}

function monthsBack(label: string, back: number): string {
  const [y, m] = label.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const eur = (v: number) => `${v.toFixed(3)} EUR`;
const LU_WORDS = new Set(["lu", "lux", "luxembourg", "luxemburg", "national", "nationwide", "all", "whole country"]);

export interface LuFuelQuery { fuel?: string; town?: string; area?: string; postcode?: string; baseUrl?: string }

function change(months: Month[], latest: Month, back: number) {
  const label = monthsBack(latest.label, back);
  const from = months.find((m) => m.label === label)?.e10;
  if (from === undefined || latest.e10 === undefined) return null;
  return { from_month: label, from_value: from, change_percent: Math.round(((latest.e10 - from) / from) * 1000) / 10 };
}

export const METHOD =
  "Luxembourg fuel: the Ministry of the Economy (Energy Directorate-General) publishes on data.public.lu the monthly average price per litre, all taxes included, of E10 petrol, diesel B7 and LPG (prices from STATEC). " +
  "ProofPrice returns the published E10 average for the newest month, unchanged, with the change on three months and on a year earlier (calculated by ProofPrice from the same series). " +
  "No range or sample size: one national average per month. An official statistic, not a station price.";

export function luFuelAnswer(months: Month[], q: LuFuelQuery): PriceAnswer {
  if (q.fuel !== "e10") throw new InputError("Luxembourg monthly series: fuel must be e10 here (diesel, petrol95 and lpg for Luxembourg are answered by the weekly EU Oil Bulletin).");
  const place = q.town || q.area || q.postcode || undefined;
  const query = { country: "LU", fuel: "e10", ...(place ? { place } : {}) };
  const latest = [...months].reverse().find((m) => m.e10 !== undefined);
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", method: METHOD, baseUrl: q.baseUrl };
  if (!latest) return buildStatisticAnswer({ ...base, value: null, unit: "per litre", period: { from: null, to: null }, reference_period: "n/a", describe: () => "" });
  const value = latest.e10 as number;
  const m3 = change(months, latest, 3);
  const y1 = change(months, latest, 12);
  const placeNote = place && !LU_WORDS.has(place.trim().toLowerCase()) ? `The Luxembourg data is one national price per month, so '${place}' is answered with the national average.` : undefined;
  const move = (c: ReturnType<typeof change>, what: string) =>
    c ? `${c.change_percent === 0 ? "unchanged" : `${c.change_percent > 0 ? "up" : "down"} ${Math.abs(c.change_percent)}%`} on ${what} (${eur(c.from_value)} in ${c.from_month})` : `no figure for ${what}`;
  const others: Record<string, unknown> = {};
  if (latest.diesel !== undefined) others.diesel = { price_eur: latest.diesel, unit: "per litre", definition: "Diesel B7" };
  if (latest.lpg !== undefined) others.lpg = { price_eur: latest.lpg, unit: "per litre", definition: "LPG (autogas)" };
  if (latest.hydrogen !== undefined) others.hydrogen = { price_eur: latest.hydrogen, unit: "per kg", definition: "Hydrogen" };
  return buildStatisticAnswer({
    ...base,
    value,
    unit: "per litre",
    period: { from: latest.from, to: latest.to },
    reference_period: latest.label,
    note: placeNote,
    describe: (v) =>
      `The national average pump price of E10 petrol in Luxembourg was ${eur(v)} per litre, all taxes included, in ${latest.label} (monthly figure; Ministry of the Economy, prices from STATEC), ` +
      `${move(m3, "three months earlier")} and ${move(y1, "a year earlier")}.`,
    extra: {
      country_name: "Luxembourg",
      reference_month: latest.label,
      change_on_three_months_earlier: m3,
      change_on_year_earlier: y1,
      other_fuels_same_month: others,
      dataset: { url: DATA_URL, page: DATASET_PAGE },
      ...(placeNote ? { place_note: placeNote } : {}),
    },
  });
}

export interface LuOptions { getter?: (url: string) => Promise<string>; timeoutMs?: number }

export async function fetchMonths(o: LuOptions = {}): Promise<Month[]> {
  if (o.getter) return parseMonths(await o.getter(DATA_URL));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 20000);
  try {
    const res = await fetch(DATA_URL, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "text/csv" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, DATA_URL, res.status);
    return parseMonths(await res.text());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", DATA_URL);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function luFuel(input: LuFuelQuery, o: LuOptions = {}): Promise<PriceAnswer> {
  if (input.fuel !== "e10") throw new InputError("Luxembourg monthly series: fuel must be e10 here (diesel, petrol95 and lpg for Luxembourg are answered by the weekly EU Oil Bulletin).");
  return luFuelAnswer(await fetchMonths(o), input);
}

// ---------- daily collector (stale-if-error copy) ----------
// One row for the newest month (E10), n NO_COUNT because the ministry publishes one national average and no record count.
// Dated by the last day of the reference month so the copy keeps standing in for that month while the portal is down.
export function harvestRows(months: Month[]): HarvestResult {
  const head = [...months].reverse().find((m) => m.e10 !== undefined);
  if (!head || head.e10 === undefined) throw new SourceError("Luxembourg fuel file holds no usable E10 price");
  const v = head.e10;
  return {
    date: head.to,
    currency: "EUR",
    unit: "per litre",
    rows: [{ area: "LU", item: "e10", n: NO_COUNT, median: v, low: v, high: v, min: v, max: v }],
    note: `data.public.lu 'Comparaison des prix de carburants par motorisation': national average E10 price per litre incl. taxes for ${head.label}. Published average, not a count of records.`,
  };
}

export async function luFuelHarvest(o: LuOptions = {}): Promise<HarvestResult> {
  return harvestRows(await fetchMonths(o));
}

export function luFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return p.fuel === "e10" ? { area: "LU", item: "e10", label: "Luxembourg (national average)" } : null;
}
