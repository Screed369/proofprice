// Monthly history for England & Wales home sales: HM Land Registry Price Paid Data, one CSV per year (about 1.2 million sales a year,
// 4.5 GB for 1995 onwards). The files are STREAMED a line at a time and only prices are kept in memory for one year; no address,
// postcode or single record is ever kept or written. Output: monthly median / 10th-90th percentile / count per local authority
// and for England & Wales (ALL), for all homes and by type. Run by hand through the History backfill workflow, never in the app.
import { InputError, SourceError } from "../../lib/http";
import { summarise, MIN_PUBLISH } from "../../lib/stats";
import { NATIONAL } from "../../lib/library/aggregate";
import type { BackfillResult, DailyRow } from "../../lib/plugin";
import { normaliseDistrict } from "./source";

export const PPD_YEAR_URL = (year: number) => `https://price-paid-data.publicdata.landregistry.gov.uk/pp-${year}.csv`;
export const GB_FIRST_YEAR = 1995;
/** Sales outside these prices are typing slips, garages or portfolio deals, not homes (left out of the history, said in the note). */
export const GB_MIN_PRICE = 10_000;
export const GB_MAX_PRICE = 25_000_000;
/** Registration is late: the newest months are incomplete, so the newest two whole months before the latest sale are not loaded. */
export const GB_HOLD_BACK_MONTHS = 2;

export const GB_MONTHLY_TYPES = ["any", "detached", "semi-detached", "terraced", "flat-maisonette"] as const;
export type GbMonthlyType = (typeof GB_MONTHLY_TYPES)[number];
const TYPE_CODE: Record<string, Exclude<GbMonthlyType, "any">> = { D: "detached", S: "semi-detached", T: "terraced", F: "flat-maisonette" };

export const gbMonthlyItem = (t: GbMonthlyType) => `${t}/month`;

const STOP = new Set(["of", "and", "upon", "the", "on"]);
/** A council name as a short library label: "KENSINGTON AND CHELSEA" -> "kensington-and-chelsea". The platform allows 24 characters
 *  in the first word, so very long names lose small joining words ("KINGSTON UPON HULL, CITY OF" -> "kingston-hull-city"), then trailing words. */
export function districtSlug(raw: string | undefined | null): string | null {
  const n = normaliseDistrict(raw);
  if (!n) return null;
  let words = n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  if (words.join("-").length > 24) words = words.filter((w) => !STOP.has(w));
  while (words.length > 1 && words.join("-").length > 24) words.pop();
  const s = words.join("-").slice(0, 24);
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? s : null;
}

/** Collects prices per month/area/item for ONE year; nothing else about a sale is kept. */
export class GbYearAccumulator {
  private groups = new Map<string, number[]>();
  readonly names = new Map<string, string>(); // slug -> register name, to detect two councils sharing a label
  collisions = new Set<string>();
  lines = 0;
  kept = 0;
  rejected = 0;
  newest = "0000-00-00";

  /** One CSV line, all 16 fields quoted: id, price, date, postcode, type, new, duration, PAON, SAON, street, locality, town, district, county, category, status. */
  addLine(line: string): void {
    if (!line) return;
    this.lines++;
    if (line.charCodeAt(0) !== 34 /* " */) { this.rejected++; return; }
    const f = line.replace(/\r$/, "").slice(1, -1).split('","');
    if (f.length !== 16) { this.rejected++; return; }
    const price = Number(f[1]);
    const date = f[2].slice(0, 10);
    // Standard-price sales only (category A), as the live answer; deleted records (status D) are not sales any more.
    if (f[14] !== "A" || f[15] === "D") return;
    if (!(price >= GB_MIN_PRICE && price <= GB_MAX_PRICE) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { this.rejected++; return; }
    const slug = districtSlug(f[12]);
    if (!slug) { this.rejected++; return; }
    const known = this.names.get(slug);
    if (known === undefined) this.names.set(slug, f[12]);
    else if (known !== f[12]) { this.collisions.add(slug); return; }
    this.kept++;
    if (date > this.newest) this.newest = date;
    const month = date.slice(0, 7);
    const type = TYPE_CODE[f[4]];
    this.push(month, slug, "any", price);
    this.push(month, NATIONAL, "any", price);
    if (type) {
      this.push(month, slug, type, price);
      this.push(month, NATIONAL, type, price);
    }
  }

  private push(month: string, area: string, type: string, price: number) {
    const k = `${month}\u0000${area}\u0000${type}/month`;
    const g = this.groups.get(k);
    if (g) g.push(price);
    else this.groups.set(k, [price]);
  }

  /** Aggregates per month; groups under 5 sales and any council label shared by two names are dropped. */
  periods(): Map<string, DailyRow[]> {
    const out = new Map<string, DailyRow[]>();
    for (const [k, prices] of this.groups) {
      if (prices.length < MIN_PUBLISH) continue;
      const [month, area, item] = k.split("\u0000");
      if (this.collisions.has(area)) continue;
      const s = summarise(prices);
      if (!s) continue;
      let rows = out.get(month);
      if (!rows) out.set(month, (rows = []));
      rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
    }
    for (const rows of out.values()) rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
    return out;
  }
}

/** Feed a stream of text chunks through the accumulator line by line. */
export async function feedChunks(chunks: AsyncIterable<string>, acc: GbYearAccumulator): Promise<void> {
  let tail = "";
  for await (const chunk of chunks) {
    const text = tail + chunk;
    let start = 0;
    for (;;) {
      const nl = text.indexOf("\n", start);
      if (nl < 0) break;
      acc.addLine(text.slice(start, nl));
      start = nl + 1;
    }
    tail = text.slice(start);
  }
  if (tail) acc.addLine(tail);
}

export interface GbBackfillDeps {
  /** Text chunks of one year's file. */
  openYear?: (year: number) => AsyncIterable<string>;
  log?: (s: string) => void;
  pauseMs?: number;
}

async function* fetchYear(year: number): AsyncIterable<string> {
  const res = await fetch(PPD_YEAR_URL(year), { headers: { "user-agent": "ProofPrice-Historian/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
  if (!res.ok || !res.body) throw new SourceError(`Price Paid Data ${year} returned HTTP ${res.status}`);
  const dec = new TextDecoder("utf-8");
  // @ts-ignore web stream is async iterable in Node 22
  for await (const buf of res.body) yield dec.decode(buf, { stream: true });
  yield dec.decode();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prevMonth = (ym: string, back: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 - back, 1)).toISOString().slice(0, 7);

/** Backfill: from/to are YYYY-MM-DD; whole calendar months only (a month is loaded when it lies inside from..to and is older than the hold-back). */
export async function gbBackfill(from: string, to: string, deps: GbBackfillDeps = {}): Promise<BackfillResult> {
  const open = deps.openYear ?? fetchYear;
  const log = deps.log ?? ((s: string) => console.log(s));
  const y0 = Math.max(GB_FIRST_YEAR, Number(from.slice(0, 4)));
  const y1 = Number(to.slice(0, 4));
  const fromMonth = from.slice(0, 7);
  const periods: BackfillResult["periods"] = [];
  let newest = "0000-00-00";
  let totalKept = 0;
  const collided = new Set<string>();
  const yearResults: { period: string; rows: DailyRow[] }[] = [];
  for (let y = y0; y <= y1; y++) {
    let acc: GbYearAccumulator | null = null;
    for (let attempt = 1; attempt <= 3 && !acc; attempt++) {
      const a = new GbYearAccumulator();
      try {
        await feedChunks(open(y), a);
        acc = a;
      } catch (e) {
        log(`${y}: attempt ${attempt} failed: ${String((e as Error)?.message ?? e)}`);
        if (attempt === 3) throw e;
        await sleep((deps.pauseMs ?? 5000) * attempt);
      }
    }
    if (!acc || acc.kept === 0) throw new SourceError(`Price Paid Data ${y} held no usable sales`);
    if (acc.newest > newest) newest = acc.newest;
    totalKept += acc.kept;
    acc.collisions.forEach((c) => collided.add(c));
    for (const [period, rows] of acc.periods()) yearResults.push({ period, rows });
    log(`${y}: ${acc.lines} lines, ${acc.kept} sales kept, ${acc.rejected} rejected, newest ${acc.newest}`);
    await sleep(deps.pauseMs ?? 1000);
  }
  if (collided.size) log(`Council labels shared by two names, left out: ${[...collided].join(", ")}`);
  const lastWhole = prevMonth(newest.slice(0, 7), GB_HOLD_BACK_MONTHS);
  const toMonth = to.slice(0, 7) < lastWhole ? to.slice(0, 7) : lastWhole;
  for (const r of yearResults.sort((a, b) => a.period.localeCompare(b.period))) {
    if (r.period >= fromMonth && r.period <= toMonth) periods.push(r);
  }
  log(`${totalKept} sales; ${periods.length} months ${periods[0]?.period}..${periods[periods.length - 1]?.period}; ${periods.reduce((n, p) => n + p.rows.length, 0)} rows`);
  return {
    currency: "GBP",
    unit: "per home",
    periods,
    note: `Monthly figures from HM Land Registry Price Paid Data: median and 10th-90th percentile of standard-price residential sales (category A) by completion month, per local authority (council area or London borough) and for England & Wales, for all homes and by type. Sales under £${GB_MIN_PRICE.toLocaleString("en-GB")} and over £${(GB_MAX_PRICE / 1e6).toFixed(0)} million are left out. Sales reach the register weeks to months late, so the newest ${GB_HOLD_BACK_MONTHS} months are not loaded.`,
  };
}

/** Library keys for /history: months=N asks for the monthly figures of a local authority (district) or, with no place, England & Wales. */
export function gbHistoryKey(
  input: { town?: string; district?: string; property_type?: string },
  opts?: { monthly?: boolean },
): { area: string; item: string; label: string } | null {
  const t = (input.property_type ?? "any").toLowerCase() as GbMonthlyType;
  if (!opts?.monthly) throw new InputError("England & Wales: history is kept as monthly figures (no daily snapshots). Pass months, for example months=120 for ten years.");
  if (!(GB_MONTHLY_TYPES as readonly string[]).includes(t)) return null;
  const place = input.district ?? input.town;
  if (!place) return { area: NATIONAL, item: gbMonthlyItem(t), label: "England & Wales" };
  const slug = districtSlug(place);
  if (!slug) return null;
  const nice = normaliseDistrict(place)!.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, sp, c) => sp + c.toUpperCase());
  return { area: slug, item: gbMonthlyItem(t), label: `${nice} (local authority), England & Wales` };
}
