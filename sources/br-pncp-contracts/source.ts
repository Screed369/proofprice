// Brazilian public contract prices from the PNCP (Portal Nacional de Contratacoes Publicas), the national procurement portal.
// Format checked 2026-10-29 from GitHub's servers (probes brpncp-d1, -d2, -d3), key-free JSON, no cookies:
//   GET https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=YYYYMMDD&dataFinal=YYYYMMDD&pagina=1&tamanhoPagina=500
//   -> {"data":[...], "totalRegistros":7672, "totalPaginas":768 (for size 10), "numeroPagina":1, "paginasRestantes":..., "empty":false}
//   One publication day holds about 7,700 contracts (a 500-row page is about 860 KB). Dates are publication dates of the contract.
//   Fields read: numeroControlePNCP (to count a contract once), objetoContrato (what was bought, Portuguese free text),
//   valorGlobal (BRL, plain decimal), tipoContrato.id (1 = "Contrato (termo inicial)", the initial contract), receita (true = the buyer EARNS money, e.g. sale of goods),
//   unidadeOrgao.ufSigla (state), dataAssinatura (signing date).
// The rows ALSO name suppliers (company or personal tax ids and names). We never read those fields: only the six above are copied out of each row.
// Licence: the PNCP site footer says CC BY-ND 3.0; no licence is stated for the API itself (Notion Source Pipeline row, 24 Oct 2026). Served as FREE TIER ONLY
// (Simon, 29 Oct 2026: unclear licence = free only; the payment gate lists cleared sources in lib/payments/cleared.ts and this one is not on it).
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { InputError, retryOnce, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, normaliseText, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "br-pncp-contracts",
  country: "BR (federal, state and municipal public buyers)",
  category: "government contracts (signed contracts)",
  name: "PNCP: Brazilian public contracts (Portal Nacional de Contratacoes Publicas)",
  publisher: "Portal Nacional de Contratacoes Publicas (PNCP), Governo Federal do Brasil",
  what_is_recorded:
    "Initial contracts that Brazilian public buyers publish on the PNCP: what was bought, the signing date, the state of the buyer and the total contract value in reais.",
  price_type: "contract_price",
  freshness: "Daily: the PNCP publishes contracts as buyers register them and our copy is collected once a day",
  licence: "PNCP site content is published under Creative Commons Attribution-NoDerivatives 3.0 (CC BY-ND 3.0); no licence is stated for the API data itself, so ProofPrice serves this source free of charge only",
  licence_url: "https://www.gov.br/pncp/pt-br/acesso-a-informacao/dados-abertos",
  attribution: "Fonte: Portal Nacional de Contratacoes Publicas (PNCP). Figures are ProofPrice aggregates (median and range) of the published contracts.",
  homepage: "https://pncp.gov.br/",
  limits:
    "Contract values as registered by the buyer, in Brazilian reais, over the whole contract (often 12 months or more); they are not unit prices and not amounts paid yet. " +
    "Purchases are recognised from Portuguese words in the contract description, so a contract with unusual wording is missed and a contract that bundles several items is counted once under each matching purchase. " +
    "Only initial contracts count (amendments are left out), contracts where the buyer earns money (sales of goods) are left out, and values under 1,000 reais (placeholders) or over 10 billion reais (entry errors) are dropped. " +
    "Each figure covers the contracts published in the last 7 days. Aggregates only; suppliers and their tax ids in the open file are never read or kept.",
  method_version: "1",
};

export const BASE_URL = "https://pncp.gov.br/api/consulta/v1/contratos";
export const WINDOW_DAYS = 7;
export const PAGE_SIZE = 500;
export const MAX_PAGES_PER_DAY = 40; // about 20,000 contracts, 2.5 times a normal day
export const MIN_VALUE = 1_000;
export const MAX_VALUE = 10_000_000_000;
export const UNIT = "per contract, total contract value";
export const STATES = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

/** Portuguese patterns per shared purchase id, tested on the description in lower case WITHOUT accents (normaliseText). */
export const PATTERNS: Record<string, RegExp[]> = {
  laptops: [/\bnotebooks?\b/, /\blaptops?\b/, /computadores? portateis/, /computador portatil/],
  "desktop-computers": [/computadores? (de mesa|desktop)/, /microcomputadores?/],
  "school-meals": [/merenda escolar/, /alimentacao escolar/, /refeicoes escolares/],
  catering: [/\bbuffet\b/, /coffee ?break/, /fornecimento de refeicoes/, /servicos? de refeicoes/],
  "building-cleaning": [/servicos? de limpeza/, /limpeza e conservacao/, /limpeza predial/],
  "security-guards": [/vigilancia (armada|desarmada|patrimonial|ostensiva)/, /servicos? de vigilancia/, /seguranca privada/],
  "waste-collection": [/coleta (e transporte )?de (residuos|lixo)/, /coleta de lixo/],
  "street-cleaning": [/varricao/],
  ambulances: [/\bambulancias?\b/],
  printers: [/\bimpressoras?\b/],
  buses: [/\bonibus\b/, /micro-?onibus/],
  "school-transport": [/transporte escolar/],
  cars: [/aquisicao de veiculos?/, /veiculos? (zero|0) ?km/, /\bautomoveis\b/],
  diesel: [/oleo diesel/, /\bdiesel s-?(10|500)\b/],
  electricity: [/energia eletrica/],
  software: [/licencas? de (uso de )?software/, /licenciamento de software/],
  uniforms: [/\buniformes?\b/],
  textbooks: [/livros? didaticos?/],
  pharmaceuticals: [/aquisicao de medicamentos/, /fornecimento de medicamentos/],
  vaccines: [/\bvacinas?\b/],
};

/** Words people may use for each purchase in Portuguese (the shared list has English and a few EU languages). Matched without accents. */
export const PT_ALIASES: Record<string, string[]> = {
  laptops: ["notebook", "notebooks", "laptop", "laptops", "computador portatil", "computadores portateis"],
  "desktop-computers": ["computador de mesa", "computadores de mesa", "computador desktop"],
  "school-meals": ["merenda escolar", "alimentacao escolar", "refeicoes escolares"],
  catering: ["buffet", "coffee break", "fornecimento de refeicoes", "refeicoes"],
  "building-cleaning": ["limpeza", "servico de limpeza", "servicos de limpeza", "limpeza predial", "limpeza e conservacao"],
  "security-guards": ["vigilancia", "seguranca privada", "vigilancia patrimonial"],
  "waste-collection": ["coleta de lixo", "coleta de residuos", "lixo"],
  "street-cleaning": ["varricao"],
  ambulances: ["ambulancia", "ambulancias"],
  printers: ["impressora", "impressoras"],
  buses: ["onibus", "microonibus", "micro onibus"],
  "school-transport": ["transporte escolar"],
  cars: ["veiculos", "veiculo", "carros", "carro", "automoveis"],
  diesel: ["oleo diesel", "diesel"],
  electricity: ["energia eletrica", "energia"],
  software: ["licenca de software", "licencas de software", "software"],
  uniforms: ["uniforme", "uniformes"],
  textbooks: ["livros didaticos", "livro didatico"],
  pharmaceuticals: ["medicamentos", "remedios"],
  vaccines: ["vacina", "vacinas"],
};

/** One initial contract with only the fields we use. */
export interface BrContract {
  key: string;
  uf: string;
  value: number;
  text: string; // normalised description
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The last WINDOW_DAYS complete days before `now`, oldest first, as YYYY-MM-DD. */
export function windowDays(now: Date, days = WINDOW_DAYS): string[] {
  const out: string[] = [];
  for (let i = days; i >= 1; i--) out.push(ymd(new Date(now.getTime() - i * 86400000)));
  return out;
}

export function pageUrl(day: string, page: number, size = PAGE_SIZE): string {
  const d = day.replace(/-/g, "");
  return `${BASE_URL}?dataInicial=${d}&dataFinal=${d}&pagina=${page}&tamanhoPagina=${size}`;
}

/** Pure: PNCP rows to usable initial contracts. Only the fields listed at the top of this file are read. */
export function contractsOf(rows: Record<string, any>[]): BrContract[] {
  const out: BrContract[] = [];
  for (const r of rows) {
    if (r?.receita === true) continue; // the buyer earns money (sale of goods or rights): not a price paid by the public
    if (r?.tipoContrato?.id !== 1) continue; // initial contracts only (amendments repeat values already counted)
    const value = Number(r?.valorGlobal);
    if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    const key = String(r?.numeroControlePNCP ?? "");
    const text = normaliseText(String(r?.objetoContrato ?? ""));
    if (!key || !text) continue;
    const uf = String(r?.unidadeOrgao?.ufSigla ?? "").toUpperCase();
    out.push({ key, uf: STATES.includes(uf) ? uf : "", value, text });
  }
  return out;
}

/** Pure: which shared purchase ids a contract description matches. */
export function purchasesOf(text: string, patterns: Record<string, RegExp[]> = PATTERNS): string[] {
  return Object.keys(patterns).filter((id) => patterns[id].some((re) => re.test(text)));
}

/** Pure: library rows. One row per purchase for the whole country (area ALL) and per state (area UF); a contract counts once; 5-contract rule. */
export function aggregate(contracts: BrContract[], patterns: Record<string, RegExp[]> = PATTERNS): DailyRow[] {
  const groups = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const c of contracts) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    for (const id of purchasesOf(c.text, patterns)) {
      for (const area of c.uf ? ["ALL", c.uf] : ["ALL"]) {
        const k = `${area}\u0000${id}`;
        const g = groups.get(k);
        if (g) g.push(c.value);
        else groups.set(k, [c.value]);
      }
    }
  }
  const rows: DailyRow[] = [];
  for (const [k, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    const [area, item] = k.split("\u0000");
    rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item) || a.area.localeCompare(b.area));
}

export interface HarvestOptions {
  fetcher?: (url: string) => Promise<any>;
  maxPages?: number;
  days?: number;
}

async function defaultFetcher(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", accept: "application/json" } });
    if (!res.ok) throw new SourceError(`PNCP returned HTTP ${res.status}`, url, res.status);
    return await res.json();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("PNCP timed out", url);
    throw new SourceError("Could not reach the PNCP", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** Collects one publication day, page by page. Returns the usable contracts and whether the day was read completely. */
export async function readDay(day: string, o: HarvestOptions = {}): Promise<{ contracts: BrContract[]; complete: boolean; total: number }> {
  const fetcher = o.fetcher ?? defaultFetcher;
  const maxPages = o.maxPages ?? MAX_PAGES_PER_DAY;
  const contracts: BrContract[] = [];
  let total = 0;
  let pages = 1;
  for (let page = 1; page <= pages && page <= maxPages; page++) {
    const body = await retryOnce(() => fetcher(pageUrl(day, page)), 2000);
    if (!body || !Array.isArray(body.data)) throw new SourceError("The PNCP answered in an unexpected format (no data list): the API may have changed");
    total = Number(body.totalRegistros) || total;
    pages = Number(body.totalPaginas) || pages;
    contracts.push(...contractsOf(body.data));
    if (body.data.length === 0 || body.empty === true) break;
  }
  return { contracts, complete: pages <= maxPages, total };
}

export async function brContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const days = windowDays(now, o.days ?? WINDOW_DAYS);
  const all: BrContract[] = [];
  const failed: string[] = [];
  const partial: string[] = [];
  let lastError: unknown = null;
  let read = 0;
  for (const day of days) {
    try {
      const d = await readDay(day, o);
      all.push(...d.contracts);
      read += d.total;
      if (!d.complete) partial.push(day);
    } catch (err) {
      failed.push(day);
      lastError = err;
    }
  }
  if (failed.length === days.length) throw new SourceError("Could not read the PNCP contracts", String((lastError as any)?.message ?? lastError));
  if (failed.length > 2) throw new SourceError(`Could not read ${failed.length} of ${days.length} PNCP days (${failed.join(", ")}): not publishing a thin window`, String((lastError as any)?.message ?? lastError));
  if (all.length === 0) throw new SourceError("The PNCP held no usable initial contracts: the API may have changed");
  const rows = aggregate(all);
  return {
    date: days[days.length - 1],
    currency: "BRL",
    unit: UNIT,
    rows,
    note: `Contracts published ${days[0]} to ${days[days.length - 1]}; ${all.length} usable initial contracts out of ${read} listed.` +
      (failed.length ? ` Days not read: ${failed.join(", ")}.` : "") +
      (partial.length ? ` Days capped at ${MAX_PAGES_PER_DAY} pages: ${partial.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface BrInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["school meals", "security guard services", "cleaning services", "laptops", "ambulances", "printers"];

/** Pure: the shared purchase id for a request in English, Portuguese or the shared aliases. */
export function purchaseFor(what: string): { id: string; label: string } | null {
  const text = normaliseText(what);
  if (!text) return null;
  for (const [id, words] of Object.entries(PT_ALIASES)) {
    if (words.includes(text)) {
      const p = PURCHASES.find((x) => x.id === id);
      if (p && PATTERNS[id]) return { id, label: p.label };
    }
  }
  const p = matchPurchase(what);
  if (p && PATTERNS[p.id]) return { id: p.id, label: p.label };
  // "office cleaning" and "school cleaning" are building cleaning for Brazilian contracts
  if (p && (p.id === "office-cleaning" || p.id === "school-cleaning")) {
    const b = PURCHASES.find((x) => x.id === "building-cleaning");
    if (b) return { id: b.id, label: b.label };
  }
  return null;
}

export function stateOf(raw: string | undefined): string {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return "ALL";
  if (!STATES.includes(s)) throw new InputError(`Brazil: buyer_area must be a two-letter state code such as SP, RJ, MG or DF (or left out for all of Brazil). Got "${raw}".`);
  return s;
}

export async function brContracts(input: BrInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Brazil: cpv is not used (the PNCP does not publish CPV codes). Leave it out and say what was bought in words.");
  const area = stateOf(input.buyer_area);
  const p = purchaseFor(input.what);
  if (!p) {
    const known = PURCHASES.filter((x) => PATTERNS[x.id]).map((x) => x.label);
    throw new InputError(
      `Brazil: "${input.what}" is not one of the purchases we summarise from the PNCP. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${known.length} purchases are recognised: ${known.join(", ")}).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Brazilian contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = ymd(new Date(new Date(day.date + "T12:00:00Z").getTime() - (WINDOW_DAYS - 1) * 86400000)); // the newest day is part of the window
  const row = day.rows.find((r) => r.area === area && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  const where = area === "ALL" ? "Brazilian public buyers" : `public buyers in the state of ${area}`;
  return buildAnswer({
    source: INFO,
    query: { country: "BR", what: input.what, ...(area === "ALL" ? {} : { buyer_area: area }) },
    summary,
    currency: "BRL",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `PNCP initial contracts published ${from} to ${day.date}, recognised by Portuguese words in the contract description (${p.label}). Median and 10th–90th percentile of the contract value in BRL. ` +
      "Totals per contract, not unit prices; amendments, sales and suppliers are never counted or named.",
    describe: (s) =>
      `${where[0].toUpperCase()}${where.slice(1)} signed ${p.label} contracts with a median total value of ${fmtMoney(s.median, "BRL")} per contract ` +
      `(typical range ${fmtMoney(s.low, "BRL")} to ${fmtMoney(s.high, "BRL")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value (initial contract), not a unit price", matched_purchase: p.id, newest_collection: day.date, window_days: WINDOW_DAYS },
  });
}
