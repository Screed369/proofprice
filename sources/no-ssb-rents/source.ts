// Norway: average monthly rent from Statistics Norway's Rental market survey (Leiemarkedsundersokelsen), table 09895
// "Average rents ... by price zone, year and number of rooms". Annual survey, published each December.
// Format checked live on 2026-10-14 from GitHub's servers (JSON-stat2 and CSV, see fixtures/t09895.json).
// Note: the table title says "per sqm" but the contents are "Average monthly rents" in NOK (values 6,000-26,000).
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "no-ssb-rents",
  country: "NO (Norway)",
  category: "rent (official rent survey)",
  name: "Rental market survey, average monthly rents (Statistics Norway, table 09895)",
  publisher: "Statistics Norway (SSB)",
  what_is_recorded:
    "Average monthly rent in NOK of rented homes, by price zone (Oslo and Baerum, Akershus, Bergen, Trondheim, Stavanger, three size classes of town and the whole country) and number of rooms (1 to 5 or more). Weighted survey average for the survey year; SSB publishes no number of observations per cell.",
  price_type: "official_statistic",
  freshness: "Annual; the 2025 survey was published on 22 December 2025",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), Statistics Norway",
  licence_url: "https://www.ssb.no/en/diverse/lisens",
  attribution: "Source: Statistics Norway (SSB), Rental market survey, table 09895. Licensed under CC BY 4.0.",
  homepage: "https://www.ssb.no/en/statbank/table/09895",
  limits:
    "A survey average per price zone and number of rooms, not a list of rents: no range and no sample size. Each year uses a fresh sample, so year-on-year changes are not strictly comparable. Cells with too few or unreliable observations are blank. 'Rooms' counts living rooms and bedrooms (not kitchen or bath), so it is not the same as bedrooms.",
};

export const TABLE = "09895";
const BASE = `https://data.ssb.no/api/pxwebapi/v2/tables/${TABLE}/data?lang=en&outputFormat=json-stat2`;
/** Latest year only (default) */
export const URL_LATEST = BASE;
/** Last three years; bracket filters are PxWebApi v2 syntax. If SSB refuses it we fall back to URL_LATEST. */
export const URL_RECENT = `${BASE}&valueCodes%5BTid%5D=top(3)`;

const D_ZONE = "Soner2";
const D_YEAR = "Tid";
const D_ROOMS = "AntRom";
const D_CONTENTS = "ContentsCode";
/** The only contents we read: "Average monthly rents" (NOK). The table title says "per sqm"; never mix in another measure if SSB adds one. */
export const CONTENTS_RENT = "Husleie";

export const ROOM_CODES: Record<string, string> = { "1": "1", "2": "2", "3": "3", "4": "4", "5": "5+" };

/** Place words people use, mapped to SSB price zone codes. */
const ALIASES: Record<string, string> = {
  norway: "00", norge: "00", "the whole country": "00", "whole country": "00", national: "00", nationwide: "00",
  oslo: "01", baerum: "01", "oslo and baerum": "01", "oslo og baerum": "01",
  akershus: "02",
  bergen: "03",
  trondheim: "04",
  stavanger: "05",
  "large towns": "20", "cities over 20000": "20", "urban over 20000": "20",
  "medium towns": "21", "towns 2000-19999": "21",
  "small towns": "22", "rural": "22", "sparsely populated": "22",
};

function norm(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/æ/gi, "ae").replace(/ø/gi, "o").replace(/å/gi, "a")
    .toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export function matchZone(table: JsonStatTable, input: string): { code: string; label: string } {
  const q = norm(input);
  let code = ALIASES[q];
  if (!code) {
    const hit = table.codes[D_ZONE].filter((c) => norm(table.labels[D_ZONE][c]) === q || (q.length >= 4 && norm(table.labels[D_ZONE][c]).includes(q)));
    if (hit.length === 1) code = hit[0];
  }
  if (!code || !table.codes[D_ZONE].includes(code)) {
    throw new InputError(
      `'${input}' is not a price zone in the Norwegian rent survey. Use one of: Norway (whole country), Oslo, Akershus, Bergen, Trondheim, Stavanger, large towns, medium towns, small towns/rural.`,
    );
  }
  return { code, label: table.labels[D_ZONE][code] };
}

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  for (const d of [D_ZONE, D_YEAR, D_ROOMS]) {
    if (!t.codes[d]) throw new SourceError("Statistics Norway changed the layout of table 09895; this source needs updating.");
  }
  if (t.codes[D_CONTENTS] && !t.codes[D_CONTENTS].includes(CONTENTS_RENT)) {
    throw new SourceError("Statistics Norway no longer publishes 'Average monthly rents' (Husleie) in table 09895; this source needs updating.");
  }
  return t;
}

export interface RentPick {
  year: string;
  value: number;
  previous: { year: string; value: number } | null;
}

/** Newest year with a figure for this zone and room count, plus the year before it when it has one. */
/** Cells of the monthly-rent measure only (when the table has a contents dimension). */
export function rentCells(table: JsonStatTable, match: Record<string, string>) {
  const hasContents = Boolean(table.codes[D_CONTENTS]);
  return rowsWhere(table, hasContents ? { ...match, [D_CONTENTS]: CONTENTS_RENT } : match);
}

export function pickLatest(table: JsonStatTable, zone: string, rooms: string): RentPick | null {
  const cells = rentCells(table, { [D_ZONE]: zone, [D_ROOMS]: rooms });
  const byYear = new Map<string, number>();
  for (const r of cells) if (r.value !== null && r.value > 0) byYear.set(String(r[D_YEAR]), r.value);
  const years = [...byYear.keys()].sort();
  if (!years.length) return null;
  const y = years[years.length - 1];
  const prevYear = String(Number(y) - 1);
  return { year: y, value: byYear.get(y)!, previous: byYear.has(prevYear) ? { year: prevYear, value: byYear.get(prevYear)! } : null };
}

export interface NoRentInput {
  town?: string;
  rooms?: number;
  baseUrl?: string;
}

export async function noRent(input: NoRentInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  if (!input.town) throw new InputError("A place is required: Norway (whole country), Oslo, Akershus, Bergen, Trondheim, Stavanger, large towns, medium towns or small towns/rural.");
  if (input.rooms === undefined || !Number.isInteger(input.rooms) || input.rooms < 1) {
    throw new InputError("Norway publishes rents by number of rooms (living rooms plus bedrooms): add rooms=1, 2, 3, 4 or 5 (5 means five or more).");
  }
  const roomCode = ROOM_CODES[String(Math.min(input.rooms, 5))];
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  let json: unknown;
  try {
    json = await get(URL_RECENT);
  } catch {
    json = await get(URL_LATEST);
  }
  let table: JsonStatTable;
  try {
    table = parseTable(json);
  } catch {
    table = parseTable(await get(URL_LATEST));
  }
  const zone = matchZone(table, input.town);
  const pick = pickLatest(table, zone.code, roomCode);
  const roomLabel = table.labels[D_ROOMS][roomCode];
  const changePct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;

  const breakdown: Record<string, number> = {};
  if (pick) {
    for (const r of rentCells(table, { [D_ZONE]: zone.code, [D_YEAR]: pick.year })) {
      if (r.value !== null && r.value > 0) breakdown[table.labels[D_ROOMS][String(r[D_ROOMS])]] = r.value;
    }
  }

  return buildStatisticAnswer({
    source: INFO,
    query: { country: "NO", town: zone.label, rooms: input.rooms },
    value: pick ? pick.value : null,
    measure: "average",
    currency: "NOK",
    unit: "per month",
    period: pick ? { from: `${pick.year}-01-01`, to: `${pick.year}-12-31` } : { from: null, to: null },
    reference_period: pick ? pick.year : "",
    method:
      "Norway (Statistics Norway, Rental market survey, table 09895): the weighted average monthly rent of rented homes in the price zone with the chosen number of rooms, from the annual survey. We pass on the published average and its year; it is an average, not a range built from individual rents.",
    describe: (v) => `The average monthly rent of rented homes with ${roomLabel.toLowerCase()} in ${zone.label} was ${fmtMoney(v, "NOK")} in ${pick!.year}.`,
    note: "Survey average (a fresh sample each year, so year-on-year changes are indicative). 'Rooms' counts living rooms and bedrooms.",
    baseUrl: input.baseUrl,
    extra: pick
      ? {
          price_zone: { name: zone.label, ssb_code: zone.code },
          rooms: roomLabel,
          previous_year: pick.previous ? { year: pick.previous.year, value: pick.previous.value, change_percent: changePct(pick.value, pick.previous.value) } : null,
          by_rooms: breakdown,
          table_updated: table.updated,
          rent_kind: "weighted survey average of monthly rents",
        }
      : undefined,
  });
}
