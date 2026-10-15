// BR electricity: regulated residential tariffs per distributor, from ANEEL (Brazil's electricity regulator).
// Format checked live on 2026-10-15 through the GitHub probe (CKAN datastore_search, no key, ODbL).
// One request per answer (the newest 300 conventional residential tariff lines, about three years of ~100 distributors).
// These are posted, regulator-approved tariffs (TE energy + TUSD network use), BEFORE taxes (ICMS, PIS/COFINS) and flag surcharges.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, retryOnce, SourceError } from "../../lib/http";
import { ckanSearch } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import { percentile } from "../../lib/stats";
import type { DailyRow, HarvestResult, Params, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";

export const SITE = "https://dadosabertos.aneel.gov.br";
export const RESOURCE_ID = "fcf2906c-7c32-4b9b-a637-054e7a5234f4";
export const ROW_LIMIT = 300;

export const INFO: SourceInfo = {
  id: "br-aneel-electricity",
  country: "BR",
  category: "energy (regulated household electricity tariffs)",
  name: "Tarifas homologadas das distribuidoras de energia elétrica (ANEEL)",
  publisher: "ANEEL (Agência Nacional de Energia Elétrica), Dados Abertos",
  what_is_recorded:
    "For each electricity distributor, the tariff the regulator approved for residential customers (subgroup B1, conventional tariff, residential class): " +
    "TE (energy) plus TUSD (use of the distribution network), in R$ per MWh before taxes. One approved tariff per distributor and year; never individual bills.",
  price_type: "posted_price",
  freshness: "Updated whenever ANEEL homologates a tariff adjustment (each distributor adjusts once a year); each answer states the validity period of the tariff",
  licence: "Open Data Commons Open Database License (ODbL)",
  licence_url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution:
    "Source: ANEEL (Agência Nacional de Energia Elétrica), Dados Abertos, Tarifas das distribuidoras de energia elétrica, ODbL. " +
    "Converted from R$/MWh to R$/kWh by ProofPrice; the national median across distributors is calculated by ProofPrice.",
  homepage: "https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica",
  limits:
    "Regulated tariffs (TE + TUSD) before taxes (ICMS, PIS/COFINS), public lighting charges and the monthly flag surcharges (bandeiras tarifárias), so the bill per kWh is higher. " +
    "A tariff is set for every customer of a distributor, so the figure is a posted price, not a sample of bills. Conventional residential tariff only (not time-of-use 'Branca', not the low-income subclass). " +
    "Areas are distributors, not states or postcodes. The national figure is the median of distributors' tariffs, not weighted by customers.",
};

export interface Tariff {
  distributor: string;
  cnpj: string;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  resolution: string;
  te: number; // R$/MWh
  tusd: number; // R$/MWh
  total: number; // R$/MWh
}

/** Brazilian text number: "418,31" -> 418.31, ",00" -> 0, "1.234,50" -> 1234.5. NaN when unreadable. */
export function parseBrNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (s.startsWith(".")) s = "0" + s;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Keep only the tariff lines we price (the request already filters; this guards against a changed portal). */
export function parseTariffs(records: Record<string, any>[]): Tariff[] {
  const out: Tariff[] = [];
  for (const r of records) {
    if (r.DscSubGrupo !== "B1" || r.DscBaseTarifaria !== "Tarifa de Aplicação") continue;
    if (r.DscModalidadeTarifaria !== "Convencional" || r.DscSubClasse !== "Residencial" || r.DscDetalhe !== "Não se aplica") continue;
    if (r.DscUnidadeTerciaria !== "MWh") continue;
    const te = parseBrNumber(r.VlrTE);
    const tusd = parseBrNumber(r.VlrTUSD);
    const distributor = String(r.SigAgente ?? "").trim();
    if (!distributor || !Number.isFinite(te) || !Number.isFinite(tusd) || te + tusd <= 0) continue;
    out.push({
      distributor,
      cnpj: String(r.NumCNPJDistribuidora ?? ""),
      from: String(r.DatInicioVigencia ?? ""),
      to: String(r.DatFimVigencia ?? ""),
      resolution: String(r.DscREH ?? ""),
      te,
      tusd,
      total: te + tusd,
    });
  }
  return out;
}

/** The tariff in force on `today` for each distributor (newest start date wins). */
export function currentTariffs(tariffs: Tariff[], today: Date): Tariff[] {
  const day = today.toISOString().slice(0, 10);
  const best = new Map<string, Tariff>();
  for (const t of tariffs) {
    if (t.from > day || t.to < day) continue;
    const cur = best.get(t.distributor);
    if (!cur || t.from > cur.from) best.set(t.distributor, t);
  }
  return [...best.values()].sort((a, b) => a.distributor.localeCompare(b.distributor));
}

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "cemig", "CEMIG-D" -> the one distributor it names; exact match first, then a unique prefix. */
export function findDistributor(current: Tariff[], raw: string): Tariff | null {
  const k = key(raw);
  if (!k) return null;
  const exact = current.find((t) => key(t.distributor) === k);
  if (exact) return exact;
  const hits = current.filter((t) => key(t.distributor).startsWith(k));
  return hits.length === 1 ? hits[0] : null;
}

const perKwh = (mwh: number) => Math.round((mwh / 1000) * 10000) / 10000;

export function normaliseEnergy(raw?: string): "electricity" {
  const s = (raw ?? "").trim().toLowerCase();
  if (["electricity", "electric", "power"].includes(s)) return "electricity";
  throw new InputError('Brazil: only energy "electricity" is available from this source (ANEEL electricity tariffs; no gas).');
}

export interface BrEnergyQuery {
  energy?: string;
  distributor?: string;
  baseUrl?: string;
  today?: Date;
}

/** Pure: build the answer from parsed tariff lines. */
export function brElectricityAnswer(tariffs: Tariff[], q: BrEnergyQuery): PriceAnswer {
  normaliseEnergy(q.energy);
  const today = q.today ?? new Date();
  const current = currentTariffs(tariffs, today);
  const query = { country: "BR", energy: "electricity", ...(q.distributor ? { distributor: q.distributor } : {}) };
  const method =
    "Brazil electricity: the residential conventional tariff (TE energy + TUSD network) that ANEEL approved for the distributor, in force today, converted to R$ per kWh before taxes and flag surcharges. " +
    "Without a distributor, the median of all distributors' tariffs.";
  if (current.length === 0) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "BRL", unit: "per kWh before taxes", period: { from: null, to: null },
      reference_period: "", method, describe: () => "", baseUrl: q.baseUrl,
    });
  }
  if (q.distributor) {
    const t = findDistributor(current, q.distributor);
    if (!t) {
      throw new InputError(
        `distributor "${q.distributor}" not found. Use ANEEL's short name, for example CEMIG-D, ENEL SP, LIGHT, COPEL-DIS, CPFL PAULISTA. Known: ${current.map((c) => c.distributor).join(", ")}.`,
      );
    }
    const total = perKwh(t.total);
    return buildStatisticAnswer({
      source: INFO, query: { ...query, distributor: t.distributor }, value: total, measure: "average", currency: "BRL", unit: "per kWh before taxes",
      period: { from: t.from, to: t.to }, reference_period: `${t.from} to ${t.to}`, sample_size: null, method, baseUrl: q.baseUrl,
      note: "Posted regulated tariff (TE + TUSD) before taxes (ICMS, PIS/COFINS) and flag surcharges; the same for every residential customer of the distributor.",
      describe: (v) => `${t.distributor} residential tariff is ${v.toFixed(4)} BRL per kWh before taxes (energy ${perKwh(t.te)} + network ${perKwh(t.tusd)}), valid ${t.from} to ${t.to}.`,
      extra: { distributor: t.distributor, te_brl_per_kwh: perKwh(t.te), tusd_brl_per_kwh: perKwh(t.tusd), resolution: t.resolution, tax_level: "before taxes and flag surcharges" },
    });
  }
  const totals = current.map((t) => t.total).sort((a, b) => a - b);
  const median = perKwh(percentile(totals, 0.5));
  const starts = current.map((t) => t.from).sort();
  const byTotal = [...current].sort((a, b) => a.total - b.total);
  const lowest = byTotal[0];
  const highest = byTotal[byTotal.length - 1];
  return buildStatisticAnswer({
    source: INFO, query, value: median, measure: "median", currency: "BRL", unit: "per kWh before taxes",
    period: { from: starts[0], to: today.toISOString().slice(0, 10) }, reference_period: `tariffs in force on ${today.toISOString().slice(0, 10)}`,
    sample_size: current.length, low: perKwh(percentile(totals, 0.1)), high: perKwh(percentile(totals, 0.9)), method, baseUrl: q.baseUrl,
    note: "Median of the regulated tariffs of the distributors (not weighted by customers); the sample is distributors, not bills.",
    describe: (v) => `Median residential tariff across ${current.length} Brazilian distributors is ${v.toFixed(4)} BRL per kWh before taxes (10th-90th percentile of distributors ${perKwh(percentile(totals, 0.1))} to ${perKwh(percentile(totals, 0.9))}).`,
    extra: { distributors: current.length, lowest: lowest.distributor, highest: highest.distributor, tax_level: "before taxes and flag surcharges" },
  });
}

export function ckanFilters() {
  return {
    DscSubGrupo: "B1",
    DscBaseTarifaria: "Tarifa de Aplicação",
    DscModalidadeTarifaria: "Convencional",
    DscSubClasse: "Residencial",
    DscDetalhe: "Não se aplica",
  };
}

/** Two attempts of 9 s with a 0.5 s pause stay inside the 20 s budget (ANEEL's portal often answers 502 after about 8 s). */
export const ATTEMPT_TIMEOUT_MS = 9000;

async function fetchTariffs(o: FetchOptions, timeoutMs: number, backoffMs: number): Promise<Tariff[]> {
  const res = await retryOnce(
    () => ckanSearch(SITE, { resourceId: RESOURCE_ID, filters: ckanFilters(), sort: "DatInicioVigencia desc", limit: ROW_LIMIT, includeTotal: false }, { timeoutMs, ...o }),
    backoffMs,
  );
  return parseTariffs(res.records);
}

export async function brElectricity(q: BrEnergyQuery, o: FetchOptions = {}): Promise<PriceAnswer> {
  normaliseEnergy(q.energy);
  return brElectricityAnswer(await fetchTariffs(o, ATTEMPT_TIMEOUT_MS, 500), q);
}

// ---------- the price library (daily collector) and stale-if-error ----------

export const HARVEST_UNIT = "per kWh before taxes";

/** Library key of a distributor: "CEMIG-D" -> "CEMIGD", "ENEL SP" -> "ENELSP". */
export const distributorKey = key;

/** Pure: library rows for one day. "ALL" = the median across distributors (real count); one row per distributor holds its posted tariff
 *  (the publisher gives one figure, not a sample, so n is the placeholder 5; the source sets nominalCounts so answers show no count). */
export function aneelDailyRows(tariffs: Tariff[], today: Date): DailyRow[] {
  const current = currentTariffs(tariffs, today);
  if (!current.length) return [];
  const totals = current.map((t) => t.total).sort((a, b) => a - b);
  const rows: DailyRow[] = [
    {
      area: NATIONAL, item: "electricity", n: current.length, median: perKwh(percentile(totals, 0.5)),
      low: perKwh(percentile(totals, 0.1)), high: perKwh(percentile(totals, 0.9)), min: perKwh(totals[0]), max: perKwh(totals[totals.length - 1]),
    },
  ];
  for (const t of current) {
    const v = perKwh(t.total);
    rows.push({ area: distributorKey(t.distributor), item: "electricity", n: 5, median: v, low: v, high: v, min: v, max: v });
  }
  return rows;
}

export async function aneelHarvest(o: FetchOptions = {}): Promise<HarvestResult> {
  // The collector is not in a hurry: a longer timeout and a longer pause before the one retry.
  const tariffs = await fetchTariffs(o, 60000, 5000);
  const today = new Date();
  const rows = aneelDailyRows(tariffs, today);
  if (!rows.length) throw new SourceError("ANEEL returned no residential tariff in force today");
  return {
    date: today.toISOString().slice(0, 10), currency: "BRL", unit: HARVEST_UNIT, rows,
    note: `Regulated residential tariff (TE + TUSD, before taxes) of ${rows.length - 1} distributors in force on the collection day; ALL = median across distributors.`,
  };
}

/** Which library row answers this request: one distributor, or the national median. null when the request is not a valid one. */
export function aneelHistoryKey(p: Params) {
  try {
    normaliseEnergy(typeof p.energy === "string" ? p.energy : undefined);
  } catch {
    return null;
  }
  const d = typeof p.distributor === "string" ? p.distributor.trim() : "";
  if (d) {
    const k = distributorKey(d);
    return k ? { area: k, item: "electricity", label: `${d}, Brazil` } : null;
  }
  return { area: NATIONAL, item: "electricity", label: "Brazil (median of distributors)" };
}
