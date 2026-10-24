// Ireland: average monthly rent of tenancies registered with the Residential Tenancies Board (RTB), published by the
// Central Statistics Office (CSO) as PxStat table RIQ02 "RTB Average Monthly Rent Report".
// Quarterly, by location (county, town, local electoral area, Dublin district), number of bedrooms and property type.
// We ask the CSO's key-free JSON-RPC GET endpoint for just the cells we need (a few dozen numbers), never the whole cube.
// Formats checked live on 2026-10-14 from GitHub's servers (metadata and a filtered query, see fixtures/).

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, periodRange, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "ie-rtb-rents",
  country: "IE (Ireland)",
  category: "rent (registered tenancies)",
  name: "RTB Average Monthly Rent Report (CSO table RIQ02)",
  publisher: "Residential Tenancies Board (RTB), published by the Central Statistics Office (CSO), Ireland",
  what_is_recorded:
    "Average monthly rent of tenancies registered with the RTB in the quarter, by location (county, town, local electoral area), number of bedrooms and property type. An actual average of registered rents, not mix-adjusted.",
  price_type: "official_statistic",
  freshness: "Quarterly; a quarter is published about five months after it ends",
  licence:
    "Creative Commons Attribution 4.0 (CC BY 4.0): the CSO copyright policy states that its statistical information is licensed under CC BY 4.0 (https://www.cso.ie/en/aboutus/whoweare/copyrightpolicy/), and data.gov.ie lists the RTB Average Monthly Rent Report tables published by the CSO under CC BY 4.0. The CSO logo may not be used.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Residential Tenancies Board (RTB), RTB Average Monthly Rent Report, published by the Central Statistics Office (CSO) as PxStat table RIQ02. Licensed under CC BY 4.0.",
  homepage: "https://data.cso.ie/table/RIQ02",
  limits:
    "A published average per quarter, not a list of rents: no range and no sample size. It is the actual average of registered rents (not the standardised, mix-adjusted RTB Rent Index), so it moves with the mix of homes let. Small areas are left blank by the publisher in some quarters, then we use the latest quarter that has a figure. Registered rents only: asking rents are not included.",
};

export const TABLE = "RIQ02";
export const META_URL = `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadMetadata/${TABLE}/JSON-stat/2.0/en`;
export const RPC_URL = "https://ws.cso.ie/public/api.jsonrpc";

// Dimension ids of RIQ02 (checked 2026-10-14).
const D_TIME = "TLIST(Q1)";
const D_BEDS = "C02970V03592";
const D_TYPE = "C02969V03591";
const D_LOC = "C03004V03625";

export const BEDROOM_CODES: Record<string, string> = { "1": "01", "2": "02", "3": "03", "4": "08", "5": "08", "6": "08", "7": "08", "8": "08", "9": "08", "10": "08" };
export const HOUSE_TYPE_NAMES = ["detached", "semi-detached", "terraced"] as const;
const HOUSE_TYPES: Record<string, { code: string; name: (typeof HOUSE_TYPE_NAMES)[number] }> = {
  detached: { code: "01", name: "detached" },
  "semi-detached": { code: "02", name: "semi-detached" },
  semi: { code: "02", name: "semi-detached" },
  "semi detached": { code: "02", name: "semi-detached" },
  terraced: { code: "03", name: "terraced" },
  terrace: { code: "03", name: "terraced" },
};
function houseType(v: string | undefined) {
  return v ? HOUSE_TYPES[v.trim().toLowerCase().replace(/_/g, "-")] : undefined;
}

export interface RiqMeta {
  updated: string | null;
  /** Quarter codes oldest first, e.g. "20254". */
  quarters: string[];
  locations: { code: string; label: string }[];
  bedLabels: Record<string, string>;
  typeLabels: Record<string, string>;
}

export function parseRiqMeta(json: unknown): RiqMeta {
  const t = parseJsonStat(json);
  for (const d of [D_TIME, D_BEDS, D_TYPE, D_LOC]) {
    if (!t.codes[d]) throw new SourceError("The CSO changed the layout of table RIQ02; this source needs updating.");
  }
  return {
    updated: t.updated,
    quarters: t.codes[D_TIME],
    locations: t.codes[D_LOC].map((code) => ({ code, label: t.labels[D_LOC][code] })),
    bedLabels: t.labels[D_BEDS],
    typeLabels: t.labels[D_TYPE],
  };
}

let metaCache: { at: number; meta: RiqMeta } | null = null;
const META_TTL_MS = 6 * 3600 * 1000;

export async function loadMeta(fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 20000)): Promise<RiqMeta> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.meta;
  const meta = parseRiqMeta(await fetcher(META_URL));
  metaCache = { at: Date.now(), meta };
  return meta;
}

// ---------- place matching ----------

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bco\.?\s+/g, "")
    .replace(/\bcounty\s+/g, "")
    .replace(/[.']/g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Find the CSO location for a place name: exact label, then "<town>, <county>", with a few spellings. */
export function matchLocation(meta: RiqMeta, input: string): { code: string; label: string } {
  let q = norm(input);
  const dm = /^d\s*(\d{1,2}w?)$/.exec(q);
  if (dm) q = `dublin ${dm[1]}`;
  const normed = meta.locations.map((l) => ({ ...l, n: norm(l.label) }));
  const plain = (l: { code: string; label: string }) => ({ code: l.code, label: l.label });
  const exact = normed.filter((l) => l.n === q);
  if (exact.length === 1) return plain(exact[0]);
  const inCounty = normed.filter((l) => l.n.startsWith(`${q}, `));
  if (exact.length === 0 && inCounty.length === 1) return plain(inCounty[0]);
  const pool = exact.length > 1 ? exact : inCounty;
  if (pool.length > 1) {
    throw new InputError(`'${input}' matches several places in the RTB data (${pool.slice(0, 6).map((l) => l.label).join("; ")}). Say which one, for example '${pool[0].label}'.`);
  }
  const near = normed.filter((l) => l.n.includes(q)).slice(0, 6);
  throw new InputError(
    `'${input}' is not a place in the RTB rent data.` +
      (near.length ? ` Did you mean: ${near.map((l) => l.label).join("; ")}?` : " Use a county (Dublin, Cork), a town ('Swords, Dublin', 'Galway City'), or a Dublin district ('Dublin 6')."),
  );
}

// ---------- the query ----------

export function quarterLabel(code: string): string {
  return `${code.slice(0, 4)}-Q${code.slice(4)}`;
}

/** JSON-RPC GET URL asking for a set of quarters and one location, every bedroom size, one property type. */
export function buildRpcUrl(quarters: string[], locationCode: string | string[], typeCode: string): string {
  const query = {
    jsonrpc: "2.0",
    method: "PxStat.Data.Cube_API.ReadDataset",
    params: {
      class: "query",
      id: [D_TIME, D_TYPE, D_LOC],
      dimension: {
        [D_TIME]: { category: { index: quarters } },
        [D_TYPE]: { category: { index: [typeCode] } },
        [D_LOC]: { category: { index: Array.isArray(locationCode) ? locationCode : [locationCode] } },
      },
      extension: { pivot: null, codes: false, language: { code: "en" }, format: { type: "JSON-stat", version: "2.0" }, matrix: TABLE },
      version: "2.0",
    },
  };
  return `${RPC_URL}?data=${encodeURIComponent(JSON.stringify(query))}`;
}

export function parseRpc(json: any): JsonStatTable {
  if (json && typeof json === "object" && json.error) {
    const e = json.error;
    throw new SourceError(`The CSO refused the request: ${String(e?.message ?? e?.data ?? "unknown error")}`.slice(0, 300));
  }
  if (!json || typeof json !== "object" || !json.result) throw new SourceError("Unexpected response from the CSO (no result)");
  return parseJsonStat(json.result);
}

export interface RentPick {
  quarter: string; // "2025Q4"
  code: string;
  value: number;
  previous: { quarter: string; value: number } | null;
  yearAgo: { quarter: string; value: number } | null;
}

/** The newest quarter with a figure for this cell, plus the quarter before it and the same quarter a year earlier. */
export function pickLatest(table: JsonStatTable, cell: { bed: string; type: string; loc: string }): RentPick | null {
  const cells = rowsWhere(table, { [D_BEDS]: cell.bed, [D_TYPE]: cell.type, [D_LOC]: cell.loc });
  const byQuarter = new Map<string, number>();
  for (const r of cells) byQuarter.set(String(r[D_TIME]), r.value as number);
  const order = table.codes[D_TIME];
  const at = (j: number) => {
    const c = order[j];
    const val = c !== undefined ? byQuarter.get(c) : undefined;
    return c !== undefined && val !== undefined && val > 0 ? { quarter: table.labels[D_TIME][c], value: val } : null;
  };
  for (let i = order.length - 1; i >= 0; i--) {
    const v = byQuarter.get(order[i]);
    if (v === undefined || !(v > 0)) continue;
    return { quarter: table.labels[D_TIME][order[i]], code: order[i], value: v, previous: at(i - 1), yearAgo: at(i - 4) };
  }
  return null;
}

function monthsSince(iso: string, now = new Date()): number {
  const d = new Date(iso + "T00:00:00Z");
  return Math.round(((now.getTime() - d.getTime()) / 86400000 / 30.44) * 10) / 10;
}

export interface IeRentInput {
  town?: string;
  property_type?: string;
  house_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

export async function ieRent(input: IeRentInput, fetcher?: (url: string) => Promise<unknown>, now = new Date()): Promise<PriceAnswer> {
  if (!input.town) throw new InputError("A place is required: a county (Dublin, Cork), a town ('Swords, Dublin', 'Galway City') or a Dublin district ('Dublin 6').");
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  const meta = await loadMeta(get);
  const loc = matchLocation(meta, input.town);

  let bedCode = "-";
  let bedLabel = "all sizes";
  if (input.bedrooms !== undefined) {
    if (input.bedrooms === 0) throw new InputError("The RTB data starts at one bedroom (studios are not published separately). Leave bedrooms out or use 1 or more.");
    bedCode = BEDROOM_CODES[String(input.bedrooms)];
    bedLabel = input.bedrooms >= 4 ? "four or more bedrooms" : input.bedrooms === 1 ? "one bedroom" : `${input.bedrooms} bedrooms`;
  }
  let typeCode = "-";
  let typeLabel = "homes";
  const pt = input.property_type;
  if (pt === "room") throw new InputError("The RTB data does not publish room rentals separately; use apartment or house.");
  if (pt === "apartment") {
    typeCode = "04";
    typeLabel = "apartments";
  } else if (pt === "house" || input.house_type) {
    const h = houseType(input.house_type);
    if (!h) {
      throw new InputError(
        input.house_type
          ? "house_type must be detached, semi-detached or terraced."
          : "Ireland publishes houses by type: add house_type (detached, semi-detached or terraced), or leave property_type out for all homes.",
      );
    }
    typeCode = h.code;
    typeLabel = `${h.name} houses`;
  }

  const wanted = meta.quarters.slice(-12);
  const table = parseRpc(await get(buildRpcUrl(wanted, loc.code, typeCode)));
  let pick = pickLatest(table, { bed: bedCode, type: typeCode, loc: loc.code });

  // A postal district such as "Dublin 8" is often only a heading in the RTB table: the figures sit on its named parts
  // ("Rialto, Dublin 8"). When the district itself has no figure, use those parts (G20261018-3).
  let parts: { name: string; value: number }[] | null = null;
  if (!pick) {
    const kids = meta.locations.filter((l) => l.code !== loc.code && l.label.replace(/\s+,/, ",").endsWith(`, ${loc.label}`));
    if (kids.length) {
      const kidTable = parseRpc(await get(buildRpcUrl(wanted, kids.map((k) => k.code), typeCode)));
      const found = kids
        .map((k) => ({ k, p: pickLatest(kidTable, { bed: bedCode, type: typeCode, loc: k.code }) }))
        .filter((x): x is { k: { code: string; label: string }; p: RentPick } => x.p !== null);
      if (found.length) {
        const newest = found.map((x) => x.p.code).sort().pop()!;
        const atNewest = found.filter((x) => x.p.code === newest);
        const vals = atNewest.map((x) => x.p.value);
        const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
        parts = atNewest.map((x) => ({ name: x.k.label.replace(/\s+,/, ","), value: x.p.value }));
        pick = { quarter: atNewest[0].p.quarter, code: newest, value: mean, previous: null, yearAgo: null };
      }
    }
  }

  const queryEcho = {
    country: "IE",
    town: loc.label,
    property_type: pt ?? "any",
    ...(input.house_type ? { house_type: houseType(input.house_type)?.name ?? input.house_type } : {}),
    bedrooms: input.bedrooms ?? null,
  };
  const period = pick ? periodRange(quarterLabel(pick.code)) : null;
  const ageMonths = period ? monthsSince(period.to, now) : null;
  const notes: string[] = [
    "Actual (not standardised) average monthly rent of tenancies registered with the RTB in the quarter; it moves with the mix of homes let.",
  ];
  if (ageMonths !== null && ageMonths > 6) {
    notes.push(`The latest quarter published for this place is ${pick!.quarter}, which ended about ${Math.round(ageMonths)} months ago, so rents today may differ.`);
  }

  if (parts) {
    notes.push(
      parts.length === 1
        ? `${loc.label} itself has no published figure for this size; the only part of it with one is ${parts[0].name}, so the figure is for that part, not the whole district.`
        : `${loc.label} itself has no published figure for this size; the figure is the plain mean of the averages for its parts (${parts.map((x) => x.name).join("; ")}). The RTB does not publish tenancy counts, so the parts are not weighted.`,
    );
  }

  // Bedroom breakdown for the same place, type and latest quarter (all sizes the publisher gives).
  const breakdown: Record<string, number> = {};
  if (pick) {
    for (const r of rowsWhere(table, { [D_TIME]: pick.code })) {
      const lbl = table.labels[D_BEDS][String(r[D_BEDS])];
      if (lbl && r.value !== null && r.value > 0) breakdown[lbl] = r.value;
    }
  }

  const changePct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
  return buildStatisticAnswer({
    source: INFO,
    query: queryEcho,
    value: pick ? pick.value : null,
    measure: "average",
    currency: "EUR",
    unit: "per month",
    period: period ?? { from: null, to: null },
    reference_period: pick ? pick.quarter.replace("Q", "-Q") : "",
    method:
      "Ireland (RTB, via the CSO table RIQ02): the average monthly rent of tenancies registered with the Residential Tenancies Board in the quarter, for the chosen place, bedrooms and property type. We pass on the published average and its quarter; it is an average, not a range built from individual rents, and it is not standardised.",
    describe: (v) =>
      `The average monthly rent of ${typeLabel} (${bedLabel}) registered with the RTB in ${parts ? (parts.length === 1 ? parts[0].name : `${loc.label} (mean of its parts)`) : loc.label} was ${fmtMoney(v, "EUR")} (one published average, not a range; not mix-adjusted).` +
      (ageMonths !== null && ageMonths > 6 ? ` That quarter ended about ${Math.round(ageMonths)} months ago, so rents today may differ.` : ""),
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra: pick
      ? {
          location: { name: loc.label, cso_code: loc.code },
          bedrooms: table.labels[D_BEDS][bedCode],
          property_type: table.labels[D_TYPE][typeCode],
          previous_quarter: pick.previous ? { quarter: pick.previous.quarter, value: pick.previous.value, change_percent: changePct(pick.value, pick.previous.value) } : null,
          same_quarter_last_year: pick.yearAgo ? { quarter: pick.yearAgo.quarter, value: pick.yearAgo.value, change_percent: changePct(pick.value, pick.yearAgo.value) } : null,
          by_bedrooms: breakdown,
          ...(parts ? { district_has_no_figure: true, parts_used: parts } : {}),
          table_updated: meta.updated,
          rent_kind: "actual average of registered rents, not standardised",
        }
      : undefined,
  });
}

// ---------- daily copy of the newest quarter (stale-if-error and history) ----------
// One library row per place, property type and bedroom group for the newest quarter that has figures. Each row is one published
// average: n is NO_COUNT and the range fields repeat the figure. Rows are dated by the end of the quarter (referenceDates).

/** Property types kept in the copy: library item name -> CSO code. */
const COPY_TYPES: { name: string; code: string }[] = [
  { name: "all", code: "-" },
  { name: "apartment", code: "04" },
  { name: "detached", code: "01" },
  { name: "semi-detached", code: "02" },
  { name: "terraced", code: "03" },
];
/** Bedroom groups kept in the copy: library item name -> CSO code. */
const COPY_BEDS: { name: string; code: string }[] = [
  { name: "all", code: "-" },
  { name: "1", code: "01" },
  { name: "2", code: "02" },
  { name: "3", code: "03" },
  { name: "4plus", code: "08" },
];

export const rentItem = (type: string, bed: string) => `${type}/${bed}`;

/** Pure: library rows from the tables the CSO returned (one per property type), newest quarter that has any figure. */
export function ieHarvestRows(tables: { type: { name: string; code: string }; table: JsonStatTable }[], locations: { code: string; label: string }[]): HarvestResult {
  const labelOf = new Map(locations.map((l) => [l.code, l.label.replace(/\s+,/, ",")]));
  const newest = tables
    .flatMap((t) => t.table.codes[D_TIME])
    .filter((q, i, a) => a.indexOf(q) === i)
    .sort()
    .reverse()
    .find((q) => tables.some((t) => rowsWhere(t.table, { [D_TIME]: q }).some((r) => r.value !== null && r.value > 0)));
  if (!newest) throw new SourceError("The CSO table RIQ02 returned no usable average rent");
  const seen = new Set<string>();
  const rows: DailyRow[] = [];
  for (const { type, table } of tables) {
    for (const r of rowsWhere(table, { [D_TIME]: newest, [D_TYPE]: type.code })) {
      const v = r.value;
      if (v === null || !(v > 0)) continue;
      const bed = COPY_BEDS.find((b) => b.code === String(r[D_BEDS]));
      const area = labelOf.get(String(r[D_LOC]));
      if (!bed || !area) continue;
      const item = rentItem(type.name, bed.name);
      if (seen.has(`${area}|${item}`)) continue; // a cell is one row, however the requests were split
      seen.add(`${area}|${item}`);
      rows.push({ area, item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  if (!rows.length) throw new SourceError("The CSO table RIQ02 returned no usable average rent");
  const period = periodRange(quarterLabel(newest))!;
  return {
    date: period.to,
    currency: "EUR",
    unit: "per month",
    rows,
    note: `RTB Average Monthly Rent Report ${quarterLabel(newest)} (CSO table RIQ02): average monthly rent of registered tenancies by place, property type and bedrooms. Published averages, not counts of tenancies (no count is published).`,
  };
}

export async function ieHarvest(fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 30000)): Promise<HarvestResult> {
  const meta = await loadMeta(fetcher);
  const quarters = meta.quarters.slice(-2);
  const tables: { type: { name: string; code: string }; table: JsonStatTable }[] = [];
  // The CSO's address layer refuses long GET addresses (HTTP 403 at 100 places, 200 at 25, probed 2026-10-24), so ask for at most
  // 30 places per request, a few requests at a time.
  const BATCH = 30;
  for (const type of COPY_TYPES) {
    const batches: string[][] = [];
    for (let i = 0; i < meta.locations.length; i += BATCH) batches.push(meta.locations.slice(i, i + BATCH).map((l) => l.code));
    let merged = null as JsonStatTable | null;
    for (let i = 0; i < batches.length; i += 4) {
      const got = await Promise.all(batches.slice(i, i + 4).map(async (codes) => parseRpc(await fetcher(buildRpcUrl(quarters, codes, type.code)))));
      for (const t of got) merged = merged ? { ...merged, rows: [...merged.rows, ...t.rows] } : t;
    }
    if (merged) tables.push({ type, table: merged });
  }
  return ieHarvestRows(tables, meta.locations);
}

/** Where a request lives in the library, without asking the CSO: places come from the areas of our newest stored day. */
export function ieHistoryKey(
  p: { town?: string; property_type?: string; house_type?: string; bedrooms?: number },
  areas: string[],
): { area: string; item: string; label: string } | null {
  if (!p.town || !areas.length) return null;
  if (p.property_type === "room") return null;
  let type = "all";
  if (p.property_type === "apartment") type = "apartment";
  else if (p.property_type === "house" || p.house_type) {
    const h = houseType(p.house_type);
    if (!h) return null;
    type = h.name;
  }
  let bed = "all";
  if (p.bedrooms !== undefined) {
    if (!Number.isInteger(p.bedrooms) || p.bedrooms < 1) return null;
    bed = p.bedrooms >= 4 ? "4plus" : String(p.bedrooms);
  }
  try {
    const place = matchLocation({ updated: null, quarters: [], bedLabels: {}, typeLabels: {}, locations: areas.map((label, i) => ({ code: String(i), label })) }, p.town);
    return { area: place.label, item: rentItem(type, bed), label: place.label };
  } catch {
    return null;
  }
}
