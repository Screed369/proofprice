// Netherlands: average end-user prices of natural gas and electricity for households, half-yearly, Statistics Netherlands (CBS) StatLine
// table 85666NED "Eindverbruikersprijzen aardgas en elektriciteit", read through the key-free CBS OData API.
// Format proven 2026-10-23 through the GitHub probe (see fixtures.ts): GET .../ODataApi/odata/85666NED/TypedDataSet?$format=json&$filter=Perioden gt '2021'
// -> {"value":[{"ID":51,"Prijscomponenten":"A047656","Belastingen":"A047659","Perioden":"2026HJ01","MinderDan569M3_1":1.993,...}]}.
// Rows = price component (total / supply / network) x tax level x period; columns = consumption classes (gas _1.._8 in m3 a year, electricity _9.._20 in MWh a year;
// households are _1.._3 and _9.._13). One published modelled average per cell (tariff sheets x consumption): an official statistic, no record count.
// Units: euro per m3 (gas) and euro per kWh (electricity), as the table title and the plausible levels show; the OData DataProperties reply has no Unit field.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const TABLE = "85666NED";
export const API = `https://opendata.cbs.nl/ODataApi/odata/${TABLE}/TypedDataSet`;
export const TABLE_URL = "https://opendata.cbs.nl/#/CBS/nl/dataset/85666NED/table";
const SOURCE_LINE = "Source: Statistics Netherlands (CBS), StatLine table 85666NED Eindverbruikersprijzen aardgas en elektriciteit";

export const INFO: SourceInfo = {
  id: "nl-cbs-energy",
  country: "NL (Netherlands)",
  category: "energy (household electricity and gas prices)",
  name: "Eindverbruikersprijzen aardgas en elektriciteit, half-yearly (CBS StatLine table 85666NED)",
  publisher: "Statistics Netherlands (Centraal Bureau voor de Statistiek, CBS)",
  what_is_recorded:
    "For each half-year and each household consumption class, the average price of natural gas (euro per m3) and of electricity (euro per kWh) in the Netherlands: the total price and its parts " +
    "(supply price, network price), with VAT and taxes included, with VAT excluded, and with VAT and taxes excluded. A modelled average (tariff sheets times consumption); never a bill, a supplier or a household.",
  price_type: "official_statistic",
  freshness: "Half-yearly (new figures end of March and end of September; the last two half-years are provisional); each answer states its reference half-year",
  licence:
    "Creative Commons Attribution 4.0 (CC BY 4.0). CBS states: \"Unless otherwise stated, the content of this website is subject to Creative Commons Attribution (CC BY 4.0)\" " +
    "(Dutch: \"Dit betekent dat u verplicht bent te vermelden dat de gegevens afkomstig zijn van CBS\"). Re-use must not suggest that CBS endorses ProofPrice; the CBS logo is excluded.",
  licence_url: "https://www.cbs.nl/nl-nl/over-ons/website/copyright",
  attribution:
    `${SOURCE_LINE} (${TABLE_URL}), licensed CC BY 4.0. Prices are passed on as published; the change on the previous half-year and the gas price per kWh are calculated by ProofPrice from the same table, so this is based on data from Statistics Netherlands. CBS does not endorse ProofPrice.`,
  homepage: TABLE_URL,
  limits:
    "A modelled national average for households by consumption class (tariff sheets times consumption), not a supplier's offer, a quote or a bill, and not split by region. " +
    "Published twice a year, so it lags the market; the last two half-years are provisional. CBS does not say how many households or contracts stand behind a figure. " +
    "Gas is in euro per m3 (one m3 is 35.17 MJ, about 9.77 kWh, on CBS's own conversion); electricity in euro per kWh. Electricity includes the Dutch energy-tax refund (heffingskorting), so in the smaller classes the price without taxes can be higher than the price with taxes, and the supply price in the smallest class can be negative.",
};

export type Energy = "electricity" | "gas";
export type Taxes = "all" | "excl_vat" | "none";
export interface Band {
  code: string;
  column: string;
  help: string;
}
export const BANDS: Record<Energy, Band[]> = {
  electricity: [
    { code: "DA", column: "MinderDan1MWh_9", help: "under 1 MWh (1,000 kWh) a year" },
    { code: "DB", column: "k_1Tot25MWh_10", help: "1 to 2.5 MWh (1,000 to 2,499 kWh) a year" },
    { code: "DC", column: "k_25Tot5MWh_11", help: "2.5 to 5 MWh (2,500 to 4,999 kWh) a year; most households" },
    { code: "DD", column: "k_5Tot15MWh_12", help: "5 to 15 MWh (5,000 to 14,999 kWh) a year" },
    { code: "DE", column: "k_15MWhEnMeer_13", help: "15 MWh (15,000 kWh) a year or more" },
  ],
  gas: [
    { code: "D1", column: "MinderDan569M3_1", help: "under 569 m3 (under 20 GJ) a year" },
    { code: "D2", column: "k_569Tot5687M3_2", help: "569 to 5,687 m3 (20 to 200 GJ) a year; most households" },
    { code: "D3", column: "k_5687M3EnMeer_3", help: "5,687 m3 (200 GJ) a year or more" },
  ],
};
export const DEFAULT_BAND: Record<Energy, string> = { electricity: "DC", gas: "D2" };
const KWH_PER_M3 = 35.17 / 3.6; // CBS: 1 m3 = 35.17 MJ; 1 kWh = 3.6 MJ

const COMPONENT: Record<string, "total" | "supply" | "network"> = { A047656: "total", A047657: "supply", A047658: "network" };
const TAXLEVEL: Record<string, Taxes> = { A047659: "all", A047660: "excl_vat", A047661: "none" };
type Cell = Partial<Record<"total" | "supply" | "network", Record<string, number>>>; // component -> column -> value
/** period ("2026-H1") -> tax level -> component -> column -> euro */
export type Table = Map<string, Map<Taxes, Cell>>;

export function url(): string {
  return `${API}?$format=json&$filter=${encodeURIComponent("Perioden gt '2021'")}`;
}

const toPeriod = (p: string): string | null => {
  const m = /^(\d{4})HJ0([12])$/.exec(p);
  return m ? `${m[1]}-H${m[2]}` : null;
};

/** Pure: the CBS OData reply -> table. Annual rows (JJ00) and unknown codes are dropped. */
export function parseTable(body: unknown): Table {
  const rows = (body as { value?: unknown })?.value;
  if (!Array.isArray(rows)) throw new SourceError("CBS StatLine answered in an unexpected format (no value list); this source needs updating.");
  const cols = [...BANDS.electricity, ...BANDS.gas].map((b) => b.column);
  const out: Table = new Map();
  for (const r of rows as Record<string, unknown>[]) {
    const period = toPeriod(String(r?.Perioden ?? ""));
    const comp = COMPONENT[String(r?.Prijscomponenten ?? "")];
    const tax = TAXLEVEL[String(r?.Belastingen ?? "")];
    if (!period || !comp || !tax) continue;
    const byTax = out.get(period) ?? new Map<Taxes, Cell>();
    const cell = byTax.get(tax) ?? {};
    const vals = cell[comp] ?? {};
    for (const c of cols) {
      const v = r[c];
      if (typeof v === "number" && Number.isFinite(v)) vals[c] = v;
    }
    cell[comp] = vals;
    byTax.set(tax, cell);
    out.set(period, byTax);
  }
  if (!out.size) throw new SourceError("CBS StatLine answered with no usable half-yearly prices; this source needs updating.");
  return out;
}

export function normaliseEnergy(raw?: string): Energy {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "electricity" || s === "gas") return s;
  throw new InputError('energy must be "electricity" or "gas".');
}

export function normaliseBand(energy: Energy, raw?: string): Band {
  const s = (raw ?? "").trim().toUpperCase();
  const list = BANDS[energy];
  if (!s) return list.find((b) => b.code === DEFAULT_BAND[energy])!;
  const hit = list.find((b) => b.code === s);
  if (hit) return hit;
  const eurostat: Record<string, string> = energy === "electricity"
    ? { KWH_LT1000: "DA", "KWH1000-2499": "DB", "KWH2500-4999": "DC", "KWH5000-14999": "DD", KWH_GE15000: "DE" }
    : { GJ_LT20: "D1", "GJ20-199": "D2", GJ_GE200: "D3" };
  if (eurostat[s]) return list.find((b) => b.code === eurostat[s])!;
  throw new InputError(`consumption_band for the Netherlands ${energy} must be one of: ${list.map((b) => `${b.code} (${b.help})`).join("; ")}. Default ${DEFAULT_BAND[energy]}.`);
}

export function normaliseTaxes(raw?: string): Taxes {
  const s = (raw ?? "all").trim().toLowerCase();
  if (s === "all" || s === "excl_vat" || s === "none") return s;
  throw new InputError('taxes must be "all" (default), "excl_vat" or "none".');
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const value = (t: Table, period: string, tax: Taxes, comp: "total" | "supply" | "network", col: string): number | null => {
  const v = t.get(period)?.get(tax)?.[comp]?.[col];
  return typeof v === "number" ? v : null;
};
/** A usable headline price is positive. */
const total = (t: Table, period: string, tax: Taxes, col: string): number | null => {
  const v = value(t, period, tax, "total", col);
  return v !== null && v > 0 ? r4(v) : null;
};

const periodWords = (c: string) => {
  const m = /^(\d{4})-H([12])$/.exec(c);
  return m ? `the ${m[2] === "1" ? "first" : "second"} half of ${m[1]}` : c;
};
const periodRange = (c: string) => {
  const m = /^(\d{4})-H([12])$/.exec(c)!;
  return m[2] === "1" ? { from: `${m[1]}-01-01`, to: `${m[1]}-06-30` } : { from: `${m[1]}-07-01`, to: `${m[1]}-12-31` };
};
const prevOf = (c: string) => {
  const m = /^(\d{4})-H([12])$/.exec(c)!;
  return m[2] === "2" ? `${m[1]}-H1` : `${Number(m[1]) - 1}-H2`;
};
const taxWords: Record<Taxes, string> = { all: "VAT and all taxes included", excl_vat: "excluding VAT, taxes included", none: "excluding VAT and taxes" };

export function nlMethod(): string {
  return (
    "Statistics Netherlands (CBS) publishes, twice a year, the average end-user price of natural gas (euro per m3) and electricity (euro per kWh) for households in consumption classes " +
    "(table 85666NED), as a total and in parts (supply price, network price), at three tax levels. We read the table from the CBS open-data API and pass on the newest half-year for the chosen class, " +
    "the same class at the other tax levels, every class and the previous half-year. The figures are modelled averages (tariff sheets times consumption). No range is calculated: CBS gives one average and no count of households or contracts."
  );
}

/** Pure: the answer from a parsed table. */
export function nlAnswer(table: Table, q: { energy: Energy; band: Band; taxes: Taxes; baseUrl?: string }): PriceAnswer {
  const gas = q.energy === "gas";
  const unit = gas ? "per m3" : "per kWh";
  const query = { country: "NL", energy: q.energy, consumption_band: q.band.code, taxes: q.taxes };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit, method: nlMethod(), baseUrl: q.baseUrl };
  const periods = [...table.keys()].filter((p) => total(table, p, q.taxes, q.band.column) !== null).sort();
  const period = periods[periods.length - 1];
  if (!period) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistics Netherlands publishes no positive household ${q.energy} price for consumption class ${q.band.code} (${q.band.help}) at this tax level.` };
  }
  const v = total(table, period, q.taxes, q.band.column) as number;
  const prevCode = prevOf(period);
  const prevVal = total(table, prevCode, q.taxes, q.band.column);
  const change = prevVal ? Math.round(((v - prevVal) / prevVal) * 1000) / 10 : null;
  const latestAnywhere = [...table.keys()].sort().pop()!;
  const notes: string[] = [];
  if (latestAnywhere > period) notes.push(`Statistics Netherlands has published ${latestAnywhere}, but not for this class and tax level; the newest figure for it is given.`);
  const provisional = [...table.keys()].sort().slice(-2);
  if (provisional.includes(period)) notes.push("CBS marks the last two half-years as provisional.");
  const byTax: Record<string, number> = {};
  for (const [k, name] of [["all", "all_taxes_included"], ["excl_vat", "excluding_vat"], ["none", "excluding_all_taxes"]] as const) {
    const x = total(table, period, k, q.band.column);
    if (x !== null) byTax[name] = x;
  }
  const allBands = BANDS[q.energy].flatMap((b) => {
    const x = total(table, period, q.taxes, b.column);
    return x === null ? [] : [{ band: b.code, label: b.help, value: x }];
  });
  const parts: Record<string, number> = {};
  for (const c of ["supply", "network"] as const) {
    const x = value(table, period, q.taxes, c, q.band.column);
    if (x !== null) parts[c] = r4(x);
  }
  return buildStatisticAnswer({
    ...base,
    value: v,
    period: periodRange(period),
    reference_period: period,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (x) =>
      `In the Netherlands the average household price of ${q.energy} was ${x.toFixed(3)} euro ${unit} in ${periodWords(period)} (${taxWords[q.taxes]}; ${q.energy === "gas" ? "gas" : "electricity"} class ${q.band.code}, ${q.band.help}).` +
      (change === null ? "" : change === 0 ? ` That is unchanged from ${periodWords(prevCode)}.` : ` That is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than in ${periodWords(prevCode)}.`),
    extra: {
      energy: q.energy,
      country_name: "Netherlands",
      consumption_band: { band: q.band.code, annual_consumption: q.band.help },
      taxes: { level: q.taxes, label: taxWords[q.taxes] },
      reference_period_label: periodWords(period),
      price_by_tax_level_eur: byTax,
      cbs_parts_eur: parts,
      ...(gas ? { price_per_kwh_eur_calculated: r4(v / KWH_PER_M3), kwh_per_m3_used: Math.round(KWH_PER_M3 * 1000) / 1000 } : {}),
      previous_period: prevVal ? { reference_period: prevCode, value: prevVal, change_percent: change } : null,
      all_bands: allBands,
      dataset: { table: TABLE, url: TABLE_URL },
      attribution_notice: SOURCE_LINE,
    },
  });
}

export async function fetchTable(): Promise<unknown> {
  return fetchJson(url(), {}, 25000);
}

export async function nlEnergy(input: { energy?: string; consumption_band?: string; taxes?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const energy = normaliseEnergy(input.energy);
  const band = normaliseBand(energy, input.consumption_band);
  const taxes = normaliseTaxes(input.taxes);
  return nlAnswer(parseTable(await fetchTable()), { energy, band, taxes, baseUrl: input.baseUrl });
}
