// Taiwan Railway (TRA) posted fares per station pair, TWD, from the operator's open-data fare table.
// Format checked live on 2026-11-11 from the cloud workspace (plain GET, no key, redirects followed):
//   https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/b9acae0f5fbf4e689e6aaff2109241b0
// A single UTF-8 JSON array of about 171 MB (171,494,567 bytes), one object per station pair AND direction code, e.g.
//   {"startStaCode":"0900","endStaCode":"0910","startStaName":"基隆","endStaName":"三坑","directionCode":2,"specLine":null,
//    "mileage":1.5,"trnClassTypeCount":9,"details":[{"trnclassCode":11,"adultTktPrice":34,"childTktPrice":17,"iChildTktPrice":null,
//    "adultTkt9Price":null,"childTkt9Price":null,"discountPrice":null}, ...]}
// Two things the first 63 MB (42,415 records, 21,549 distinct pairs) showed: (1) EVERY pair appears twice, once per route
// direction code, and directionCode does not say which is the normal one (Taipei to Keelung is code 1 at 28.5 km, Keelung to Taipei is
// code 2 at 855.2 km, the long way round the island at TWD 2,058): the normal fare is the record with the SMALLER mileage.
// (2) every record lists all 9 train class codes (1, 2, 3, 4, 5, 6, 7, 10, 11) with a fare, whether or not that class stops there.
// The meaning of the class codes is not stated in the file, the dataset page or the developer page, so we never name a class.
// The file is far too big to read per request: harvest() streams it once a day and keeps only the main-city station pairs.
// Posted tariff, not paid.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const URL_FARES = "https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/b9acae0f5fbf4e689e6aaff2109241b0";
export const URL_META = "https://data.gov.tw/api/v2/rest/dataset/6998";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "tw-tra-fares",
  country: "TW",
  category: "transport fares (Taiwan Railway)",
  name: "Taiwan Railway (TRA) train fares between stations (Taiwan Railway Corporation open data)",
  publisher: "Taiwan Railway Corporation (國營臺灣鐵路股份有限公司), published on data.gov.tw (dataset 6998)",
  what_is_recorded:
    "The posted adult and child fare for one Taiwan Railway journey between two stations, for each of the nine train classes in the fare table. " +
    "ProofPrice keeps the cheapest and the dearest class fare for 22 main-city stations (Keelung, Taipei, Banqiao, Taoyuan, Hsinchu, Taichung, Changhua, Chiayi, Tainan, Kaohsiung, Hualien, Taitung and others). A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Irregular: updated by the operator when fares change (the dataset page shows 'last modified'); collected into our price library every day",
  licence:
    "Taiwan Open Government Data License v1.0: any purpose, any time and place, non-exclusive, irrevocable, royalty-free use of the open data, including derivative products and services, with attribution of the source; compatible with CC BY 4.0",
  licence_url: "https://data.gov.tw/license",
  attribution:
    "Contains information from the Taiwan Railway fare table (Taiwan Railway Corporation) accessed from data.gov.tw (https://data.gov.tw/en/datasets/6998) under the Taiwan Open Government Data License v1.0 (https://data.gov.tw/license). " +
    "ProofPrice looks up the station pair; this is not an official service of Taiwan Railway Corporation.",
  homepage: "https://data.gov.tw/en/datasets/6998",
  limits:
    "Posted Taiwan Railway fares per station pair, not amounts paid, not a ticket and not a quote; no sample size. Only 22 main-city stations are available. " +
    "The headline is the cheapest class fare in the file; the file gives a fare for all nine train classes on every pair whether or not a train of that class stops there, and does not name the classes, so check the train you will take. " +
    "Adult and child fares only (no senior, student or pass fares). Other operators (High Speed Rail, Taipei Metro, buses) are not included.",
};

// ---------- the file (pure) ----------

export interface TraRecord {
  from: string;
  to: string;
  km: number;
  /** One entry per train class code. */
  adult: Record<string, number>;
  child: Record<string, number>;
}

/** The stations kept in the library: Chinese name as written in the file -> the English name people use. Each name checked against the file on 2026-11-11. */
export const KEY_STATIONS: Record<string, string> = {
  基隆: "Keelung", 南港: "Nangang", 松山: "Songshan", 臺北: "Taipei", 板橋: "Banqiao", 桃園: "Taoyuan", 中壢: "Zhongli", 新竹: "Hsinchu",
  苗栗: "Miaoli", 豐原: "Fengyuan", 臺中: "Taichung", 彰化: "Changhua", 員林: "Yuanlin", 斗六: "Douliu", 嘉義: "Chiayi", 新營: "Xinying",
  臺南: "Tainan", 高雄: "Kaohsiung", 屏東: "Pingtung", 臺東: "Taitung", 花蓮: "Hualien", 宜蘭: "Yilan",
};
const EXTRA_ALIASES: Record<string, string> = {
  "taipei main station": "臺北", "taipei station": "臺北", "kaohsiung station": "高雄", "taichung station": "臺中", "tainan station": "臺南",
  "hsinchu station": "新竹", "chiayi station": "嘉義", "hualien station": "花蓮", "taitung station": "臺東", "yilan station": "宜蘭",
};

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/台/g, "臺").replace(/[^a-z0-9㐀-鿿]+/g, " ").trim();

/** Pure: one station of the 22 by Chinese name (台 or 臺) or English name. */
export function findStation(text: string, what: string): string {
  const raw = (text ?? "").trim();
  if (!raw) throw new InputError(`Give a ${what} for Taiwan Railway, for example "Taipei" or "Kaohsiung".`);
  const t = norm(raw);
  if (EXTRA_ALIASES[t]) return EXTRA_ALIASES[t];
  for (const [zh, en] of Object.entries(KEY_STATIONS)) {
    if (norm(zh) === t || norm(en) === t || norm(en + " station") === t) return zh;
  }
  throw new InputError(
    `Not yet known: ${what} "${text}" is not one of the Taiwan Railway stations we keep. Available: ${Object.entries(KEY_STATIONS).map(([zh, en]) => `${en} (${zh})`).join(", ")}.`,
  );
}

/** Pure: reduce one raw object of the file to the fares we need; null when it has no usable fare. */
export function toRecord(o: any): TraRecord | null {
  if (!o || typeof o.startStaName !== "string" || typeof o.endStaName !== "string" || !Array.isArray(o.details)) return null;
  const adult: Record<string, number> = {};
  const child: Record<string, number> = {};
  for (const d of o.details) {
    const code = String(d?.trnclassCode ?? "");
    if (!code) continue;
    if (Number.isFinite(d.adultTktPrice) && d.adultTktPrice > 0) adult[code] = d.adultTktPrice;
    if (Number.isFinite(d.childTktPrice) && d.childTktPrice > 0) child[code] = d.childTktPrice;
  }
  if (!Object.keys(adult).length) return null;
  const km = Number(o.mileage);
  if (!Number.isFinite(km) || km <= 0) return null;
  return { from: o.startStaName, to: o.endStaName, km, adult, child };
}

/** Pure: of the records of one pair (one per direction code) keep the one with the smaller mileage: the normal route. */
export function normalRoute(records: TraRecord[]): Map<string, TraRecord> {
  const best = new Map<string, TraRecord>();
  for (const r of records) {
    const k = `${r.from}>${r.to}`;
    const cur = best.get(k);
    if (!cur || r.km < cur.km) best.set(k, r);
  }
  return best;
}

/** Pure: split the JSON array text into its objects as they arrive. Feed chunks with push(); call end() once. Strings are honoured, so a brace inside a name cannot confuse it. */
export class ObjectSplitter {
  private depth = 0;
  private inStr = false;
  private esc = false;
  private buf: string[] = [];
  private started = false;
  constructor(private onObject: (json: string) => void) {}
  push(chunk: string): void {
    let startAt = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === 92) this.esc = true;
        else if (c === 34) this.inStr = false;
        continue;
      }
      if (c === 34) { this.inStr = true; continue; }
      if (c === 123) {
        if (this.depth === 0) { startAt = i; this.started = true; this.buf = []; }
        this.depth++;
      } else if (c === 125) {
        this.depth--;
        if (this.depth === 0 && this.started) {
          this.buf.push(chunk.slice(startAt, i + 1));
          this.onObject(this.buf.join(""));
          this.buf = [];
          this.started = false;
          startAt = i + 1;
        }
      }
    }
    if (this.started) this.buf.push(chunk.slice(startAt));
  }
  end(): void {
    if (this.depth !== 0 || this.inStr) throw new SourceError("The Taiwan Railway fare file ended in the middle of a record.");
  }
}

/** Pure: the stations' normal-route records into library rows: per ordered pair, items adult and child; median = cheapest class fare, max = dearest class. */
export function rowsFromRecords(records: Iterable<TraRecord>): DailyRow[] {
  const keep = [...records].filter((r) => r.from in KEY_STATIONS && r.to in KEY_STATIONS && r.from !== r.to);
  const rows: DailyRow[] = [];
  for (const r of normalRoute(keep).values()) {
    for (const [item, fares] of [["adult", r.adult], ["child", r.child]] as const) {
      const v = Object.values(fares);
      if (!v.length) continue;
      const lo = Math.min(...v), hi = Math.max(...v);
      rows.push({ area: `${r.from}>${r.to}`, item, n: NO_COUNT, median: lo, low: lo, high: hi, min: lo, max: hi });
    }
  }
  return rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

// ---------- the collector ----------

async function modifiedDate(): Promise<string | null> {
  try {
    const res = await fetch(URL_META, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const m = String(j?.result?.modifiedDate ?? "").match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  } catch { return null; }
}

export async function traHarvest(): Promise<HarvestResult> {
  const res = await fetch(URL_FARES, { headers: { "user-agent": UA, accept: "application/json,*/*" }, signal: AbortSignal.timeout(14 * 60 * 1000) });
  if (!res.ok || !res.body) throw new SourceError(`Source returned HTTP ${res.status}`, URL_FARES, res.status);
  const kept: TraRecord[] = [];
  let seen = 0;
  const splitter = new ObjectSplitter((json) => {
    seen++;
    // Cheap pre-filter on the raw text: both names must be key stations before we parse the object.
    const a = json.match(/"startStaName":"([^"]*)"/)?.[1];
    const b = json.match(/"endStaName":"([^"]*)"/)?.[1];
    if (!a || !b || !(a in KEY_STATIONS) || !(b in KEY_STATIONS)) return;
    const r = toRecord(JSON.parse(json));
    if (r) kept.push(r);
  });
  const dec = new TextDecoder("utf-8");
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    splitter.push(dec.decode(value, { stream: true }));
  }
  splitter.push(dec.decode());
  splitter.end();
  const rows = rowsFromRecords(kept);
  const want = Object.keys(KEY_STATIONS).length * (Object.keys(KEY_STATIONS).length - 1) * 2;
  if (seen < 20000) throw new SourceError(`The Taiwan Railway fare file has only ${seen} records; this source needs updating.`);
  if (rows.length < want * 0.9) throw new SourceError(`Only ${rows.length} of ${want} expected station-pair rows found in the Taiwan Railway fare file; this source needs updating.`);
  const modified = await modifiedDate();
  return {
    date: new Date().toISOString().slice(0, 10),
    currency: "TWD",
    unit: "per journey (Taiwan Railway posted fare)",
    rows,
    note: `Posted fare table, ${seen} records read${modified ? `, dataset last modified ${modified}` : ""}. Cheapest and dearest class fare per station pair.`,
  };
}

// ---------- the request ----------

export interface TraInput {
  from_station?: string;
  to_station?: string;
  passenger?: string;
  baseUrl?: string;
}

export type Passenger = "adult" | "child";

export function parsePassenger(p?: string, fare_type?: string): Passenger {
  const ft = (fare_type ?? "").toLowerCase();
  if (ft && ft !== "adult") throw new InputError("fare_type for Taiwan Railway is adult only (the file has no senior, student or workfare fares); for a child fare give passenger=child.");
  const v = (p ?? "adult").toLowerCase();
  if (v === "adult" || v === "child") return v;
  throw new InputError("passenger must be adult (default) or child.");
}

/** Pure: pick the figure for the request from the library rows of one day. */
export function answerFromRows(rows: DailyRow[], date: string, input: TraInput & { fare_type?: string }): PriceAnswer {
  if (!input.from_station || !input.to_station) {
    throw new InputError("Give origin_station and destination_station for Taiwan Railway, for example origin_station=Taipei&destination_station=Kaohsiung&tw_operator=tra.");
  }
  const who = parsePassenger(input.passenger, input.fare_type);
  const a = findStation(input.from_station, "origin_station");
  const b = findStation(input.to_station, "destination_station");
  if (a === b) throw new InputError("origin_station and destination_station are the same station; give two different stations.");
  const row = rows.find((r) => r.area === `${a}>${b}` && r.item === who);
  if (!row) throw new SourceError("No Taiwan Railway fare for this station pair in our price library yet.");
  const an = KEY_STATIONS[a], bn = KEY_STATIONS[b];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "TW", tw_operator: "tra", from_station: an, to_station: bn, passenger: who },
    value: row.median,
    measure: "average",
    currency: "TWD",
    unit: "per journey (Taiwan Railway posted fare, cheapest class)",
    period: { from: date, to: null },
    reference_period: `fare table collected ${date}`,
    min: row.min,
    max: row.max,
    method:
      "Taiwan Railway: the operator's posted fare for one journey between the two stations on the normal (shorter) route, from its open-data fare table. The headline is the cheapest of the nine train-class fares in the table; the highest class fare is given as the maximum. A published fare table, not a count of fares paid.",
    describe: (v) =>
      `The cheapest posted Taiwan Railway ${who} fare from ${an} to ${bn} is TWD ${v} per journey; the dearest train class in the table costs TWD ${row.max}.`,
    note: "Posted fare table, not an amount paid. The file lists a fare for every train class on every pair and does not name the classes: check the train you take. Taiwan High Speed Rail and Taipei Metro are not included.",
    baseUrl: input.baseUrl,
    extra: { from_station: an, to_station: bn, passenger: who, cheapest_class_twd: row.min, dearest_class_twd: row.max, mode: "Rail (TRA)" },
  });
}

export async function traFares(input: TraInput & { fare_type?: string }): Promise<PriceAnswer> {
  const day = readLatestDay(INFO.id);
  if (!day || !readMeta(INFO.id)) throw new SourceError("The Taiwan Railway fare table has not been collected into our price library yet.");
  return answerFromRows(day.rows, day.date, input);
}

export function traHistoryKey(input: TraInput): { area: string; item: string; label: string } | null {
  if (!input.from_station || !input.to_station) return null;
  try {
    const a = findStation(input.from_station, "origin_station");
    const b = findStation(input.to_station, "destination_station");
    return { area: `${a}>${b}`, item: parsePassenger(input.passenger), label: "station pair" };
  } catch { return null; }
}
