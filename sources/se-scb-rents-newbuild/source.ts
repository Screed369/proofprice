// Sweden: rents of NEWLY BUILT rented flats from Statistics Sweden (SCB), table TAB6421 (BO0404) "Rents in newly constructed
// buildings (rented dwellings) by region, investor, number of rooms and year". Annual, stock of rents at 31 December.
// Format checked live on 2026-10-22 from GitHub's servers (JSON-stat2, see fixtures/tab6421.json).
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "se-scb-rents-newbuild",
  country: "SE (Sweden)",
  category: "rent (official rent statistics, newly built flats)",
  name: "Rents in newly constructed rented flats, average (Statistics Sweden, table BO0404 / TAB6421)",
  publisher: "Statistics Sweden (SCB)",
  what_is_recorded:
    "Average monthly rent per flat (annual rent divided by 12) and annual rent per square metre, in SEK, of rented flats in newly constructed buildings (built from 2022 on), by region group and number of rooms, with the number of flats behind each figure. Rents at 31 December, including water and heating.",
  price_type: "official_statistic",
  freshness: "Annual; rents at 31 December 2025, published on 2 October 2026",
  licence: "CC0 (Statistics Sweden open data API): data may be used and shared without any requirement to state the source",
  licence_url: "https://www.scb.se/en/services/open-data-api/",
  attribution: "Based on data from Statistics Sweden (SCB), table BO0404, rents in newly constructed buildings. CC0.",
  homepage: "https://www.statistikdatabasen.scb.se/pxweb/en/ssd/START__BO__BO0404/",
  limits:
    "An average per region group and number of rooms published by SCB, not a list of rents and with no range. It covers only rented flats in newly constructed buildings (tenant-owned flats are excluded) and is the stock of contracted rents at 31 December, not the rent of new lettings. Regions are groups (Greater Stockholm, Greater Gothenburg, Greater Malmo, bigger and smaller municipalities), not towns. Cells with fewer than 5 flats are not shown.",
};

const BASE = "https://api.scb.se/OV0104/v2beta/api/v2/tables/TAB6421/data?lang=en&outputFormat=json-stat2";
export const URL_ALL =
  `${BASE}&valueCodes%5BRegion%5D=00,0010,0020,0030,0040,0041&valueCodes%5BByggherre%5D=4&valueCodes%5BAntalRum%5D=1,2,3,4,99,00&valueCodes%5BContentsCode%5D=000007ND,000007NF,000007NH&valueCodes%5BTid%5D=top(1)`;

const C_DWELLINGS = "000007ND";
const C_PER_M2 = "000007NF";
const C_MONTHLY = "000007NH";
const MIN_DWELLINGS = 5;

const REGION_ALIASES: Record<string, string> = {
  sweden: "00", sverige: "00", national: "00", nationwide: "00", "whole country": "00",
  stockholm: "0010", "greater stockholm": "0010",
  gothenburg: "0020", goteborg: "0020", "greater gothenburg": "0020", "greater goteborg": "0020",
  malmo: "0030", "greater malmo": "0030",
  "large municipalities": "0040", "big municipalities": "0040", "larger municipalities": "0040",
  "small municipalities": "0041", "smaller municipalities": "0041",
};
const REGION_HELP = "Use one of: Sweden (whole country), Greater Stockholm, Greater Gothenburg, Greater Malmo, large municipalities, small municipalities.";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/å/gi, "a").replace(/ö/gi, "o").replace(/ä/gi, "a").toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  for (const d of ["Region", "AntalRum", "ContentsCode", "Tid"]) {
    if (!t.codes[d]) throw new SourceError("Statistics Sweden changed the layout of table TAB6421; this source needs updating.");
  }
  for (const c of [C_DWELLINGS, C_MONTHLY]) {
    if (!t.codes.ContentsCode.includes(c)) throw new SourceError("Statistics Sweden no longer publishes the new-build rent in table TAB6421; this source needs updating.");
  }
  return t;
}

export function matchRegion(table: JsonStatTable, input: string | undefined): { code: string; label: string } {
  const q = norm(input ?? "sweden");
  const code = REGION_ALIASES[q];
  if (!code || !table.codes.Region.includes(code)) throw new InputError("'" + input + "' is not a region group in the Swedish rent statistics. " + REGION_HELP);
  return { code, label: code === "00" ? "Sweden" : table.labels.Region[code].replace("Göteborg", "Gothenburg").replace("Malmö", "Malmo") };
}

/** rooms: 1-4 (4 = four or more), or undefined for all flats together. */
export function roomCode(rooms: number | undefined): string {
  if (rooms === undefined) return "00";
  if (!Number.isInteger(rooms) || rooms < 1) throw new InputError("bedrooms must be the number of ROOMS: 1, 2, 3 or 4 (4 means four or more). Leave it out for all new-build flats together.");
  return String(Math.min(rooms, 4));
}

export interface NewBuildPick { year: string; monthly: number; perM2: number | null; dwellings: number }

export function pickLatest(table: JsonStatTable, region: string, rooms: string): NewBuildPick | null {
  const rows = rowsWhere(table, { Region: region, AntalRum: rooms });
  const years = [...new Set(rows.map((r) => String(r.Tid)))].sort();
  for (const y of years.reverse()) {
    const v = (c: string) => rows.find((r) => String(r.Tid) === y && r.ContentsCode === c)?.value ?? null;
    const dwellings = v(C_DWELLINGS);
    const monthly = v(C_MONTHLY);
    if (dwellings !== null && dwellings >= MIN_DWELLINGS && monthly !== null && monthly > 0) {
      return { year: y, monthly, perM2: v(C_PER_M2), dwellings };
    }
  }
  return null;
}

export interface SeNewBuildInput { town?: string; rooms?: number; baseUrl?: string }

export async function seNewBuildRent(input: SeNewBuildInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const rc = roomCode(input.rooms);
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  const table = parseTable(await get(URL_ALL));
  const region = matchRegion(table, input.town);
  const pick = pickLatest(table, region.code, rc);
  const roomLabel = table.labels.AntalRum[rc];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SE", town: region.label, rooms: input.rooms ?? "all", new_build: true },
    value: pick ? pick.monthly : null,
    measure: "average",
    currency: "SEK",
    unit: "per month",
    period: pick ? { from: `${pick.year}-12-31`, to: `${pick.year}-12-31` } : { from: null, to: null },
    reference_period: pick ? `${pick.year}-12-31` : "",
    sample_size: pick ? pick.dwellings : null,
    method:
      "Sweden (Statistics Sweden, table BO0404): the average monthly rent (annual rent divided by 12) of rented flats in newly constructed buildings at 31 December, by region group and number of rooms. The number of flats behind the figure is Statistics Sweden's own count; cells with fewer than 5 flats are not shown.",
    describe: (v) => `The average monthly rent of a newly built rented flat (${roomLabel.toLowerCase()}) in ${region.label} was ${fmtMoney(v, "SEK")} at the end of ${pick!.year}, across ${pick!.dwellings} flats.`,
    note: "Average of contracted rents in newly constructed rented flats, including water and heating; not the rent of new lettings.",
    baseUrl: input.baseUrl,
    published: table.updated ?? null,
    extra: pick
      ? {
          region: { name: region.label, scb_code: region.code },
          rooms: roomLabel,
          dwellings: pick.dwellings,
          average_annual_rent_per_m2: pick.perM2,
          table_updated: table.updated,
          rent_kind: "average of contracted rents in newly constructed rented flats (stock at 31 December)",
        }
      : { reason: `No figure with at least ${MIN_DWELLINGS} flats for ${region.label}, ${roomLabel.toLowerCase()}. Try another number of rooms or a wider region (Sweden).` },
  });
}
