// Australia wholesale GAS: AEMO Short Term Trading Market (STTM) ex post imbalance prices at the Adelaide, Brisbane and Sydney hubs.
// Format checked live on 2026-10-30 from the workspace shell (plain GET, no headers needed):
//   GET https://nemweb.com.au/Reports/CURRENT/STTM/int657_v2_ex_post_market_data_rpt_1.csv   (about 2 KB, rewritten each morning ~10:30 AEST, last 7 gas days)
//   gas_date,hub_identifier,hub_name,schedule_identifier,imbalance_qty,ex_post_imbalance_price,schedule_type_code,imbalance_type,schedule_imbalance_price,approval_datetime,report_datetime
//   29 Oct 2026,SYD,Sydney,70636,-4679,12.5583,XPOST,L,,30 Oct 2026 10:30:41,30 Oct 2026 10:32:28
//   One row per hub and gas day (gas day = 06:00 to 06:00 AEST). ex_post_imbalance_price = Australian dollars per GJ, the price at which that gas day's
//   imbalance was settled at the hub. Dates are written "29 Oct 2026".
// Licence (read 2026-10-30 by the Licence Checker, https://aemo.com.au/privacy-and-legal-notices/copyright-permissions): "AEMO confirms its general permission for
//   anyone to use AEMO Material for any purpose, but only with accurate and appropriate attribution of the relevant AEMO Material and AEMO as its author."

import { SourceError, InputError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { NO_COUNT, percentile, PriceSummary } from "../../lib/stats";
import type { BackfillResult, DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const BASE = "https://nemweb.com.au";
export const FILE_URL = `${BASE}/Reports/CURRENT/STTM/int657_v2_ex_post_market_data_rpt_1.csv`;
export const LICENCE_URL = "https://aemo.com.au/privacy-and-legal-notices/copyright-permissions";

export const HUBS: Record<string, { label: string; aliases: string[] }> = {
  ADL: { label: "Adelaide", aliases: ["adelaide", "sa", "south australia"] },
  BRI: { label: "Brisbane", aliases: ["brisbane", "qld", "queensland"] },
  SYD: { label: "Sydney", aliases: ["sydney", "nsw", "new south wales", "act"] },
};
export const DEFAULT_HUB = "SYD";
export const HISTORY_ITEM = "gas-expost";

export const INFO: SourceInfo = {
  id: "au-aemo-sttm-gas",
  country: "AU",
  category: "wholesale gas (STTM hub)",
  name: "AEMO: Short Term Trading Market (STTM) ex post gas prices at the Adelaide, Brisbane and Sydney hubs",
  publisher: "Australian Energy Market Operator (AEMO)",
  what_is_recorded:
    "The ex post imbalance price of natural gas at one STTM hub for one gas day, in Australian dollars per gigajoule (GJ): the price at which the day's gas imbalance was settled.",
  price_type: "transaction",
  freshness: "AEMO rewrites the STTM ex post file each morning (about 10:30 Sydney time) with the last 7 gas days; ProofPrice reads it on each request (cached up to 30 minutes)",
  licence: "AEMO general permission: anyone may use AEMO Material for any purpose with accurate and appropriate attribution of the material and AEMO as its author",
  licence_url: LICENCE_URL,
  attribution:
    "Source: AEMO (Australian Energy Market Operator), Short Term Trading Market (STTM) ex post market data. Used under AEMO's general copyright permission with attribution. Medians and ranges are own calculations by ProofPrice from the daily hub prices.",
  homepage: "https://nemweb.com.au/Reports/CURRENT/STTM/",
  limits:
    "Wholesale gas hub prices (Adelaide, Brisbane and Sydney STTM hubs only), not what households or businesses pay on gas bills. Prices are in Australian dollars per GJ (1 GJ is about 278 kWh). " +
    "The record count is hub gas days (one price per hub per day, at most 7 in the published file), not separate trades. Other states (Victoria, Western Australia) are not in the STTM and are not covered here.",
};

export interface HubDay {
  /** Gas day, YYYY-MM-DD. */
  date: string;
  hub: string;
  /** AUD per GJ. */
  price: number;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "29 Oct 2026" -> "2026-10-29" (null when it is not in that form). */
export function parseGasDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  const mo = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return m && mo ? `${m[3]}-${mo}-${m[1].padStart(2, "0")}` : null;
}

/** All hub prices of the STTM ex post file (XPOST rows only), oldest first. Throws when the layout changed. */
export function parseExPost(csv: string): HubDay[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const iDate = head.indexOf("gas_date");
  const iHub = head.indexOf("hub_identifier");
  const iPrice = head.indexOf("ex_post_imbalance_price");
  const iType = head.indexOf("schedule_type_code");
  if ([iDate, iHub, iPrice].some((i) => i < 0)) {
    throw new SourceError("AEMO changed the columns of its STTM ex post file (gas_date, hub_identifier or ex_post_imbalance_price missing); this source needs updating.");
  }
  const best = new Map<string, HubDay>();
  for (const line of lines.slice(1)) {
    const f = line.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
    if (iType >= 0 && f[iType] && f[iType] !== "XPOST") continue;
    const date = parseGasDate(f[iDate] ?? "");
    const price = f[iPrice] === "" || f[iPrice] === undefined ? NaN : Number(f[iPrice]);
    const hub = f[iHub];
    if (!date || !hub || !Number.isFinite(price)) continue;
    best.set(`${hub}|${date}`, { date, hub, price }); // later rows of the same hub and day replace earlier ones
  }
  if (best.size === 0) throw new SourceError("AEMO's STTM ex post file held no hub prices.");
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hub.localeCompare(b.hub));
}

// ---------- fetching ----------

export interface Fetcher {
  text(url: string): Promise<string>;
}

export const liveFetcher: Fetcher = {
  async text(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
      if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
      return await res.text();
    } catch (err: any) {
      if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
      if (err instanceof SourceError) throw err;
      throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
    } finally {
      clearTimeout(timer);
    }
  },
};

// ---------- statistics ----------

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function summariseGas(values: number[]): PriceSummary | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return {
    count: clean.length,
    median: r2(percentile(clean, 0.5)),
    low: r2(percentile(clean, 0.1)),
    high: r2(percentile(clean, 0.9)),
    min: r2(clean[0]),
    max: r2(clean[clean.length - 1]),
  };
}

export function resolveHub(hub?: string): { code: string; label: string } {
  if (!hub || !hub.trim()) return { code: DEFAULT_HUB, label: HUBS[DEFAULT_HUB].label };
  const k = hub.trim().toLowerCase();
  for (const [code, h] of Object.entries(HUBS)) {
    if (code.toLowerCase() === k || h.label.toLowerCase() === k || h.aliases.includes(k)) return { code, label: h.label };
  }
  throw new InputError(`AEMO STTM hub "${hub}" is not available. Use one of ${Object.keys(HUBS).join(", ")} (Adelaide, Brisbane, Sydney). Victoria and Western Australia have no STTM hub.`);
}

export const MAX_DAYS = 7;
export const DEFAULT_DAYS = 7;

export function answerFromHubDays(days: HubDay[], opts: { hub: string; hubLabel: string; days: number; baseUrl?: string }): PriceAnswer {
  const sel = days.filter((d) => d.hub === opts.hub).slice(-opts.days);
  const s = summariseGas(sel.map((d) => d.price));
  const last = sel[sel.length - 1];
  const lo = sel.length ? sel.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const hi = sel.length ? sel.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: "AU", commodity: "gas", hub: opts.hub, days: opts.days },
    summary: s,
    currency: "AUD",
    unit: "per GJ",
    period: sel.length ? { from: sel[0].date, to: last.date } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the daily ex post imbalance prices (Australian dollars per GJ) at the ${opts.hubLabel} (${opts.hub}) hub of AEMO's Short Term Trading Market over the last ${opts.days} gas day(s). ` +
      "Each hub gas day counts as one record. Wholesale gas prices, not retail bills. A gas day runs 06:00 to 06:00 Sydney time.",
    describe: (x) =>
      `Wholesale gas at the ${opts.hubLabel} hub (AEMO STTM): median ${x.median} AUD/GJ (${r2(x.median / 0.2778)} AUD/MWh equivalent), daily prices between ${x.low} and ${x.high} AUD/GJ over the last ${opts.days} gas day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          commodity: "gas",
          latest_day: last ? { gas_day: last.date, aud_per_gj: r4(last.price) } : null,
          cheapest_day: lo ? { gas_day: lo.date, aud_per_gj: r4(lo.price) } : null,
          dearest_day: hi ? { gas_day: hi.date, aud_per_gj: r4(hi.price) } : null,
          sttm_hub: opts.hub,
          default_hub_used: opts.hub === DEFAULT_HUB,
          basis: "AEMO STTM ex post imbalance price at the hub, one price per gas day; household and business gas bills add network, retail and other charges.",
          note_hub: "Choose hub=ADL (Adelaide), BRI (Brisbane) or SYD (Sydney). SYD is the default.",
        }
      : undefined,
  });
}

export async function sttmGas(input: { hub?: string; days?: number; baseUrl?: string }, f: Fetcher = liveFetcher): Promise<PriceAnswer> {
  const hub = resolveHub(input.hub);
  const n = Math.min(MAX_DAYS, Math.max(1, Math.round(input.days ?? DEFAULT_DAYS)));
  const days = parseExPost(await f.text(FILE_URL));
  return answerFromHubDays(days, { hub: hub.code, hubLabel: hub.label, days: n, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

/** One library row per hub for one gas day. A hub gas day is one published price, so n is NO_COUNT. */
export function dayRows(days: HubDay[], date: string): DailyRow[] {
  return days
    .filter((d) => d.date === date)
    .map((d) => ({ area: d.hub, item: HISTORY_ITEM, n: NO_COUNT, median: r4(d.price), low: r4(d.price), high: r4(d.price), min: r4(d.price), max: r4(d.price) }));
}

export async function sttmHarvest(f: Fetcher = liveFetcher): Promise<HarvestResult> {
  const days = parseExPost(await f.text(FILE_URL));
  const date = days[days.length - 1].date;
  return {
    date,
    currency: "AUD",
    unit: "per GJ",
    rows: dayRows(days, date),
    note: "AEMO STTM ex post imbalance price per hub and gas day (Adelaide, Brisbane, Sydney). One published price per hub per day. Used under AEMO's general copyright permission with attribution.",
  };
}

/** The gas days still in the published file (the last 7). */
export async function sttmBackfill(from: string, to: string, f: Fetcher = liveFetcher): Promise<BackfillResult> {
  const days = parseExPost(await f.text(FILE_URL));
  const dates = [...new Set(days.map((d) => d.date))].filter((d) => d >= from && d <= to);
  return {
    currency: "AUD",
    unit: "per GJ",
    periods: dates.map((d) => ({ period: d, rows: dayRows(days, d) })),
    note: "AEMO STTM ex post file (last 7 gas days still published).",
  };
}

export function sttmHistoryKey(hub?: string): { area: string; item: string; label: string } | null {
  try {
    const h = resolveHub(hub);
    return { area: h.code, item: HISTORY_ITEM, label: `${h.label} (${h.code}) wholesale gas hub price` };
  } catch {
    return null;
  }
}
