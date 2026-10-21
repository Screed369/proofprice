// Taiwan fuel: the posted island-wide pump list price of CPC Corporation (state oil company), from CPC's open-data API.
// Format checked 2026-10-18 from GitHub's servers (Builder-verified by the Verifier probe): GET https://vipmbr.cpc.com.tw/openData/MainProdListPrice_English
// returns a JSON array (UTF-8, Chinese keys). Per product: 產品名稱 (name), 計價單位 ("NT$ per liter"; marine fuels are per kiloliter and are ignored),
// 參考牌價_金額 (number, NT$ including 5% VAT and excise), 牌價生效日期 (Minguo date yyyMMdd: 1151019 = 2026-10-19; the next Monday's price is already
// published on Sunday). The feed holds only the current list price, so the daily collector keeps the history.
// Fixture rows in fixtures/ were copied from that response.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";

export const API_URL = "https://vipmbr.cpc.com.tw/openData/MainProdListPrice_English";
export const PAGE_URL = "https://vipmbr.cpc.com.tw/openData/swagger/index.html";
export const LICENCE_URL = "https://data.gov.tw/license";

export const INFO: SourceInfo = {
  id: "tw-fuel",
  country: "TW (Taiwan)",
  category: "fuel (posted national pump list price)",
  name: "CPC Corporation, Taiwan: posted pump list prices (open-data API)",
  publisher: "CPC Corporation, Taiwan (state-owned oil company), open data service",
  what_is_recorded:
    "The island-wide posted retail list price in New Taiwan dollars (NT$) per litre of 92, 95 and 98 unleaded petrol, 95E3 gasohol and premium diesel at CPC stations, with the date it takes effect. Prices include 5% VAT and the fuel excise.",
  price_type: "posted_pump_price",
  freshness: "Changes usually on Mondays; the next week's list price is published the day before",
  licence: "Government Open Data License v1.0 (Taiwan)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: Taiwan CPC Corporation open data (vipmbr.cpc.com.tw/openData), Government Open Data License v1.0. Figures are passed on as published; the changes on the previous price are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "A posted list price of one company (CPC), the same everywhere on the island: not a station survey, not what each customer paid, and no town, range or sample size. " +
    "Formosa Petrochemical, the other large seller, posts its own price (usually the same) and is not included. Stations can differ slightly. No e10, e85, LPG or methane series.",
};

export interface TwProduct { name: string; ntdPerLitre: number; effective: string }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Minguo date "1151019" (year 115 = 2026) to "2026-10-19". Null when it is not a 7-digit Minguo date. */
export function minguoToIso(s: unknown): string | null {
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The per-litre products (marine fuels, priced per kilolitre, are dropped). Throws SourceError when the layout is not the one we know. */
export function parseProducts(json: unknown): TwProduct[] {
  if (!Array.isArray(json)) throw new SourceError("CPC changed the layout of the pump price feed (expected a JSON array); this source needs updating.");
  const out: TwProduct[] = [];
  for (const r of json as any[]) {
    if (!r || typeof r !== "object") continue;
    const unit = String(r["計價單位"] ?? "");
    const price = num(r["參考牌價_金額"]);
    const effective = minguoToIso(r["牌價生效日期"]);
    const name = String(r["產品名稱"] ?? "").trim();
    if (!name || price === null || !effective || !/per\s+lit(re|er)\b/i.test(unit)) continue;
    out.push({ name, ntdPerLitre: price, effective });
  }
  if (json.length && !out.length) throw new SourceError("CPC pump price feed had no per-litre rows; this source needs updating.");
  return out;
}

/** Our fuel names to CPC product names. 92 petrol and 95E3 are not in the shared fuel list: they are given in extra. */
export const SERIES: Record<string, { cpc: string; label: string }> = {
  diesel: { cpc: "Premium Diesel", label: "premium diesel" },
  petrol95: { cpc: "95 Unleaded Gasoline", label: "95 unleaded petrol" },
  petrol98: { cpc: "98 Unleaded Gasoline", label: "98 unleaded petrol" },
};

const ntd = (v: number) => `NT$${v.toFixed(1)}`;

export const METHOD =
  "Taiwan fuel: the island-wide posted list price of CPC Corporation, in New Taiwan dollars per litre (5% VAT and excise included), for the newest list price in CPC's open-data feed, with the date it takes effect. " +
  "A posted price of one company, not a station survey and not what each customer paid; the daily collector keeps the weekly history.";

export interface TwFuelInput { fuel?: string; town?: string; area?: string; postcode?: string; baseUrl?: string }

export function answerFromProducts(products: TwProduct[], input: TwFuelInput): PriceAnswer {
  const series = SERIES[input.fuel ?? ""];
  if (!series) throw new InputError("Taiwan: fuel must be diesel (premium diesel), petrol95 or petrol98. 92 unleaded and 95E3 gasohol are given in the extra fields.");
  const place = input.town || input.area || input.postcode;
  const query = { country: "TW", fuel: input.fuel, ...(place ? { place } : {}) };
  const hit = products.find((p) => p.name.toLowerCase() === series.cpc.toLowerCase());
  if (!hit) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "TWD", unit: "per litre",
      period: { from: null, to: null }, reference_period: "n/a", method: METHOD, describe: () => "", baseUrl: input.baseUrl,
    });
  }
  const others = Object.fromEntries(products.map((p) => [p.name, p.ntdPerLitre]));
  const note =
    (place ? `CPC publishes one island-wide list price only; '${place}' is answered with the Taiwan price. ` : "") +
    "Posted list price of CPC Corporation, not a station survey and not what each customer paid.";
  return buildStatisticAnswer({
    source: INFO, query, value: hit.ntdPerLitre, measure: "average", currency: "TWD", unit: "per litre",
    period: { from: hit.effective, to: hit.effective },
    reference_period: `list price effective ${hit.effective}`,
    method: METHOD,
    note: note.trim(),
    ending: `List price published by ${INFO.publisher}, effective ${hit.effective}.`,
    describe: (v) => `The posted CPC list price of ${series.label} in Taiwan is ${ntd(v)} per litre, effective ${hit.effective} (VAT and excise included).`,
    baseUrl: input.baseUrl,
    extra: {
      list_prices_ntd_per_litre: others,
      price_includes: "5% VAT and fuel excise",
      ...(place ? { place_note: "national figure only" } : {}),
    },
  });
}

export async function twFuel(input: TwFuelInput, fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u)): Promise<PriceAnswer> {
  return answerFromProducts(parseProducts(await fetcher(API_URL)), input);
}

// ---------- daily collector ----------

/** One library row per fuel: the published list price (n = 5 is a placeholder, see nominalCounts in the manifest). */
export function harvestFromProducts(products: TwProduct[]): HarvestResult {
  const rows = Object.entries(SERIES).flatMap(([item, s]) => {
    const p = products.find((x) => x.name.toLowerCase() === s.cpc.toLowerCase());
    return p ? [{ area: "ALL", item, n: 5, median: p.ntdPerLitre, low: p.ntdPerLitre, high: p.ntdPerLitre, min: p.ntdPerLitre, max: p.ntdPerLitre }] : [];
  });
  if (!rows.length) throw new SourceError("CPC pump price feed had none of the expected fuels; this source needs updating.");
  const date = products.find((p) => p.name === SERIES.petrol95.cpc)?.effective ?? products[0].effective;
  return {
    date,
    currency: "TWD",
    unit: "per litre",
    rows,
    note: `CPC Corporation posted island-wide list prices, NT$ per litre, effective ${date}, VAT and excise included. Published values, not counts of records (n=5 is a placeholder).`,
  };
}

export async function twHarvest(fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u)): Promise<HarvestResult> {
  return harvestFromProducts(parseProducts(await fetcher(API_URL)));
}

export function twHistoryKey(p: { country: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (p.country.trim().toUpperCase() !== "TW" || !SERIES[p.fuel]) return null;
  return { area: "ALL", item: p.fuel, label: "Taiwan (CPC posted list price)" };
}
