// Hong Kong fuel: the posted pump prices of the five main oil companies, from the Consumer Council's Oil Watch open data (via DATA.GOV.HK).
// Format checked 2026-10-29 from GitHub's servers (Verifier B probe hkfuelcsv): GET https://www.consumer.org.hk/pricewatch/oilwatch/opendata/oilprice_en.csv
// returns a 472-byte CSV (UTF-8 with BOM): "Auto-fuel Type","Oil Company","Pump Price\n(HKD / Litre)" (the third header cell holds a newline),
// then 15 rows = Standard Petrol / Premium Petrol / Diesel x Sinopec, PetroChina, Caltex, Esso, Shell. There is NO date column: the date of a
// figure is the day we fetched it, so the daily collector builds the history. The fixture in fixtures/ is that exact file.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const CSV_URL = "https://www.consumer.org.hk/pricewatch/oilwatch/opendata/oilprice_en.csv";
export const PAGE_URL = "https://data.gov.hk/en-data/dataset/cc-oilprice-oilprice";
export const LICENCE_URL = "https://data.gov.hk/en/terms-and-conditions";

export const INFO: SourceInfo = {
  id: "hk-consumer-fuel",
  country: "HK (Hong Kong)",
  category: "fuel (posted pump prices of the main oil companies)",
  name: "Consumer Council Oil Watch: pump prices of auto-fuels (DATA.GOV.HK)",
  publisher: "Consumer Council, Hong Kong (open data on DATA.GOV.HK)",
  what_is_recorded:
    "The posted pump price in Hong Kong dollars (HKD) per litre of standard petrol, premium petrol and diesel at each of five oil companies (Sinopec, PetroChina, Caltex, Esso, Shell), as collected by the Consumer Council.",
  price_type: "posted_pump_price",
  freshness: "Updated by the Consumer Council as and when prices change; the file carries no date, so the date shown is the day ProofPrice fetched it",
  licence: "DATA.GOV.HK Terms and Conditions v1.2 (free commercial and non-commercial reuse if the source is identified and the Government's and the Consumer Council's ownership acknowledged)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: Consumer Council, Hong Kong (via DATA.GOV.HK), Pump Prices of Auto-Fuels. Data owned by the Government of the Hong Kong SAR and the Consumer Council. The median and range across the five companies are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Posted pump prices: one list price per oil company (five companies), not a station survey, not what each customer paid (discounts and member rates are not included) and no town or sample size. " +
    "The file has no date, so the figure is dated the day it was fetched. 'Standard petrol' is answered as petrol95 and 'premium petrol' as petrol98: the file does not state octane numbers. No e10, e85, LPG or methane series.",
};

export interface HkRow { fuel: string; company: string; price: number }

/** Parse the CSV with a real state machine: quoted cells may hold newlines (the header does), and the file starts with a BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** The price rows. Throws SourceError when the layout is not the one we know. */
export function parseOilPrices(text: string): HkRow[] {
  const rows = parseCsv(text);
  const head = rows[0]?.map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  if (!head || head.length < 3 || !head[0].includes("fuel type") || !head[1].includes("company") || !head[2].includes("pump price")) {
    throw new SourceError("The Consumer Council changed the layout of the oil price file (header not recognised); this source needs updating.");
  }
  const out: HkRow[] = [];
  for (const r of rows.slice(1)) {
    const price = Number(r[2]);
    const fuel = (r[0] ?? "").trim();
    const company = (r[1] ?? "").trim();
    if (!fuel || !company || !Number.isFinite(price) || price <= 0) continue;
    out.push({ fuel, company, price });
  }
  if (!out.length) throw new SourceError("The Consumer Council oil price file had no price rows; this source needs updating.");
  return out;
}

/** Our fuel names to the Consumer Council's labels. */
export const SERIES: Record<string, { csv: string; label: string; note?: string }> = {
  diesel: { csv: "Diesel", label: "diesel" },
  petrol95: { csv: "Standard Petrol", label: "standard petrol", note: "Answered with the Consumer Council's 'Standard Petrol' (the file does not state an octane number)." },
  petrol98: { csv: "Premium Petrol", label: "premium petrol", note: "Answered with the Consumer Council's 'Premium Petrol' (the file does not state an octane number)." },
};

export interface Companies { prices: Record<string, number>; sorted: number[]; median: number }

export function companiesFor(rows: HkRow[], fuel: string): Companies | null {
  const s = SERIES[fuel];
  if (!s) return null;
  const hits = rows.filter((r) => r.fuel.toLowerCase() === s.csv.toLowerCase());
  if (!hits.length) return null;
  const sorted = hits.map((h) => h.price).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { prices: Object.fromEntries(hits.map((h) => [h.company, h.price])), sorted, median: Math.round(median * 100) / 100 };
}

const hkd = (v: number) => `HK$${v.toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);

export const METHOD =
  "Hong Kong fuel: the median of the posted pump prices (HKD per litre) of the five oil companies in the Consumer Council's Oil Watch open data, with the lowest and highest company price and each company's price in extra. " +
  "Posted prices, one per company: not a station survey and not what each customer paid. The file carries no date, so the figure is dated the day it was fetched; the daily collector keeps the history.";

export interface HkFuelInput { fuel?: string; town?: string; area?: string; postcode?: string; baseUrl?: string; asOf?: string }

export function answerFromRows(rows: HkRow[], input: HkFuelInput): PriceAnswer {
  const series = SERIES[input.fuel ?? ""];
  if (!series) throw new InputError("Hong Kong: fuel must be diesel, petrol95 (standard petrol) or petrol98 (premium petrol).");
  const place = input.town || input.area || input.postcode;
  const query = { country: "HK", fuel: input.fuel, ...(place ? { place } : {}) };
  const asOf = input.asOf ?? today();
  const c = companiesFor(rows, input.fuel!);
  if (!c) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "median", currency: "HKD", unit: "per litre",
      period: { from: null, to: null }, reference_period: "n/a", method: METHOD, describe: () => "", baseUrl: input.baseUrl,
    });
  }
  const note =
    (series.note ? series.note + " " : "") +
    (place ? `The Consumer Council publishes company prices for the whole territory only; '${place}' is answered with the Hong Kong figure. ` : "") +
    "Posted pump prices of five oil companies, not a station survey and not what each customer paid.";
  const lo = c.sorted[0];
  const hi = c.sorted[c.sorted.length - 1];
  return buildStatisticAnswer({
    source: INFO, query, value: c.median, measure: "median", currency: "HKD", unit: "per litre",
    period: { from: asOf, to: asOf },
    reference_period: `posted prices fetched ${asOf}`,
    min: lo, max: hi,
    method: METHOD,
    note: note.trim(),
    ending: `Posted prices published by ${INFO.publisher}, fetched ${asOf}.`,
    describe: (v) =>
      `The median posted pump price of ${series.label} in Hong Kong is ${hkd(v)} per litre across ${c.sorted.length} oil companies (lowest ${hkd(lo)}, highest ${hkd(hi)}), as of ${asOf}.`,
    baseUrl: input.baseUrl,
    extra: {
      company_prices_hkd_per_litre: c.prices,
      companies: c.sorted.length,
      ...(place ? { place_note: "territory-wide figure only" } : {}),
    },
  });
}

async function fetchCsv(timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(CSV_URL, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, CSV_URL, res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", CSV_URL);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function hkFuel(input: HkFuelInput, fetcher: () => Promise<string> = fetchCsv): Promise<PriceAnswer> {
  return answerFromRows(parseOilPrices(await fetcher()), input);
}

// ---------- daily collector ----------
// One row per fuel for the day of the fetch; n is NO_COUNT (five company list prices, not a count of sales), see nominalCounts in the manifest.

export function harvestFromRows(rows: HkRow[], date: string = today()): HarvestResult {
  const out = [];
  for (const item of Object.keys(SERIES)) {
    const c = companiesFor(rows, item);
    if (!c) continue;
    out.push({ area: "HK", item, n: NO_COUNT, median: c.median, low: c.sorted[0], high: c.sorted[c.sorted.length - 1], min: c.sorted[0], max: c.sorted[c.sorted.length - 1] });
  }
  if (!out.length) throw new SourceError("The Consumer Council oil price file held none of the expected fuels; this source needs updating.");
  return {
    date,
    currency: "HKD",
    unit: "per litre",
    rows: out,
    note: `Consumer Council Oil Watch: median of the posted pump prices of five oil companies, HKD per litre, fetched ${date}. Low and high are the cheapest and dearest company. Published list prices, not counts of sales.`,
  };
}

export async function hkHarvest(fetcher: () => Promise<string> = fetchCsv): Promise<HarvestResult> {
  return harvestFromRows(parseOilPrices(await fetcher()));
}

export function hkHistoryKey(p: { country: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (p.country.trim().toUpperCase() !== "HK" || !SERIES[p.fuel]) return null;
  return { area: "HK", item: p.fuel, label: "Hong Kong (posted prices, five oil companies)" };
}
