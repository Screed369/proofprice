// Norway: average household electricity price by type of contract (fixed price, tied to spot price, variable price), quarterly,
// Statistics Norway (SSB) table 14491 "Electricity prices in the end-user market, by type of contract and quarter", read through the
// key-free PxWebApi v2 (plain GET). Format proven 2026-10-31 from GitHub's servers (probe vb-no14491d, see fixtures.ts, a real JSON-stat2 reply):
//   GET https://data.ssb.no/api/pxwebapi/v2/tables/14491/data?lang=en&outputFormat=json-stat2&valuecodes[Kraftpriser]=1,1.1,1.2,1.3&valuecodes[ContentsCode]=KraftprisEA,KraftprisIA&valuecodes[Tid]=top(5)
// All three variables must be passed. Kraftpriser: 1 Households total, 1.1 fixed-price, 1.2 tied to spot price, 1.3 variable price.
// ContentsCode: KraftprisEA = price excl. taxes, KraftprisIA = price incl. VAT (both øre/kWh, 1 decimal, measuring type Average). Tid: "2026K2".
// This is SSB's price of the ELECTRICITY SUPPLY (the power bought from a supplier), not the grid rent (nettleie), which is billed separately.
// One published average per cell, from SSB's survey of power suppliers: an official statistic with no record count.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { parseJsonStat } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const TABLE = "14491";
export const TABLE_URL = "https://www.ssb.no/en/statbank/table/14491";
const BASE = `https://data.ssb.no/api/pxwebapi/v2/tables/${TABLE}/data?lang=en&outputFormat=json-stat2`;
/** The newest 5 quarters: the newest, the one before and the same quarter a year earlier in one small reply (4 contract types x 2 contents x 5 quarters). */
export const URL_RECENT = `${BASE}&valuecodes%5BKraftpriser%5D=1,1.1,1.2,1.3&valuecodes%5BContentsCode%5D=KraftprisEA,KraftprisIA&valuecodes%5BTid%5D=top(5)`;
const SOURCE_LINE = "Source: Statistics Norway (SSB), table 14491 Electricity prices in the end-user market, by type of contract";

export const INFO: SourceInfo = {
  id: "no-ssb-electricity",
  country: "NO (Norway)",
  category: "energy (household electricity prices by contract type)",
  name: "Electricity prices in the end-user market, households by type of contract, quarterly (Statistics Norway table 14491)",
  publisher: "Statistics Norway (SSB)",
  what_is_recorded:
    "For each quarter, the average price in Norway of the electricity itself (the power bought from a supplier, in NOK per kWh) paid by households: all households together and split by type of contract " +
    "(fixed price, tied to the spot price, variable price), excluding taxes and including VAT. One published average per cell, from SSB's quarterly survey of power suppliers; never a bill or a supplier.",
  price_type: "official_statistic",
  freshness: "Quarterly (about six weeks after the quarter ends); each answer states its quarter",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). SSB's licence page (https://www.ssb.no/en/diverse/lisens, as read for no-ssb-fuel on 22 Oct 2026): \"You must give appropriate credit\" (Statistics Norway, SSB, with a link to www.ssb.no) and the material may be adapted and shared \"for any purpose, even commercially\". " +
    "Re-use must not suggest that SSB endorses ProofPrice.",
  licence_url: "https://www.ssb.no/en/diverse/lisens",
  attribution: `${SOURCE_LINE} (${TABLE_URL}), licensed CC BY 4.0. Changes made by ProofPrice: published øre per kWh are converted to NOK per kWh and the change on the previous quarter and a year earlier is calculated from the same table. SSB does not endorse ProofPrice.`,
  homepage: TABLE_URL,
  limits:
    "A national quarterly average for households, from a survey of power suppliers: a typical price level, not a supplier's offer, a quote or a bill. It is the price of the electricity only: grid rent (nettleie), the electricity consumption tax and any government support are not in it. " +
    "Not split by region or consumption band. SSB gives no count of households or contracts behind a figure. Electricity only (gas goes to the Eurostat source).",
};

export interface Contract {
  key: "total" | "fixed" | "spot" | "variable";
  code: string; // SSB Kraftpriser code
  help: string;
}
export const CONTRACTS: Contract[] = [
  { key: "total", code: "1", help: "all households together (default)" },
  { key: "fixed", code: "1.1", help: "fixed-price contracts" },
  { key: "spot", code: "1.2", help: "contracts tied to the spot price" },
  { key: "variable", code: "1.3", help: "variable-price contracts" },
];
export const DEFAULT_CONTRACT = "total";

export type Taxes = "all" | "none";
export type Table = Map<string, Map<Contract["key"], Partial<Record<Taxes, number>>>>; // quarter ("2026K2") -> contract -> tax level -> NOK per kWh

const D_CONTRACT = "Kraftpriser";
const D_CONTENT = "ContentsCode";
const D_TIME = "Tid";
const CONTENT_TAXES: Record<string, Taxes> = { KraftprisIA: "all", KraftprisEA: "none" };
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Pure: SSB JSON-stat -> quarter -> contract -> tax level -> NOK per kWh (øre / 100). Missing or non-positive cells are left out. */
export function parseTable(json: unknown): Table {
  const t = parseJsonStat(json);
  for (const id of [D_CONTRACT, D_CONTENT, D_TIME]) if (!t.ids.includes(id)) throw new SourceError(`Statistics Norway answered in an unexpected format (no ${id} dimension); this source needs updating.`);
  const byCode = new Map(CONTRACTS.map((c) => [c.code, c.key]));
  const out: Table = new Map();
  for (const r of t.rows) {
    const q = String(r[D_TIME]);
    const contract = byCode.get(String(r[D_CONTRACT]));
    const tax = CONTENT_TAXES[String(r[D_CONTENT])];
    const v = r.value;
    if (!/^\d{4}K[1-4]$/.test(q) || !contract || !tax || typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    const contracts = out.get(q) ?? new Map();
    const cell = contracts.get(contract) ?? {};
    cell[tax] = r4(v / 100);
    contracts.set(contract, cell);
    out.set(q, contracts);
  }
  if (!out.size) throw new SourceError("Statistics Norway answered with no usable prices; this source needs updating.");
  return out;
}

export function normaliseContract(raw?: string): Contract {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!s || s === "total" || s === "all" || s === "households" || s === "average") return CONTRACTS[0];
  if (["fixed", "fixed price", "fixed price contract", "fastpris", "fast"].includes(s)) return CONTRACTS[1];
  if (["spot", "spot price", "tied to spot price", "spot price contract", "spotpris", "market"].includes(s)) return CONTRACTS[2];
  if (["variable", "variable price", "variable price contract", "standard variable", "variabel"].includes(s)) return CONTRACTS[3];
  throw new InputError(`contract for Norway must be one of: total (default, all households), fixed, spot (tied to the spot price) or variable.`);
}

export function normaliseTaxes(raw?: string): Taxes {
  const s = (raw ?? "all").trim().toLowerCase();
  if (s === "all") return "all";
  if (s === "none" || s === "excl_vat") return "none";
  throw new InputError('taxes for Norway must be "all" (default, with VAT) or "none" / "excl_vat" (excluding taxes). SSB publishes only these two levels.');
}

const MONTH_RANGE: Record<string, [string, string]> = { "1": ["01-01", "03-31"], "2": ["04-01", "06-30"], "3": ["07-01", "09-30"], "4": ["10-01", "12-31"] };
export function quarterRange(q: string): { from: string; to: string } {
  const m = /^(\d{4})K([1-4])$/.exec(q);
  if (!m) return { from: "", to: "" };
  const [a, b] = MONTH_RANGE[m[2]];
  return { from: `${m[1]}-${a}`, to: `${m[1]}-${b}` };
}
const quarterWords = (q: string) => {
  const m = /^(\d{4})K([1-4])$/.exec(q);
  return m ? `${["January to March", "April to June", "July to September", "October to December"][Number(m[2]) - 1]} ${m[1]} (${m[1]}K${m[2]})` : q;
};
const shiftQuarter = (q: string, back: number) => {
  const m = /^(\d{4})K([1-4])$/.exec(q);
  if (!m) return q;
  const idx = Number(m[1]) * 4 + (Number(m[2]) - 1) - back;
  return `${Math.floor(idx / 4)}K${(idx % 4) + 1}`;
};
const taxWords: Record<Taxes, string> = { all: "including VAT", none: "excluding taxes" };

export function noElMethod(): string {
  return (
    "Statistics Norway (SSB) publishes every quarter the average price of electricity in øre per kWh paid by households, for all households and for fixed-price, spot-price-tied and variable-price contracts (table 14491), " +
    "excluding taxes and including VAT. We read the newest five quarters from the SSB PxWebApi and pass on the newest quarter for the chosen contract type in NOK per kWh, the other contract types, " +
    "and the change on the previous quarter and the same quarter a year earlier. It is the price of the power itself, without grid rent. No range is calculated: SSB gives one average and no count of households or contracts."
  );
}

const pct = (now: number, then: number | undefined) => (then ? Math.round(((now - then) / then) * 1000) / 10 : null);
const fmt = (v: number) => v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

/** Pure: the answer from a parsed table. */
export function noElAnswer(table: Table, q: { contract: Contract; taxes: Taxes; baseUrl?: string }): PriceAnswer {
  const query = { country: "NO", energy: "electricity", contract: q.contract.key, taxes: q.taxes };
  const base = { source: INFO, query, measure: "average" as const, currency: "NOK", unit: "per kWh", method: noElMethod(), baseUrl: q.baseUrl };
  const at = (quarter: string, c: Contract["key"] = q.contract.key, t: Taxes = q.taxes) => table.get(quarter)?.get(c)?.[t];
  const quarters = [...table.keys()].filter((k) => at(k) !== undefined).sort();
  const quarter = quarters[quarters.length - 1];
  if (!quarter) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistics Norway publishes no household electricity price for ${q.contract.help} at this tax level.` };
  }
  const value = at(quarter) as number;
  const prevQ = shiftQuarter(quarter, 1);
  const prevY = shiftQuarter(quarter, 4);
  const qChange = pct(value, at(prevQ));
  const yChange = pct(value, at(prevY));
  const latestAnywhere = [...table.keys()].sort().pop()!;
  const notes: string[] = [];
  if (latestAnywhere > quarter) notes.push(`SSB has published ${quarterWords(latestAnywhere)}, but not for this contract type and tax level; the newest figure for it is given.`);
  if (q.taxes === "none") notes.push("This is SSB's price excluding taxes (VAT and any other taxes); the VAT-inclusive price is in price_by_tax_level_nok_per_kwh.");
  const byTax: Record<string, number> = {};
  const all = at(quarter, q.contract.key, "all");
  const none = at(quarter, q.contract.key, "none");
  if (all !== undefined) byTax.including_vat = all;
  if (none !== undefined) byTax.excluding_taxes = none;
  const byContract = CONTRACTS.flatMap((c) => {
    const v = at(quarter, c.key);
    return v === undefined ? [] : [{ contract: c.key, label: c.help, value: v }];
  });
  const change = (c: number | null, since: string) => (c === null ? "" : c === 0 ? ` That is unchanged from ${quarterWords(since)}.` : ` That is ${Math.abs(c)}% ${c > 0 ? "higher" : "lower"} than in ${quarterWords(since)}.`);
  return buildStatisticAnswer({
    ...base,
    value,
    period: quarterRange(quarter),
    reference_period: quarter,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Norway the average household price of electricity (the power itself, without grid rent) was ${fmt(v)} NOK per kWh in ${quarterWords(quarter)} (${taxWords[q.taxes]}; ${q.contract.help}).` +
      change(yChange, prevY) +
      (qChange !== null && yChange === null ? change(qChange, prevQ) : ""),
    extra: {
      energy: "electricity",
      country_name: "Norway",
      contract: { type: q.contract.key, label: q.contract.help },
      taxes: { level: q.taxes, label: taxWords[q.taxes] },
      reference_period_label: quarterWords(quarter),
      price_by_tax_level_nok_per_kwh: byTax,
      all_contract_types_nok_per_kwh: byContract,
      previous_quarter: at(prevQ) !== undefined ? { reference_period: prevQ, value: at(prevQ), change_percent: qChange } : null,
      same_quarter_last_year: at(prevY) !== undefined ? { reference_period: prevY, value: at(prevY), change_percent: yChange } : null,
      scope: "Electricity supply price only: grid rent (nettleie) is billed separately and is not included.",
      dataset: { table: TABLE, url: TABLE_URL, unit_published: "øre/kWh (1 NOK = 100 øre); ProofPrice divides by 100" },
      attribution_notice: SOURCE_LINE,
    },
  });
}

export async function fetchTable(get: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 20000)): Promise<Table> {
  return parseTable(await get(URL_RECENT));
}

export async function noElectricity(input: { contract?: string; taxes?: string; baseUrl?: string }, get?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const contract = normaliseContract(input.contract);
  const taxes = normaliseTaxes(input.taxes);
  return noElAnswer(await fetchTable(get), { contract, taxes, baseUrl: input.baseUrl });
}

// ---------- daily collector copy (harvest) and history keys ----------
// Stores the newest quarter: each contract type at both tax levels (NOK per kWh, n NO_COUNT), dated by the quarter's last day. If SSB does not answer,
// runCategory answers from this copy for up to 7 days and says so.
export const AREA = "NO";
export const itemKey = (contract: Contract["key"], taxes: Taxes) => `electricity/${contract}/${taxes}`;

export function harvestFromTable(table: Table): HarvestResult {
  const quarter = [...table.keys()].sort().pop();
  if (!quarter) throw new SourceError("SSB table 14491 returned no quarters");
  const rows: DailyRow[] = [];
  for (const c of CONTRACTS) {
    for (const t of ["all", "none"] as Taxes[]) {
      const v = table.get(quarter)?.get(c.key)?.[t];
      if (v !== undefined) rows.push({ area: AREA, item: itemKey(c.key, t), n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  if (!rows.length) throw new SourceError("SSB table 14491's newest quarter holds no household electricity price; this source needs updating.");
  return {
    date: quarterRange(quarter).to,
    currency: "NOK",
    unit: "per kWh",
    rows,
    note: `Statistics Norway (SSB) average household electricity price for ${quarterWords(quarter)} by contract type, excluding taxes and including VAT. An official statistic; no record count is published.`,
  };
}

export async function noElHarvest(get?: (url: string) => Promise<unknown>): Promise<HarvestResult> {
  return harvestFromTable(await fetchTable(get));
}

export function noElHistoryKey(p: { contract?: string; taxes?: string }): { area: string; item: string; label: string } | null {
  try {
    const c = normaliseContract(p.contract);
    const t = normaliseTaxes(p.taxes);
    return { area: AREA, item: itemKey(c.key, t), label: `Norway, ${c.help}, ${taxWords[t]}` };
  } catch {
    return null;
  }
}
