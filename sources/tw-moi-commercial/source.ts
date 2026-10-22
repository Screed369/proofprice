// Taiwan commercial property and land sales from the Ministry of the Interior's "actual price registration" open data
// (不動產成交案件實際資訊), the same register tw-home-sales reads. Shops, offices, factories and building land are sold
// like homes and registered with their price within 30 days; the files hold addresses, so the daily collector (harvest)
// reads the releases once, keeps only aggregates per city or county, district and kind in the price library, and requests
// are answered from there. Download, zip and CSV helpers are shared with tw-home-sales (../tw-home-sales/moi.ts).
// Formats checked live 2026-10-14 (see fixtures/a_lvr_land_a.csv, a real slice of the Taipei sales file).

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { libraryRoot, readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import {
  PORTAL_URL, anchorOf, cityFiles, decodeCsv, download, fetchReleases, listZip, parseTable, readZipEntry, rocToIso, selectReleases, windowStart, type Table,
} from "../tw-home-sales/moi";
import { districtKey, findPlace, districtList, indexWithLibrary, placeLabel, type City, type District } from "../tw-home-sales/places";

export const INFO: SourceInfo = {
  id: "tw-moi-commercial",
  country: "TW (Taiwan)",
  category: "commercial property and land (actual price registration)",
  name: "Actual price registration of real-estate transactions (不動產成交案件實際資訊), commercial premises and land",
  publisher: "Ministry of the Interior (內政部), Taiwan",
  what_is_recorded:
    "Real-estate sales registered in Taiwan: the date of the deal, the district, what was sold (land only, or land and building), the main use of the building, the total price and the unit price per m², with a remark field for special circumstances. Addresses are in the files but are never stored or shown.",
  price_type: "transaction",
  freshness:
    "Every 10 days. A sale appears one to two months after the deal; answers cover whole calendar months ending at least 30 days before the newest deal",
  licence:
    'Open Government Data License, version 1.0 (政府資料開放授權條款－第1版), https://data.gov.tw/license. Clause 2.1: "The Data Providing Organization grants User a perpetual, worldwide, non-exclusive, irrevocable, royalty-free copyright license to reproduce, distribute, publicly transmit, publicly broadcast, publicly recite, publicly present, publicly perform, compile, adapt to the Open Data provided for any purpose, including but not limited to making all kinds of Derivative Works either as products or services." ' +
    'Clause 3.2 requires an explicit attribution statement; clause 4.2: "The License is compatible with the Creative Commons Attribution License 4.0 International." ' +
    'The portal page (https://plvr.land.moi.gov.tw/DownloadOpenData) calls its free open-data download a "非專屬之私法授權" (non-exclusive private-law licence) whose 授權條款 button opens the Open Government Data License at data.gov.tw; that is the licence applied here, as for tw-home-sales and tw-rents. No key, login or sign-up is needed to download. Licence checked: 2026-10-21 | commercial: unclear (private-law wording on the portal), free tier only until confirmed.',
  licence_url: "https://data.gov.tw/license",
  attribution:
    "Ministry of the Interior (內政部), Taiwan, 不動產成交案件實際資訊 (Actual Price Registration of Real Estate Transactions), open data, releases of 2024 to 2026. " +
    "The Open Data is made available to the public under the Open Government Data License: https://data.gov.tw/license. " +
    "Medians and ranges are calculated by ProofPrice from the registered prices; this is not an endorsement by the Ministry of the Interior.",
  homepage: PORTAL_URL,
  limits:
    "Aggregates by city or county, district (鄉鎮市區) and kind; never addresses, parcel numbers or serial numbers. 'commercial' = sales of land with building (with or without a parking space) whose main use is commercial, office, industrial or industrial-commercial (商業用, 辦公用, 工業用, 工商用); homes and mixed residential-commercial use (住商用) are left out. " +
    "'land' = sales of land without a building (交易標的 土地) in an urban residential, commercial or industrial zone, or on non-urban building land (建築用地); farmland, forest, protected, road, park and other public-facility land are left out. " +
    "Records whose remark (備註) flags a relatives/employees/co-owners/special-relationship deal, a government purchase or tender, an urgent sale, a debt-related sale, an unfinished shell, a defective property, leasehold-right property, an odd lot, redevelopment value, an auction, or a presale are left out. " +
    "The price per m² is the Ministry's unit price: for commercial premises per m² of registered building area including shared areas and excluding parking, for land per m² of land. A deal registered twice counts once. " +
    "Windows are whole calendar months (12 or 24) ending at the last month that is at least 30 days older than the newest deal in the register. A district or kind with fewer than 5 qualifying sales in the window gets no figure.",
};

// ---------- the register (pure) ----------

export type Kind = "commercial" | "land";

export interface CSale {
  city: string; // file letter, "A" = 臺北市
  district: string;
  date: string; // ISO
  kind: Kind;
  total: number; // TWD, registered total price (land sales: price of the plot or share sold)
  unit: number | null; // TWD per m² (see limits)
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

const BUILDING_OBJECTS = new Set(["房地(土地+建物)", "房地(土地+建物)+車位"]);
const LAND_OBJECT = "土地";
/** Remark (備註) phrases that mark a deal as not an ordinary market sale. Matched as substrings. */
export const REMARKS_EXCLUDED = [
  "特殊關係", "預售屋", "分件登記", "協議價購", "政府機關", "標讓售", "急買急賣", "債權債務", "毛胚", "瑕疵", "地上權", "重建或重劃", "都更",
  "畸零地", "民情風俗", "拍賣", "法拍", "地清", "未辦繼承", "僅車位", "公共設施保留地", "農作物", "農業設施", "水利地",
];

/** Is the main use (主要用途) commercial, office or industrial (and not mixed with housing)? */
export function isCommercialUse(use: string | undefined): boolean {
  const u = (use ?? "").trim();
  if (!u || /[住農]/.test(u)) return false;
  return /商業|辦公|工業|工商|店舖|店鋪|廠/.test(u);
}

/** Is a land-only sale on building land? Urban zone residential/commercial/industrial, or non-urban building land (建築用地). */
export function isBuildingLand(urbanZone: string | undefined, nonUrbanZone: string | undefined, nonUrbanUse: string | undefined): boolean {
  const u = (urbanZone ?? "").trim();
  if (u) {
    if (/農業區|保護區|公共設施|道路|公園|學校|綠地|河川|水利|保留|風景|古蹟|墓|軍事|森林/.test(u)) return false;
    return /住宅區|商業區|工業區|產業|倉儲|住商|工商/.test(u);
  }
  const z = `${nonUrbanZone ?? ""}${nonUrbanUse ?? ""}`;
  return /建築用地/.test(z) && !/農牧|林業|養殖|水利|國土保安|生態/.test(z);
}

const MIN_TOTAL = 300_000;
const MAX_TOTAL = 20_000_000_000;
const LIMITS = { commercialUnit: [3_000, 3_000_000], landUnit: [500, 5_000_000] } as const;
const numOf = (s: string | undefined) => {
  const v = Number((s ?? "").trim());
  return Number.isFinite(v) ? v : NaN;
};

/**
 * Commercial and building-land market sales from one city's sales file (<letter>_lvr_land_a.csv). Columns are found by their
 * Chinese names. `seen` holds record numbers already read, so a record in two releases counts once. `today` (ISO) drops future dates.
 */
export function parseCommercialSales(t: Table, city: string, o: { seen?: Set<string>; stats?: ParseStats; today?: string } = {}): CSale[] {
  const need = ["鄉鎮市區", "交易標的", "都市土地使用分區", "交易年月日", "主要用途", "總價元", "單價元平方公尺", "備註"];
  for (const c of need) if (t.col(c) < 0) throw new SourceError(`The MOI sales file has a new layout (no ${c} column); this source needs updating.`);
  const [iDist, iObj, iUrban, iDate, iUse, iTotal, iUnit, iNote] = need.map((c) => t.col(c));
  const iNonUrban = t.col("非都市土地使用分區");
  const iNonUrbanUse = t.col("非都市土地使用編定");
  const iSerial = t.col("編號");
  const iArea = t.col("建物移轉總面積平方公尺");
  const iParkArea = t.col("車位移轉總面積平方公尺");
  const iParkPrice = t.col("車位總價元");
  const iLandArea = t.col("土地移轉總面積平方公尺");
  const iAddr = t.col("土地位置建物門牌");
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const out: CSale[] = [];
  for (const r of t.rows) {
    o.stats && o.stats.rows++;
    const obj = r[iObj] ?? "";
    let kind: Kind;
    if (BUILDING_OBJECTS.has(obj)) {
      if (!isCommercialUse(r[iUse])) { drop(o.stats, "not commercial or industrial use"); continue; }
      kind = "commercial";
    } else if (obj === LAND_OBJECT) {
      if (!isBuildingLand(r[iUrban], iNonUrban >= 0 ? r[iNonUrban] : "", iNonUrbanUse >= 0 ? r[iNonUrbanUse] : "")) { drop(o.stats, "land not building land"); continue; }
      kind = "land";
    } else { drop(o.stats, "other sale object"); continue; }
    const note = r[iNote] ?? "";
    if (REMARKS_EXCLUDED.some((k) => note.includes(k))) { drop(o.stats, "non-market remark"); continue; }
    const date = rocToIso(r[iDate]);
    if (!date || date > today) { drop(o.stats, "bad date"); continue; }
    const total = numOf(r[iTotal]);
    if (!(total >= MIN_TOTAL && total <= MAX_TOTAL)) { drop(o.stats, "bad price"); continue; }
    const serial = iSerial >= 0 ? (r[iSerial] ?? "").trim() : "";
    const address = iAddr >= 0 ? (r[iAddr] ?? "").trim() : "";
    if (o.seen) {
      const k1 = serial ? "n:" + serial : "";
      const k2 = address ? `a:${address}|${r[iDate]}|${total}|${iArea >= 0 ? r[iArea] : ""}|${iLandArea >= 0 ? r[iLandArea] : ""}` : "";
      if ((k1 && o.seen.has(k1)) || (k2 && o.seen.has(k2))) { drop(o.stats, "duplicate record"); continue; }
      if (k1) o.seen.add(k1);
      if (k2) o.seen.add(k2);
    }
    let unit = numOf(r[iUnit]);
    if (!(unit > 0)) {
      if (kind === "commercial" && iArea >= 0) {
        const area = numOf(r[iArea]) - (iParkArea >= 0 ? numOf(r[iParkArea]) || 0 : 0);
        const price = total - (iParkPrice >= 0 ? numOf(r[iParkPrice]) || 0 : 0);
        unit = area > 0 ? Math.round(price / area) : NaN;
      } else if (kind === "land" && iLandArea >= 0) {
        const area = numOf(r[iLandArea]);
        unit = area > 0 ? Math.round(total / area) : NaN;
      }
    }
    const [lo, hi] = kind === "commercial" ? LIMITS.commercialUnit : LIMITS.landUnit;
    if (!(unit >= lo && unit <= hi)) { drop(o.stats, "bad unit price"); continue; }
    o.stats && o.stats.kept++;
    out.push({ city, district: (r[iDist] ?? "").trim(), date, kind, total, unit });
  }
  return out;
}

// ---------- aggregation (pure) ----------

export const WINDOWS = [12, 24] as const;
export type Measure = "total" | "m2";
export const itemKey = (kind: Kind, measure: Measure, months: number) => `${kind}:${measure}:${months}m`;
export const NATIONAL_AREA = "ALL";

/**
 * Library rows and the date they are stamped with: windows of 12 and 24 whole calendar months ending at `anchor`, per district,
 * per city or county and for Taiwan, per kind and per measure. The total price is kept for commercial premises only (a land
 * sale may be a share of a plot, so its total says nothing); the price per m² is kept for both. Cells under 5 sales are dropped.
 */
export function salesRows(sales: CSale[], anchor: string): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (area: string, item: string, v: number) => {
    const k = `${area}\u0000${item}`;
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  const starts = WINDOWS.map((w) => ({ w, from: windowStart(anchor, w) }));
  for (const s of sales) {
    if (s.date > anchor || s.unit === null) continue;
    const areas = [districtKey({ code: s.city } as City, { zh: s.district } as District), s.city, NATIONAL_AREA];
    for (const { w, from } of starts) {
      if (s.date < from) continue;
      for (const a of areas) {
        add(a, itemKey(s.kind, "m2", w), s.unit);
        if (s.kind === "commercial") add(a, itemKey(s.kind, "total", w), s.total);
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

/** The collector: read every release that can hold deals of the last 24 months, keep the aggregates (recomputed once per calendar month of the register). */
export async function twCommercialHarvest(deps: HarvestDeps = realDeps): Promise<HarvestResult> {
  const today = deps.now().toISOString().slice(0, 10);
  const releases = await deps.fetchReleases();
  const newestEnd = releases.map((r) => r.salesTo).filter((x): x is string => !!x).sort().pop() ?? "none";
  const marker = `${LOGIC_VERSION}:${newestEnd.slice(0, 7)}`;
  const prev = deps.stored();
  if (prev && prev.note && MARKER.exec(prev.note)?.[1] === marker && prev.rows.length) {
    return { date: prev.date, currency: "TWD", unit: "per m²", rows: prev.rows, note: prev.note };
  }
  const chosen = selectReleases(releases, "sales", windowStart(today, 26));
  if (!chosen.length) throw new SourceError("No MOI releases found that cover the last two years; the download page may have changed.");
  const seen = new Set<string>();
  const stats = newStats();
  const sales: CSale[] = [];
  for (const rel of chosen) {
    const buf = await deps.download(rel.url);
    const files = cityFiles(listZip(buf), "a");
    if (!files.length) throw new SourceError(`MOI release ${rel.id} holds no sales files; the download format may have changed.`);
    for (const f of files) sales.push(...parseCommercialSales(parseTable(decodeCsv(readZipEntry(buf, f.entry))), f.code, { seen, stats, today }));
  }
  if (!sales.length) throw new SourceError("The MOI releases held no commercial or land sales to harvest.");
  const newest = sales.reduce((a, s) => (s.date > a ? s.date : a), "0000-00-00");
  const anchor = anchorOf(newest);
  const why = Object.entries(stats.dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ");
  return {
    date: anchor,
    currency: "TWD",
    unit: "per m²",
    rows: salesRows(sales, anchor),
    note:
      `[releases ${marker}] ${chosen.length} MOI releases (${chosen.map((r) => r.id).join(", ")}), ${stats.rows} sale records read, ${stats.kept} commercial or building-land market sales kept, newest deal ${newest}; ` +
      `windows of 12 and 24 whole months ending ${anchor}. Left out: ${why}.`,
  };
}

// ---------- the snapshot in the library (pure) ----------

export interface Snapshot {
  date: string;
  rows: Map<string, DailyRow>; // key: area \u0000 item
  cities: City[];
}

export function snapshotFromRows(date: string, rows: Pick<LibraryRow, "area" | "item" | "n" | "median" | "low" | "high" | "min" | "max">[]): Snapshot {
  const map = new Map<string, DailyRow>();
  const areas = new Set<string>();
  for (const r of rows) {
    map.set(`${r.area}\u0000${r.item}`, { area: r.area, item: r.item, n: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max });
    areas.add(r.area);
  }
  return { date, rows: map, cities: indexWithLibrary([...areas]) };
}

let cache: { key: string; snap: Snapshot } | null = null;
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

const TYPE_WORDS: Record<Kind, string> = {
  commercial: "commercial premises (shops, offices, factories and workshops)",
  land: "building land (plots without a building)",
};

export function normaliseKind(v: string | undefined): Kind {
  const t = (v ?? "commercial").trim().toLowerCase().replace(/[_\s]+/g, " ");
  if (["commercial", "shop", "shops", "office", "offices", "retail", "industrial", "factory", "warehouse", "premises", "商業用", "辦公用"].includes(t)) return "commercial";
  if (["land", "plot", "plots", "building plot", "building land", "lot", "土地"].includes(t)) return "land";
  throw new InputError('property_type must be "commercial" (shops, offices, factories) or "land" (building plots).');
}

export interface TwCommercialQuery {
  town?: string;
  property_type: Kind;
  months?: number;
  baseUrl?: string;
  now?: Date;
}

const METHOD =
  "Median and 10th–90th percentile of the Ministry's unit price per m² of registered market sales in the chosen city, county or district over the last 12 or 24 whole calendar months: " +
  "for commercial premises, land with a commercial, office or industrial building (per m² of building area, parking excluded); for land, plots without a building in urban residential, commercial or industrial zones and non-urban building land (per m² of land). " +
  "Built by ProofPrice from the Ministry of the Interior's actual price registration open data, read by our collector from the official releases. " +
  "Sales between relatives and other special relationships, presales, government deals, urgent, debt-related, shell, defective, leasehold-right, auction and other non-market remarks are excluded; farmland and public-facility land are left out.";

function resolveTown(town: string | undefined, snap: Snapshot): { area: string; label: string; national: boolean } {
  const f = findPlace(town ?? "", snap.cities);
  if (f.kind === "national") return { area: NATIONAL_AREA, label: "Taiwan", national: true };
  if (f.kind === "found") return { area: f.place.key, label: f.place.label, national: false };
  if (f.kind === "ambiguous") {
    throw new InputError(`'${town}' names several places in Taiwan: ${f.options.slice(0, 8).map((p) => p.label).join("; ")}. Give the city too, for example "Zhongshan, Taipei" or "臺北市中山區".`);
  }
  if (f.kind === "city_only_district_missing") {
    throw new InputError(`No district called '${f.asked}' in ${f.city.en} (${f.city.zh}). Its districts are: ${districtList(f.city)}.`);
  }
  throw new InputError(
    `Unknown place '${town}'. Use a city or county ('Taipei', 'New Taipei', 'Taichung', 'Kaohsiung', '臺北市') or a district with its city ("Zhongshan, Taipei", "臺北市中山區"), or leave town out for all of Taiwan.`,
  );
}

/** The finished answer from a snapshot. Throws InputError for an unknown or ambiguous place; returns no_matches when there are fewer than 5 sales. */
export function twCommercialAnswer(snap: Snapshot, q: TwCommercialQuery): PriceAnswer {
  const where = resolveTown(q.town, snap);
  const kind = q.property_type;
  const windows: number[] = q.months !== undefined && q.months > 18 ? [24] : [12, 24];
  let m2Row: DailyRow | undefined;
  let w = windows[windows.length - 1];
  for (const cand of windows) {
    const r = snap.rows.get(`${where.area}\u0000${itemKey(kind, "m2", cand)}`);
    if (r && r.n >= MIN_PUBLISH) {
      m2Row = r;
      w = cand;
      break;
    }
  }
  const words = TYPE_WORDS[kind];
  if (!m2Row) {
    const none = buildAnswer({
      source: INFO,
      query: { country: "TW", town: where.label, property_type: kind },
      summary: null,
      currency: "TWD",
      unit: "per m²",
      period: { from: null, to: null },
      method: METHOD,
      describe: () => "",
      baseUrl: q.baseUrl,
    });
    return {
      ...none,
      summary: `Fewer than ${MIN_PUBLISH} qualifying sales of ${words} in ${where.label} in the last ${windows[windows.length - 1]} months (to ${snap.date}) in the Ministry of the Interior's register, so no price range is published. Try the city or county, or leave town out for all of Taiwan.`,
    };
  }
  const totalRow = kind === "commercial" ? snap.rows.get(`${where.area}\u0000${itemKey(kind, "total", w)}`) : undefined;
  const total = totalRow && totalRow.n >= MIN_PUBLISH ? totalRow : null;
  const taiwan = where.national ? null : snap.rows.get(`${NATIONAL_AREA}\u0000${itemKey(kind, "m2", w)}`);
  const taiwanCmp = taiwan && taiwan.n >= MIN_PUBLISH ? { median_price_per_m2: taiwan.median, sales: taiwan.n, this_place_vs_it_percent: Math.round(((m2Row.median - taiwan.median) / taiwan.median) * 1000) / 10 } : null;
  const from = windowStart(snap.date, w);
  const money = (v: number) => fmtMoney(v, "TWD");
  const ans = buildAnswer({
    source: INFO,
    query: { country: "TW", town: where.label, property_type: kind, months: w },
    summary: { count: m2Row.n, median: m2Row.median, low: m2Row.low, high: m2Row.high, min: m2Row.min, max: m2Row.max },
    currency: "TWD",
    unit: "per m²",
    period: { from, to: snap.date },
    method: METHOD,
    baseUrl: q.baseUrl,
    extra: {
      place: { name: where.label, level: where.national ? "country" : where.area.includes("|") ? "district" : "city or county", area_key: where.area },
      property_type_published: words,
      window_months: w,
      windows_tried: windows,
      snapshot_date: snap.date,
      total_price: total ? { currency: "TWD", unit: "per sale (whole registered price)", median: total.median, typical_low: total.low, typical_high: total.high, sales: total.n } : null,
      taiwan_comparison: taiwanCmp,
      dataset: { url: PORTAL_URL, licence_url: INFO.licence_url },
    },
    describe: (x) =>
      `Market sales of ${words} in ${where.label} over the last ${w} months had a median of ${money(x.median)} per m²; typical range ${money(x.low)}–${money(x.high)} per m².` +
      (total ? ` The median whole price of those sales was ${money(total.median)}.` : "") +
      (taiwanCmp ? ` The Taiwan median for the same period is ${money(taiwanCmp.median_price_per_m2)} per m².` : ""),
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

export async function twCommercial(
  input: { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string },
  o: { snapshot?: Snapshot | null; now?: Date } = {},
): Promise<PriceAnswer> {
  const kind = normaliseKind(input.property_type);
  if (input.postcode && !input.town) {
    throw new InputError("The Taiwanese register has no postcodes. Give the city, county or district as town, for example 'Taipei' or \"Zhongshan, Taipei\".");
  }
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("Not yet available: ProofPrice collects Taiwan's actual price registration regularly; figures appear after the next collection.");
  return twCommercialAnswer(snap, { town: input.town, property_type: kind, months: input.months, baseUrl: input.baseUrl, now: o.now });
}

export { placeLabel };
