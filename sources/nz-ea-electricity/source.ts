// New Zealand average household electricity bills by network region (Electricity Authority, EMI "Regional power prices").
// Format proven 2026-10-20 through the GitHub probe: plain GET, no key, one CSV (about 110 KB) named <YYYYMMDD>_AveragePowerUseAndCosts.csv,
// where YYYYMMDD is the latest month end it holds. Fixture rows 1-4 of fixtures/sample.csv are real; the 2026 rows are SYNTHETIC.
// It is a modelled average (tariffs x typical use), so the answer is an official statistic with no sample size.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { percentile } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const BASE = "https://www.emi.ea.govt.nz";
export const DATASET_PAGE = `${BASE}/Retail/Datasets/RegionalPowerPrices`;
const FILE_RE = /\/Retail\/Datasets\/RegionalPowerPrices\/(\d{8})_AveragePowerUseAndCosts\.csv/gi;

export const INFO: SourceInfo = {
  id: "nz-ea-electricity",
  country: "NZ",
  category: "energy (household electricity)",
  name: "Regional power prices: average power use and costs (EMI)",
  publisher: "Electricity Authority (New Zealand), Electricity Market Information (EMI)",
  what_is_recorded:
    "For each month, network region and household type (low user or standard user): the Authority's modelled average fixed daily charge, variable rate per kWh, monthly use in kWh and monthly bill, all in NZD including GST. Built from retailer tariffs and network data; not individual bills.",
  price_type: "official_statistic",
  freshness: "Monthly file; the newest month is about four to five months behind today. Each answer states its month.",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), per the EMI Legal Information page",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "www.emi.ea.govt.nz provided by the Electricity Authority (New Zealand), licensed CC BY 4.0. The price per kWh (monthly bill divided by monthly kWh) is calculated by ProofPrice.",
  homepage: "https://www.emi.ea.govt.nz/Retail/Datasets/RegionalPowerPrices",
  limits:
    "A modelled average of retail tariffs for typical households, not a count of paid bills and not an offer from any retailer. No sample size. Electricity only (no gas). Figures lag by several months. Prices include GST (15%).",
};

export type LoadType = "Low user" | "Standard user";

export interface PowerRow {
  month: string; // YYYY-MM-DD month end
  code: string;
  region: string;
  load: string;
  fixedPerDay: number;
  variablePerKwh: number;
  kwh: number;
  bill: number;
  network: number;
}

/** Latest-first file names (YYYYMMDD) listed on the dataset page. */
export function parseFileLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(FILE_RE)) out.add(m[1]);
  return [...out].sort().reverse();
}

export const fileUrl = (stamp: string) => `${DATASET_PAGE}/${stamp}_AveragePowerUseAndCosts.csv`;

/** Month-end stamps (YYYYMMDD) going back from the month before `now`, for when the page cannot be read. */
export function candidateStamps(now: Date, count = 9): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const HEADER = ["MonthEnd", "NetworkReportingRegionCode", "NetworkReportingRegion", "LoadType", "FixedDollarPerDayInclGST", "VariableDollarPerkWhInclGST", "MonthlyNetworkMeankWh", "TotalMonthlyBillDollarsInclGST", "NetworkMonthlyChargeDollarsInclGST"];

export function parsePowerCsv(text: string): PowerRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsv(lines[0] ?? "").map((h) => h.trim());
  if (HEADER.some((h, i) => head[i] !== h)) {
    throw new SourceError("The Electricity Authority changed the layout of the regional power prices file (expected MonthEnd, NetworkReportingRegionCode ... NetworkMonthlyChargeDollarsInclGST); this source needs updating.");
  }
  const rows: PowerRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    if (c.length < 9) continue;
    const [fixedPerDay, variablePerKwh, kwh, bill, network] = c.slice(4, 9).map(Number);
    if (![fixedPerDay, variablePerKwh, kwh, bill].every(Number.isFinite) || kwh <= 0 || bill <= 0) continue;
    rows.push({ month: c[0].trim(), code: c[1].trim(), region: c[2].trim(), load: c[3].trim(), fixedPerDay, variablePerKwh, kwh, bill, network });
  }
  return rows;
}

export function normaliseLoad(raw?: string): LoadType {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || ["standard", "standard user", "std", "ds", "dc", "average"].includes(s)) return "Standard user";
  if (["low", "low user", "lowuser", "da"].includes(s)) return "Low user";
  throw new InputError('consumption_band for NZ must be "standard" (default, the standard household user) or "low" (the low user).');
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Distinct region names in the rows. */
export const regionsIn = (rows: PowerRow[]) => [...new Set(rows.map((r) => r.region))].sort();

/** "Auckland" -> "Auckland (Vector)". Exact name first, then name before the bracket, then contains. Throws InputError if unknown or ambiguous. */
export function matchRegion(raw: string, names: string[]): string {
  const q = norm(raw);
  if (!q) throw new InputError("Give a network region such as Auckland, Wellington, Christchurch or Dunedin.");
  const exact = names.filter((n) => norm(n) === q);
  if (exact.length === 1) return exact[0];
  const lead = names.filter((n) => norm(n.replace(/\(.*\)/, "")) === q);
  if (lead.length === 1) return lead[0];
  const some = names.filter((n) => norm(n).includes(q));
  if (some.length === 1) return some[0];
  if (some.length > 1 || lead.length > 1) {
    const list = (lead.length > 1 ? lead : some).join("; ");
    throw new InputError(`'${raw}' matches more than one New Zealand network region: ${list}. Give one of these names.`);
  }
  throw new InputError(`'${raw}' is not a network region in the Electricity Authority data. Examples: ${names.slice(0, 8).join("; ")}.`);
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface PowerInput {
  region?: string;
  consumption_band?: string;
  taxes?: string;
  baseUrl?: string;
}

/** Pure: pick the answer from parsed rows. */
export function answerFromRows(rows: PowerRow[], input: PowerInput): PriceAnswer {
  const load = normaliseLoad(input.consumption_band);
  const taxes = (input.taxes ?? "all").toString().toLowerCase();
  if (taxes && taxes !== "all") throw new InputError('NZ prices include GST: taxes must be "all" (or left out).');
  const month = rows.map((r) => r.month).sort().pop();
  if (!month) throw new SourceError("The Electricity Authority file had no usable rows.");
  const latest = rows.filter((r) => r.month === month && r.load === load);
  const query: Record<string, unknown> = { country: "NZ", energy: "electricity", consumption_band: load === "Low user" ? "low" : "standard" };
  const period = { from: month.slice(0, 8) + "01", to: month };
  const unit = "per kWh (monthly bill divided by monthly kWh, including GST and the fixed daily charge)";
  const perKwh = (r: PowerRow) => r4(r.bill / r.kwh);

  if (input.region && input.region.trim()) {
    const name = matchRegion(input.region, regionsIn(rows));
    query.region = name;
    const r = latest.find((x) => x.region === name);
    if (!r) {
      return buildStatisticAnswer({ source: INFO, query, value: null, measure: "average", currency: "NZD", unit, period, reference_period: month.slice(0, 7), method: METHOD, describe: () => "", baseUrl: input.baseUrl });
    }
    return buildStatisticAnswer({
      source: INFO, query, value: perKwh(r), measure: "average", currency: "NZD", unit, period, reference_period: month.slice(0, 7),
      method: METHOD,
      describe: (v) => `The Electricity Authority's modelled average for a ${load.toLowerCase()} household in ${name} in ${month.slice(0, 7)} is about NZD ${v.toFixed(3)} per kWh including GST and the daily charge.`,
      note: "Modelled average from retail tariffs, not a paid bill. Includes GST.",
      baseUrl: input.baseUrl,
      extra: { region: name, month_end: month, fixed_charge_nzd_per_day: r.fixedPerDay, variable_rate_nzd_per_kwh: r.variablePerKwh, monthly_use_kwh: r.kwh, monthly_bill_nzd: r.bill, monthly_network_charge_nzd: r.network },
    });
  }

  const vals = latest.map(perKwh).sort((a, b) => a - b);
  if (vals.length < 5) {
    return buildStatisticAnswer({ source: INFO, query, value: null, measure: "median", currency: "NZD", unit, period, reference_period: month.slice(0, 7), method: METHOD, describe: () => "", baseUrl: input.baseUrl });
  }
  const med = r4(percentile(vals, 0.5));
  return buildStatisticAnswer({
    source: INFO, query, value: med, measure: "median", currency: "NZD", unit, period, reference_period: month.slice(0, 7),
    low: r4(percentile(vals, 0.1)), high: r4(percentile(vals, 0.9)),
    method: METHOD + " With no region given, the figure is the unweighted median across the network regions; the range is their 10th to 90th percentile. Give a region for one place.",
    describe: (v) => `Across ${vals.length} New Zealand network regions the median modelled household electricity price in ${month.slice(0, 7)} is about NZD ${v.toFixed(3)} per kWh including GST (regions are not weighted by population).`,
    note: `Unweighted median of ${vals.length} network regions; sample_size is null because the regions are not purchases.`,
    baseUrl: input.baseUrl,
    extra: { regions_counted: vals.length, month_end: month, region_cheapest_nzd_per_kwh: vals[0], region_dearest_nzd_per_kwh: vals[vals.length - 1] },
  });
}

const METHOD = "New Zealand electricity: the Electricity Authority's modelled average monthly bill for a typical household in a network region, divided by its monthly kWh.";

// ---------- fetching ----------

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function nzElectricity(
  input: PowerInput & { energy?: string },
  fetcher: (url: string) => Promise<string> = fetchText,
  now: Date = new Date(),
): Promise<PriceAnswer> {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("NZ: only electricity is available (no gas). Use energy=electricity.");
  normaliseLoad(input.consumption_band); // fail early on bad input

  let stamps: string[] = [];
  try {
    stamps = parseFileLinks(await fetcher(DATASET_PAGE));
  } catch {
    stamps = [];
  }
  if (!stamps.length) stamps = candidateStamps(now);
  let lastErr: unknown = null;
  for (const stamp of stamps.slice(0, 6)) {
    try {
      return answerFromRows(parsePowerCsv(await fetcher(fileUrl(stamp))), input);
    } catch (err) {
      if (err instanceof InputError) throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof SourceError ? lastErr : new SourceError("Could not read the Electricity Authority regional power prices file.");
}
