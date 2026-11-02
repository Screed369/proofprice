// Sweden: median rent of rented flats from Statistics Sweden (SCB), table TAB4618 (BO0406E) "Rent in rented dwellings by
// region, number of rooms and ownership". Annual rent survey; 2026 = rents at the start of the year, released 2026-10-02.
// Format checked live on 2026-10-15 from GitHub's servers (JSON-stat2, see fixtures/tab4618.json).
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "se-scb-rents",
  country: "SE (Sweden)",
  category: "rent (official rent survey)",
  name: "Rent in rented dwellings, median (Statistics Sweden, table BO0406 / TAB4618)",
  publisher: "Statistics Sweden (SCB)",
  what_is_recorded:
    "Median annual rent per flat (shown here per month) and per square metre, in SEK, of rented flats by number of rooms (1, 2, 3, 4 or more) and region group, for private and other owners, from SCB's annual rent survey. Also the median 'new rent' (rent on newly signed leases) per flat per month.",
  price_type: "official_statistic",
  freshness: "Annual; the 2026 survey (rents at the start of 2026) was published on 2 October 2026",
  licence: "CC0 (Statistics Sweden open data API): data may be used and shared without any requirement to state the source",
  licence_url: "https://www.scb.se/en/services/open-data-api/",
  attribution: "Source: Statistics Sweden (SCB), rent survey, table BO0406. CC0.",
  homepage: "https://www.statistikdatabasen.scb.se/pxweb/en/ssd/START__BO__BO0406/",
  limits:
    "A survey median per region group and number of rooms, not a list of rents: no range and no sample size (SCB publishes a margin of error separately). Swedish rents are largely negotiated collectively and regulated, so they are below what a new tenant may face on the open market. Regions are groups (Greater Stockholm, Greater Gothenburg, Greater Malmo, bigger and smaller municipalities), not individual towns.",
};

const BASE = "https://api.scb.se/OV0104/v2beta/api/v2/tables/TAB4618/data?lang=en&outputFormat=json-stat2";
/** Regions, owners (private and other) and the contents we read; bracket filters are PxWebApi v2 syntax. */
export const URL_ALL_REGIONS =
  `${BASE}&valueCodes%5BRegion%5D=00,0010,0020,0030,0040,0041&valueCodes%5BAntalRum%5D=1,2,3,4&valueCodes%5BAgarkategori%5D=PrivOovriga&valueCodes%5BHyresuppg%5D=Ah_lgh,Ah_kvm,Mh_lgh&valueCodes%5BContentsCode%5D=00000145&valueCodes%5BTid%5D=top(1)`;
/** Default selection: Sweden total, latest year. Used if SCB refuses the filter. */
export const URL_DEFAULT = BASE;

const D_ROOMS = "AntalRum";
const D_KIND = "Hyresuppg";
const D_YEAR = "Tid";
const D_REGION = "Region";
export const CONTENTS_MEDIAN = "00000145";
export const ROOM_CODES: Record<string, string> = { "1": "1", "2": "2", "3": "3", "4": "4" };

const REGION_ALIASES: Record<string, string> = {
  sweden: "00", sverige: "00", national: "00", nationwide: "00", "whole country": "00",
  stockholm: "0010", "greater stockholm": "0010",
  gothenburg: "0020", goteborg: "0020", "greater gothenburg": "0020",
  malmo: "0030", "greater malmo": "0030",
  "large municipalities": "0040", "big municipalities": "0040", "larger municipalities": "0040",
  "small municipalities": "0041", "smaller municipalities": "0041",
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/å/gi, "a").replace(/ö/gi, "o").replace(/ä/gi, "a").toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  for (const d of [D_ROOMS, D_KIND, D_YEAR]) {
    if (!t.codes[d]) throw new SourceError("Statistics Sweden changed the layout of table TAB4618; this source needs updating.");
  }
  if (t.codes.ContentsCode && !t.codes.ContentsCode.includes(CONTENTS_MEDIAN)) {
    throw new SourceError("Statistics Sweden no longer publishes the median rent in table TAB4618; this source needs updating.");
  }
  return t;
}

export function matchRegion(table: JsonStatTable, input: string | undefined): { code: string; label: string } {
  const q = norm(input ?? "sweden");
  const regionCodes = table.codes[D_REGION];
  const code = REGION_ALIASES[q];
  if (!regionCodes) {
    // Default selection has no region dimension: it is the Sweden total only. Never answer a regional question with it.
    if (code && code !== "00") throw new SourceError("Statistics Sweden did not return the regional table just now; try again later.");
    if (!code) throw new InputError("'" + input + "' is not a region group in the Swedish rent survey. Use one of: Sweden (whole country), Greater Stockholm, Greater Gothenburg, Greater Malmo, large municipalities, small municipalities.");
    return { code: "00", label: "Sweden" };
  }
  if (!code || !regionCodes.includes(code)) {
    throw new InputError("'" + input + "' is not a region group in the Swedish rent survey. Use one of: Sweden (whole country), Greater Stockholm, Greater Gothenburg, Greater Malmo, large municipalities, small municipalities.");
  }
  return { code, label: REGION_ALIASES[q] === "00" ? "Sweden" : table.labels[D_REGION][code] };
}

export interface RentPick { year: string; annual: number; perM2: number | null; newMonthly: number | null }

export function pickLatest(table: JsonStatTable, region: string, rooms: string): RentPick | null {
  const match: Record<string, string> = { [D_ROOMS]: rooms };
  if (table.codes[D_REGION]) match[D_REGION] = region;
  if (table.codes.Agarkategori) match.Agarkategori = "PrivOovriga";
  if (table.codes.ContentsCode) match.ContentsCode = CONTENTS_MEDIAN;
  const rows = rowsWhere(table, match).filter((r) => r.value !== null && r.value > 0);
  const years = [...new Set(rows.map((r) => String(r[D_YEAR])))].sort();
  if (!years.length) return null;
  const y = years[years.length - 1];
  const v = (kind: string) => rows.find((r) => String(r[D_YEAR]) === y && r[D_KIND] === kind)?.value ?? null;
  const annual = v("Ah_lgh");
  if (annual === null) return null;
  return { year: y, annual, perM2: v("Ah_kvm"), newMonthly: v("Mh_lgh") };
}

export interface SeRentInput { town?: string; rooms?: number; baseUrl?: string }

export async function seRent(input: SeRentInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  if (input.rooms === undefined || !Number.isInteger(input.rooms) || input.rooms < 1) {
    throw new InputError("Sweden publishes rents by number of rooms: add bedrooms=1, 2, 3 or 4 (this is the number of rooms; 4 means four or more).");
  }
  const roomCode = ROOM_CODES[String(Math.min(input.rooms, 4))];
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  let table: JsonStatTable;
  try {
    table = parseTable(await get(URL_ALL_REGIONS));
  } catch (e) {
    if (e instanceof InputError) throw e;
    table = parseTable(await get(URL_DEFAULT));
  }
  const region = matchRegion(table, input.town);
  const pick = pickLatest(table, region.code, roomCode);
  const roomLabel = table.labels[D_ROOMS][roomCode];
  const monthly = pick ? Math.round(pick.annual / 12) : null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SE", town: region.label, rooms: input.rooms },
    value: monthly,
    measure: "median",
    currency: "SEK",
    unit: "per month",
    period: pick ? { from: `${pick.year}-01-01`, to: `${pick.year}-12-31` } : { from: null, to: null },
    reference_period: pick ? pick.year : "",
    method:
      "Sweden (Statistics Sweden, rent survey, table BO0406): the median annual rent of rented flats with the chosen number of rooms (private and other owners) divided by 12. We pass on the published median and its year; it is a median, not a range built from individual rents.",
    describe: (v) => `The median monthly rent of a rented flat (${roomLabel.toLowerCase()}) in ${region.label} was ${fmtMoney(v, "SEK")} in ${pick!.year}.`,
    note: "Survey median, mostly negotiated and regulated rents (below open-market rents for new tenants).",
    baseUrl: input.baseUrl,
    // The reference period is a calendar year that may not be over yet: the data date is then the day SCB updated the table.
    published: table.updated ?? null,
    extra: pick
      ? {
          region: { name: region.label, scb_code: region.code },
          rooms: roomLabel,
          median_annual_rent_per_flat: pick.annual,
          median_annual_rent_per_m2: pick.perM2,
          median_new_rent_per_flat_per_month: pick.newMonthly,
          table_updated: table.updated,
          rent_kind: "survey median of rents in rented flats, private and other owners",
        }
      : undefined,
  });
}


// ---------- library copy (stale-if-error and history) ----------
// Once a day the collector stores the newest survey year for every region group and room count (24 rows) as one library day dated
// 1 January of the survey year (rents at the start of that year). Kept so a stale copy can answer when SCB is down and history
// builds up year by year.

/** Library rows for the newest year in the regional table: monthly median rent (annual / 12, SEK) by region group and rooms. */
export function seRentHarvestRows(table: JsonStatTable): { date: string; rows: DailyRow[] } {
  let year: string | null = null;
  const rows: DailyRow[] = [];
  for (const region of table.codes[D_REGION] ?? []) {
    for (const rooms of Object.values(ROOM_CODES)) {
      const pick = pickLatest(table, region, rooms);
      if (!pick) continue;
      if (year === null || pick.year > year) year = pick.year;
      const monthly = Math.round(pick.annual / 12);
      rows.push({ area: region, item: `rooms-${rooms}`, n: NO_COUNT, median: monthly, low: monthly, high: monthly, min: monthly, max: monthly });
    }
  }
  if (!year) throw new SourceError("Statistics Sweden's rent table gave no year");
  return { date: `${year}-01-01`, rows };
}

export async function seRentHarvest(fetcher?: (url: string) => Promise<unknown>): Promise<HarvestResult> {
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 30000));
  const { date, rows } = seRentHarvestRows(parseTable(await get(URL_ALL_REGIONS)));
  if (rows.length < 20) throw new SourceError(`Statistics Sweden's rent table gave only ${rows.length} library rows; expected 24`);
  return {
    date,
    currency: "SEK",
    unit: "per month",
    rows,
    note: "Statistics Sweden rent survey BO0406 (TAB4618): median annual rent of rented flats (private and other owners) divided by 12, by region group and number of rooms, for the newest survey year. One published median per place and year; n is not a count. Kept so a stale copy can answer when the publisher is down and so history builds up.",
  };
}

const SE_LABELS: Record<string, string> = { "00": "Sweden", "0010": "Greater Stockholm", "0020": "Greater Gothenburg", "0030": "Greater Malmo", "0040": "large municipalities", "0041": "small municipalities" };

/** Library key for a request, or null when the copy cannot answer it (rooms missing, unknown region group). */
export function seRentHistoryKey(p: { town?: string; rooms?: number }): { area: string; item: string; label: string } | null {
  if (p.rooms === undefined || !Number.isInteger(p.rooms) || p.rooms < 1) return null;
  const code = REGION_ALIASES[norm(p.town ?? "sweden")];
  if (!code) return null;
  const rooms = ROOM_CODES[String(Math.min(p.rooms, 4))];
  const label = SE_LABELS[code] ?? code;
  return { area: code, item: `rooms-${rooms}`, label };
}
