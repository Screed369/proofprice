// Taiwan home sales from the Ministry of the Interior's "actual price registration" open data (不動產成交案件實際資訊).
// Every property sale is registered with its price within 30 days of the title transfer; the MOI publishes the register every
// 10 days (the 1st, 11th and 21st) and as quarterly files, as one CSV per city or county. The files hold addresses, so they are
// bulk files: the daily collector (harvest) reads the releases of the last two years once, keeps only aggregates per
// city / county, district and building type in the price library, and requests are answered from there.
// Formats checked live on 2026-10-14 (see moi.ts for the URLs and source.test.ts for real rows).

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { libraryRoot, readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import {
  CITY_BY_CODE, PORTAL_URL, anchorOf, cityFiles, decodeCsv, download, fetchReleases, isResidentialUse, listZip, parseTable, readZipEntry, rocToIso,
  selectReleases, windowStart, type Table,
} from "./moi";
import { districtList, districtKey, findPlace, indexWithLibrary, placeLabel, type City, type District, type Place } from "./places";

export const INFO: SourceInfo = {
  id: "tw-home-sales",
  country: "TW (Taiwan)",
  category: "home sales (actual price registration)",
  name: "Actual price registration of real-estate transactions (不動產成交案件實際資訊), sales",
  publisher: "Ministry of the Interior (內政部), Taiwan",
  what_is_recorded:
    "Real-estate sales registered in Taiwan: the date of the deal, the district, what was sold (land and building, with or without a parking space), the building type, the total price and the unit price per m², with a remark field for special circumstances. Addresses are in the files but are never stored or shown.",
  price_type: "transaction",
  freshness:
    "The Ministry publishes every 10 days (the 1st, 11th and 21st); a sale appears one to two months after the deal. Our collector re-reads the releases daily, and answers cover whole calendar months ending at least 30 days before the newest deal",
  licence:
    'Open Government Data License, version 1.0 (政府資料開放授權條款－第1版), https://data.gov.tw/license. Clause 2.1: "The Data Providing Organization grants User a perpetual, worldwide, non-exclusive, irrevocable, royalty-free copyright license to reproduce, distribute, publicly transmit, publicly broadcast, publicly recite, publicly present, publicly perform, compile, adapt to the Open Data provided for any purpose, including but not limited to making all kinds of Derivative Works either as products or services." ' +
    'Clause 3.2: "When User makes use of the Open Data and its Derivative Work, he/she must make an explicit notice of statement as attribution requested in the Exhibit below by the Data Providing Organization." Clause 4.2: "The License is compatible with the Creative Commons Attribution License 4.0 International." ' +
    'The portal page itself (https://plvr.land.moi.gov.tw/DownloadOpenData) says its free open-data download is licensed as a "非專屬之私法授權" (non-exclusive private-law licence) and its 授權條款 button opens the Open Government Data License at data.gov.tw; that is the licence applied here. No key, login or sign-up is needed to download.',
  licence_url: "https://data.gov.tw/license",
  attribution:
    "Ministry of the Interior (內政部), Taiwan, 不動產成交案件實際資訊 (Actual Price Registration of Real Estate Transactions), open data, releases of 2024 to 2026. " +
    "The Open Data is made available to the public under the Open Government Data License, User can make use of it when complying to the condition and obligation of its terms. Open Government Data License: https://data.gov.tw/license. " +
    "Medians and ranges are calculated by ProofPrice from the registered prices; this is not an endorsement by the Ministry of the Interior.",
  homepage: PORTAL_URL,
  limits:
    "Aggregates by city or county, district (鄉鎮市區) and building type; never addresses, parcel numbers or serial numbers. These are sales of completed homes (presales are not included, see below): residential sales of land with building, with or without a parking space, whose main use is residential (住家用, also written 住宅, 集合住宅 or 公寓): 住宅大樓 high-rise with lift (11+ floors), 華廈 mid-rise with lift (10 floors or fewer), 公寓 walk-up without lift (5 floors or fewer), 透天厝 house (and 套房 studio, counted in 'apartment'). " +
    "New homes sold from plan and deals registered as separate land and building cases carry the remark 預售屋、或土地及建物分件登記案件 (about four in ten residential records in the register) and are left out: the Ministry publishes presale prices separately, at the contract date, and a presale registered at completion carries a contract date long before. " +
    "Land-only, parking-only, commercial, mixed-use (住商用), office, industrial and farm sales are also left out, as are records whose remark (備註) flags a relatives/employees/co-owners/special-relationship deal, a government purchase or tender, an urgent sale, a debt-related sale, an unfinished shell (毛胚屋), a defective property, leasehold-right housing (地上權), an odd lot, redevelopment value, or an unclaimed-estate auction. " +
    "Prices are those declared when the deal is registered. The price is the total price registered, which includes a parking space bought with the home (the register does not always itemise it). The price per m² is the Ministry's unit price, which excludes parking and counts the whole registered building area including shared areas, so it is lower than the indoor price per m² that developers quote. A deal registered twice (same record number, or same address, day, price and area) counts once. 1 ping = 3.3058 m². " +
    "Windows are whole calendar months (12 or 24) ending at the last month that is at least 30 days older than the newest deal in the register, because the newest weeks are always thin. A district or type with fewer than 5 qualifying sales in the window gets no figure.",
};

// ---------- the register (pure) ----------

export type BuildingType = "high-rise" | "mid-rise" | "walk-up" | "house" | "studio";

/** Our key for the register's building type (建物型態), or null for anything that is not a home (shop, office, factory, farmhouse, other). */
export function buildingTypeOf(zh: string): BuildingType | null {
  if (zh.startsWith("住宅大樓")) return "high-rise";
  if (zh.startsWith("華廈")) return "mid-rise";
  if (zh.startsWith("公寓")) return "walk-up";
  if (zh.startsWith("透天厝")) return "house";
  if (zh.startsWith("套房")) return "studio";
  return null;
}

/** The property_type values a sale of each building type is counted under (always "any"). */
export function itemTypesOf(t: BuildingType): string[] {
  return t === "house" ? ["any", "house"] : t === "studio" ? ["any", "apartment"] : ["any", "apartment", t];
}

// Remark (備註) phrases that mark a deal as not an ordinary market sale of the whole home. Matched as substrings.
export const REMARK_RELATIVES = ["特殊關係"]; // 親友、員工、共有人或其他特殊關係間之交易
export const REMARK_PRESALE = ["預售屋", "分件登記"]; // 預售屋、或土地及建物分件登記案件
export const REMARK_OTHER = [
  "協議價購", "政府機關", "標讓售", "急買急賣", "債權債務", "毛胚", "瑕疵", "地上權", "重建或重劃", "都更", "畸零地", "民情風俗",
  "拍賣", "法拍", "地清", "未辦繼承", "僅車位", "公共設施保留地", "農作物", "農業設施", "水利地",
];

export interface Sale {
  city: string; // file letter, "A" = 臺北市
  district: string; // 大安區
  date: string; // ISO
  type: BuildingType;
  total: number; // TWD, the registered total price (includes a parking space bought with the home)
  unit: number | null; // TWD per m², the Ministry's unit price (parking excluded)
}

export interface ParseStats {
  rows: number;
  kept: number;
  dropped: Record<string, number>;
}

export const newStats = (): ParseStats => ({ rows: 0, kept: 0, dropped: {} });
const drop = (s: ParseStats | undefined, why: string) => {
  if (s) s.dropped[why] = (s.dropped[why] ?? 0) + 1;
};

const SALE_OBJECTS = new Set(["房地(土地+建物)", "房地(土地+建物)+車位"]);
const MIN_TOTAL = 300_000;
const MAX_TOTAL = 3_000_000_000;
const MIN_UNIT = 3_000;
const MAX_UNIT = 3_000_000;
const numOf = (s: string | undefined) => {
  const v = Number((s ?? "").trim());
  return Number.isFinite(v) ? v : NaN;
};

/**
 * Residential market sales from one city's sales file (<letter>_lvr_land_a.csv). Columns are found by their Chinese names.
 * `seen` holds record numbers (編號) already read, so a record that appears in two releases counts once. `today` (ISO) drops dates
 * in the future, which are typing errors.
 */
export function parseSales(t: Table, city: string, o: { seen?: Set<string>; stats?: ParseStats; today?: string } = {}): Sale[] {
  const need = ["鄉鎮市區", "交易標的", "交易年月日", "建物型態", "主要用途", "總價元", "單價元平方公尺", "備註"];
  for (const c of need) if (t.col(c) < 0) throw new SourceError(`The MOI sales file has a new layout (no ${c} column); this source needs updating.`);
  const [iDist, iObj, iDate, iType, iUse, iTotal, iUnit, iNote] = need.map((c) => t.col(c));
  const iSerial = t.col("編號");
  const iArea = t.col("建物移轉總面積平方公尺");
  const iParkArea = t.col("車位移轉總面積平方公尺");
  const iParkPrice = t.col("車位總價元");
  const iAddr = t.col("土地位置建物門牌");
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const out: Sale[] = [];
  for (const r of t.rows) {
    o.stats && o.stats.rows++;
    if (!SALE_OBJECTS.has(r[iObj] ?? "")) { drop(o.stats, "not a land-and-building sale"); continue; }
    const type = buildingTypeOf(r[iType] ?? "");
    if (!type) { drop(o.stats, "not a home building type"); continue; }
    if (!isResidentialUse(r[iUse])) { drop(o.stats, "main use not residential"); continue; }
    const note = r[iNote] ?? "";
    if (REMARK_RELATIVES.some((k) => note.includes(k))) { drop(o.stats, "special relationship"); continue; }
    if (REMARK_PRESALE.some((k) => note.includes(k))) { drop(o.stats, "presale or separate registration"); continue; }
    if (REMARK_OTHER.some((k) => note.includes(k))) { drop(o.stats, "other non-market remark"); continue; }
    const date = rocToIso(r[iDate]);
    if (!date || date > today) { drop(o.stats, "bad date"); continue; }
    // The price paid: the registered total, which includes a parking space bought with the home (its price is not always itemised).
    const total = numOf(r[iTotal]);
    if (!(total >= MIN_TOTAL && total <= MAX_TOTAL)) { drop(o.stats, "bad price"); continue; }
    // The same deal can be in two releases and can be registered more than once: by record number and by place + day + price.
    const serial = iSerial >= 0 ? (r[iSerial] ?? "").trim() : "";
    const address = iAddr >= 0 ? (r[iAddr] ?? "").trim() : "";
    if (o.seen) {
      const k1 = serial ? "n:" + serial : "";
      const k2 = address ? `a:${address}|${r[iDate]}|${total}|${iArea >= 0 ? r[iArea] : ""}` : "";
      if ((k1 && o.seen.has(k1)) || (k2 && o.seen.has(k2))) { drop(o.stats, "duplicate record"); continue; }
      if (k1) o.seen.add(k1);
      if (k2) o.seen.add(k2);
    }
    // Unit price: the Ministry's own (parking excluded); if it is missing, the price less parking over the area less parking.
    let unit = numOf(r[iUnit]);
    if (!(unit > 0) && iArea >= 0) {
      const area = numOf(r[iArea]) - (iParkArea >= 0 ? numOf(r[iParkArea]) || 0 : 0);
      const price = total - (iParkPrice >= 0 ? numOf(r[iParkPrice]) || 0 : 0);
      unit = area > 0 ? Math.round(price / area) : NaN;
    }
    o.stats && o.stats.kept++;
    out.push({ city, district: (r[iDist] ?? "").trim(), date, type, total, unit: unit >= MIN_UNIT && unit <= MAX_UNIT ? unit : null });
  }
  return out;
}

// ---------- aggregation (pure) ----------

export const WINDOWS = [12, 24] as const;
export type Measure = "total" | "m2";
export const itemKey = (type: string, measure: Measure, months: number) => `${type}:${measure}:${months}m`;
export const NATIONAL_AREA = "ALL";

/**
 * Library rows for sales and the date they are stamped with: windows of 12 and 24 whole calendar months ending at `anchor`, per
 * district, per city or county and for Taiwan, per property type ("any", "apartment", "house", "high-rise", "mid-rise", "walk-up")
 * and per measure ("total" price of the home, "m2" price per square metre). Only sales dated inside a window count.
 */
export function salesRows(sales: Sale[], anchor: string): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (area: string, item: string, v: number) => {
    const k = `${area}\u0000${item}`;
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  const starts = WINDOWS.map((w) => ({ w, from: windowStart(anchor, w) }));
  for (const s of sales) {
    if (s.date > anchor) continue;
    const areas = [districtKey({ code: s.city } as City, { zh: s.district } as District), s.city, NATIONAL_AREA];
    for (const { w, from } of starts) {
      if (s.date < from) continue;
      for (const t of itemTypesOf(s.type)) {
        for (const a of areas) {
          add(a, itemKey(t, "total", w), s.total);
          if (s.unit !== null) add(a, itemKey(t, "m2", w), s.unit);
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
  /** The stored note and rows of the newest day, to reuse when the Ministry has published nothing new. */
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

/** The daily collector: read every release that can hold deals of the last 24 months (about 150 MB), keep the aggregates. */
export async function twHomeSalesHarvest(deps: HarvestDeps = realDeps): Promise<HarvestResult> {
  const today = deps.now().toISOString().slice(0, 10);
  const releases = await deps.fetchReleases();
  const newestEnd = releases.map((r) => r.salesTo).filter((x): x is string => !!x).sort().pop() ?? "none";
  // Recompute once per calendar month of the register (the windows end at a month end), not at every 10-day release: the
  // ~10 releases of 150 MB are read once a month and the stored library file changes once a month.
  const marker = `${LOGIC_VERSION}:${newestEnd.slice(0, 7)}`;
  const prev = deps.stored();
  if (prev && prev.note && MARKER.exec(prev.note)?.[1] === marker && prev.rows.length) {
    return { date: prev.date, currency: "TWD", unit: "per home", rows: prev.rows, note: prev.note }; // nothing new since the last read
  }
  const needFrom = windowStart(today, 26);
  const chosen = selectReleases(releases, "sales", needFrom);
  if (!chosen.length) throw new SourceError("No MOI releases found that cover the last two years; the download page may have changed.");
  const seen = new Set<string>();
  const stats = newStats();
  const sales: Sale[] = [];
  for (const rel of chosen) {
    const buf = await deps.download(rel.url);
    const files = cityFiles(listZip(buf), "a");
    if (!files.length) throw new SourceError(`MOI release ${rel.id} holds no sales files; the download format may have changed.`);
    for (const f of files) {
      sales.push(...parseSales(parseTable(decodeCsv(readZipEntry(buf, f.entry))), f.code, { seen, stats, today }));
    }
  }
  if (!sales.length) throw new SourceError("The MOI releases held no residential sales to harvest.");
  const newest = sales.reduce((a, s) => (s.date > a ? s.date : a), "0000-00-00");
  const anchor = anchorOf(newest);
  const rows = salesRows(sales, anchor);
  const why = Object.entries(stats.dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ");
  return {
    date: anchor,
    currency: "TWD",
    unit: "per home",
    rows,
    note:
      `[releases ${marker}] ${chosen.length} MOI releases (${chosen.map((r) => r.id).join(", ")}), ${stats.rows} sale records read, ${stats.kept} residential market sales kept, newest deal ${newest}; ` +
      `windows of 12 and 24 whole months ending ${anchor}. Left out: ${why}.`,
  };
}

// ---------- the snapshot in the library (pure) ----------

export interface Snapshot {
  date: string;
  rows: Map<string, DailyRow>; // key: area \u0000 item
  areas: string[];
  cities: City[];
}

export function snapshotFromRows(date: string, rows: Pick<LibraryRow, "area" | "item" | "n" | "median" | "low" | "high" | "min" | "max">[]): Snapshot {
  const map = new Map<string, DailyRow>();
  const areas = new Set<string>();
  for (const r of rows) {
    map.set(`${r.area}\u0000${r.item}`, { area: r.area, item: r.item, n: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max });
    areas.add(r.area);
  }
  return { date, rows: map, areas: [...areas], cities: indexWithLibrary([...areas]) };
}

let cache: { key: string; snap: Snapshot } | null = null;
/** The newest snapshot in the library, or null if the collector has not stored one yet. */
export function loadSnapshot(): Snapshot | null {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta || !day) return null;
  const key = `${libraryRoot()}:${day.date}:${day.rows.length}:${meta.last_ok_at ?? ""}`;
  if (cache?.key === key) return cache.snap;
  const snap = snapshotFromRows(day.date, day.rows);
  cache = { key, snap };
  return snap;
}

// ---------- the request (pure) ----------

export const TW_TYPES = ["any", "apartment", "house", "high-rise", "mid-rise", "walk-up"] as const;
export type TwType = (typeof TW_TYPES)[number];

const TYPE_ALIASES: Record<string, TwType> = {
  any: "any", all: "any", home: "any", homes: "any",
  apartment: "apartment", apartments: "apartment", flat: "apartment", flats: "apartment", condo: "apartment", condominium: "apartment", unit: "apartment",
  "flat-maisonette": "apartment", studio: "apartment",
  house: "house", houses: "house", townhouse: "house", detached: "house", terraced: "house", "semi-detached": "house", 透天厝: "house", 透天: "house",
  "high-rise": "high-rise", highrise: "high-rise", tower: "high-rise", "apartment-building": "high-rise", 住宅大樓: "high-rise", 大樓: "high-rise",
  "mid-rise": "mid-rise", midrise: "mid-rise", elevator: "mid-rise", 華廈: "mid-rise",
  "walk-up": "walk-up", walkup: "walk-up", 公寓: "walk-up",
};

export function normaliseType(v: string | undefined): TwType {
  const t = (v ?? "any").trim().toLowerCase().replace(/[_\s]+/g, "-");
  const hit = TYPE_ALIASES[t];
  if (!hit) throw new InputError(`property_type must be one of: ${TW_TYPES.join(", ")} (apartment = high-rise, mid-rise and walk-up together; house = 透天厝).`);
  return hit;
}

const TYPE_WORDS: Record<TwType, string> = {
  any: "homes (apartments and houses)",
  apartment: "apartments (high-rise, mid-rise and walk-up)",
  house: "houses (透天厝)",
  "high-rise": "high-rise apartments (住宅大樓, 11 floors or more with a lift)",
  "mid-rise": "mid-rise apartments (華廈, up to 10 floors with a lift)",
  "walk-up": "walk-up apartments (公寓, up to 5 floors, no lift)",
};

export const PING_M2 = 3.3058;
const round0 = (v: number) => Math.round(v);

export interface TwQuery {
  town?: string;
  property_type: TwType;
  months?: number;
  baseUrl?: string;
  now?: Date;
}

const METHOD =
  "Median and 10th–90th percentile of the registered total price of residential market sales (land with building, including any parking space bought with it) in the chosen city, county or district over the last 12 or 24 whole calendar months, " +
  "and the same for the Ministry's unit price per m². Built by ProofPrice from the Ministry of the Interior's actual price registration open data, read by our collector from the official releases. " +
  "Sales between relatives and other special relationships, presales and separately registered land and building cases, government deals, urgent, debt-related, shell, defective, leasehold-right and other non-market remarks are excluded.";

function noMatch(q: TwQuery, label: string, summary: string): PriceAnswer {
  const none = buildAnswer({
    source: INFO,
    query: { country: "TW", town: label, property_type: q.property_type },
    summary: null,
    currency: "TWD",
    unit: "per home",
    period: { from: null, to: null },
    method: METHOD,
    describe: () => "",
    baseUrl: q.baseUrl,
  });
  return { ...none, summary };
}

function pickWindows(months?: number): number[] {
  return months !== undefined && months > 18 ? [24] : [12, 24];
}

const placeOption = (p: Place) => p.label;

/** Resolve the town text to a place, or throw InputError with the options. */
export function resolveTown(town: string | undefined, snap: Snapshot): { area: string; label: string; city: City | null; national: boolean } {
  const f = findPlace(town ?? "", snap.cities);
  if (f.kind === "national") return { area: NATIONAL_AREA, label: "Taiwan", city: null, national: true };
  if (f.kind === "found") return { area: f.place.key, label: f.place.label, city: f.place.city, national: false };
  if (f.kind === "ambiguous") {
    throw new InputError(`'${town}' names several places in Taiwan: ${f.options.slice(0, 8).map(placeOption).join("; ")}. Give the city too, for example "Da'an, Taipei" or "臺北市大安區".`);
  }
  if (f.kind === "city_only_district_missing") {
    throw new InputError(`No district called '${f.asked}' in ${f.city.en} (${f.city.zh}). Its districts are: ${districtList(f.city)}.`);
  }
  throw new InputError(
    `Unknown place '${town}'. Use a city or county ('Taipei', 'New Taipei', 'Taichung', 'Kaohsiung', 'Hsinchu County', '臺北市') or a district with its city ("Da'an, Taipei", "臺北市大安區"), or leave town out for all of Taiwan.`,
  );
}

/** The finished answer from a snapshot. Throws InputError for an unknown or ambiguous place; returns no_matches when there are fewer than 5 sales. */
export function twAnswer(snap: Snapshot, q: TwQuery): PriceAnswer {
  const where = resolveTown(q.town, snap);
  const type = q.property_type;
  const windows = pickWindows(q.months);
  let totalRow: DailyRow | undefined;
  let w = windows[windows.length - 1];
  for (const cand of windows) {
    const r = snap.rows.get(`${where.area}\u0000${itemKey(type, "total", cand)}`);
    if (r && r.n >= MIN_PUBLISH) {
      totalRow = r;
      w = cand;
      break;
    }
  }
  const typeWords = TYPE_WORDS[type];
  if (!totalRow) {
    return noMatch(
      q,
      where.label,
      `Fewer than ${MIN_PUBLISH} qualifying sales of ${typeWords} in ${where.label} in the last ${windows[windows.length - 1]} months (to ${snap.date}) in the Ministry of the Interior's register, so no price range is published. Try the city or county, or property_type 'any'.`,
    );
  }
  const m2Row = snap.rows.get(`${where.area}\u0000${itemKey(type, "m2", w)}`);
  const m2 = m2Row && m2Row.n >= MIN_PUBLISH ? m2Row : null;
  const from = windowStart(snap.date, w);
  const ping = (v: number) => round0(v * PING_M2);
  const money = (v: number) => fmtMoney(v, "TWD");

  // The city or county and Taiwan as a comparison for a district (or Taiwan for a city).
  const cmp = (area: string, name: string) => {
    if (area === where.area) return null;
    const r = snap.rows.get(`${area}\u0000${itemKey(type, "total", w)}`);
    const r2 = snap.rows.get(`${area}\u0000${itemKey(type, "m2", w)}`);
    return r && r.n >= MIN_PUBLISH
      ? {
          place: name,
          median_total_price: r.median,
          sales: r.n,
          median_price_per_m2: r2 && r2.n >= MIN_PUBLISH ? r2.median : null,
          this_place_vs_it_percent: Math.round(((totalRow!.median - r.median) / r.median) * 1000) / 10,
        }
      : null;
  };
  const cityCmp = where.city && where.area.includes("|") ? cmp(where.city.code, `${where.city.en} (${where.city.zh})`) : null;
  const taiwanCmp = cmp(NATIONAL_AREA, "Taiwan");

  const extra: Record<string, unknown> = {
    place: { name: where.label, level: where.national ? "country" : where.area.includes("|") ? "district" : "city or county", area_key: where.area },
    property_type_published: typeWords,
    window_months: w,
    windows_tried: windows,
    snapshot_date: snap.date,
    price_per_m2: m2
      ? { currency: "TWD", unit: "per m² of registered building area (parking excluded)", median: m2.median, typical_low: m2.low, typical_high: m2.high, min: m2.min, max: m2.max, sales: m2.n }
      : null,
    price_per_ping: m2
      ? { currency: "TWD", unit: "per ping (1 ping = 3.3058 m²)", median: ping(m2.median), typical_low: ping(m2.low), typical_high: ping(m2.high), sales: m2.n }
      : null,
    city_comparison: cityCmp,
    taiwan_comparison: taiwanCmp,
    dataset: { url: PORTAL_URL, licence_url: INFO.licence_url },
  };
  const ans = buildAnswer({
    source: INFO,
    query: { country: "TW", town: where.label, property_type: type, months: w },
    summary: { count: totalRow.n, median: totalRow.median, low: totalRow.low, high: totalRow.high, min: totalRow.min, max: totalRow.max },
    currency: "TWD",
    unit: "per home",
    period: { from, to: snap.date },
    method: METHOD,
    baseUrl: q.baseUrl,
    extra,
    describe: (x) =>
      `Residential market sales (presales excluded) of ${typeWords} in ${where.label} over the last ${w} months had a median registered price of ${money(x.median)}; typical range ${money(x.low)}–${money(x.high)}.` +
      (m2 ? ` Per square metre of building area: median ${money(m2.median)} (about ${money(ping(m2.median))} per ping), typical range ${money(m2.low)}–${money(m2.high)}.` : "") +
      (taiwanCmp ? ` The Taiwan median for the same period is ${money(taiwanCmp.median_total_price)}.` : ""),
  });
  // Old data is flagged plainly.
  const now = q.now ?? new Date();
  const ageDays = Math.round((now.getTime() - Date.parse(snap.date + "T00:00:00Z")) / 86400000);
  if (ageDays > 120) {
    const note = `The newest month in this range ended ${snap.date}, ${ageDays} days ago; the Ministry normally publishes every 10 days, so our copy is behind.`;
    ans.extra = { ...(ans.extra ?? {}), data_age_note: note };
    ans.summary = `${ans.summary} Note: ${note}`;
  }
  return ans;
}

export async function twHomeSales(
  input: { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string },
  o: { snapshot?: Snapshot | null; now?: Date } = {},
): Promise<PriceAnswer> {
  const type = normaliseType(input.property_type);
  if (input.postcode && !input.town) {
    throw new InputError("The Taiwanese register has no postcodes. Give the city, county or district as town, for example 'Taipei' or \"Da'an, Taipei\".");
  }
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("Not yet available: ProofPrice collects Taiwan's actual price registration daily; figures appear after the next collection.");
  return twAnswer(snap, { town: input.town, property_type: type, months: input.months, baseUrl: input.baseUrl, now: o.now });
}

export { CITY_BY_CODE, placeLabel };
