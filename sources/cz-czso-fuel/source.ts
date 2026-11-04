// Czech fuel: weekly national average consumer prices of diesel, petrol 95 and LPG from the Czech Statistical Office (CZSO, ČSÚ) public database.
// Format checked live on 2026-11-04 (plain GET, no key, no cookies; the file is 229 KB, 1,611 rows = 537 weeks x 3 fuels, 2016-W01 to 2026-W44):
//   https://vdb.czso.cz/pll/eweb/cenyphm.data   (text/csv, UTF-8, every field quoted)
//   "idhod","hodnota","ukazatel_kod","polozka_cis","polozka_kod","obdobi","rok","tyden","uzemi_cis","uzemi_kod","ukazatel_txt","polozka_txt"
//   "1551164743","47.51","6621","503","0722101","2026-W44","2026","44","97","19","Průměrná cena pohonných hmot","Motorová nafta [1 l]"
// Fuel = polozka_kod 0722101 diesel, 0722201 petrol 95 (Natural 95), 0722301 LPG; unit CZK per litre; territory 19 = the whole Czech Republic.
// The metadata file names indicator 7402 but the data rows carry 6621: we filter on polozka_cis 503 + polozka_kod and ignore the indicator.
// One national average per fuel and week, no range and no record count: an official statistic. Fixture: fixtures/cenyphm-2026-w44.csv (rows copied verbatim).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const DATA_URL = "https://vdb.czso.cz/pll/eweb/cenyphm.data";

export const INFO: SourceInfo = {
  id: "cz-czso-fuel",
  country: "CZ (Czechia)",
  category: "fuel (weekly national average pump price)",
  name: "Average consumer prices of motor fuels, weekly (CZSO public database, dataset cenyphm)",
  publisher: "Czech Statistical Office (ČSÚ / CZSO)",
  what_is_recorded:
    "Each week, the national average consumer price in Czech koruna of diesel, petrol 95 (Natural 95) and LPG per litre across the Czech Republic, from the CZSO weekly price survey of motor fuels. " +
    "One published average per fuel and week; never an individual station.",
  price_type: "official_statistic",
  freshness: "Weekly, with the ISO week named in every answer; history from 2016",
  licence:
    "CC BY 4.0. The Czech Statistical Office states that statistical information it releases through csu.gov.cz is licensed under CC BY 4.0; derived data must be labelled as adjusted, and the licence terms mentioned.",
  licence_url: "https://csu.gov.cz/conditions_for_use_and_further_dissemination",
  attribution:
    "Source: Czech Statistical Office (CZSO), average consumer prices of motor fuels (dataset cenyphm, vdb.czso.cz), licensed under CC BY 4.0 " +
    "https://csu.gov.cz/conditions_for_use_and_further_dissemination . Figures are passed on as published; the changes on earlier weeks are calculated by ProofPrice. " +
    "This is not an official CZSO product and CZSO does not endorse it.",
  homepage: "https://vdb.czso.cz/vdbvo2/faces/en/index.jsf",
  limits:
    "A weekly national average from a price survey, not a price at a station and not a receipt: no town, station or range, and CZSO does not say how many quotes stand behind an average. " +
    "Only diesel, petrol 95 and LPG are published; there is no E10, E85, CNG or petrol 98 series. The newest week can lag by a few days.",
};

/** CZSO item code (polozka_kod) for each fuel the tool can be asked for. */
export const FUEL_ROWS: Record<string, { code: string; label: string }> = {
  diesel: { code: "0722101", label: "diesel" },
  petrol95: { code: "0722201", label: "95-octane petrol (Natural 95)" },
  lpg: { code: "0722301", label: "LPG (autogas)" },
};
const CODE_TO_FUEL = Object.fromEntries(Object.entries(FUEL_ROWS).map(([k, v]) => [v.code, k]));

const CZ_WORDS = new Set(["cz", "cze", "czechia", "czech republic", "česko", "česká republika", "national", "nationwide", "all", "whole country"]);

export const METHOD =
  "Czechia fuel: the Czech Statistical Office (CZSO) publishes each week the national average consumer price in koruna per litre of diesel, petrol 95 and LPG (public database dataset cenyphm). " +
  "ProofPrice returns the published average for the newest week, unchanged, with the change on four weeks and on a year earlier (calculated by ProofPrice from the same series). " +
  "No range or sample size: CZSO gives one average. An official statistic for the whole country, not a station price.";

export interface Week {
  /** ISO week label as CZSO writes it, e.g. "2026-W44". */
  label: string;
  /** Monday and Sunday of that ISO week (YYYY-MM-DD). */
  from: string;
  to: string;
  values: Record<string, number>;
}

/** Split one CSV line whose fields are all quoted (or plain); CZSO's file has no embedded quotes or line breaks. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Monday (UTC) of ISO week `week` of ISO year `year`. */
export function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayWeek1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
  return new Date(mondayWeek1.getTime() + (week - 1) * 7 * 86400000);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Shift an ISO week label by whole weeks (negative = earlier). */
export function shiftWeek(label: string, weeks: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) return label;
  const mon = new Date(isoWeekMonday(Number(m[1]), Number(m[2])).getTime() + weeks * 7 * 86400000);
  const isoYear = new Date(mon.getTime() + 3 * 86400000).getUTCFullYear(); // the Thursday decides the ISO year
  const wk = Math.round((mon.getTime() - isoWeekMonday(isoYear, 1).getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(wk).padStart(2, "0")}`;
}

/** Parse the CZSO CSV into weeks, oldest first. Only whole-country rows (uzemi_kod 19) of the three fuel items are kept. */
export function parseWeeks(csvText: string): Week[] {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new SourceError("CZSO fuel file is empty");
  const head = splitLine(lines[0]);
  const ix = (n: string) => head.indexOf(n);
  const [iVal, iCis, iCode, iPer, iTerr] = ["hodnota", "polozka_cis", "polozka_kod", "obdobi", "uzemi_kod"].map(ix);
  if ([iVal, iCis, iCode, iPer, iTerr].some((i) => i < 0)) throw new SourceError("CZSO fuel file has an unexpected layout", head.join(","));
  const byWeek = new Map<string, Record<string, number>>();
  for (const line of lines.slice(1)) {
    const f = splitLine(line);
    if (f[iCis] !== "503" || f[iTerr] !== "19") continue;
    const fuel = CODE_TO_FUEL[f[iCode]];
    const v = Number(f[iVal]);
    if (!fuel || !Number.isFinite(v) || v <= 0 || !/^\d{4}-W\d{2}$/.test(f[iPer])) continue;
    const w = byWeek.get(f[iPer]) ?? {};
    w[fuel] = v;
    byWeek.set(f[iPer], w);
  }
  const weeks = [...byWeek.entries()]
    .map(([label, values]) => {
      const mon = isoWeekMonday(Number(label.slice(0, 4)), Number(label.slice(6)));
      return { label, from: ymd(mon), to: ymd(new Date(mon.getTime() + 6 * 86400000)), values } as Week;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!weeks.length) throw new SourceError("CZSO fuel file holds no diesel, petrol 95 or LPG weekly price");
  return weeks;
}

export interface CzFuelQuery {
  fuel?: string;
  town?: string;
  area?: string;
  postcode?: string;
  baseUrl?: string;
}

const czk = (v: number) => `${v.toFixed(2)} CZK`;

function change(weeks: Week[], fuel: string, latest: Week, back: number) {
  const label = shiftWeek(latest.label, -back);
  const from = weeks.find((w) => w.label === label)?.values[fuel];
  const now = latest.values[fuel];
  if (from === undefined || now === undefined) return null;
  return { from_week: label, from_value: from, change_percent: Math.round(((now - from) / from) * 1000) / 10 };
}

export function czFuelAnswer(weeks: Week[], q: CzFuelQuery): PriceAnswer {
  const fuel = q.fuel ?? "";
  const def = FUEL_ROWS[fuel];
  if (!def) throw new InputError("Czechia: fuel must be diesel, petrol95 or lpg (CZSO has no E10, E85, CNG or petrol 98 series).");
  const place = q.town || q.area || q.postcode || undefined;
  const query = { country: "CZ", fuel, ...(place ? { place } : {}) };
  const latest = [...weeks].reverse().find((w) => w.values[fuel] !== undefined);
  const base = { source: INFO, query, measure: "average" as const, currency: "CZK", method: METHOD, baseUrl: q.baseUrl };
  if (!latest) return buildStatisticAnswer({ ...base, value: null, unit: "per litre", period: { from: null, to: null }, reference_period: "n/a", describe: () => "" });
  const value = latest.values[fuel];
  const m4 = change(weeks, fuel, latest, 4);
  const y1 = change(weeks, fuel, latest, 52);
  const placeNote = place && !CZ_WORDS.has(place.trim().toLowerCase()) ? `CZSO publishes one national price per fuel, so '${place}' is answered with the Czech national average.` : undefined;
  const others: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(FUEL_ROWS)) if (k !== fuel && latest.values[k] !== undefined) others[k] = { price_czk: latest.values[k], unit: "per litre", definition: d.label };
  const move = (c: ReturnType<typeof change>, what: string) =>
    c ? `${c.change_percent === 0 ? "unchanged" : `${c.change_percent > 0 ? "up" : "down"} ${Math.abs(c.change_percent)}%`} on ${what} (${czk(c.from_value)} in ${c.from_week})` : `no figure for ${what}`;
  return buildStatisticAnswer({
    ...base,
    value,
    unit: "per litre",
    period: { from: latest.from, to: latest.to },
    reference_period: latest.label,
    note: placeNote,
    describe: (v) =>
      `The national average consumer price of ${def.label} in Czechia was ${czk(v)} per litre in week ${latest.label} (${latest.from} to ${latest.to}; Czech Statistical Office weekly fuel price survey), ` +
      `${move(m4, "four weeks earlier")} and ${move(y1, "a year earlier")}.`,
    extra: {
      country_name: "Czechia",
      reference_week: latest.label,
      change_on_four_weeks_earlier: m4,
      change_on_year_earlier: y1,
      other_fuels: others,
      dataset: { code: "cenyphm", url: DATA_URL, homepage: INFO.homepage },
      ...(placeNote ? { place_note: placeNote } : {}),
    },
  });
}

export interface CzOptions {
  /** Test hook: returns the CSV text instead of fetching it. */
  getter?: (url: string) => Promise<string>;
  timeoutMs?: number;
}

export async function fetchWeeks(o: CzOptions = {}): Promise<Week[]> {
  if (o.getter) return parseWeeks(await o.getter(DATA_URL));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 20000);
  try {
    const res = await fetch(DATA_URL, { signal: ctl.signal, headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "text/csv" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, DATA_URL, res.status);
    return parseWeeks(await res.text());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", DATA_URL);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function czFuel(input: CzFuelQuery, o: CzOptions = {}): Promise<PriceAnswer> {
  if (!FUEL_ROWS[input.fuel ?? ""]) throw new InputError("Czechia: fuel must be diesel, petrol95 or lpg (CZSO has no E10, E85, CNG or petrol 98 series).");
  return czFuelAnswer(await fetchWeeks(o), input);
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day the collector stores CZSO's newest week: one row per fuel, n NO_COUNT because CZSO gives one national average and no record
// count. Rows are dated by the last day (Sunday) of the reference week (referenceDates), so the copy keeps standing in for the week when the
// CZSO database is down. A daily history of the weekly series is not offered here: the answer itself carries the change on four weeks and a year.

export function harvestRows(weeks: Week[]): HarvestResult {
  const head = weeks[weeks.length - 1];
  const rows = Object.keys(FUEL_ROWS)
    .filter((f) => head?.values[f] !== undefined)
    .map((f) => {
      const v = head.values[f];
      return { area: "CZ", item: f, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  if (!head || !rows.length) throw new SourceError("CZSO fuel file holds no usable price for the newest week");
  return {
    date: head.to,
    currency: "CZK",
    unit: "per litre",
    rows,
    note: `CZSO dataset cenyphm: national average consumer price per litre of diesel, petrol 95 and LPG for week ${head.label}. Published averages, not counts of records (no record count is published).`,
  };
}

export async function czFuelHarvest(o: CzOptions = {}): Promise<HarvestResult> {
  return harvestRows(await fetchWeeks(o));
}

export function czFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return p.fuel && FUEL_ROWS[p.fuel] ? { area: "CZ", item: p.fuel, label: "Czechia (national average)" } : null;
}
