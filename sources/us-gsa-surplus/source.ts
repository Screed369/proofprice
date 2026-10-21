// US federal surplus auctions (GSA Auctions) as compiled by GovAuctions. Format checked on 2026-10-21 (2,442,264 bytes, 13,837 lots).
import { SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const CSV_URL = "https://raw.githubusercontent.com/benswork-space/us-government-surplus-dataset/main/us-gsa-surplus-auctions.csv";

export const INFO: SourceInfo = {
  id: "us-gsa-surplus",
  country: "US",
  category: "auctions (surplus auction prices)",
  name: "U.S. Government (GSA) Surplus Auction Dataset",
  publisher: "GovAuctions, compiled from GSA Auctions (gsaauctions.gov)",
  what_is_recorded: "One lot of US federal surplus or seized goods offered at public auction, with its final bid.",
  price_type: "transaction",
  freshness: "Monthly file, covers the last six months of auctions",
  licence: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "GovAuctions (https://govauctions.app), 'U.S. Government (GSA) Surplus Auction Dataset', CC BY 4.0. Aggregated by ProofPrice (changed: medians and percentiles only).",
  homepage: "https://github.com/benswork-space/us-government-surplus-dataset",
  limits:
    "Final bid on sold lots, a bid level that excludes the buyer premium, not a confirmed hammer price and not a retail price. About six months of history. Group labels in the file are noisy. Lots with no bid are left out.",
};

/** What the figure is: the last bid on lots marked sold, from a third-party compilation of GSA Auctions listings. */
export const AUCTION_EVIDENCE = {
  label: "Auction final bids (winning bid level)",
  meaning:
    "The last recorded bid on lots marked sold at public GSA auctions, compiled by GovAuctions from the auction listings: a winning bid level before the buyer premium, not a confirmed completed sale or receipt, and not a retail price.",
};

export interface Lot {
  category: string;
  title: string;
  state: string;
  bid: number;
  endedAt: string;
}

/** RFC 4180 CSV into rows of cells (quoted cells, doubled quotes and line breaks inside quotes). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Sold lots with a recorded bid. Everything else (no bid, not sold, no date) is dropped. */
export function parseLots(text: string): Lot[] {
  const rows = parseCsvRows(text);
  const head = rows[0] ?? [];
  const ix = (name: string) => head.indexOf(name);
  const [iCat, iTitle, iState, iBid, iSold, iEnd] = ["category", "title", "state", "current_or_final_bid", "sold", "ended_at"].map(ix);
  if ([iCat, iTitle, iState, iBid, iSold, iEnd].some((v) => v < 0)) throw new SourceError("Unexpected file format from GovAuctions");
  const lots: Lot[] = [];
  for (const r of rows.slice(1)) {
    if (r[iSold] !== "true") continue;
    const bid = Number(r[iBid]);
    if (!(bid > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r[iEnd] ?? "")) continue;
    lots.push({ category: r[iCat], title: r[iTitle] ?? "", state: (r[iState] ?? "").toUpperCase(), bid, endedAt: r[iEnd] });
  }
  return lots;
}

/** Match a request to lots: a group slug ("heavy equipment" = heavy-equipment) or every word found in the lot title. */
export function matchLots(lots: Lot[], what: string, state?: string, fromDate?: string): Lot[] {
  const slug = what.toLowerCase().replace(/[\s_&]+/g, "-");
  const words = what.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  const isGroup = lots.some((l) => l.category === slug);
  const st = state?.trim().toUpperCase();
  return lots.filter((l) => {
    if (fromDate && l.endedAt < fromDate) return false;
    if (st && l.state !== st) return false;
    if (isGroup) return l.category === slug;
    const title = l.title.toLowerCase();
    return words.length > 0 && words.every((w) => title.includes(w));
  });
}

let cache: { at: number; lots: Lot[] } | null = null;

async function loadLots(): Promise<Lot[]> {
  if (cache && Date.now() - cache.at < 24 * 3600 * 1000) return cache.lots;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(CSV_URL, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, undefined, res.status);
    const lots = parseLots(await res.text());
    cache = { at: Date.now(), lots };
    return lots;
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", CSV_URL);
    throw new SourceError("Could not reach the GovAuctions dataset", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function auctionPrices(input: { what: string; state?: string; months: number; baseUrl?: string }, lots?: Lot[]): Promise<PriceAnswer> {
  const all = lots ?? (await loadLots());
  const newest = all.reduce((m, l) => (l.endedAt > m ? l.endedAt : m), "");
  if (!newest) throw new SourceError("The auction file held no sold lots");
  const d = new Date(newest + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - input.months);
  const from = d.toISOString().slice(0, 10);
  const hits = matchLots(all, input.what, input.state, from);
  const s = summarise(hits.map((l) => l.bid));
  const oldest = hits.reduce((m, l) => (!m || l.endedAt < m ? l.endedAt : m), "");
  return buildAnswer({
    source: INFO,
    query: { country: "US", what: input.what, ...(input.state ? { state: input.state } : {}), months: input.months },
    summary: s,
    currency: "USD",
    unit: "per lot",
    period: { from: oldest || from, to: newest },
    method:
      "Median and 10th–90th percentile of the final bid on sold federal surplus auction lots (GSA Auctions, via GovAuctions) that match the lot type, in the stated months. Lots with no bid are left out. The bid excludes the buyer premium. No range under 5 lots.",
    describe: (x) =>
      `Matching surplus lots marked sold had a median final (winning) bid of ${fmtMoney(x.median, "USD")} per lot (10th–90th percentile ${fmtMoney(x.low, "USD")} to ${fmtMoney(x.high, "USD")}); ` +
      "a bid level before the buyer premium, not a confirmed sale price or receipt; used goods at auction, not retail prices.",
    baseUrl: input.baseUrl,
    evidence: AUCTION_EVIDENCE,
  });
}
