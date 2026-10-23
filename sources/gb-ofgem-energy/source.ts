// Great Britain: the Ofgem energy price cap for households (default tariffs), unit rates and daily standing charges for 14 regions
// and the GB average, by payment method. Read on 2026-10-23 through the GitHub probe: the Ofgem page
// https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges embeds nine tables from app.everviz.com
// (<div id="everviz-table-ID"><script src="https://app.everviz.com/inject/ID/?v=N">). Each script holds `var options = {... "data":{"value":[[header],[row]...]} ...,
// "title":{"text":"<h3>Electricity standing charges and unit rates paid by Direct Debit, single rate</h3>"}`. Rows: Region, standing charge (previous quarter,
// current quarter, "45.68 pence per day"), unit rate (previous, current, "26.49 pence per kWh"). The last row is "Great Britain average".
// The cap is a maximum price per unit that suppliers may charge on default tariffs: a regulated posted price, never what a household paid.
// Ids and versions change when Ofgem edits the page, so they are read from the page every time and the tables are told apart by their titles.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_URL = "https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges";
export const EMBED_URL = (id: string, v: string) => `https://app.everviz.com/inject/${id}/?v=${v}`;
const SOURCE_LINE = "Contains public sector information licensed under the Open Government Licence v3.0. Source: Ofgem, energy price cap unit rates and standing charges";

export const INFO: SourceInfo = {
  id: "gb-ofgem-energy",
  country: "GB (Great Britain)",
  category: "energy (household energy price cap)",
  name: "Energy price cap: unit rates and standing charges by region (Ofgem)",
  publisher: "Ofgem (Office of Gas and Electricity Markets)",
  what_is_recorded:
    "For each of the 14 electricity and gas regions of Great Britain and for the GB average, the maximum unit rate (pence per kWh) and the maximum daily standing charge (pence per day) that suppliers may charge on " +
    "default tariffs, for the current quarter and the one before, by payment method (Direct Debit, standard credit, prepayment meter). Electricity single-rate and gas. Gas includes 5% VAT; electricity has no VAT from 1 October 2026 to 31 March 2027.",
  price_type: "posted_price",
  freshness: "Quarterly (the cap is reset on 1 January, 1 April, 1 July and 1 October); each answer states the quarter it is for",
  licence:
    "Open Government Licence. Ofgem states that Crown copyright information (not including logos) may be used \"under the terms of the Open Government Licence\" and that the permission \"does not extend to any material on this website that is identified as being the copyright of a third party\". " +
    "The Ofgem page names no version; the licence it links to is OGL v3.0, which allows commercial reuse with attribution. No Ofgem logo is used and Ofgem does not endorse ProofPrice.",
  licence_url: "https://www.ofgem.gov.uk/copyright",
  attribution:
    `${SOURCE_LINE} (${PAGE_URL}). The pence figures are passed on as published; the conversion to pounds, the change on the previous quarter and the ordering of regions are calculated by ProofPrice.`,
  homepage: "https://www.ofgem.gov.uk/energy-price-cap",
  limits:
    "A regulated CAP (the most a supplier may charge per unit on a default tariff), not a price any household paid and not a quote: many tariffs are cheaper or dearer, and fixed tariffs are not capped. " +
    "It is a unit rate plus a standing charge, not a bill; what a household pays depends on how much it uses. Single-rate electricity only (Economy 7 and other multi-rate tariffs are not served). " +
    "Great Britain only (England, Scotland, Wales): Northern Ireland has its own regulator. Regions are the 14 electricity distribution regions, not postcodes or towns; a town is mapped to its usual region, so check a postcode on Ofgem's page for a border case.",
};

export type Energy = "electricity" | "gas";
export type Payment = "direct_debit" | "standard_credit" | "prepayment";
export const PAYMENTS: Record<Payment, { label: string; words: string[] }> = {
  direct_debit: { label: "Direct Debit", words: ["direct debit", "dd", "direct_debit", "directdebit"] },
  standard_credit: { label: "standard credit (paying on receipt of the bill)", words: ["standard credit", "standard", "credit", "standard_credit", "pay on receipt"] },
  prepayment: { label: "prepayment meter", words: ["prepayment", "prepay", "pre-payment", "prepayment meter", "pay as you go", "payg"] },
};

export const AVERAGE = "Great Britain average";
export const REGIONS = [
  "North Western England", "North Eastern England", "Yorkshire", "Northern Scotland", "Southern England", "Southern Scotland", "Merseyside and Northern Wales",
  "London", "South Eastern England", "Eastern England", "East Midlands", "West Midlands", "South Western England", "Southern Wales",
] as const;

/** Usual region of well-known places (the place names are ours, not Ofgem's; the limits text says so). */
const PLACES: Record<string, string> = {
  manchester: "North Western England", preston: "North Western England", lancaster: "North Western England", carlisle: "North Western England", blackpool: "North Western England", cumbria: "North Western England", lancashire: "North Western England",
  newcastle: "North Eastern England", sunderland: "North Eastern England", durham: "North Eastern England", middlesbrough: "North Eastern England", "north east": "North Eastern England",
  leeds: "Yorkshire", sheffield: "Yorkshire", york: "Yorkshire", bradford: "Yorkshire", hull: "Yorkshire",
  aberdeen: "Northern Scotland", inverness: "Northern Scotland", highlands: "Northern Scotland", dundee: "Northern Scotland", perth: "Northern Scotland",
  southampton: "Southern England", reading: "Southern England", oxford: "Southern England", portsmouth: "Southern England", bournemouth: "Southern England", swindon: "Southern England",
  glasgow: "Southern Scotland", edinburgh: "Southern Scotland", dumfries: "Southern Scotland",
  liverpool: "Merseyside and Northern Wales", chester: "Merseyside and Northern Wales", wrexham: "Merseyside and Northern Wales", bangor: "Merseyside and Northern Wales", merseyside: "Merseyside and Northern Wales",
  london: "London",
  brighton: "South Eastern England", canterbury: "South Eastern England", maidstone: "South Eastern England", croydon: "South Eastern England", kent: "South Eastern England", sussex: "South Eastern England", surrey: "South Eastern England",
  cambridge: "Eastern England", norwich: "Eastern England", ipswich: "Eastern England", colchester: "Eastern England", peterborough: "Eastern England", norfolk: "Eastern England", suffolk: "Eastern England",
  nottingham: "East Midlands", leicester: "East Midlands", derby: "East Midlands", lincoln: "East Midlands", northampton: "East Midlands",
  birmingham: "West Midlands", coventry: "West Midlands", wolverhampton: "West Midlands", stoke: "West Midlands", worcester: "West Midlands", shrewsbury: "West Midlands",
  bristol: "South Western England", plymouth: "South Western England", exeter: "South Western England", bath: "South Western England", cornwall: "South Western England", devon: "South Western England", gloucester: "South Western England",
  cardiff: "Southern Wales", swansea: "Southern Wales", newport: "Southern Wales",
  national: AVERAGE, uk: AVERAGE, gb: AVERAGE, "great britain": AVERAGE, britain: AVERAGE, average: AVERAGE,
};

export interface Row {
  region: string;
  standing_prev: number; // pence per day
  standing: number;
  unit_prev: number; // pence per kWh
  unit: number;
}
export interface CapTable {
  energy: Energy;
  payment: Payment;
  multi: boolean;
  quarter: string; // e.g. "October to December 2026"
  prevQuarter: string;
  rows: Row[];
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Pure: embed ids and versions from the Ofgem page, in page order. */
export function embedsFromPage(html: string): { id: string; v: string }[] {
  const out: { id: string; v: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/app\.everviz\.com\/inject\/([A-Za-z0-9_-]+)\/\?v=(\d+)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], v: m[2] });
  }
  return out;
}

const pence = (s: unknown, unit: "day" | "kWh"): number => {
  const m = new RegExp(`^\\s*(\\d+(?:\\.\\d+)?)\\s*pence per ${unit}\\s*$`, "i").exec(String(s ?? ""));
  if (!m) throw new SourceError(`Ofgem table cell "${String(s)}" is not in the expected "N pence per ${unit}" form; this source needs updating.`);
  return Number(m[1]);
};

const QUARTER = /(January to March|April to June|July to September|October to December) (\d{4})/;

/** Pure: one everviz script -> a cap table, or null when it is not one of the cap tables (title says something else). */
export function parseScript(js: string): CapTable | null {
  const t = /"title":\{"text":"(.*?)"/.exec(js);
  if (!t) return null;
  const title = t[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const energy: Energy | null = title.startsWith("electricity") ? "electricity" : title.startsWith("gas") ? "gas" : null;
  const payment: Payment | null = title.includes("direct debit") ? "direct_debit" : title.includes("standard credit") ? "standard_credit" : title.includes("prepayment") ? "prepayment" : null;
  if (!energy || !payment) return null;
  const k = js.indexOf('"value":[[');
  if (k < 0) throw new SourceError("An Ofgem price cap table has no data; this source needs updating.");
  const e = js.indexOf("]]", k) + 2;
  let grid: unknown;
  try {
    grid = JSON.parse(js.slice(k + 8, e));
  } catch {
    throw new SourceError("An Ofgem price cap table could not be read; this source needs updating.");
  }
  if (!Array.isArray(grid) || grid.length < 3) throw new SourceError("An Ofgem price cap table is empty; this source needs updating.");
  const head = (grid[0] as unknown[]).map(String);
  const q = (i: number) => {
    const m = QUARTER.exec(head[i] ?? "");
    return m ? `${m[1]} ${m[2]}` : "";
  };
  const prevQuarter = q(1);
  const quarter = q(2);
  if (!prevQuarter || !quarter || q(3) !== prevQuarter || q(4) !== quarter) throw new SourceError("Ofgem changed the columns of its price cap tables; this source needs updating.");
  const rows: Row[] = [];
  for (const r of (grid as unknown[][]).slice(1)) {
    if (!Array.isArray(r) || r.length < 5) continue;
    rows.push({ region: String(r[0]).trim(), standing_prev: pence(r[1], "day"), standing: pence(r[2], "day"), unit_prev: pence(r[3], "kWh"), unit: pence(r[4], "kWh") });
  }
  return { energy, payment, multi: title.includes("multi-rate"), quarter, prevQuarter, rows };
}

export function pickTable(tables: CapTable[], energy: Energy, payment: Payment): CapTable | null {
  return tables.find((t) => t.energy === energy && t.payment === payment && !t.multi) ?? null;
}

export function normaliseEnergy(raw?: string): Energy {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "electricity" || s === "gas") return s;
  throw new InputError('energy must be "electricity" or "gas".');
}

export function normalisePayment(raw?: string): Payment {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "direct_debit";
  for (const [k, v] of Object.entries(PAYMENTS)) if (k === s || v.words.includes(s)) return k as Payment;
  throw new InputError(`payment_method must be one of: direct_debit (default), standard_credit, prepayment. Got "${raw}".`);
}

/** Region name from a region, a well-known town or "" (= the GB average). */
export function resolveRegion(raw?: string): string {
  const s = norm(raw ?? "");
  if (!s) return AVERAGE;
  const exact = [AVERAGE, ...REGIONS].find((r) => norm(r) === s);
  if (exact) return exact;
  if (PLACES[s]) return PLACES[s];
  const loose = [...REGIONS].filter((r) => norm(r).includes(s) || (s.length > 5 && s.includes(norm(r))));
  if (loose.length === 1) return loose[0];
  const word = Object.keys(PLACES).find((p) => s === p || s.split(" ").includes(p) || (p.includes(" ") && s.includes(p)));
  if (word) return PLACES[word];
  throw new InputError(
    `region "${raw}" is not one of the 14 Ofgem regions or a town we map. Use one of: ${REGIONS.join(", ")}; or leave it out for the Great Britain average. ` +
      "For a postcode, Ofgem's page names the region. Northern Ireland has no Ofgem cap.",
  );
}

const QSTART: Record<string, [string, string]> = {
  "January to March": ["01-01", "03-31"], "April to June": ["04-01", "06-30"], "July to September": ["07-01", "09-30"], "October to December": ["10-01", "12-31"],
};
export function quarterRange(q: string): { from: string; to: string } {
  const m = /^(.*) (\d{4})$/.exec(q)!;
  const [a, b] = QSTART[m[1]];
  return { from: `${m[2]}-${a}`, to: `${m[2]}-${b}` };
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const pct = (now: number, was: number) => Math.round(((now - was) / was) * 1000) / 10;

export function gbMethod(): string {
  return (
    "Ofgem publishes the energy price cap for default tariffs every quarter: the highest unit rate (pence per kWh) and daily standing charge (pence per day) for each of 14 regions and the GB average, " +
    "by payment method. We read the tables on Ofgem's price cap page and pass on the figures for the chosen region and payment method, with the previous quarter and the change. " +
    "It is a regulated maximum, a posted price: no range is calculated and no household or sale count stands behind it."
  );
}

/** Pure: the answer from the parsed tables. */
export function capAnswer(tables: CapTable[], q: { energy: Energy; payment: Payment; region: string; baseUrl?: string }): PriceAnswer {
  const query = { country: "GB", energy: q.energy, gb_region: q.region, payment_method: q.payment };
  const base = { source: INFO, query, measure: "average" as const, currency: "GBP", unit: "per kWh", method: gbMethod(), baseUrl: q.baseUrl };
  const t = pickTable(tables, q.energy, q.payment);
  const row = t?.rows.find((r) => r.region === q.region);
  if (!t || !row) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Ofgem's price cap tables hold no ${q.energy} figure for ${q.region} paid by ${PAYMENTS[q.payment].label}.` };
  }
  const range = quarterRange(t.quarter);
  const unitChange = pct(row.unit, row.unit_prev);
  const standChange = pct(row.standing, row.standing_prev);
  const other = (["direct_debit", "standard_credit", "prepayment"] as Payment[]).flatMap((p) => {
    const rr = pickTable(tables, q.energy, p)?.rows.find((r) => r.region === q.region);
    return rr ? [{ payment_method: p, unit_rate_pence_per_kwh: rr.unit, standing_charge_pence_per_day: rr.standing }] : [];
  });
  const regions = (pickTable(tables, q.energy, q.payment)?.rows ?? [])
    .filter((r) => r.region !== AVERAGE)
    .map((r) => ({ region: r.region, unit_rate_pence_per_kwh: r.unit, standing_charge_pence_per_day: r.standing }))
    .sort((a, b) => a.unit_rate_pence_per_kwh - b.unit_rate_pence_per_kwh);
  const vat = q.energy === "gas" ? "5% VAT included" : "no VAT on electricity from 1 October 2026 to 31 March 2027";
  return buildStatisticAnswer({
    ...base,
    value: r4(row.unit / 100),
    period: range,
    reference_period: t.quarter,
    note: "Regulated cap on the unit rate, not a price any household paid; many tariffs are cheaper or dearer, and fixed tariffs are not capped.",
    describe: () =>
      `The Ofgem price cap for ${q.energy} in ${q.region} (${PAYMENTS[q.payment].label}, ${t.quarter}) is ${row.unit} pence per kWh with a standing charge of ${row.standing} pence a day (${vat}). ` +
      `The unit rate is ${unitChange === 0 ? "unchanged" : `${Math.abs(unitChange)}% ${unitChange > 0 ? "higher" : "lower"}`} than in ${t.prevQuarter} (${row.unit_prev} pence).`,
    ending: "A regulated maximum (posted price) published by Ofgem, not what households paid.",
    evidence: {
      label: "Regulated price cap (posted maximum)",
      meaning: "The most a supplier may charge per unit on a default tariff, set by the regulator for a quarter and a region. It is a ceiling that applies to everyone on a default tariff, not an average of sales or bills.",
    },
    extra: {
      energy: q.energy,
      region: q.region,
      payment_method: q.payment,
      unit_rate_pence_per_kwh: row.unit,
      standing_charge_pence_per_day: row.standing,
      standing_charge_gbp_per_day: r4(row.standing / 100),
      vat: vat,
      tariff: "single-rate" + (q.energy === "electricity" ? " electricity" : " gas"),
      reference_period_label: t.quarter,
      previous_period: {
        reference_period: t.prevQuarter,
        unit_rate_pence_per_kwh: row.unit_prev,
        standing_charge_pence_per_day: row.standing_prev,
        unit_rate_change_percent: unitChange,
        standing_charge_change_percent: standChange,
      },
      all_payment_methods: other,
      all_regions_cheapest_unit_rate_first: regions,
      attribution_notice: SOURCE_LINE,
    },
  });
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
}

export type TextFetcher = (url: string) => Promise<string>;

/** Fetch Ofgem's page, then every embedded table (in parallel; they are about 7 KB each), and parse them. */
export async function loadTables(fetcher: TextFetcher = (u) => fetchText(u, 12000)): Promise<CapTable[]> {
  const embeds = embedsFromPage(await fetcher(PAGE_URL));
  if (!embeds.length) throw new SourceError("Ofgem's price cap page no longer lists its tables (no everviz embeds found); this source needs updating.");
  const scripts = await Promise.all(embeds.map((e) => fetcher(EMBED_URL(e.id, e.v))));
  const tables = scripts.flatMap((s) => {
    const t = parseScript(s);
    return t ? [t] : [];
  });
  if (!tables.length) throw new SourceError("Ofgem's price cap tables could not be recognised; this source needs updating.");
  return tables;
}

export async function gbEnergy(input: { energy?: string; region?: string; payment_method?: string; baseUrl?: string }, fetcher?: TextFetcher): Promise<PriceAnswer> {
  const energy = normaliseEnergy(input.energy);
  const payment = normalisePayment(input.payment_method);
  const region = resolveRegion(input.region);
  return capAnswer(await loadTables(fetcher), { energy, payment, region, baseUrl: input.baseUrl });
}
