// Australia home prices from the Australian Bureau of Statistics (ABS) Data API, dataflow RES_DWELL_ST
// "Residential Dwellings: Values, Mean Price and Number by State and Territories" (catalogue 6416.0). Format checked live on 2026-10-14
// (GitHub probe and a Vercel deployment): one GET, SDMX-JSON 2.0 ("format=jsondata"), no API key, no sign-up.
//
// What the ABS publishes: for Australia and each of the 8 states and territories, each quarter, (4) the number of residential dwellings and
// (5) the mean price of residential dwellings, in AUD with a unit multiplier of thousands. The mean price is the ABS estimate of the total value of
// the residential dwelling stock divided by the number of dwellings: it describes the whole stock, not the homes sold in the quarter. The newest
// quarter carries observation status "p" (preliminary) and is revised. There is no median, no distribution and no sales count, so the answer is an
// official statistic: measure "average", range fields null, sample_size null. The changes are calculated here from the published figures.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { SourceError } from "../../lib/http";
import { periodRange, previousPeriod, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import { INFO } from "./info";
import { resolvePlace } from "./places";
import type { Place, RegionCode } from "./places";
import { NO_COUNT } from "../../lib/stats";
import type { DailyRow, HarvestResult } from "../../lib/plugin";

export const ABS_API = "https://data.api.abs.gov.au/rest";
export const DATAFLOW = "ABS,RES_DWELL_ST";
const MEASURE_NUMBER = "4"; // Number of residential dwellings
const MEASURE_PRICE = "5"; // Mean price of residential dwellings

/** One GET: both measures, the place's region and Australia (for the comparison), the last 6 quarters (newest, previous, same quarter a year earlier and spare). */
export function dataUrl(region: RegionCode, base = ABS_API): string {
  const regions = region === "AUS" ? "AUS" : `${region}+AUS`;
  return `${base}/data/${DATAFLOW}/${MEASURE_NUMBER}+${MEASURE_PRICE}.${regions}.Q?lastNObservations=6&format=jsondata`;
}

// ---------- reading the SDMX-JSON message (pure) ----------

export interface Point {
  period: string; // "2026-Q2"
  value: number; // in the unit (AUD or dwellings), multiplier applied
  status: string | null; // OBS_STATUS: "p" preliminary, "r" revised, null = final
}
export interface Series {
  measure: string; // "4" or "5"
  region: string; // ABS REGION code
  unit: string; // "AUD" or "NUM"
  points: Point[]; // oldest first
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Turn an ABS Data API SDMX-JSON 2.0 response into one series per measure and region. Throws SourceError for anything else. */
export function parseAbs(json: unknown): Series[] {
  const j = json as any;
  if (isObj(j) && Array.isArray(j.errors) && j.errors.length && !j.data) {
    throw new SourceError(`The ABS Data API refused the request: ${String(j.errors[0]?.message ?? JSON.stringify(j.errors[0])).slice(0, 200)}`);
  }
  const ds = j?.data?.dataSets?.[0];
  const st = j?.data?.structures?.[0];
  const seriesDims: any[] | undefined = st?.dimensions?.series;
  const timeDim = st?.dimensions?.observation?.find((d: any) => d.id === "TIME_PERIOD");
  if (!isObj(ds) || !isObj(ds.series) || !Array.isArray(seriesDims) || !timeDim || !Array.isArray(timeDim.values)) {
    throw new SourceError("Unexpected response from the ABS Data API (not an SDMX-JSON data message)");
  }
  const dimIndex = (id: string) => seriesDims.findIndex((d) => d.id === id);
  const iMeasure = dimIndex("MEASURE");
  const iRegion = dimIndex("REGION");
  if (iMeasure < 0 || iRegion < 0) throw new SourceError("Unexpected response from the ABS Data API (no MEASURE or REGION dimension)");
  const serAttrs: any[] = st?.attributes?.series ?? [];
  const obsAttrs: any[] = st?.attributes?.observation ?? [];
  const attrPos = (list: any[], id: string) => list.findIndex((a) => a.id === id);
  const aUnit = attrPos(serAttrs, "UNIT_MEASURE");
  const aMult = attrPos(serAttrs, "UNIT_MULT");
  const oStatus = attrPos(obsAttrs, "OBS_STATUS");

  const out: Series[] = [];
  for (const [key, s] of Object.entries<any>(ds.series)) {
    const parts = key.split(":").map(Number);
    const measure = seriesDims[iMeasure].values?.[parts[iMeasure]]?.id;
    const region = seriesDims[iRegion].values?.[parts[iRegion]]?.id;
    if (typeof measure !== "string" || typeof region !== "string") continue;
    const attrs: number[] = Array.isArray(s.attributes) ? s.attributes : [];
    const unit = aUnit >= 0 ? String(serAttrs[aUnit].values?.[attrs[aUnit]]?.id ?? "") : "";
    const mult = aMult >= 0 ? Number(serAttrs[aMult].values?.[attrs[aMult]]?.id ?? 0) : 0;
    const factor = Number.isFinite(mult) ? 10 ** mult : 1;
    const points: Point[] = [];
    for (const [t, obs] of Object.entries<any>(s.observations ?? {})) {
      const period = timeDim.values[Number(t)]?.id;
      const raw = Array.isArray(obs) ? obs[0] : null;
      if (typeof period !== "string" || typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const sIdx = oStatus >= 0 ? obs[1 + oStatus] : undefined;
      const status = typeof sIdx === "number" ? String(obsAttrs[oStatus].values?.[sIdx]?.id ?? "") || null : null;
      points.push({ period, value: Math.round(raw * factor * 100) / 100, status });
    }
    points.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    out.push({ measure, region, unit, points });
  }
  if (!out.length) throw new SourceError("The ABS Data API returned no series for this request");
  return out;
}

// ---------- periods ----------

/** "2026-Q3" -> "the third quarter of 2026". */
export function periodWords(code: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `the ${["first", "second", "third", "fourth"][Number(m[2]) - 1]} quarter of ${m[1]}` : code;
}
/** The same quarter one year earlier: "2026-Q3" -> "2025-Q3". */
export function yearEarlier(code: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `${Number(m[1]) - 1}-Q${m[2]}` : null;
}
const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
export const changePercent = (now: number, then: number) => roundTo(((now - then) / then) * 100, 1);

const DAY = 86400000;
/** Plain-words caveat when a figure is old: the ABS publishes about three months after a quarter, so over nine months means a release was missed. */
export function ageNote(periodTo: string | null, now: Date): string | null {
  if (!periodTo) return null;
  const days = Math.round((now.getTime() - Date.parse(periodTo + "T23:59:59Z")) / DAY);
  if (days <= 270) return null;
  return `This figure is old: its quarter ended about ${Math.round(days / 30)} months ago.`;
}

// ---------- the reading (pure) ----------

export interface Change {
  reference_period: string;
  mean_price: number;
  change_percent: number;
}
export interface Reading {
  region: string;
  reference_period: string;
  mean_price: number;
  preliminary: boolean;
  dwellings: { number: number; reference_period: string } | null;
  previous: Change | null;
  year_earlier: Change | null;
  /** The newest quarter the ABS has revised (status not "p"), when the newest one is preliminary. */
  latest_revised: { reference_period: string; mean_price: number } | null;
  national: { mean_price: number; reference_period: string } | null;
  /** The newest quarter in the response, over all series. */
  datasetLatest: string;
}

function find(series: Series[], measure: string, region: string): Series | undefined {
  return series.find((s) => s.measure === measure && s.region === region);
}

/** From the parsed message pick the figure for one region: newest mean price, previous quarter, year earlier, dwellings, Australia. Null if the ABS has no price for the region. */
export function readAbs(series: Series[], region: string): Reading | null {
  const price = find(series, MEASURE_PRICE, region);
  const latest = price?.points[price.points.length - 1];
  if (!price || !latest || !(latest.value > 0)) return null;
  const at = (s: Series | undefined, period: string | null) => (period ? s?.points.find((p) => p.period === period) : undefined);
  const compare = (period: string | null): Change | null => {
    const p = at(price, period);
    return p && p.value > 0 ? { reference_period: p.period, mean_price: p.value, change_percent: changePercent(latest.value, p.value) } : null;
  };
  const num = at(find(series, MEASURE_NUMBER, region), latest.period);
  const nat = region === "AUS" ? undefined : at(find(series, MEASURE_PRICE, "AUS"), latest.period);
  const preliminary = latest.status === "p";
  const revised = preliminary ? [...price.points].reverse().find((p) => p.status !== "p" && p.value > 0) : undefined;
  const all = series.flatMap((s) => s.points.map((p) => p.period)).sort();
  return {
    region,
    reference_period: latest.period,
    mean_price: latest.value,
    preliminary,
    dwellings: num && num.value > 0 ? { number: num.value, reference_period: num.period } : null,
    previous: compare(previousPeriod(latest.period)),
    year_earlier: compare(yearEarlier(latest.period)),
    latest_revised: revised ? { reference_period: revised.period, mean_price: revised.value } : null,
    national: nat && nat.value > 0 ? { mean_price: nat.value, reference_period: nat.period } : null,
    datasetLatest: all[all.length - 1] ?? latest.period,
  };
}

// ---------- the answer (pure) ----------

export const METHOD =
  "The Australian Bureau of Statistics publishes, each quarter, the mean price of residential dwellings for Australia and each state and territory " +
  "(Residential Property Price Indexes, dataflow RES_DWELL_ST, measure 5), with the number of dwellings (measure 4). The mean price is the ABS estimate of the total value " +
  "of the residential dwelling stock divided by the number of dwellings, so it describes all dwellings, not the homes sold in the quarter. ProofPrice returns the published figure for the latest quarter " +
  "for the state or territory the place lies in (a city or postcode is answered with its state), unchanged, with the previous quarter, the same quarter a year earlier and Australia. " +
  "The percentage changes are calculated by ProofPrice from the published figures. The ABS marks its newest quarter preliminary and revises it, which is stated in every answer. " +
  "No range is calculated: only one figure is published and the ABS gives no number of sales.";

export interface AnswerInput {
  place: Place;
  property_type?: string;
  baseUrl?: string;
  apiUrl?: string;
  now?: Date;
}

const AUD = "AUD";
const money = (v: number) => fmtMoney(v, AUD);

function oneChange(c: Change, label: string): string {
  if (c.change_percent === 0) return `unchanged from ${label.replace(/^in /, "")}`;
  return `${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${label}`;
}
/** " That is 2.1% lower than in the first quarter of 2026 and 3.0% higher than a year earlier (the second quarter of 2025)." */
export function changeSentence(previous: Change | null, yearAgo: Change | null): string {
  const parts: string[] = [];
  if (previous) parts.push(oneChange(previous, `in ${periodWords(previous.reference_period)}`));
  if (yearAgo) parts.push(oneChange(yearAgo, `a year earlier (${periodWords(yearAgo.reference_period)})`));
  return parts.length ? ` That is ${parts.join(" and ")}.` : "";
}

/** What the caller asked for, in words: "Parramatta", "postcode 2150", "Victoria", "Australia". */
function asked(place: Place): string {
  if (place.level === "country") return "Australia";
  if (place.level === "postcode") return `postcode ${place.asked}`;
  return place.asked.trim() || place.region.name;
}

export function absAnswer(reading: Reading | null, q: AnswerInput): PriceAnswer {
  const now = q.now ?? new Date();
  const { place } = q;
  const region = place.region;
  const query: Record<string, unknown> = { country: "AU" };
  if (place.level !== "country") query[place.level === "postcode" ? "postcode" : "town"] = place.asked;
  if (q.property_type && q.property_type !== "any") query.property_type = q.property_type;
  const base = { source: INFO, query, measure: "average" as const, currency: AUD, unit: "per dwelling", method: METHOD, baseUrl: q.baseUrl };

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `The ABS Data API holds no mean price of residential dwellings for ${region.name}. Try Australia as a whole or another state or territory.` };
  }

  const range = periodRange(reading.reference_period);
  const resolved = place.level === "state" || place.level === "country";
  const notes: string[] = [];
  if (!resolved) {
    notes.push(
      `The ABS publishes this table for states and territories only, not for a ${place.level === "postcode" ? "postcode" : "city or suburb"}: the figure is for ${region.name}, the state or territory where ${asked(place)} lies. ` +
        "It is not a price for that area.",
    );
  }
  notes.push(
    "This is the ABS estimate of the total value of all residential dwellings (houses and attached dwellings together) divided by the number of dwellings: an average over the whole housing stock, " +
      "not the average price of the homes sold in the quarter, not a median and not a valuation.",
  );
  if (q.property_type && q.property_type !== "any") {
    notes.push(`The ABS does not split this figure by property type, so "${q.property_type}" was not applied: the figure covers all residential dwellings.`);
  }
  if (reading.preliminary) {
    notes.push(
      "Preliminary: the ABS marks the newest quarter as a preliminary figure subject to revision." +
        (reading.latest_revised ? ` The latest revised quarter is ${reading.latest_revised.reference_period}: ${money(reading.latest_revised.mean_price)}.` : ""),
    );
  }
  if (reading.reference_period < reading.datasetLatest) {
    notes.push(`The newest quarter the ABS holds for ${region.name} is ${reading.reference_period}; ${reading.datasetLatest} has been published for other places.`);
  }
  const old = ageNote(range?.to ?? null, now);
  if (old) notes.push(old);
  notes.push(...place.notes);

  const extra: Record<string, unknown> = {
    place: {
      asked: place.asked || null,
      level: place.level,
      area_resolution: resolved ? "as asked" : "state_or_territory",
      figure_is_for: { code: region.code, name: region.name, abbreviation: region.abbr },
    },
    reference_period_label: periodWords(reading.reference_period),
    preliminary: reading.preliminary,
    what_the_figure_is: "mean price of the whole residential dwelling stock (value of all dwellings divided by their number), not the price of homes sold",
    previous_period: reading.previous,
    year_earlier: reading.year_earlier,
    ...(reading.latest_revised ? { latest_revised: reading.latest_revised } : {}),
    ...(reading.dwellings ? { number_of_residential_dwellings: reading.dwellings } : {}),
    ...(reading.national ? { australia_mean_price: reading.national } : {}),
    confidence_reason: "An official statistic, but it describes the dwelling stock, not what people paid for the homes sold; the ABS gives no number of sales.",
    dataset: { dataflow: "RES_DWELL_ST", catalogue_number: "6416.0", latest_period_in_response: reading.datasetLatest, url: INFO.homepage },
    ...(q.apiUrl ? { abs_api_url: q.apiUrl } : {}),
  };

  const where = resolved ? (region.code === "AUS" ? "Australia" : region.name) : `${asked(place)} (the ABS publishes by state, so this is the figure for ${region.name})`;
  const stat = buildStatisticAnswer({
    ...base,
    value: reading.mean_price,
    period: range ?? { from: null, to: null },
    reference_period: reading.reference_period,
    sample_size: null,
    note: notes.join(" "),
    describe: (v) =>
      `In ${where} the mean price of a residential dwelling was ${money(v)} in ${periodWords(reading.reference_period)}${reading.preliminary ? " (preliminary)" : ""}` +
      " (the ABS estimate of the value of all dwellings divided by their number, not the price of homes sold)." +
      changeSentence(reading.previous, reading.year_earlier),
    extra,
  });
  // An official statistic, but about the stock rather than sales: medium, not high.
  return { ...stat, confidence: "medium" };
}

// ---------- the request ----------

export async function absHomePrices(place: Place, o: FetchOptions & { now?: Date; apiBase?: string; baseUrl?: string; property_type?: string } = {}): Promise<PriceAnswer> {
  const url = dataUrl(place.region.code, o.apiBase);
  const series = parseAbs(await resolveFetcher(o)(url));
  const reading = readAbs(series, place.region.code);
  return absAnswer(reading, { place, property_type: o.property_type, baseUrl: o.baseUrl, apiUrl: url, now: o.now });
}

// ---------- the collector (stale-if-error copy) ----------

/** One GET: the newest observation of the mean price for Australia and all 8 states and territories. */
export function harvestUrl(base = ABS_API): string {
  return `${base}/data/${DATAFLOW}/${MEASURE_PRICE}.AUS+1+2+3+4+5+6+7+8.Q?lastNObservations=1&format=jsondata`;
}

/** Library key of the single item this source keeps. */
export const LIBRARY_ITEM = "dwelling-stock-mean";

/** The newest published quarter as one library day (dated by the quarter's last day): one row per region, the published mean price,
 *  no record count (the ABS publishes none) and no range. Throws if fewer than all 9 regions have a price. */
export function absHarvestFrom(series: Series[]): HarvestResult {
  const prices = series.filter((s) => s.measure === MEASURE_PRICE && s.points.length && s.points[s.points.length - 1].value > 0);
  const rows: DailyRow[] = prices.map((s) => {
    const v = s.points[s.points.length - 1].value;
    return { area: s.region, item: LIBRARY_ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
  });
  if (rows.length < 9) throw new SourceError(`The ABS Data API gave a mean price for only ${rows.length} of 9 regions`);
  const newest = prices.map((s) => s.points[s.points.length - 1].period).sort().pop()!;
  const range = periodRange(newest);
  if (!range) throw new SourceError(`Unreadable ABS period "${newest}"`);
  return {
    date: range.to,
    currency: AUD,
    unit: "per dwelling",
    rows,
    note: `ABS mean price of residential dwellings (RES_DWELL_ST measure 5) for ${newest}: the estimated value of the whole dwelling stock divided by the number of dwellings, one published figure per state or territory and Australia, no record count. Kept only so a stale copy can answer when the ABS API is down.`,
  };
}

export async function absHarvest(o: FetchOptions & { apiBase?: string } = {}): Promise<HarvestResult> {
  return absHarvestFrom(parseAbs(await resolveFetcher(o)(harvestUrl(o.apiBase))));
}

/** Library key for a request: the ABS region the place lies in. Null when the place cannot be resolved. */
export function absHistoryKey(p: { town?: string; postcode?: string }): { area: string; item: string; label: string } | null {
  try {
    const place = resolvePlace(p.town, p.postcode);
    return { area: place.region.code, item: LIBRARY_ITEM, label: place.region.name };
  } catch {
    return null;
  }
}
