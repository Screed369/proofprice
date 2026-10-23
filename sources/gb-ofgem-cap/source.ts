// Great Britain: household electricity and gas, the Ofgem energy price cap (default tariffs). Format checked live on 2026-10-23 through the GitHub probe:
//  - GET https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges answers 200 text/html (about 440 kB).
//  - A heading "Energy price cap from 1 October to 31 December 2026", then a table "Average electricity and gas unit prices and standing charges by Direct Debit"
//    with two columns (the previous and the current cap period, each headed "Energy price cap per unit and standing charge <range>") and two rows
//    (Electricity, Gas), each cell "<x> pence per kWh" and "<y> pence daily standing charge". Figures include 5% VAT on gas; electricity has no VAT from
//    1 October 2026 to 31 March 2027 (the page says so below the table).
//  - The regional tables further down the page are drawn by JavaScript and are not in the HTML, so this source reads the national Direct Debit average only.
// Ofgem sets the cap: the most a supplier may charge per unit on a default (standard variable) tariff. It is a regulated maximum, not a price anyone was
// recorded paying, so the answer is labelled a posted price and an average, with no sample size.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_URL = "https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges";

export const INFO: SourceInfo = {
  id: "gb-ofgem-cap",
  country: "GB (Great Britain: England, Scotland and Wales)",
  category: "energy (household electricity and gas, price cap)",
  name: "Energy price cap: unit rates and standing charges (Direct Debit, national average)",
  publisher: "Ofgem (Office of Gas and Electricity Markets)",
  what_is_recorded:
    "For each price cap period (three months), the cap on the unit rate in pence per kWh and on the daily standing charge in pence that a supplier may charge a household on a default tariff " +
    "in Great Britain, for electricity and for gas, as the average across the 14 regions for customers who pay by Direct Debit. One published figure per cell; never individual bills or suppliers.",
  price_type: "posted_price",
  freshness: "Quarterly (Ofgem sets a new cap for January, April, July and October); each answer states its quarter",
  licence:
    'Open Government Licence v3.0 (Ofgem copyright page: Crown copyright information, not including logos, may be used "under the terms of the Open Government Licence"); Crown copyright',
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Ofgem, Energy price cap unit rates and standing charges. " +
    "Prices are passed on as published (in pence per kWh); the pounds-per-kWh figure is calculated by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "This is a regulated maximum for default tariffs (a cap), not what households were recorded paying: many pay less on a fixed deal. It is one national Direct Debit average for Great Britain " +
    "(not Northern Ireland); regional, standard-credit and prepayment rates differ and are not in this answer. Gas includes 5% VAT; electricity has had no VAT since 1 October 2026, so the change from the previous period is not like for like. " +
    "It is not a quote or offer from any supplier.",
};

// ---------- the page (pure parsing) ----------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export interface Range { label: string; from: string; to: string }
export interface FuelCap {
  /** pence per kWh and pence per day, current period */
  unit: number;
  standing: number;
  previous: { unit: number; standing: number } | null;
}
export interface CapPage {
  period: Range;
  previous_period: Range | null;
  electricity: FuelCap;
  gas: FuelCap;
  annual_typical_gbp: number | null;
  vat_note: string | null;
  not_comparable: boolean;
}

const RANGE = String.raw`(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})`;
const d2 = (n: number) => String(n).padStart(2, "0");

function toRange(m: RegExpMatchArray): Range | null {
  const [, d1, mo1, y1, d3, mo3, y3] = m;
  const m1 = MONTHS[mo1.toLowerCase()];
  const m3 = MONTHS[mo3.toLowerCase()];
  if (!m1 || !m3) return null;
  const endYear = Number(y3);
  const startYear = y1 ? Number(y1) : m1 > m3 ? endYear - 1 : endYear;
  const label = `${Number(d1)} ${mo1}${y1 ? ` ${y1}` : ""} to ${Number(d3)} ${mo3} ${y3}`;
  return { label, from: `${startYear}-${d2(m1)}-${d2(Number(d1))}`, to: `${endYear}-${d2(m3)}-${d2(Number(d3))}` };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;| /g, " ")
    .replace(/&pound;/g, "£")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function fuelRow(text: string, fuel: "Electricity" | "Gas"): FuelCap {
  const cell = String.raw`([\d.]+)\s*pence per kWh\s+([\d.]+)\s*pence daily standing charge`;
  const m = new RegExp(`${fuel}\\s+${cell}(?:\\s+${cell})?`).exec(text);
  if (!m) throw new SourceError(`The Ofgem page has no ${fuel} row in the price cap table; this source needs updating.`);
  const n = (s: string) => Number(s);
  const hasTwo = m[3] !== undefined;
  const cur = hasTwo ? { unit: n(m[3]), standing: n(m[4]) } : { unit: n(m[1]), standing: n(m[2]) };
  const prev = hasTwo ? { unit: n(m[1]), standing: n(m[2]) } : null;
  for (const v of [cur, ...(prev ? [prev] : [])]) {
    if (!(v.unit >= 2 && v.unit <= 120) || !(v.standing >= 5 && v.standing <= 250)) {
      throw new SourceError(`The Ofgem ${fuel} figures look wrong (${v.unit} pence per kWh, ${v.standing} pence a day); this source needs updating.`);
    }
  }
  return { ...cur, previous: prev };
}

/** The headline table of the Ofgem unit-rates page: current cap period (and the previous one, when the page still shows it). */
export function parseCapPage(html: string): CapPage {
  const text = htmlToText(html);
  const heading = new RegExp(`Energy price cap from ${RANGE}`).exec(text);
  const period = heading ? toRange(heading) : null;
  if (!period) throw new SourceError("The Ofgem page has no 'Energy price cap from ... to ...' heading; this source needs updating.");

  const at = text.indexOf("Energy price cap per unit and standing charge");
  if (at < 0) throw new SourceError("The Ofgem page has no price cap table; this source needs updating.");
  const tableText = text.slice(at);
  const labels = [...tableText.matchAll(new RegExp(`Energy price cap per unit and standing charge\\s+${RANGE}`, "g"))]
    .map((m) => toRange(m))
    .filter((r): r is Range => r !== null);
  const current = labels[1] ?? labels[0];
  if (!current) throw new SourceError("The Ofgem price cap table has no period headings; this source needs updating.");
  if (current.from !== period.from || current.to !== period.to) {
    throw new SourceError(`The Ofgem table is headed ${current.label} but the page heading says ${period.label}; this source needs updating.`);
  }

  const electricity = fuelRow(tableText, "Electricity");
  const gas = fuelRow(tableText, "Gas");
  const annual = /price cap will be £([\d,]+) per year/.exec(text) ?? /price cap is £([\d,]+) per year/.exec(text);
  const vat = /Figures are rounded[^.]*\.(?:\s*There is no VAT[^.]*\d{4}\.)?/.exec(tableText);
  return {
    period,
    previous_period: labels.length > 1 ? labels[0] : null,
    electricity,
    gas,
    annual_typical_gbp: annual ? Number(annual[1].replace(/,/g, "")) : null,
    vat_note: vat ? vat[0].trim() : null,
    not_comparable: /cannot be compared directly/i.test(tableText),
  };
}

// ---------- fetching ----------

export async function fetchOfgemPage(url = PAGE_URL, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com; hello@proofprice.com)", accept: "text/html" },
    });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

let cached: { at: number; page: CapPage } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function loadCap(now = Date.now()): Promise<CapPage> {
  if (cached && now - cached.at < CACHE_MS) return cached.page;
  const page = parseCapPage(await fetchOfgemPage());
  cached = { at: now, page };
  return page;
}

// ---------- the answer (pure) ----------

export type Energy = "electricity" | "gas";

export function normaliseEnergy(raw: string): Energy {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["electricity", "electric", "power"].includes(s)) return "electricity";
  if (["gas", "natural gas", "mains gas"].includes(s)) return "gas";
  throw new InputError('energy must be "electricity" or "gas".');
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export function capAnswer(page: CapPage, q: { energy: Energy; consumption_band?: string; baseUrl?: string }): PriceAnswer {
  const fuel = page[q.energy];
  const gbp = fuel.unit / 100;
  const word = q.energy === "gas" ? "gas" : "electricity";
  const notes: string[] = [];
  if (q.consumption_band) notes.push("Ofgem sets one unit rate per fuel, not one per consumption band, so consumption_band was ignored.");
  if (q.energy === "electricity" && page.not_comparable) notes.push("Electricity VAT fell to 0% on 1 October 2026, so the change from the previous period is not like for like.");
  const change = fuel.previous ? roundTo(((fuel.unit - fuel.previous.unit) / fuel.previous.unit) * 100, 1) : null;

  const extra: Record<string, unknown> = {
    energy: q.energy,
    country_name: "Great Britain",
    pence_per_kwh: fuel.unit,
    standing_charge_pence_per_day: fuel.standing,
    price_basis: "Ofgem price cap on default tariffs (a regulated maximum), national average for Direct Debit customers, including VAT as stated on the page",
    cap_period: { label: page.period.label, from: page.period.from, to: page.period.to },
    previous_period: fuel.previous && page.previous_period
      ? { label: page.previous_period.label, pence_per_kwh: fuel.previous.unit, standing_charge_pence_per_day: fuel.previous.standing, change_percent: change }
      : null,
    ...(page.annual_typical_gbp ? { ofgem_typical_dual_fuel_bill_gbp_per_year: page.annual_typical_gbp } : {}),
    ...(page.vat_note ? { vat_note: page.vat_note } : {}),
    dataset: { name: "Energy price cap unit rates and standing charges", page: PAGE_URL },
  };

  return buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", energy: q.energy, ...(q.consumption_band ? { consumption_band: q.consumption_band } : {}) },
    value: gbp,
    measure: "average",
    currency: "GBP",
    unit: "per kWh",
    period: { from: page.period.from, to: page.period.to },
    reference_period: page.period.label,
    method:
      `Ofgem sets the energy price cap for each three-month period: the most a supplier may charge per unit of ${word} on a default tariff in Great Britain. ` +
      "ProofPrice returns the national average unit rate for customers who pay by Direct Debit, in pounds per kWh (Ofgem publishes pence), with the daily standing charge and the previous period. " +
      "It is a regulated maximum, not a list of sales: no range is calculated and there is no sample size.",
    note: notes.length ? notes.join(" ") : undefined,
    describe: () =>
      `In Great Britain the Ofgem price cap on the ${word} unit rate for default tariffs (Direct Debit, national average) is ${fuel.unit.toFixed(2)} pence per kWh (£${gbp.toFixed(4)}) ` +
      `for ${page.period.label}, plus a standing charge of ${fuel.standing.toFixed(2)} pence a day.` +
      (fuel.previous && change !== null && !(q.energy === "electricity" && page.not_comparable)
        ? ` The previous cap was ${fuel.previous.unit.toFixed(2)} pence (${change === 0 ? "unchanged" : `${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} now`}).`
        : ""),
    ending: "This is the price cap Ofgem sets (the most a supplier can charge on a default tariff), not what each household was recorded paying.",
    evidence: { label: "Regulated price cap", meaning: "The most a supplier may charge per unit on a default tariff, set by Ofgem; many households pay less on fixed deals." },
    extra,
    baseUrl: q.baseUrl,
  });
}

// ---------- the request ----------

export async function ofgemCap(
  input: { energy: string; taxes?: string; consumption_band?: string; baseUrl?: string },
  load: () => Promise<CapPage> = () => loadCap(),
): Promise<PriceAnswer> {
  const energy = normaliseEnergy(input.energy);
  const t = (input.taxes ?? "all").trim().toLowerCase();
  if (t && t !== "all") {
    throw new InputError('taxes must be "all" for GB household energy: Ofgem publishes the cap including VAT only (omit taxes).');
  }
  return capAnswer(await load(), { energy, consumption_band: input.consumption_band?.trim() || undefined, baseUrl: input.baseUrl });
}
