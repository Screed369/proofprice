// Taiwan household electricity: Taipower's published tariff table (residential, non-time-of-use, tiered per kWh).
// Format checked live on 2026-10-22 through the GitHub probe: plain GET, no key, one JSON file (about 81 KB, UTF-8) at
// https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json . data["表燈非時間電價"]["住宅用"] holds six
// consumption tiers (120度以下部分, 121~330度部分 ... 1001度以上部分), each with a summer (夏月) and non-summer (非夏月) rate in TWD per kWh.
// This is a regulated POSTED tariff, not a count of paid bills. The headline is the average price per kWh a household
// would be charged for a month's use under the table (bill divided by kWh), which ProofPrice calculates.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const URL_JSON = "https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json";

export const INFO: SourceInfo = {
  id: "tw-taipower-tariffs",
  country: "TW",
  category: "energy (household electricity tariff)",
  name: "Taipower electricity price tables (residential, non-time-of-use)",
  publisher: "Taiwan Power Company (Taipower), via Taiwan's government open data platform (data.gov.tw, dataset 17060)",
  what_is_recorded:
    "The published price per kWh for each monthly consumption tier of the residential tariff (summer and non-summer), in TWD. A regulated tariff schedule, not individual bills.",
  price_type: "posted_price",
  freshness: "Updated when Taipower changes its tariff; each answer states the date the table took effect",
  licence: "Taiwan Open Government Data License, version 1.0 (grants use for any purpose, including derivative products and services, with attribution)",
  licence_url: "https://data.gov.tw/license",
  attribution:
    "Source: Taiwan Power Company, \"All types of electricity price tables and calculation examples\" (Taiwan Open Government Data Platform, dataset 17060), licensed under the Taiwan Open Government Data License, version 1.0 (https://data.gov.tw/license). " +
    "The average price per kWh for a month's use is calculated by ProofPrice from the published tiers.",
  homepage: "https://data.gov.tw/dataset/17060",
  limits:
    "A published tariff schedule, not a count of paid bills, not an offer and not a quote. The average price per kWh is calculated from the residential tier rates only: no tax, surcharge, fixed fee or adjustment is added and none is removed. " +
    "Residential non-time-of-use tariff only (no time-of-use, business or industrial plans). Electricity only (no gas). No sample size.",
};

export interface Tier {
  /** Upper limit of the tier in kWh a month (Infinity for the last tier). */
  upTo: number;
  summer: number;
  nonSummer: number;
  label: string; // the publisher's tier name
}

export interface Table {
  effective: string; // YYYY-MM-DD the table took effect
  tiers: Tier[];
}

/** "120度以下部分" -> 120, "121~330度部分" -> 330, "1001度以上部分" -> Infinity. */
export function tierUpperLimit(label: string): number | null {
  let m = /^(\d+)度以下/.exec(label);
  if (m) return Number(m[1]);
  m = /^(\d+)~(\d+)度/.exec(label);
  if (m) return Number(m[2]);
  if (/^\d+度以上/.test(label)) return Infinity;
  return null;
}

export function parseTable(json: any): Table {
  const res = json?.data?.["表燈非時間電價"]?.["住宅用"];
  const effective = String(json?.metadata?.["實施日期"] ?? "");
  if (!res || typeof res !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    throw new SourceError("Taipower changed the layout of its electricity price table (expected data.表燈非時間電價.住宅用 and metadata.實施日期); this source needs updating.");
  }
  const tiers: Tier[] = [];
  for (const [label, v] of Object.entries<any>(res)) {
    const upTo = tierUpperLimit(label);
    const summer = Number(v?.["夏月"]?.["單價"]);
    const nonSummer = Number(v?.["非夏月"]?.["單價"]);
    if (upTo === null || !Number.isFinite(summer) || !Number.isFinite(nonSummer) || summer <= 0 || nonSummer <= 0) {
      throw new SourceError(`Taipower's residential tier "${label}" could not be read; this source needs updating.`);
    }
    tiers.push({ upTo, summer, nonSummer, label });
  }
  tiers.sort((a, b) => a.upTo - b.upTo);
  if (tiers.length < 2 || tiers[tiers.length - 1].upTo !== Infinity) {
    throw new SourceError("Taipower's residential table does not end with an open top tier; this source needs updating.");
  }
  return { effective, tiers };
}

export type Season = "summer" | "non_summer";

export function normaliseSeason(raw?: string): Season {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s || s === "non_summer" || s === "nonsummer" || s === "winter" || s === "off_season") return "non_summer";
  if (s === "summer") return "summer";
  throw new InputError('season for TW must be "non_summer" (default) or "summer" (Taipower prices summer months higher; the tariff file does not list the months).');
}

export const BANDS: Record<string, { kwh: number; help: string }> = {
  low: { kwh: 120, help: "120 kWh a month (the first tier only)" },
  standard: { kwh: 330, help: "330 kWh a month" },
  high: { kwh: 700, help: "700 kWh a month" },
};

/** "low" / "standard" / "high", or a number of kWh a month (1 to 5000). Empty = standard. */
export function normaliseUse(raw?: string): { kwh: number; band: string } {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "standard" || s === "std" || s === "average") return { kwh: BANDS.standard.kwh, band: "standard" };
  if (s === "low" || s === "high") return { kwh: BANDS[s].kwh, band: s };
  const n = Number(s.replace(/\s*kwh.*$/, ""));
  if (Number.isFinite(n) && n >= 1 && n <= 5000) return { kwh: Math.round(n), band: `${Math.round(n)} kWh a month` };
  throw new InputError('consumption_band for TW must be "standard" (default, 330 kWh a month), "low" (120 kWh a month), "high" (700 kWh a month) or a number of kWh a month between 1 and 5000.');
}

/** Bill in TWD for a month's use, charged tier by tier. */
export function monthlyBill(table: Table, kwh: number, season: Season): number {
  let bill = 0;
  let from = 0;
  for (const t of table.tiers) {
    if (kwh <= from) break;
    const used = Math.min(kwh, t.upTo) - from;
    bill += used * (season === "summer" ? t.summer : t.nonSummer);
    from = t.upTo;
  }
  return bill;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export interface TwInput {
  energy?: string;
  consumption_band?: string;
  season?: string;
  taxes?: string;
  baseUrl?: string;
}

const METHOD =
  "Taiwan electricity: Taipower's published residential (non-time-of-use) price table. The average price per kWh is the bill for a month's use, charged tier by tier at the published rate for the chosen season, divided by the kWh used. " +
  "A posted tariff, not a count of paid bills; no tax, surcharge or fixed fee is added.";

/** Pure: build the answer from a parsed table. */
export function answerFromTable(table: Table, input: TwInput): PriceAnswer {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("TW: only electricity is available (no gas). Use energy=electricity.");
  const { kwh, band } = normaliseUse(input.consumption_band);
  const season = normaliseSeason(input.season);
  const bill = monthlyBill(table, kwh, season);
  const other: Season = season === "summer" ? "non_summer" : "summer";
  const avg = r4(bill / kwh);
  const query: Record<string, unknown> = { country: "TW", energy: "electricity", consumption_band: band, season };
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: avg,
    measure: "average",
    currency: "TWD",
    unit: `per kWh (average over ${kwh} kWh used in a month, residential tiered tariff, ${season === "summer" ? "summer" : "non-summer"} rates, before any tax or surcharge)`,
    period: { from: table.effective, to: null },
    reference_period: `tariff in force from ${table.effective}`,
    method: METHOD,
    describe: (v) =>
      `Under Taipower's published residential tariff (in force from ${table.effective}), a household using ${kwh} kWh in a month at ${season === "summer" ? "summer" : "non-summer"} rates pays about TWD ${v.toFixed(2)} per kWh on average (a bill of TWD ${r2(bill)}).`,
    note: "Published tariff schedule, not a paid bill. Calculated by ProofPrice from the tier rates; no tax, surcharge or fixed fee added.",
    baseUrl: input.baseUrl,
    published: table.effective,
    extra: {
      monthly_use_kwh: kwh,
      season,
      monthly_bill_twd: r2(bill),
      average_price_other_season_twd_per_kwh: r4(monthlyBill(table, kwh, other) / kwh),
      other_season: other,
      tiers: table.tiers.map((t, i) => ({
        tier: t.label,
        up_to_kwh: Number.isFinite(t.upTo) ? t.upTo : null,
        summer_twd_per_kwh: t.summer,
        non_summer_twd_per_kwh: t.nonSummer,
        tier_number: i + 1,
      })),
    },
  });
}

async function fetchJsonText(url: string, timeoutMs = 25000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    const text = await res.text();
    try {
      return JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      throw new SourceError("Taipower did not return JSON for the price table; this source needs updating.", url);
    }
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function twElectricity(input: TwInput, fetcher: (url: string) => Promise<any> = fetchJsonText): Promise<PriceAnswer> {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("TW: only electricity is available (no gas). Use energy=electricity.");
  normaliseUse(input.consumption_band); // fail early on bad input
  normaliseSeason(input.season);
  return answerFromTable(parseTable(await fetcher(URL_JSON)), input);
}
