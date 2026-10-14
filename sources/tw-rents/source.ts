// Taiwan rents from the Ministry of the Interior's "actual price registration" open data (不動產成交案件實際資訊), rentals file
// (租賃, <letter>_lvr_land_c.csv): every residential tenancy declared by the landlord, agent or tenant, with its monthly rent.
// The files hold addresses, so they are bulk files: the daily collector (harvest) reads the releases of the last two years once
// (the same release zips tw-home-sales reads), keeps only aggregates per city / county, district, kind of home and number of
// bedrooms in the price library, and requests are answered from there.
// Formats checked live on 2026-10-14 (see moi.ts for the URLs and source.test.ts for real rows).

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readLatestDay, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { anchorOf, cityFiles, decodeCsv, download, fetchReleases, listZip, parseTable, readZipEntry, rocToIso, selectReleases, windowStart, PORTAL_URL, type Table } from "../tw-home-sales/moi";
import { districtKey, type City, type District } from "../tw-home-sales/places";
import { INFO as SALES_INFO, NATIONAL_AREA, PING_M2, WINDOWS, newStats, resolveTown, snapshotFromRows, type ParseStats, type Snapshot } from "../tw-home-sales/source";

export const INFO: SourceInfo = {
  id: "tw-rents",
  country: "TW (Taiwan)",
  category: "rent (actual price registration, rentals)",
  name: "Actual price registration of real-estate transactions (不動產成交案件實際資訊), rentals",
  publisher: "Ministry of the Interior (內政部), Taiwan",
  what_is_recorded:
    "Residential tenancies declared in Taiwan: the contract date, the district, the kind of building, how the home is let (whole home, self-contained studio, or a room in a shared home), the number of bedrooms and the monthly rent in New Taiwan dollars. Addresses are in the files but are never stored or shown.",
  price_type: "transaction",
  freshness:
    "The Ministry publishes every 10 days (the 1st, 11th and 21st); a tenancy appears about one to two months after the contract date. Our collector re-reads the releases daily, and answers cover whole calendar months ending at least 30 days before the newest contract in the register",
  licence: SALES_INFO.licence,
  licence_url: SALES_INFO.licence_url,
  attribution: SALES_INFO.attribution,
  homepage: PORTAL_URL,
  limits:
    "Aggregates by city or county, district (鄉鎮市區), kind of home and number of bedrooms; never addresses or serial numbers. Only residential lettings (main use 住家用) of a home, with or without a parking space: apartments (住宅大樓 high-rise with lift, 華廈 mid-rise with lift, 公寓 walk-up, 套房 studio building) and houses (透天厝). " +
    "Rents are monthly, in New Taiwan dollars, as declared. 'any' covers whole homes and self-contained studios (獨立套房); rooms let separately in a shared home (分租套房, 分租雅房) are a separate kind, 'room', and are in no other figure. Studios and open-plan homes with no separate bedroom count as 0 bedrooms; 5 means five or more. " +
    "The rent is the monthly total declared, which includes the rent of a parking space let with the home. " +
    "Left out: lettings through the social-housing programmes (社會住宅包租轉租 and 社會住宅代管), whose rents are set below market; lettings between relatives, employees or other special relationships; commercial, office and industrial lettings; land-only and parking-only lettings; and rooms let to several tenants on one contract (多人共同承租). A tenancy registered twice (same record number, or same address, day, rent and area) counts once. " +
    "These are the rents of tenancies declared in the window, new and renewed, not asking rents. Windows are whole calendar months (12 or 24) ending at the last month that is at least 30 days older than the newest contract in the register. A district, kind or bedroom count with fewer than 5 tenancies in the window gets no figure. The rent per m² is the Ministry's monthly unit rent, per m² of registered building area (parking excluded). 1 ping = 3.3058 m².",
};

// ---------- the register (pure) ----------

export type Kind = "whole" | "studio" | "room";
export type Building = "apartment" | "house";

export interface Rental {
  city: string; // file letter, "A" = 臺北市
  district: string;
  date: string; // ISO contract date
  kind: Kind;
  building: Building;
  bedrooms: number; // 0 (studio), 1 ... 5 (five or more)
  rent: number; // TWD per month, as declared (includes the rent of a parking space let with the home)
  unit: number | null; // TWD per m² per month (the Ministry's unit rent)
}

const RENT_OBJECTS = new Set(["租賃房屋", "租賃房屋+車位"]);
const MIN_RENT = 1_500;
const MAX_RENT = 1_000_000;
const MIN_UNIT = 20;
const MAX_UNIT = 20_000;
const numOf = (s: string | undefined) => {
  const v = Number((s ?? "").trim());
  return Number.isFinite(v) ? v : NaN;
};

export function buildingOf(zh: string): Building | null {
  if (zh.startsWith("住宅大樓") || zh.startsWith("華廈") || zh.startsWith("公寓") || zh.startsWith("套房")) return "apartment";
  if (zh.startsWith("透天厝")) return "house";
  return null;
}

/** How the home is let (出租型態): the whole home, a self-contained studio, or a room in a shared home; blank on older records. */
export function kindOf(zh: string, bedrooms: number): Kind {
  const t = zh.trim();
  if (t.startsWith("分租")) return "room";
  if (t.startsWith("獨立套房")) return "studio";
  return bedrooms === 0 ? "studio" : "whole";
}

const drop = (s: ParseStats | undefined, why: string) => {
  if (s) s.dropped[why] = (s.dropped[why] ?? 0) + 1;
};

/**
 * Residential lettings from one city's rentals file (<letter>_lvr_land_c.csv). Columns are found by their Chinese names.
 * `seen` holds record numbers and place + day + rent keys already read, so a tenancy in two releases counts once.
 */
export function parseRentals(t: Table, city: string, o: { seen?: Set<string>; stats?: ParseStats; today?: string } = {}): Rental[] {
  const need = ["鄉鎮市區", "交易標的", "租賃年月日", "建物型態", "主要用途", "總額元", "單價元平方公尺", "備註"];
  for (const c of need) if (t.col(c) < 0) throw new SourceError(`The MOI rentals file has a new layout (no ${c} column); this source needs updating.`);
  const [iDist, iObj, iDate, iType, iUse, iTotal, iUnit, iNote] = need.map((c) => t.col(c));
  const iSerial = t.col("編號");
  const iAddr = t.col("土地位置建物門牌");
  const iArea = t.col("建物總面積平方公尺");
  const iRooms = t.col("建物現況格局-房");
  const iKind = t.col("出租型態");
  const iService = t.col("租賃住宅服務");
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const out: Rental[] = [];
  for (const r of t.rows) {
    o.stats && o.stats.rows++;
    if (!RENT_OBJECTS.has(r[iObj] ?? "")) { drop(o.stats, "not a letting of a building"); continue; }
    const building = buildingOf(r[iType] ?? "");
    if (!building) { drop(o.stats, "not a home building type"); continue; }
    if ((r[iUse] ?? "").trim() !== "住家用") { drop(o.stats, "main use not residential"); continue; }
    if (iService >= 0 && (r[iService] ?? "").includes("社會住宅")) { drop(o.stats, "social housing programme"); continue; }
    const note = r[iNote] ?? "";
    if (note.includes("特殊關係")) { drop(o.stats, "special relationship"); continue; }
    const date = rocToIso(r[iDate]);
    if (!date || date > today) { drop(o.stats, "bad date"); continue; }
    // The monthly rent as declared; it includes the rent of a parking space let with the home.
    const rent = numOf(r[iTotal]);
    if (!(rent >= MIN_RENT && rent <= MAX_RENT)) { drop(o.stats, "bad rent"); continue; }
    const rooms = iRooms >= 0 ? Math.max(0, Math.round(numOf(r[iRooms]) || 0)) : 0;
    const kind = kindOf(iKind >= 0 ? r[iKind] ?? "" : "", rooms);
    if (kind === "room" && note.includes("多人共同承租")) { drop(o.stats, "room on a joint contract"); continue; }
    const serial = iSerial >= 0 ? (r[iSerial] ?? "").trim() : "";
    const address = iAddr >= 0 ? (r[iAddr] ?? "").trim() : "";
    if (o.seen) {
      const k1 = serial ? "n:" + serial : "";
      const k2 = address ? `a:${address}|${r[iDate]}|${rent}|${iArea >= 0 ? r[iArea] : ""}` : "";
      if ((k1 && o.seen.has(k1)) || (k2 && o.seen.has(k2))) { drop(o.stats, "duplicate record"); continue; }
      if (k1) o.seen.add(k1);
      if (k2) o.seen.add(k2);
    }
    const unit = numOf(r[iUnit]);
    o.stats && o.stats.kept++;
    out.push({
      city,
      district: (r[iDist] ?? "").trim(),
      date,
      kind,
      building,
      bedrooms: kind === "studio" ? 0 : Math.min(rooms, 5),
      rent,
      unit: unit >= MIN_UNIT && unit <= MAX_UNIT ? unit : null,
    });
  }
  return out;
}

// ---------- aggregation (pure) ----------

export type RentType = "any" | "apartment" | "house" | "room";
export type Bedrooms = "all" | "0" | "1" | "2" | "3" | "4" | "5";
export type RentMeasure = "rent" | "m2";
export const rentItemKey = (type: RentType, beds: Bedrooms, measure: RentMeasure, months: number) => `${type}:${beds}:${measure}:${months}m`;

/** The kinds a tenancy is counted under: a room is only a room; any other home is "any" and its building type. */
export function typesOf(r: Pick<Rental, "kind" | "building">): RentType[] {
  return r.kind === "room" ? ["room"] : ["any", r.building];
}

/**
 * Library rows for rents and the date they are stamped with: windows of 12 and 24 whole calendar months ending at `anchor`, per
 * district, per city or county and for Taiwan, per kind ("any", "apartment", "house", "room"), per number of bedrooms ("all" or
 * 0..5; not for rooms) and per measure ("rent" per month, "m2" = monthly rent per square metre, for all sizes only).
 */
export function rentRows(rentals: Rental[], anchor: string): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (area: string, item: string, v: number) => {
    const k = `${area}\u0000${item}`;
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  const starts = WINDOWS.map((w) => ({ w, from: windowStart(anchor, w) }));
  for (const r of rentals) {
    if (r.date > anchor) continue;
    const areas = [districtKey({ code: r.city } as City, { zh: r.district } as District), r.city, NATIONAL_AREA];
    const beds: Bedrooms[] = r.kind === "room" ? ["all"] : ["all", String(r.bedrooms) as Bedrooms];
    for (const { w, from } of starts) {
      if (r.date < from) continue;
      for (const t of typesOf(r)) {
        for (const b of beds) {
          for (const a of areas) {
            add(a, rentItemKey(t, b, "rent", w), r.rent);
            if (b === "all" && r.unit !== null) add(a, rentItemKey(t, b, "m2", w), r.unit);
          }
        }
      }
    }
  }
  const rows: DailyRow[] = [];
  for (const [k, vals] of groups) {
    if (vals.length < MIN_PUBLISH) continue;
    const [area, item] = k.split("\u0000");
    const s = summarise(vals);
    if (s) rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

// ---------- harvest ----------

/** Bump when the filters or the row layout change, so the collector recomputes instead of reusing the stored day. */
export const LOGIC_VERSION = "1";
const MARKER = /\[releases ([^\]]+)\]/;

export interface HarvestDeps {
  fetchReleases: typeof fetchReleases;
  download: (url: string) => Promise<Buffer>;
  stored: () => { note: string | null; date: string; rows: DailyRow[] } | null;
  now: () => Date;
}

const realDeps: HarvestDeps = {
  fetchReleases,
  download,
  stored: () => {
    const day = readLatestDay(INFO.id);
    const meta = readMeta(INFO.id);
    return day && meta ? { note: meta.note ?? null, date: day.date, rows: day.rows.map(({ date: _d, ...r }) => r) } : null;
  },
  now: () => new Date(),
};

/** The daily collector: read every release that can hold tenancies of the last 24 months (the zips tw-home-sales reads too), keep the aggregates. */
export async function twRentsHarvest(deps: HarvestDeps = realDeps): Promise<HarvestResult> {
  const today = deps.now().toISOString().slice(0, 10);
  const releases = await deps.fetchReleases();
  const newestEnd = releases.map((r) => r.rentTo).filter((x): x is string => !!x).sort().pop() ?? "none";
  const marker = `${LOGIC_VERSION}:${newestEnd.slice(0, 7)}`;
  const prev = deps.stored();
  if (prev && prev.note && MARKER.exec(prev.note)?.[1] === marker && prev.rows.length) {
    return { date: prev.date, currency: "TWD", unit: "per month", rows: prev.rows, note: prev.note }; // nothing new since the last read
  }
  const needFrom = windowStart(today, 26);
  const chosen = selectReleases(releases, "rents", needFrom);
  if (!chosen.length) throw new SourceError("No MOI releases found that cover the last two years; the download page may have changed.");
  const seen = new Set<string>();
  const stats = newStats();
  const rentals: Rental[] = [];
  for (const rel of chosen) {
    const buf = await deps.download(rel.url);
    const files = cityFiles(listZip(buf), "c");
    if (!files.length) throw new SourceError(`MOI release ${rel.id} holds no rentals files; the download format may have changed.`);
    for (const f of files) {
      rentals.push(...parseRentals(parseTable(decodeCsv(readZipEntry(buf, f.entry))), f.code, { seen, stats, today }));
    }
  }
  if (!rentals.length) throw new SourceError("The MOI releases held no residential rentals to harvest.");
  const newest = rentals.reduce((a, s) => (s.date > a ? s.date : a), "0000-00-00");
  const anchor = anchorOf(newest);
  const rows = rentRows(rentals, anchor);
  const why = Object.entries(stats.dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ");
  return {
    date: anchor,
    currency: "TWD",
    unit: "per month",
    rows,
    note:
      `[releases ${marker}] ${chosen.length} MOI releases (${chosen.map((r) => r.id).join(", ")}), ${stats.rows} rental records read, ${stats.kept} residential lettings kept, newest contract ${newest}; ` +
      `windows of 12 and 24 whole months ending ${anchor}. Left out: ${why}.`,
  };
}

// ---------- the snapshot in the library ----------

let cache: { key: string; snap: Snapshot } | null = null;
/** The newest snapshot in the library, or null if the collector has not stored one yet. */
export function loadSnapshot(): Snapshot | null {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta || !day) return null;
  const key = `${day.date}:${day.rows.length}:${meta.last_ok_at ?? ""}`;
  if (cache?.key === key) return cache.snap;
  const snap = snapshotFromRows(day.date, day.rows);
  cache = { key, snap };
  return snap;
}

// ---------- the request (pure) ----------

export const RENT_TYPES = ["any", "apartment", "house", "room"] as const;

const TYPE_ALIASES: Record<string, RentType> = {
  any: "any", all: "any", home: "any", homes: "any",
  apartment: "apartment", apartments: "apartment", flat: "apartment", flats: "apartment", unit: "apartment", condo: "apartment", 公寓: "apartment", 大樓: "apartment",
  house: "house", houses: "house", 透天厝: "house", 透天: "house",
  room: "room", rooms: "room", "room only": "room", 分租: "room", 雅房: "room",
};

export function normaliseRentType(v: string | undefined): RentType {
  const t = (v ?? "any").trim().toLowerCase().replace(/[_\s]+/g, " ");
  const hit = TYPE_ALIASES[t];
  if (!hit) throw new InputError(`property_type must be one of: ${RENT_TYPES.join(", ")} (room = a room let separately in a shared home).`);
  return hit;
}

const TYPE_WORDS: Record<RentType, string> = {
  any: "homes (whole apartments, houses and self-contained studios)",
  apartment: "apartments (including studios in apartment buildings)",
  house: "houses (透天厝)",
  room: "rooms let separately in a shared home (分租套房 and 分租雅房)",
};

const round0 = (v: number) => Math.round(v);

export interface RentQuery {
  town?: string;
  property_type: RentType;
  bedrooms?: number;
  months?: number;
  baseUrl?: string;
  now?: Date;
}

const METHOD =
  "Median and 10th–90th percentile of the monthly rent of residential tenancies declared in the chosen city, county or district over the last 12 or 24 whole calendar months, " +
  "and the same for the Ministry's unit rent per m². Built by ProofPrice from the Ministry of the Interior's actual price registration open data (rentals), read by our collector from the official releases. " +
  "Social-housing lettings, lettings between relatives and other special relationships, and rooms on joint contracts are excluded.";

const bedWords = (b: Bedrooms) => (b === "all" ? "" : b === "0" ? "studio and open-plan " : b === "5" ? "five-bedroom or larger " : `${b}-bedroom `);

/** The finished answer from a snapshot. Throws InputError for an unknown or ambiguous place; returns no_matches when there are fewer than 5 tenancies. */
export function twRentAnswer(snap: Snapshot, q: RentQuery): PriceAnswer {
  const where = resolveTown(q.town, snap);
  const type = q.property_type;
  if (q.bedrooms !== undefined && type === "room") throw new InputError("bedrooms does not apply to rooms let separately (property_type room); leave it out.");
  const beds: Bedrooms = q.bedrooms === undefined ? "all" : (String(Math.min(Math.max(0, Math.round(q.bedrooms)), 5)) as Bedrooms);
  const windows = q.months !== undefined && q.months > 18 ? [24] : [12, 24];
  let row: DailyRow | undefined;
  let w = windows[windows.length - 1];
  for (const cand of windows) {
    const r = snap.rows.get(`${where.area}\u0000${rentItemKey(type, beds, "rent", cand)}`);
    if (r && r.n >= MIN_PUBLISH) {
      row = r;
      w = cand;
      break;
    }
  }
  const typeWords = `${bedWords(beds)}${TYPE_WORDS[type]}`;
  if (!row) {
    const none = buildAnswer({
      source: INFO,
      query: { country: "TW", town: where.label, property_type: type, ...(q.bedrooms !== undefined ? { bedrooms: q.bedrooms } : {}) },
      summary: null,
      currency: "TWD",
      unit: "per month",
      period: { from: null, to: null },
      method: METHOD,
      describe: () => "",
      baseUrl: q.baseUrl,
    });
    return {
      ...none,
      summary: `Fewer than ${MIN_PUBLISH} qualifying tenancies of ${typeWords} in ${where.label} in the last ${windows[windows.length - 1]} months (to ${snap.date}) in the Ministry of the Interior's register, so no rent range is published. Try the city or county, or leave bedrooms out.`,
    };
  }
  const m2Row = beds === "all" ? snap.rows.get(`${where.area}\u0000${rentItemKey(type, "all", "m2", w)}`) : undefined;
  const m2 = m2Row && m2Row.n >= MIN_PUBLISH ? m2Row : null;
  const from = windowStart(snap.date, w);
  const money = (v: number) => fmtMoney(v, "TWD");

  const cmp = (area: string, name: string) => {
    if (area === where.area) return null;
    const r = snap.rows.get(`${area}\u0000${rentItemKey(type, beds, "rent", w)}`);
    return r && r.n >= MIN_PUBLISH
      ? { place: name, median_monthly_rent: r.median, tenancies: r.n, this_place_vs_it_percent: Math.round(((row!.median - r.median) / r.median) * 1000) / 10 }
      : null;
  };
  const cityCmp = where.city && where.area.includes("|") ? cmp(where.city.code, `${where.city.en} (${where.city.zh})`) : null;
  const taiwanCmp = cmp(NATIONAL_AREA, "Taiwan");

  const extra: Record<string, unknown> = {
    place: { name: where.label, level: where.national ? "country" : where.area.includes("|") ? "district" : "city or county", area_key: where.area },
    property_type_published: typeWords,
    bedrooms: type === "room" ? null : beds === "all" ? "all sizes" : beds === "5" ? "5 or more" : Number(beds),
    window_months: w,
    windows_tried: windows,
    snapshot_date: snap.date,
    rent_per_m2_per_month: m2
      ? { currency: "TWD", unit: "per m² per month, registered building area (parking excluded)", median: m2.median, typical_low: m2.low, typical_high: m2.high, tenancies: m2.n }
      : null,
    rent_per_ping_per_month: m2
      ? { currency: "TWD", unit: "per ping per month (1 ping = 3.3058 m²)", median: round0(m2.median * PING_M2), typical_low: round0(m2.low * PING_M2), typical_high: round0(m2.high * PING_M2), tenancies: m2.n }
      : null,
    city_comparison: cityCmp,
    taiwan_comparison: taiwanCmp,
    dataset: { url: PORTAL_URL, licence_url: INFO.licence_url },
  };
  const ans = buildAnswer({
    source: INFO,
    query: { country: "TW", town: where.label, property_type: type, ...(q.bedrooms !== undefined ? { bedrooms: q.bedrooms } : {}), months: w },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "TWD",
    unit: "per month",
    period: { from, to: snap.date },
    method: METHOD,
    baseUrl: q.baseUrl,
    extra,
    describe: (x) =>
      `Tenancies of ${typeWords} declared in ${where.label} over the last ${w} months had a median monthly rent of ${money(x.median)}; typical range ${money(x.low)}–${money(x.high)}.` +
      (m2 ? ` Per square metre of building area: median ${money(m2.median)} a month (about ${money(round0(m2.median * PING_M2))} per ping).` : "") +
      (taiwanCmp ? ` The Taiwan median for the same period is ${money(taiwanCmp.median_monthly_rent)}.` : ""),
  });
  const now = q.now ?? new Date();
  const ageDays = Math.round((now.getTime() - Date.parse(snap.date + "T00:00:00Z")) / 86400000);
  if (ageDays > 120) {
    const note = `The newest month in this range ended ${snap.date}, ${ageDays} days ago; the Ministry normally publishes every 10 days, so our copy is behind.`;
    ans.extra = { ...(ans.extra ?? {}), data_age_note: note };
    ans.summary = `${ans.summary} Note: ${note}`;
  }
  return ans;
}

export async function twRents(
  input: { town?: string; postcode?: string; property_type?: string; house_type?: string; bedrooms?: number; months?: number; baseUrl?: string },
  o: { snapshot?: Snapshot | null; now?: Date } = {},
): Promise<PriceAnswer> {
  const type = normaliseRentType(input.property_type);
  if (input.house_type) throw new InputError("house_type (detached / semi-detached / terraced) is not available for Taiwan; use property_type house for 透天厝.");
  if (input.postcode && !input.town) {
    throw new InputError("The Taiwanese register has no postcodes. Give the city, county or district as town, for example 'Taipei' or \"Da'an, Taipei\".");
  }
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("Not yet available: ProofPrice collects Taiwan's actual price registration daily; figures appear after the next collection.");
  return twRentAnswer(snap, { town: input.town, property_type: type, bedrooms: input.bedrooms, months: input.months, baseUrl: input.baseUrl, now: o.now });
}
