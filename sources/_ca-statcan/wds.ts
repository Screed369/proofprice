// Shared plumbing for the three Canadian sources that read Statistics Canada tables through its Web Data Service (WDS):
// ca-cmhc-rents (table 34-10-0133-01), ca-statcan-prices (18-10-0245-01) and ca-statcan-fuel (18-10-0001-01).
// This folder starts with "_" so the registry ignores it (like sources/_template); it holds code only, never a source.
//
// WDS needs no key and no sign-up (https://www.statcan.gc.ca/en/developers/wds/user-guide). We use two POST methods:
//   getCubeMetadata                              -> the table's title, last release and every dimension member (id + name)
//   getDataFromCubePidCoordAndLatestNPeriods     -> the latest N periods of a series named by a coordinate, e.g. "16.2.0.0.0.0.0.0.0.0"
//                                                   (member id of dimension 1, then dimension 2 ..., zero padded to 10 places)
// Formats checked live on 2026-10-14 through a preview deployment on Vercel (see fixtures.ts). The metadata is cached 24 hours and
// data 6 hours in memory, so a warm server asks Statistics Canada rarely (the WDS limit is 25 requests a second per IP address).

import { SourceError, fetchJson } from "../../lib/http";

export const WDS_BASE = "https://www150.statcan.gc.ca/t1/wds/rest";
/** StatCan asks API users to identify themselves; same style as the BLS source. */
export const WDS_USER_AGENT = "ProofPrice/1.0 (hello@proofprice.com)";
export const OPEN_LICENCE_URL = "https://www.statcan.gc.ca/en/terms-conditions/open-licence";

/** POST a JSON body to a WDS method and return the parsed reply. Tests inject a fake. */
export type Poster = (path: string, body: unknown) => Promise<unknown>;

export const wdsPost: Poster = (path, body) =>
  fetchJson(
    `${WDS_BASE}/${path}`,
    { method: "POST", headers: { "content-type": "application/json", "user-agent": WDS_USER_AGENT }, body: JSON.stringify(body) },
    20000,
  );

// ---------- in-memory cache ----------

export const META_TTL_MS = 24 * 3600 * 1000;
export const DATA_TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

export function clearWdsCache(): void {
  cache.clear();
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- table metadata ----------

export interface CubeMember {
  id: number;
  name: string;
  parent: number | null;
  terminated: boolean;
}

export interface CubeDimension {
  position: number;
  name: string;
  members: CubeMember[];
}

export interface CubeMeta {
  productId: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  /** When the table was last released, as WDS gives it: "2025-12-17T08:30". */
  releaseTime: string | null;
  dimensions: CubeDimension[];
}

/** One WDS reply is a list of {status, object}. Returns the object of the first SUCCESS entry or throws a SourceError. */
function firstObject(json: unknown, what: string): any {
  if (!Array.isArray(json) || !json.length) {
    const msg = json && typeof json === "object" && typeof (json as any).message === "string" ? (json as any).message : "unexpected reply";
    throw new SourceError(`Statistics Canada did not return ${what}: ${msg}`.slice(0, 300));
  }
  const first = json[0];
  if (!first || first.status !== "SUCCESS" || !first.object || typeof first.object !== "object") {
    throw new SourceError(`Statistics Canada did not return ${what} (status ${String(first?.status)})`);
  }
  return first.object;
}

export function parseCubeMetadata(json: unknown, expectProductId: number): CubeMeta {
  const o = firstObject(json, "the table description");
  if (Number(o.productId) !== expectProductId) throw new SourceError(`Statistics Canada returned table ${String(o.productId)}, not ${expectProductId}`);
  const dims: CubeDimension[] = (Array.isArray(o.dimension) ? o.dimension : []).map((d: any) => ({
    position: Number(d.dimensionPositionId),
    name: String(d.dimensionNameEn ?? ""),
    members: (Array.isArray(d.member) ? d.member : []).map((m: any) => ({
      id: Number(m.memberId),
      name: String(m.memberNameEn ?? "").replace(/\s+/g, " ").trim(),
      parent: m.parentMemberId === null || m.parentMemberId === undefined ? null : Number(m.parentMemberId),
      terminated: Number(m.terminated) === 1,
    })),
  }));
  return {
    productId: expectProductId,
    title: String(o.cubeTitleEn ?? ""),
    startDate: typeof o.cubeStartDate === "string" ? o.cubeStartDate : null,
    endDate: typeof o.cubeEndDate === "string" ? o.cubeEndDate : null,
    releaseTime: typeof o.releaseTime === "string" ? o.releaseTime : null,
    dimensions: dims,
  };
}

export async function loadCubeMeta(productId: number, post: Poster = wdsPost): Promise<CubeMeta> {
  // A test's fake poster is a different function object each time: key the cache by it so tests never share state.
  const key = post === wdsPost ? `meta:${productId}` : null;
  const load = async () => parseCubeMetadata(await post("getCubeMetadata", [{ productId }]), productId);
  return key ? cached(key, META_TTL_MS, load) : load();
}

export function dimension(meta: CubeMeta, position: number, expectName: string): CubeDimension {
  const d = meta.dimensions.find((x) => x.position === position);
  if (!d || d.name.toLowerCase() !== expectName.toLowerCase()) {
    throw new SourceError(`Statistics Canada changed the layout of table ${meta.productId} (expected dimension ${position} to be "${expectName}"); this source needs updating.`);
  }
  return d;
}

/** The member with exactly this name (spaces collapsed, case ignored). Members that are still published win over terminated ones. */
export function memberByName(dim: CubeDimension, name: string): CubeMember | undefined {
  const want = name.replace(/\s+/g, " ").trim().toLowerCase();
  const hits = dim.members.filter((m) => m.name.toLowerCase() === want);
  return hits.find((m) => !m.terminated) ?? hits[0];
}

// ---------- data ----------

/** WDS pads a coordinate to ten places; a shorter one is rejected for the whole request. */
export function coordinate(ids: number[]): string {
  if (!ids.length || ids.length > 10 || ids.some((i) => !Number.isInteger(i) || i < 0)) throw new RangeError("a coordinate has 1 to 10 whole-number members");
  return [...ids, ...Array(10 - ids.length).fill(0)].join(".");
}

export interface DataPoint {
  /** "YYYY-MM-DD" reference period as WDS labels it (an annual series is labelled with 1 January). */
  period: string;
  /** "YYYY-MM-DD" the real reference date (refPerRaw): for the CMHC survey this is 1 October. */
  survey: string;
  /** Null when Statistics Canada publishes no figure (status F, "..", suppressed). */
  value: number | null;
  decimals: number;
  /** WDS status code: 0 normal, 1 "..", 7 E (use with caution), 8 F (too unreliable to be published) ... */
  status: number;
  releaseTime: string | null;
}

export interface DataSeries {
  coordinate: string;
  vectorId: number | null;
  /** False when WDS answered FAILED for this coordinate (no such series). */
  ok: boolean;
  /** Oldest first. */
  points: DataPoint[];
}

export function parseCoordData(json: unknown): DataSeries[] {
  if (!Array.isArray(json)) {
    const msg = json && typeof json === "object" && typeof (json as any).message === "string" ? (json as any).message : "unexpected reply";
    throw new SourceError(`Statistics Canada rejected the data request: ${msg}`.slice(0, 300));
  }
  return json.map((item: any) => {
    const o = item?.object ?? {};
    const raw: any[] = Array.isArray(o.vectorDataPoint) ? o.vectorDataPoint : [];
    const points: DataPoint[] = raw
      .map((p) => ({
        period: String(p.refPer ?? ""),
        survey: String(p.refPerRaw || p.refPer || ""),
        value: typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null,
        decimals: Number(p.decimals ?? 0),
        status: Number(p.statusCode ?? 0),
        releaseTime: typeof p.releaseTime === "string" ? p.releaseTime : null,
      }))
      .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.period))
      .sort((a, b) => a.period.localeCompare(b.period));
    return {
      coordinate: String(o.coordinate ?? ""),
      vectorId: typeof o.vectorId === "number" && o.vectorId > 0 ? o.vectorId : null,
      ok: item?.status === "SUCCESS",
      points,
    };
  });
}

/** The latest `latestN` periods of each coordinate, in the order asked. One POST for the whole list. */
export async function latestPeriods(productId: number, coords: string[], latestN: number, post: Poster = wdsPost): Promise<DataSeries[]> {
  const key = post === wdsPost ? `data:${productId}:${latestN}:${coords.join(",")}` : null;
  const load = async () => {
    const body = coords.map((c) => ({ productId, coordinate: c, latestN }));
    const got = parseCoordData(await post("getDataFromCubePidCoordAndLatestNPeriods", body));
    return coords.map((c) => got.find((s) => s.coordinate === c) ?? { coordinate: c, vectorId: null, ok: false, points: [] });
  };
  return key ? cached(key, DATA_TTL_MS, load) : load();
}

/** A usable figure: a number above zero. (CMHC publishes a 0 for areas it does not survey.) */
export function usable(p: DataPoint | undefined | null): p is DataPoint & { value: number } {
  return !!p && p.value !== null && Number.isFinite(p.value) && p.value > 0;
}

/** The newest usable point of a series, or null. */
export function newestUsable(s: DataSeries | undefined): (DataPoint & { value: number }) | null {
  if (!s) return null;
  for (let i = s.points.length - 1; i >= 0; i--) if (usable(s.points[i])) return s.points[i] as DataPoint & { value: number };
  return null;
}

// ---------- dates ----------

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-08-01" or "2026-08" -> "2026-08" */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

export function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(month)!;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** First and last day of a month: "2026-08" -> { from: "2026-08-01", to: "2026-08-31" } */
export function monthRange(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})/.exec(month)!;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

/** Whole months from the given month until `today` (0 in the same month). */
export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})/.exec(month)!;
  return today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

export const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Percent change from `from` to `to`, one decimal. */
export function changePercent(to: number, from: number): number {
  return roundTo(((to - from) / from) * 100, 1);
}
