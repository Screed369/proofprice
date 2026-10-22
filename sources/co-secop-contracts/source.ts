// Colombian public contract prices from SECOP II "Contratos Electronicos" (Agencia Nacional de Contratacion Publica - Colombia Compra Eficiente),
// published on datos.gov.co (Socrata) as dataset jbjy-vk9h under CC BY-SA 4.0 (dataset metadata licenseId CC_40_BY_SA, read 2026-10-22).
// Format checked 2026-10-22 from GitHub's servers (probes co-secop-1, -meta, -st, -like):
//   GET https://www.datos.gov.co/resource/jbjy-vk9h.json?$select=...&$where=... answers a JSON array; every value is a string.
//   Fields used: id_contrato ("CO1.PCCNTR.4323030"), fecha_de_firma ("2024-12-12T00:00:00.000"), valor_del_contrato ("58890006", COP, sometimes "1316696626.2"),
//   descripcion_del_proceso (what was bought, upper-case Spanish), estado_contrato (Aprobado, cedido, Cerrado, En ejecución, Modificado, Suspendido, terminado).
//   upper(descripcion_del_proceso) like '%PORT_TIL%' works server-side ("_" matches one letter, so accents do not matter).
// The rows ALSO hold personal data (names of legal representatives, supervisors, bank account numbers, ID numbers): we never select those columns.
// Only id_contrato (to count a contract once), fecha_de_firma, valor_del_contrato and the description filter are read; aggregates only.
import { socrataAll } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "co-secop-contracts",
  country: "CO (national, departmental and municipal public buyers)",
  category: "government contracts (signed contracts)",
  name: "SECOP II: Colombian public contracts (Colombia Compra Eficiente)",
  publisher: "Agencia Nacional de Contratacion Publica - Colombia Compra Eficiente (SECOP II), on the datos.gov.co open-data portal",
  what_is_recorded:
    "Signed public contracts that Colombian public buyers record in SECOP II: what was bought, the signing date and the contract value in Colombian pesos.",
  price_type: "contract_price",
  freshness: "Daily: Colombia Compra Eficiente refreshes the open dataset about daily and our copy is collected once a day",
  licence: "Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)",
  licence_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  attribution:
    "Source: Agencia Nacional de Contratacion Publica - Colombia Compra Eficiente, SECOP II Contratos Electronicos, datos.gov.co (CC BY-SA 4.0). Figures are ProofPrice aggregates of the published contracts; share them under the same licence.",
  homepage: "https://www.datos.gov.co/d/jbjy-vk9h",
  limits:
    "Contract values as recorded by the buyer, in Colombian pesos, over the whole contract (often several months or a year); they are not unit prices and not amounts paid yet. " +
    "Purchases are recognised from words in the contract description, so a contract with unusual wording is missed, and a contract that bundles several items is counted as one. " +
    "Values under 100,000 pesos (placeholders) and over 1 trillion pesos (entry errors) are left out. If a purchase has more than 20,000 contracts in the window no figure is given. " +
    "Aggregates only; suppliers, officials and bank details in the open file are never read or kept.",
  method_version: "1",
};

export const DATASET_DOMAIN = "www.datos.gov.co";
export const DATASET_ID = "jbjy-vk9h";
export const WINDOW_MONTHS = 12;
export const MIN_VALUE = 100_000;
export const MAX_VALUE = 1_000_000_000_000;
export const MAX_ROWS = 20000;
export const UNIT = "per contract, total contract value";

/** Spanish description patterns per shared purchase id (SQL LIKE on the upper-cased description; "_" = any one letter, so accents never matter). */
export const PATTERNS: Record<string, string[]> = {
  laptops: ["%COMPUTADOR%PORT_TIL%", "%LAPTOP%"],
  "desktop-computers": ["%COMPUTADOR%ESCRITORIO%"],
  tablets: ["%TABLET%DIGITAL%", "%TABLETA%DIGITAL%"],
  "school-meals": ["%ALIMENTACI_N ESCOLAR%"],
  catering: ["%CATERING%"],
  "office-cleaning": ["%SERVICIO%ASEO%CAFETER_A%"],
  "security-guards": ["%VIGILANCIA%SEGURIDAD PRIVADA%"],
  "waste-collection": ["%RECOLECCI_N%RESIDUOS%"],
  ambulances: ["%AMBULANCIA%"],
  photocopiers: ["%FOTOCOPIADORA%"],
  printers: ["%IMPRESORA%"],
  "mobile-phones": ["%TEL_FONO%M_VIL%", "%CELULAR%"],
  cars: ["%CAMIONETA%"],
  buses: ["%BUSETA%", "%AUTOBUS%"],
  software: ["%LICENCIA%SOFTWARE%"],
  uniforms: ["%UNIFORME%"],
  "street-cleaning": ["%BARRIDO%"],
  diesel: ["%ACPM%"],
  electricity: ["%SUMINISTRO DE ENERG_A EL_CTRICA%"],
  "office-furniture": ["%MOBILIARIO%OFICINA%", "%MUEBLES%OFICINA%"],
};

/** One signed contract with only the fields we use. */
export interface CoContract {
  key: string;
  date: string;
  value: number;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: the SoQL where-clause for one purchase. Patterns come from PATTERNS (no user input), so quoting is safe. */
export function whereFor(patterns: string[], from: string): string {
  const likes = patterns.map((p) => `upper(descripcion_del_proceso) like '${p.replace(/'/g, "''")}'`).join(" OR ");
  return `fecha_de_firma >= '${from}T00:00:00' AND (${likes})`;
}

/** Pure: Socrata rows to usable contracts. Text numbers are converted; placeholders, entry errors and bad dates are dropped. */
export function contractsOf(rows: Record<string, any>[]): CoContract[] {
  const out: CoContract[] = [];
  for (const r of rows) {
    const value = Number(r?.valor_del_contrato);
    if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    const date = String(r?.fecha_de_firma ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01") continue;
    out.push({ key: String(r?.id_contrato ?? ""), date, value });
  }
  return out;
}

/** Pure: one library row for a purchase (area ALL), a contract counted once, 5-contract rule. */
export function aggregateOne(item: string, contracts: CoContract[], from: string, to: string): DailyRow | null {
  const seen = new Set<string>();
  const values: number[] = [];
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    if (c.key) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
    }
    values.push(c.value);
  }
  const s = summarise(values);
  if (!s || s.count < 5) return null;
  return { area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

export interface HarvestOptions {
  fetcher?: (url: string) => Promise<unknown>;
  patterns?: Record<string, string[]>;
}

export async function coContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const patterns = o.patterns ?? PATTERNS;
  const rows: DailyRow[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  let usable = 0;
  let lastError: unknown = null;
  for (const [item, pats] of Object.entries(patterns)) {
    try {
      const got = await socrataAll(
        DATASET_DOMAIN,
        DATASET_ID,
        { select: ["id_contrato", "fecha_de_firma", "valor_del_contrato"], where: whereFor(pats, from), order: "fecha_de_firma DESC, id_contrato ASC" },
        { maxRows: MAX_ROWS + 1, pageSize: 5000, timeoutMs: 90000, fetcher: o.fetcher },
      );
      if (got.rows.length > MAX_ROWS) {
        skipped.push(item); // too many contracts to read honestly: no figure rather than a figure from the newest part only
        continue;
      }
      const contracts = contractsOf(got.rows);
      usable += contracts.length;
      const row = aggregateOne(item, contracts, from, to);
      if (row) rows.push(row);
    } catch (err) {
      failed.push(item);
      lastError = err;
    }
  }
  if (failed.length === Object.keys(patterns).length) {
    throw new SourceError("Could not read the SECOP II open data (datos.gov.co)", String((lastError as any)?.message ?? lastError));
  }
  if (usable === 0 && skipped.length === 0) throw new SourceError("The SECOP II open data held no usable contracts for any purchase: the dataset may have changed");
  return {
    date: to,
    currency: "COP",
    unit: UNIT,
    rows: rows.sort((a, b) => a.item.localeCompare(b.item)),
    note: `Contracts signed ${from} to ${to}; ${usable} usable contracts across ${Object.keys(patterns).length} purchases.` +
      (skipped.length ? ` Over ${MAX_ROWS} contracts, no figure: ${skipped.join(", ")}.` : "") +
      (failed.length ? ` Not read this day: ${failed.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface CoInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["catering", "security guard services", "office cleaning", "laptops", "ambulances", "printers"];

export async function coContracts(input: CoInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Colombia: cpv is not used (SECOP II records UNSPSC codes, not CPV). Leave it out and say what was bought in words.");
  if (input.buyer_area) throw new InputError("Colombia: buyer_area is not used; the figures are for all Colombian public buyers together.");
  const p = matchPurchase(input.what);
  if (!p || !PATTERNS[p.id]) {
    const known = PURCHASES.filter((x) => PATTERNS[x.id]).map((x) => x.label);
    throw new InputError(
      `Colombia: "${input.what}" is not one of the purchases we summarise from SECOP II. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${known.length} purchases are recognised: ${known.join(", ")}).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Colombian contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "CO", what: input.what },
    summary,
    currency: "COP",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `SECOP II contracts signed ${from} to ${day.date}, recognised by Spanish words in the contract description (${p.label}). Median and 10th–90th percentile of the contract value in COP. ` +
      "Totals per contract, not unit prices; suppliers are never named.",
    describe: (s) =>
      `Colombian public buyers signed ${p.label} contracts with a median total value of ${fmtMoney(s.median, "COP")} per contract ` +
      `(typical range ${fmtMoney(s.low, "COP")} to ${fmtMoney(s.high, "COP")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value (signed contract), not a unit price", matched_purchase: p.id, newest_collection: day.date },
  });
}
