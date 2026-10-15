// Sweden: median rent of rented flats from Statistics Sweden (SCB), table TAB4618 (BO0406E) "Rent in rented dwellings by
// region, number of rooms and ownership". Annual rent survey; 2026 = rents at the start of the year, released 2026-10-02.
// Format checked live on 2026-10-15 from GitHub's servers (JSON-stat2, see fixtures/tab4618.json).
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

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
  `${BASE}&valueCodes%5BRegion%5D=*&valueCodes%5BAntalRum%5D=1,2,3,4&valueCodes%5BAgarkategori%5D=PrivOovriga&valueCodes%5BHyresuppg%5D=Ah_lgh,Ah_kvm,Mh_lgh&valueCodes%5BContentsCode%5D=00000145`;
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
  if (!regionCodes) return { code: "00", label: "Sweden" }; // default selection has no region dimension: Sweden total
  const code = REGION_ALIASES[q];
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
