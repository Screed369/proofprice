// Taiwan gas: CPC Corporation's posted list prices (data.gov.tw, Open Government Data License v1.0).
// Format checked live on 2026-11-09 (plain GET, no key, JSON array):
//   https://vipmbr.cpc.com.tw/opendata/naturalgaslistprice  10 rows, 牌價生效日期 1151101 (ROC year 115 = 2026) = 2026-11-01
//   https://vipmbr.cpc.com.tw/opendata/lpglistprice         19 rows, 牌價生效日期 1150402 = 2026-04-02
// Fields used: 產品名稱 (product), 銷售對象 (customer), 交貨地點 (delivery point), 計價單位 (unit), 參考牌價_金額 (list price, TWD),
// 牌價生效日期 (effective date, ROC yyymmdd). Prices are CPC list prices before 5% business tax: POSTED, never paid prices.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const NATURAL_GAS_URL = "https://vipmbr.cpc.com.tw/opendata/naturalgaslistprice";
export const LPG_URL = "https://vipmbr.cpc.com.tw/opendata/lpglistprice";

export const INFO: SourceInfo = {
  id: "tw-cpc-gas",
  country: "TW",
  category: "energy (natural gas and LPG list prices)",
  name: "CPC list prices for natural gas and LPG",
  publisher: "CPC Corporation, Taiwan (state oil and gas company), published on data.gov.tw",
  what_is_recorded:
    "CPC's published list prices (TWD, before 5% business tax) for natural gas per cubic metre and LPG per kilogram, by customer type. A posted list price, not what any customer paid.",
  price_type: "posted_price",
  freshness: "Changes when CPC revises its list: natural gas from 2026-11-01, LPG from 2026-04-02 at the time of writing; each answer states its effective date",
  licence: "Open Government Data License, version 1.0 (Taiwan): free of purpose, time and place, non-exclusive, irrevocable, royalty-free use including products and services; attribution required; compatible with CC BY 4.0",
  licence_url: "https://data.gov.tw/license",
  attribution:
    "Contains CPC Corporation, Taiwan list-price open data (natural gas and LPG) from data.gov.tw, made available under the Government Open Data License version 1.0 (https://data.gov.tw/license). ProofPrice converts the effective date and selects the rows.",
  homepage: "https://vipmbr.cpc.com.tw/opendata/naturalgaslistprice",
  limits:
    "CPC list prices, not paid prices and not a household bill: most natural gas customers are industry and utilities, and only one row (CPC's own direct household customers in the Hsinchu-Miaoli area) is a household price. LPG list prices are to dealers, not the cylinder price a household pays. Before 5% business tax. No sample size.",
};

export interface CpcRow {
  product: string;
  customer: string;
  place: string;
  unit: string;
  price: number;
  /** ISO date. */
  effective: string;
}

/** Pure: ROC date "1151101" (year 115 = 2026) to ISO "2026-11-01". */
export function rocToIso(raw: unknown): string | null {
  const m = /^(\d{2,3})(\d{2})(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  return `${y}-${m[2]}-${m[3]}`;
}

/** Pure: normalise a CPC JSON array. Rows without a usable price, unit or date are dropped. */
export function parseRows(json: unknown): CpcRow[] {
  if (!Array.isArray(json)) throw new SourceError("CPC did not return a list of prices; this source needs updating.");
  const rows: CpcRow[] = [];
  for (const r of json as Record<string, any>[]) {
    const price = Number(r?.["參考牌價_金額"]);
    const effective = rocToIso(r?.["牌價生效日期"]);
    const unit = String(r?.["計價單位"] ?? "").replace(/\s+/g, "");
    if (!Number.isFinite(price) || price <= 0 || !effective || !unit) continue;
    rows.push({
      product: String(r?.["產品名稱"] ?? "").replace(/\s+/g, " ").trim(),
      customer: String(r?.["銷售對象"] ?? "").trim(),
      place: String(r?.["交貨地點"] ?? "").trim(),
      unit,
      price,
      effective,
    });
  }
  if (rows.length === 0) throw new SourceError("CPC price list had no usable rows; this source needs updating.");
  return rows;
}

export type Fuel = "natural_gas" | "lpg";
export type Band = "household" | "industrial" | "utility" | "cogeneration" | "power";
// The shared energy parameter only accepts electricity|gas, so LPG is asked as energy=gas&consumption_band=lpg.

/** Pure: energy input to a fuel. */
export function normaliseFuel(raw?: string): Fuel {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "gas" || s === "natural_gas" || s === "mains_gas" || s === "lng") return "natural_gas";
  if (s === "lpg" || s === "propane" || s === "bottled_gas" || s === "cylinder") return "lpg";
  throw new InputError("TW gas: use energy=gas (natural gas, per cubic metre) or energy=lpg (per kilogram).");
}

/** Pure: consumption_band for natural gas. Empty, standard and household mean CPC's direct household customers. */
export function normaliseBand(raw?: string): Band {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s || s === "standard" || s === "household" || s === "home") return "household";
  if (s === "industrial" || s === "industry") return "industrial";
  if (s === "utility" || s === "gas_utility") return "utility";
  if (s === "cogeneration" || s === "chp") return "cogeneration";
  if (s === "power" || s === "power_plant" || s === "electricity") return "power";
  throw new InputError('consumption_band for TW gas: "household" (default), "industrial", "utility", "cogeneration", "power" or "lpg".');
}

const CUSTOMER: Record<Band, string> = {
  household: "本公司直營家庭用戶",
  industrial: "工業用戶",
  utility: "公用天然氣事業用戶",
  cogeneration: "合格汽電共生系統用戶",
  power: "電業用戶",
};
const LABEL: Record<Band, string> = {
  household: "CPC direct household customers (Hsinchu-Miaoli distribution area)",
  industrial: "industrial customers",
  utility: "gas utility customers",
  cogeneration: "qualified cogeneration customers",
  power: "power-sector customers",
};

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export interface TwGasInput {
  energy?: string;
  consumption_band?: string;
  baseUrl?: string;
}

/** Pure: natural gas answer from the parsed natural gas list. Uses the cubic-metre rows of product 天然氣（1） (the standard grade). */
export function naturalGasAnswer(rows: CpcRow[], band: Band, input: TwGasInput): PriceAnswer {
  const cubic = rows.filter((r) => r.unit.includes("立方公尺"));
  // Standard grade 天然氣（1） first; the power-sector customers are listed only under grade （2）.
  let grade = cubic.filter((r) => r.product.startsWith("天然氣（1）"));
  let picked = grade.filter((r) => r.customer === CUSTOMER[band]);
  if (picked.length === 0) {
    grade = cubic;
    picked = grade.filter((r) => r.customer === CUSTOMER[band]);
  }
  if (picked.length === 0) throw new SourceError(`CPC natural gas list has no row for ${LABEL[band]}; this source needs updating.`);
  const row = picked[0];
  const all = grade.map((r) => r.price);
  const name = LABEL[band];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "TW", energy: "gas", consumption_band: band },
    value: r4(row.price),
    measure: "average",
    currency: "TWD",
    unit: `per cubic metre (natural gas, ${name}, CPC list price before 5% business tax)`,
    period: { from: row.effective, to: null },
    reference_period: `list effective ${row.effective}`,
    min: r4(Math.min(...all)),
    max: r4(Math.max(...all)),
    method:
      "Taiwan natural gas: CPC Corporation's published list price (TWD per cubic metre, before 5% business tax) for the chosen customer type, standard grade 天然氣（1）, in force from the effective date. A posted list price, not a count of paid bills.",
    describe: (v) => `CPC's list price of natural gas for ${name} in Taiwan was TWD ${v} per cubic metre from ${row.effective}, before 5% business tax.`,
    note: "CPC list price, not a paid price. Most natural gas customers are industry and utilities; only the household row is a household price.",
    baseUrl: input.baseUrl,
    extra: {
      fuel: "natural_gas",
      customer: row.customer,
      delivery_area: row.place || null,
      effective_date: row.effective,
      business_tax_pct: 5,
      product: row.product,
      all_customer_types: grade.map((r) => ({ product: r.product, customer: r.customer, twd_per_m3: r.price })),
    },
  });
}

/** Pure: LPG answer: household-use LPG list price to dealers (家庭用), median across CPC delivery points. */
export function lpgAnswer(rows: CpcRow[], input: TwGasInput): PriceAnswer {
  const home = rows.filter((r) => r.product.startsWith("液化石油氣(家庭用)") && r.unit.includes("公斤"));
  if (home.length === 0) throw new SourceError("CPC LPG list has no household-use LPG rows; this source needs updating.");
  const prices = home.map((r) => r.price);
  const effective = home.map((r) => r.effective).sort().pop() as string;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "TW", energy: "lpg" },
    value: r4(median(prices)),
    measure: "median",
    currency: "TWD",
    unit: "per kilogram (household-use LPG, CPC list price to dealers at its delivery points, before 5% business tax)",
    period: { from: effective, to: null },
    reference_period: `list effective ${effective}`,
    min: r4(Math.min(...prices)),
    max: r4(Math.max(...prices)),
    method:
      "Taiwan LPG: the median of CPC Corporation's published household-use LPG list prices (TWD per kg, before 5% business tax) across its dealer delivery points. A wholesale list price to dealers, not the price of a cylinder bought by a household.",
    describe: (v) => `CPC's household-use LPG list price to dealers in Taiwan was TWD ${v} per kg from ${effective}, before 5% business tax.`,
    note: "CPC list price to dealers, not a paid price and not the retail cylinder price.",
    baseUrl: input.baseUrl,
    extra: {
      fuel: "lpg",
      delivery_points: home.map((r) => ({ place: r.place, twd_per_kg: r.price })),
      effective_date: effective,
      business_tax_pct: 5,
    },
  });
}

async function get(url: string): Promise<unknown> {
  return retryOnce(() => fetchJson(url, {}, 9000));
}

export async function twGas(input: TwGasInput, fetcher: (url: string) => Promise<unknown> = get): Promise<PriceAnswer> {
  const fuel = normaliseFuel(input.energy);
  const bandRaw = (input.consumption_band ?? "").trim().toLowerCase();
  if (fuel === "lpg" || bandRaw === "lpg") return lpgAnswer(parseRows(await fetcher(LPG_URL)), input);
  const band = normaliseBand(input.consumption_band);
  return naturalGasAnswer(parseRows(await fetcher(NATURAL_GAS_URL)), band, input);
}
