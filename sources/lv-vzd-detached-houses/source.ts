// Latvia house sales from VZD (Valsts zemes dienests, the State Land Service): the same monthly "Nekustama ipasuma tirgus statistika"
// dataset as lv-vzd-home-sales (apartments), but the files for houses ("ind_dz": individual houses) in six floor-area bands.
// For every town and rural parish VZD publishes the number of registered deals used and the minimum, maximum, mean, trimmed means,
// mode and MEDIAN price in EUR per house (not per m2), for the two latest full years. Dataset page:
// https://data.gov.lv/dati/lv/dataset/tirgus-statistika (CKAN, license_id CC-BY-4.0, read 2026-11-04).
// Six small CSVs (12-22 KB each) read per request through a six-hour in-memory cache. Format checked live on 2026-11-04.
// The pure table parser and place matcher are shared with the apartment source (imported, that folder is not changed).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { areaKey, findPlace, fold, MIN_SALES, parseCsv, type LvTable, type Row, type Stat } from "../lv-vzd-home-sales/source";

export const PAGE_URL = "https://data.gov.lv/dati/lv/dataset/tirgus-statistika";
const DATASET = "864bbe12-f7bf-4437-b5fa-1ec187684d01";
export interface Band { key: number; label: string; from: number; to: number | null; id: string; file: string }
/** Yearly CSV resources for the six house floor-area bands (resource ids from the CKAN package_show, 2026-11-04). */
export const BANDS: Band[] = [
  { key: 0, label: "up to 40 m2", from: 0, to: 40, id: "cb5fb8ea-c2a7-4d89-9cf9-26be895a9910", file: "publish_statistika_ind_dz_0_gads.csv" },
  { key: 40, label: "40 to 60 m2", from: 40, to: 60, id: "d0b76431-9d0b-4ec5-bfa5-bd5b62f79235", file: "publish_statistika_ind_dz_40_gads.csv" },
  { key: 60, label: "60 to 110 m2", from: 60, to: 110, id: "511b0ffd-548c-46ff-a6b6-0aec63508672", file: "publish_statistika_ind_dz_60_gads.csv" },
  { key: 110, label: "110 to 180 m2", from: 110, to: 180, id: "754aa318-bbba-4c71-84e0-7e2db24568a1", file: "publish_statistika_ind_dz_110_gads.csv" },
  { key: 180, label: "180 to 250 m2", from: 180, to: 250, id: "e9e9b250-3a85-43f0-bd03-21d59c8decaf", file: "publish_statistika_ind_dz_180_gads.csv" },
  { key: 250, label: "over 250 m2", from: 250, to: null, id: "6933a273-5194-4efe-8179-a1df9a6f6107", file: "publish_statistika_ind_dz_250_gads.csv" },
];
export const csvUrl = (b: Band): string => `https://data.gov.lv/dati/dataset/${DATASET}/resource/${b.id}/download/${b.file}`;
export { MIN_SALES };

export const INFO: SourceInfo = {
  id: "lv-vzd-detached-houses",
  country: "LV (Latvia)",
  category: "home sales (houses, official statistics of registered deals)",
  name: "VZD Real Estate Market Statistics: house sale prices by town and parish",
  publisher: "Valsts zemes dienests (VZD, the State Land Service of Latvia)",
  what_is_recorded:
    "For each town and rural parish (pagasts), Riga and Jurmala, and for six house floor-area bands (up to 40, 40-60, 60-110, 110-180, 180-250 and over 250 m2): the number of registered deals VZD used " +
    "and the median price in EUR per house, for the two latest full calendar years. Built by VZD from its Real Estate Market Database of registered deals; only statistics are published, never single deals or addresses. " +
    "VZD leaves a place out when fewer than 3 deals stand behind it; we show a figure only from 5 deals.",
  price_type: "official_statistic",
  freshness: "Refreshed monthly by VZD; yearly files switch to the new year on 1 February, so the newest year is the previous calendar year",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), as stated in the data.gov.lv catalogue record of the dataset (license_id CC-BY-4.0, maintainer Valsts zemes dienests, read 2026-11-04).",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Valsts zemes dienests (State Land Service of Latvia), Real Estate Market Statistics, via data.gov.lv. Licence CC BY 4.0. Selected figures reorganised by ProofPrice; not an endorsement by VZD.",
  homepage: PAGE_URL,
  limits:
    "A median price per house in EUR (not per m2) for a floor-area band and a calendar year, so the newest figure is 1 to 13 months old. Most rural places have fewer than 5 deals in a band and get no figure. " +
    "The land under the house may or may not be in the price (VZD publishes house files and land files apart). The data are prepared automatically without manual checking of deals (VZD notice); extreme records can sit behind the minimum and maximum.",
};

export const METHOD =
  "Latvia: the median price in EUR per house (not per m2) of the deals VZD (State Land Service) registered in its Real Estate Market Database, for one town, parish or Riga, one floor-area band and the latest full calendar year VZD publishes. " +
  "We pass on VZD's published median and deal count, the previous year's median and the other floor-area bands; a place with fewer than 5 deals in a band gets no figure.";

export interface Query { town: string | null; property_type: string | null; floor_area: number | null; baseUrl?: string }

export function bandFor(area: number): Band {
  return BANDS.find((b) => area >= b.from && (b.to === null || area < b.to))!;
}

const HOUSE_WORDS = ["house", "houses", "home", "homes", "detached", "villa", "any"];
export function isHouseType(t: string | null | undefined): boolean {
  return !!t && HOUSE_WORDS.includes(t.trim().toLowerCase());
}

function latestYear(row: Row): number | null {
  const ys = Object.keys(row.byYear).map(Number).filter((y) => row.byYear[y].n >= MIN_SALES);
  return ys.length ? Math.max(...ys) : null;
}

function noMatch(q: Query, summary: string, extra: Record<string, unknown> = {}): PriceAnswer {
  return {
    ...buildStatisticAnswer({
      source: INFO, query: { country: "LV", town: q.town, property_type: "house", floor_area: q.floor_area }, value: null, measure: "median", currency: "EUR", unit: "per house",
      period: { from: null, to: null }, reference_period: "", method: METHOD, baseUrl: q.baseUrl, describe: () => "",
    }),
    summary,
    extra,
  };
}

export function lvHouseAnswer(tables: LvTable[], q: Query): PriceAnswer {
  if (!q.town) throw new InputError("town is required for Latvian house prices (a town, a rural parish such as 'Carnikavas pagasts', or Riga)");
  if (q.floor_area !== null && (!Number.isFinite(q.floor_area) || q.floor_area <= 0 || q.floor_area > 5000)) throw new InputError("floor_area must be the house floor area in m2, for example 140");
  const wanted = q.floor_area !== null ? bandFor(q.floor_area) : null;
  const found = tables.map((tb) => ({ tb, band: BANDS.find((b) => b.key === tb.rooms)!, hit: findPlace(tb.rows, q.town!) }));
  if (!found.some((f) => f.hit)) {
    return noMatch(q, `VZD publishes house prices by town and rural parish and for Riga, not for '${q.town}'. Try the town name (for example Riga, Jurmala, Adazi, Saulkrasti) or a municipality such as 'Adazu novads'.`);
  }
  const per: { band: Band; year: number; stat: Stat; prev: Stat | null; label: string; kind: string }[] = [];
  for (const { band, hit } of found) {
    if (!hit) continue;
    const y = latestYear(hit.row);
    if (y === null) continue;
    const prev = hit.row.byYear[y - 1];
    per.push({ band, year: y, stat: hit.row.byYear[y], prev: prev && prev.n >= MIN_SALES ? prev : null, label: hit.label, kind: hit.kind });
  }
  const label = found.find((f) => f.hit)!.hit!.label;
  const list = (ps: typeof per) => ps.map((p) => `${p.band.label} ${fmtMoney(p.stat.median!, "EUR")} (${p.stat.n} deals, ${p.year})`).join("; ");
  if (!per.length) {
    return noMatch(q, `VZD has fewer than ${MIN_SALES} registered house deals in ${label} in any floor-area band in the latest two years, so ProofPrice shows no figure. Try the municipality (for example 'Adazu novads') or a bigger town nearby.`);
  }
  let pick = wanted ? per.find((p) => p.band.key === wanted.key) : undefined;
  if (wanted && !pick) {
    return noMatch(q, `VZD has fewer than ${MIN_SALES} registered deals for houses of ${wanted.label} in ${label}; other floor-area bands: ${list(per)}.`, { by_floor_area: per.map(bandOut) });
  }
  pick = pick ?? per.reduce((a, b) => (b.stat.n > a.stat.n ? b : a));
  const st = pick.stat;
  const change = pick.prev && pick.prev.median ? Math.round(((st.median! - pick.prev.median) / pick.prev.median) * 1000) / 10 : null;
  const notes: string[] = [];
  if (!wanted) notes.push(`No floor area was given, so the figure is for houses of ${pick.band.label}, the band with the most deals in ${label}; other bands are in extra.by_floor_area.`);
  const newest = Math.max(...found.flatMap((f) => (f.hit ? Object.keys(f.hit.row.byYear).map(Number) : [0])));
  if (pick.year < newest) notes.push(`VZD's ${newest} figure rests on fewer than ${MIN_SALES} deals, so the newest usable year is ${pick.year}.`);
  notes.push("Median price per house in EUR (not per m2), from VZD's registered deals; extreme records are not removed.");
  const range = st.min !== null && st.max !== null ? `${fmtMoney(st.min, "EUR")} to ${fmtMoney(st.max, "EUR")}` : null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "LV", town: q.town, property_type: "house", floor_area: q.floor_area },
    value: st.median,
    measure: "median",
    currency: "EUR",
    unit: "per house",
    period: { from: `${pick.year}-01-01`, to: `${pick.year}-12-31` },
    reference_period: String(pick.year),
    sample_size: st.n,
    method: METHOD,
    note: notes.join(" "),
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In ${label} the median price paid for a house of ${pick!.band.label} was ${fmtMoney(v, "EUR")} in ${pick!.year}, from ${st.n} registered deals (VZD, State Land Service).` +
      (change !== null ? ` That is ${Math.abs(change)}% ${change >= 0 ? "above" : "below"} ${pick!.year - 1} (${fmtMoney(pick!.prev!.median!, "EUR")}).` : "") +
      (range ? ` Single deals ran from ${range}.` : ""),
    extra: {
      place: { name: label, kind: pick.kind },
      floor_area_band: pick.band.label,
      mean: st.mean,
      lowest_deal: st.min,
      highest_deal: st.max,
      previous_year: pick.prev ? { reference_period: String(pick.year - 1), median: pick.prev.median, deals: pick.prev.n, change_percent: change } : null,
      by_floor_area: per.map(bandOut),
      all_bands: allBands(per),
      definition: "Median price in EUR per house from VZD's Real Estate Market Database of registered deals; a calendar year.",
      dataset: { page: PAGE_URL, csv: csvUrl(pick.band) },
    },
  });
}

/** Deals and deal-weighted mean over every band that has a usable figure in the same year: an exact mean of those deals, not a median. */
function allBands(per: { year: number; stat: Stat }[]) {
  const y = Math.max(...per.map((p) => p.year));
  const ok = per.filter((p) => p.year === y && p.stat.mean !== null);
  const deals = ok.reduce((a, p) => a + p.stat.n, 0);
  return { reference_period: String(y), deals, mean: deals ? Math.round(ok.reduce((a, p) => a + p.stat.n * p.stat.mean!, 0) / deals) : null, note: "Mean of the bands with 5 or more deals only; a median cannot be combined across bands." };
}

function bandOut(p: { band: Band; year: number; stat: Stat }) {
  return { floor_area: p.band.label, reference_period: String(p.year), median: p.stat.median, deals: p.stat.n };
}

// ---------- fetching ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
export type CsvFetcher = (band: Band) => Promise<string>;

export async function downloadCsv(band: Band): Promise<string> {
  const url = csvUrl(band);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  }
}

export const CACHE_MS = 6 * 3600 * 1000;
const cache = new Map<number, { at: number; table: LvTable }>();
export function clearCache(): void {
  cache.clear();
}

export async function loadBand(band: Band, o: { fetcher?: CsvFetcher; now?: number } = {}): Promise<LvTable> {
  const now = o.now ?? Date.now();
  const hit = cache.get(band.key);
  if (hit && now - hit.at < CACHE_MS) return hit.table;
  try {
    const table = parseCsv(await (o.fetcher ?? downloadCsv)(band), band.key); // LvTable.rooms carries the band key here
    cache.set(band.key, { at: now, table });
    return table;
  } catch (err) {
    if (hit) return hit.table;
    throw err;
  }
}

export async function lvHouseSales(
  input: { town?: string | null; property_type?: string | null; floor_area?: number | null; baseUrl?: string },
  o: { tables?: LvTable[]; fetcher?: CsvFetcher; now?: number } = {},
): Promise<PriceAnswer> {
  if (input.property_type && !isHouseType(input.property_type)) throw new InputError("property_type: this source covers houses only ('house'); apartments are answered without it");
  const q: Query = { town: input.town ?? null, property_type: input.property_type ?? null, floor_area: input.floor_area ?? null, baseUrl: input.baseUrl };
  if (o.tables) return lvHouseAnswer(o.tables, q);
  if (!q.town) throw new InputError("town is required for Latvian house prices (a town, a rural parish such as 'Carnikavas pagasts', or Riga)");
  if (q.floor_area !== null && (!Number.isFinite(q.floor_area) || q.floor_area <= 0 || q.floor_area > 5000)) throw new InputError("floor_area must be the house floor area in m2, for example 140");
  const bands = q.floor_area !== null ? [bandFor(q.floor_area)] : BANDS;
  const tables = await Promise.all(bands.map((b) => loadBand(b, { fetcher: o.fetcher, now: o.now })));
  return lvHouseAnswer(tables, q);
}

// ---------- price library copy (stale-if-error) ----------
// Once a day the collector stores, for every town, parish, municipality (its towns) and Riga, VZD's newest-year house median for the floor-area
// band with the most deals (the band the live answer picks when no floor area is given). If data.gov.lv does not answer, the shared
// stale-if-error path answers a town question without floor_area from that copy. Rows are dated 31 December of the year they describe.
const isTotal = (r: Row): boolean => /kopa/.test(fold(r.place));
const isUrban = (r: Row): boolean => /pilsetu teritorijas kopa/.test(fold(r.place));

export function houseHarvestRows(tables: LvTable[], minPlaces = 20): HarvestResult {
  const newest = Math.max(0, ...tables.flatMap((t) => t.years));
  if (!newest) throw new SourceError("VZD's house price tables hold no year to collect", PAGE_URL);
  const best = new Map<string, { n: number; stat: Stat }>();
  const seen = new Map<string, number>();
  for (const tb of tables) {
    for (const r of tb.rows) {
      let area: string | null = null;
      if (fold(r.municipality) === "riga") area = "riga";
      else if (isUrban(r)) area = areaKey(r.municipality);
      else if (!isTotal(r)) area = areaKey(r.place);
      if (!area) continue;
      if (tb === tables[0]) seen.set(area, (seen.get(area) ?? 0) + 1);
      const st = r.byYear[newest];
      if (!st || st.n < MIN_SALES || st.median === null || st.median <= 0) continue;
      const cur = best.get(area);
      if (!cur || st.n > cur.n) best.set(area, { n: st.n, stat: st });
    }
  }
  const rows: DailyRow[] = [];
  for (const [area, { n, stat }] of best) {
    if ((seen.get(area) ?? 0) > 1) continue; // a name shared by two places is ambiguous: leave it out
    const median = stat.median!;
    rows.push({ area, item: "house", n, median, low: stat.min ?? median, high: stat.max ?? median, min: stat.min ?? median, max: stat.max ?? median });
  }
  if (rows.length < minPlaces) throw new SourceError(`VZD's house tables gave only ${rows.length} places with ${MIN_SALES}+ deals; the files may have changed`, PAGE_URL);
  rows.sort((a, b) => a.area.localeCompare(b.area));
  return {
    date: `${newest}-12-31`,
    currency: "EUR",
    unit: "per house",
    rows,
    note: `VZD Real Estate Market Statistics ${newest}: median price per house by town, parish, municipality (towns) and Riga, for the floor-area band with the most deals; places with fewer than ${MIN_SALES} deals left out. Low/high are the cheapest and dearest single deals, not percentiles.`,
  };
}

export async function lvHouseHarvest(o: { fetcher?: CsvFetcher } = {}): Promise<HarvestResult> {
  const fetcher = o.fetcher ?? downloadCsv;
  const tables = await Promise.all(BANDS.map(async (b) => parseCsv(await fetcher(b), b.key)));
  return houseHarvestRows(tables);
}

/** Library key: the folded town, only without a floor area (the copy holds the busiest band). */
export function lvHouseHistoryKey(p: { town?: string | null; property_type?: string | null; floor_area?: number | null }): { area: string; item: string; label: string } | null {
  const town = (p.town ?? "").trim();
  if (!town || (p.floor_area !== undefined && p.floor_area !== null)) return null;
  if (!isHouseType(p.property_type)) return null;
  const area = areaKey(town);
  if (!area || /\b(parish)\b/.test(area)) return null;
  return { area, item: "house", label: town };
}
