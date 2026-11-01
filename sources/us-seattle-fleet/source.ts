// City of Seattle: sold surplus fleet equipment (vehicles, trailers, scooters) with the actual sale price at auction.
// Format checked on 2026-11-01 against https://data.seattle.gov/resource/y6ef-jf2w.json (Socrata, no key, 1,621 priced rows 2019-2026).
import { socrataQuery } from "../../lib/adapters";
import { SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "us-seattle-fleet",
  country: "US",
  category: "auctions (surplus auction prices)",
  name: "City of Seattle: sold fleet equipment",
  publisher: "City of Seattle, Fleet Management (data.seattle.gov)",
  what_is_recorded: "One surplus City of Seattle fleet item (car, truck, van, trailer, scooter, patrol vehicle) sold at auction, with its sale price.",
  price_type: "transaction",
  freshness: "Updated irregularly after each auction batch (newest sale 15 Oct 2026 when checked)",
  licence: "Public domain (City of Seattle open data)",
  licence_url: "https://data.seattle.gov/api/catalog/v1",
  attribution: "City of Seattle, 'Fleet equipment sales' (data.seattle.gov). Aggregated by ProofPrice (changed: medians and percentiles only; VINs and department names are not used).",
  homepage: "https://data.seattle.gov/resource/y6ef-jf2w",
  limits:
    "Used City fleet items sold through auction houses, not retail prices and not private sales. One city, a few hundred sales a year at most. Sales recorded with no price are left out. Nothing is returned for fewer than 5 sales.",
};

export const SEATTLE_EVIDENCE = {
  label: "Auction sale prices (City of Seattle fleet)",
  meaning: "The sale price the City of Seattle recorded for each surplus fleet item it sold at auction: used equipment, not retail prices.",
};

export interface Sale {
  type: string;
  group: string;
  text: string; // lower-case words to match: type, group, make, model, description, year
  price: number;
  date: string; // YYYY-MM-DD
}

/** Rows from the Socrata dataset into sales. Rows with no positive price or date are dropped. VIN and department are never read. */
export function parseSales(rows: Record<string, any>[]): Sale[] {
  const out: Sale[] = [];
  for (const r of rows) {
    const price = Number(r.sale_price);
    const date = String(r.sale_date ?? "").slice(0, 10);
    if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const type = String(r.equipment_type ?? "").trim();
    const group = String(r.system_group ?? "").trim();
    const text = [type, group, r.make, r.model, r.description, r.year].map((v) => String(v ?? "").toLowerCase()).join(" ");
    out.push({ type, group, text, price, date });
  }
  return out;
}

/** Every word of the request must appear in the item's type, group, make, model or description ("pickup truck", "ford van", "scooter"). */
export function matchSales(sales: Sale[], what: string, fromDate?: string): Sale[] {
  const words = what.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  return sales.filter((s) => (!fromDate || s.date >= fromDate) && words.every((w) => s.text.includes(w)));
}

let cache: { at: number; sales: Sale[] } | null = null;

async function loadSales(): Promise<Sale[]> {
  if (cache && Date.now() - cache.at < 24 * 3600 * 1000) return cache.sales;
  const rows = await socrataQuery("data.seattle.gov", "y6ef-jf2w", {
    select: ["year", "make", "model", "description", "equipment_type", "system_group", "sale_price", "sale_date"],
    where: "sale_price > 0",
    order: "sale_date DESC",
    limit: 5000,
  });
  const sales = parseSales(rows);
  if (!sales.length) throw new SourceError("The Seattle fleet sales file held no priced sales");
  cache = { at: Date.now(), sales };
  return sales;
}

export async function seattleFleetPrices(input: { what: string; months: number; baseUrl?: string }, sales?: Sale[]): Promise<PriceAnswer> {
  const all = sales ?? (await loadSales());
  const newest = all.reduce((m, s) => (s.date > m ? s.date : m), "");
  const d = new Date(newest + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - input.months);
  const from = d.toISOString().slice(0, 10);
  const hits = matchSales(all, input.what, from);
  const oldest = hits.reduce((m, s) => (!m || s.date < m ? s.date : m), "");
  return buildAnswer({
    source: INFO,
    query: { country: "US", city: "Seattle", what: input.what, months: input.months },
    summary: summarise(hits.map((s) => s.price)),
    currency: "USD",
    unit: "per item",
    period: { from: oldest || from, to: newest },
    method:
      "Median and 10th–90th percentile of the sale price of City of Seattle surplus fleet items sold at auction that match the words asked for, in the stated months before the newest sale. Sales with no price are left out. No range under 5 sales.",
    describe: (x) =>
      `Matching City of Seattle fleet items sold at auction had a median sale price of ${fmtMoney(x.median, "USD")} (10th–90th percentile ${fmtMoney(x.low, "USD")} to ${fmtMoney(x.high, "USD")}); ` +
      "used city equipment sold at auction, not retail prices.",
    baseUrl: input.baseUrl,
    evidence: SEATTLE_EVIDENCE,
  });
}
