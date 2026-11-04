// CH wholesale reference prices for renewable power: BFE (Swiss Federal Office of Energy), "Referenz-Marktpreise gemäss Art. 15 EnFV".
// Format checked live on 2026-11-04 (plain GET from the cloud workspace, 200, text/csv, 39 data rows, Jul 2023 to Sep 2026).
// Terms: opendata.swiss "terms_by" (free use incl. commercial, citing author, title and link of the dataset is mandatory;
// read on https://opendata.swiss/de/terms-of-use on 2026-11-04). The dataset record adds "Source: EPEX SPOT. Data used with permission",
// so the licence is NOT cleared for resale: this source is free tier only (never listed in lib/payments/cleared.ts).
// CSV columns: Year,Month,Days, then per technology Volume_<t>_MWh and Price_<t>_CHF_MWh for pv, wasserkraft (hydro), windenergie (wind), biomasse.
// The price is the monthly volume-weighted market reference price for that technology in CHF per MWh, excluding VAT. A statistic, not a paid price.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, retryOnce } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const CSV_URL = "https://www.bfe-ogd.ch/ogd60_rmp_monatspreise.csv";

export const INFO: SourceInfo = {
  id: "ch-bfe-reference-prices",
  country: "CH",
  category: "wholesale-power (monthly wholesale reference market prices for renewable power)",
  name: "Referenz-Marktpreise gemäss Art. 15 EnFV (monthly reference market prices)",
  publisher: "Bundesamt für Energie BFE (Swiss Federal Office of Energy), published on opendata.swiss",
  what_is_recorded:
    "For each month and each technology (solar PV, hydro, wind, biomass): the volume-weighted reference market price in CHF per MWh (excluding VAT) " +
    "that BFE sets for feed-in remuneration under Art. 15 of the Energy Ordinance, and the generation volume in MWh it is based on. Monthly; never individual contracts.",
  price_type: "official_statistic",
  freshness: "Monthly, a few weeks after month end; each answer states the month it is for",
  licence: "opendata.swiss terms of use, class terms_by: free use including commercial use, citing the source (author, title, link) is mandatory. Data from EPEX SPOT used with permission.",
  licence_url: "https://opendata.swiss/de/terms-of-use",
  attribution:
    "Source: Bundesamt für Energie BFE, Referenz-Marktpreise gemäss Art. 15 EnFV, https://opendata.swiss/de/dataset/referenz-marktpreise-gemass-art-15-enfv " +
    "(Source: EPEX SPOT. Data used with permission). The all-technology figure is a volume-weighted average calculated by ProofPrice from BFE's per-technology prices and volumes.",
  homepage: "https://opendata.swiss/de/dataset/referenz-marktpreise-gemass-art-15-enfv",
  limits:
    "A wholesale reference price for renewable electricity fed into the Swiss grid, monthly, in Swiss francs per MWh excluding VAT. Not a day-ahead hourly price, " +
    "not what a household or business pays on a bill, and not a price paid in an individual deal. Volumes are BFE's published volumes; BFE gives no record count.",
};

export type Tech = "pv" | "hydro" | "wind" | "biomass";
export const TECHS: Tech[] = ["pv", "hydro", "wind", "biomass"];
const COLS: Record<Tech, { vol: string; price: string; label: string }> = {
  pv: { vol: "Volume_pv_MWh", price: "Price_pv_CHF_MWh", label: "solar PV" },
  hydro: { vol: "Volume_wasserkraft_MWh", price: "Price_wasserkraft_CHF_MWh", label: "hydro" },
  wind: { vol: "Volume_windenergie_MWh", price: "Price_windenergie_CHF_MWh", label: "wind" },
  biomass: { vol: "Volume_biomasse_MWh", price: "Price_biomasse_CHF_MWh", label: "biomass" },
};
const TECH_ALIASES: Record<string, Tech | "all"> = {
  all: "all", pv: "pv", solar: "pv", photovoltaic: "pv", photovoltaik: "pv", hydro: "hydro", water: "hydro", hydropower: "hydro", wasserkraft: "hydro",
  wind: "wind", windenergie: "wind", biomass: "biomass", biomasse: "biomass",
};

/** "solar", "Hydro", "" -> the technology; "all" (default) = volume-weighted across the four. Throws for anything else. */
export function normaliseTech(raw?: string): Tech | "all" {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s) return "all";
  const t = TECH_ALIASES[s];
  if (!t) throw new InputError('technology must be one of: all (default), pv (solar), hydro, wind, biomass. Example: country=CH&technology=hydro');
  return t;
}

export interface Month {
  year: number;
  month: number;
  key: string; // YYYY-MM
  prices: Partial<Record<Tech, number>>; // CHF per MWh
  volumes: Partial<Record<Tech, number>>; // MWh
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Parse the BFE monthly CSV. A changed layout is reported, never guessed; rows without a year/month are dropped; empty prices are skipped. */
export function parseMonthly(csv: string): Month[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const idx = (n: string) => head.indexOf(n);
  for (const n of ["Year", "Month"]) if (idx(n) < 0) throw new SourceError("BFE answer has an unexpected layout", `missing column ${n}`);
  if (!TECHS.some((t) => idx(COLS[t].price) >= 0)) throw new SourceError("BFE answer has an unexpected layout", "no Price_<technology>_CHF_MWh column");
  const out: Month[] = [];
  for (const line of lines.slice(1)) {
    const r = line.split(",");
    const year = Number(r[idx("Year")]);
    const month = Number(r[idx("Month")]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    const prices: Month["prices"] = {};
    const volumes: Month["volumes"] = {};
    for (const t of TECHS) {
      const pi = idx(COLS[t].price);
      const vi = idx(COLS[t].vol);
      const p = pi >= 0 && r[pi] !== undefined && r[pi].trim() !== "" ? Number(r[pi]) : NaN;
      const v = vi >= 0 && r[vi] !== undefined && r[vi].trim() !== "" ? Number(r[vi]) : NaN;
      if (Number.isFinite(p) && p > 0) {
        prices[t] = p;
        if (Number.isFinite(v) && v > 0) volumes[t] = v;
      }
    }
    if (Object.keys(prices).length === 0) continue;
    out.push({ year, month, key: `${year}-${pad(month)}`, prices, volumes });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The month's figure: one technology's price, or the volume-weighted average of the technologies that have a price and a volume. */
export function monthFigure(m: Month, tech: Tech | "all"): number | null {
  if (tech !== "all") return m.prices[tech] ?? null;
  let num = 0;
  let den = 0;
  for (const t of TECHS) {
    const p = m.prices[t];
    const v = m.volumes[t];
    if (p !== undefined && v !== undefined) { num += p * v; den += v; }
  }
  return den > 0 ? num / den : null;
}

export interface ChQuery { technology?: string; commodity?: string; lookback_days?: number; baseUrl?: string }

/** Pure: build the answer from the parsed months. */
export function chReferenceAnswer(months: Month[], q: ChQuery): PriceAnswer {
  const commodity = (q.commodity ?? "").trim().toLowerCase();
  if (commodity && commodity !== "electricity") throw new InputError('Switzerland: only commodity "electricity" is available from this source (no gas).');
  const tech = normaliseTech(q.technology);
  const label = tech === "all" ? "all technologies, volume-weighted" : COLS[tech].label;
  const query = { country: "CH", commodity: "electricity", technology: tech };
  const method =
    `Switzerland wholesale electricity: the monthly reference market price BFE publishes for renewable power (${label}), CHF per MWh excluding VAT, newest month. ` +
    "An official statistic (volume-weighted by BFE), not an hourly day-ahead price and not a count of paid bills.";
  const series = months.map((m) => ({ m, v: monthFigure(m, tech) })).filter((x): x is { m: Month; v: number } => x.v !== null);
  if (series.length === 0) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "CHF", unit: "per MWh",
      period: { from: null, to: null }, reference_period: "", method, describe: () => "", baseUrl: q.baseUrl,
    });
  }
  const latest = series[series.length - 1];
  const last12 = series.slice(-12);
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const yearAgo = series.find((x) => x.m.key === `${latest.m.year - 1}-${pad(latest.m.month)}`) ?? null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const lastDay = new Date(Date.UTC(latest.m.year, latest.m.month, 0)).getUTCDate();
  const from = `${latest.m.key}-01`;
  const to = `${latest.m.key}-${pad(lastDay)}`;
  const value = round2(latest.v);
  const recent = last12.map((x) => ({ month: x.m.key, chf_per_mwh: round2(x.v) }));
  const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "CHF",
    unit: "per MWh",
    period: { from, to },
    reference_period: latest.m.key,
    sample_size: null,
    min: round2(Math.min(...last12.map((x) => x.v))),
    max: round2(Math.max(...last12.map((x) => x.v))),
    method,
    describe: (v) => `The Swiss wholesale reference market price for renewable power (${label}) was ${v} CHF per MWh (${(v / 1000).toFixed(3)} CHF per kWh), excluding VAT, in ${latest.m.key}.`,
    note: "Monthly volume-weighted reference price set by BFE; min and max are the lowest and highest monthly figure of the last 12 months.",
    baseUrl: q.baseUrl,
    extra: {
      technology: tech,
      month: latest.m.key,
      previous_month: prev ? { month: prev.m.key, chf_per_mwh: round2(prev.v), change_pct: pct(latest.v, prev.v) } : null,
      same_month_last_year: yearAgo ? { month: yearAgo.m.key, chf_per_mwh: round2(yearAgo.v), change_pct: pct(latest.v, yearAgo.v) } : null,
      last_12_months: recent,
      per_technology: Object.fromEntries(TECHS.filter((t) => latest.m.prices[t] !== undefined).map((t) => [t, latest.m.prices[t]])),
    },
  });
}

/** Live: one GET of the small monthly CSV (about 2.6 kB), then the pure answer. */
export async function chReference(q: ChQuery): Promise<PriceAnswer> {
  const text = await retryOnce(async () => {
    let res: Response;
    try {
      res = await fetch(CSV_URL, { headers: { "User-Agent": "ProofPrice/1.0 (+https://proofprice.com)" }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new SourceError("BFE reference-price file did not respond", String(e));
    }
    if (!res.ok) throw new SourceError(`BFE reference-price file answered HTTP ${res.status}`, `HTTP ${res.status}`);
    return res.text();
  });
  return chReferenceAnswer(parseMonthly(text), q);
}
