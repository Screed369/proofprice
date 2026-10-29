// Brazilian federal price research for office and school furniture: unit prices that public bodies agreed in purchase awards
// (Compras.gov.br "Pesquisa de Preço", module Preços Praticados, Ministério da Gestão e da Inovação).
// Facts (probed from GitHub Actions 2026-10-22 and 2026-10-29, probes bbf-pdm7110, bbf-price310; OpenAPI https://dadosabertos.compras.gov.br/v3/api-docs):
//   GET /modulo-pesquisa-preco/1_consultarMaterial?pagina=1&tamanhoPagina=10..500&tipo=codigoPdm&codigo=<PDM>&dataCompraInicio=YYYY-MM-DD&dataCompraFim=YYYY-MM-DD[&estado=SP]
//   -> JSON {resultado:[...], totalRegistros, totalPaginas}; tamanhoPagina must be 10 to 500 (400 otherwise). Key-free, plain GET.
//   Row fields used: precoUnitario (BRL per unit), quantidade, dataCompra (YYYY-MM-DD), idCompra, codigoItemCatalogo, estado.
//   Supplier fields (niFornecedor, nomeFornecedor) are never read or returned.
//   PDM (product family) list: GET /modulo-material/3_consultarPdmMaterial?codigoClasse=7110 -> codigoPdm, nomePdm (probe 2026-10-29).
import { buildAnswer, fmtMoney, type PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { summarise, type PriceSummary } from "../../lib/stats";
import { monthsWindow } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "br-compras-furniture",
  country: "BR (federal price research)",
  category: "government contracts (unit prices of office and school furniture)",
  name: "Compras.gov.br price research: unit prices agreed in public purchases of furniture",
  publisher: "Ministério da Gestão e da Inovação em Serviços Públicos, Compras.gov.br (Dados Abertos)",
  what_is_recorded:
    "Unit prices (Brazilian reais per unit) that Brazilian public bodies agreed in purchase awards for furniture items of the federal material catalogue (CATMAT), with purchase date, state, quantity and catalogue item. Supplier names and tax ids are never read.",
  price_type: "contract_price",
  freshness: "Updated by the publisher as purchases are registered",
  licence:
    "UNCLEAR: the API page and the official API manual state no licence (read 24 Oct 2026). Served as a FREE tier only: never charged for. " +
    "Brazilian federal open data is published under open-data terms, but this dataset's own licence line has not been confirmed.",
  licence_url: "https://dadosabertos.compras.gov.br/swagger-ui/index.html",
  attribution: "Source: Compras.gov.br, Dados Abertos (Ministério da Gestão e da Inovação em Serviços Públicos), Pesquisa de Preço. Unit prices from public purchases, not retail prices.",
  homepage: "https://dadosabertos.compras.gov.br/swagger-ui/index.html",
  limits:
    "Prices public bodies agreed in purchase awards (often bulk and tender prices), not shop prices. One product family (PDM) mixes similar items of different models, so the range is wide. " +
    "Public bodies at all levels (federal, state, municipal) that report to Compras.gov.br; many local buyers are missing. At most 2,000 newest awards per question. Suppliers are never named.",
};

export const BASE = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";
export const PAGE_SIZE = 500;
export const MAX_PAGES = 4;
/** Total time for all pages: the whole answer must fit the 20 s budget. */
export const BUDGET_MS = 14000;

/** Furniture families of the federal catalogue (PDM codes from the 29 Oct 2026 catalogue probe, class 7110 office furniture), with plain-word aliases. */
export interface Product {
  pdm: number;
  id: string;
  label: string;
  aliases: string[];
}
export const PRODUCTS: Product[] = [
  { pdm: 310, id: "filing_cabinet", label: "office filing cabinets", aliases: ["filing cabinet", "filing cabinets", "file cabinet", "arquivo", "arquivo escritorio", "arquivo de aco"] },
  { pdm: 313, id: "office_chair", label: "office chairs", aliases: ["office chair", "office chairs", "chair", "chairs", "cadeira", "cadeira escritorio", "cadeira de escritorio"] },
  { pdm: 321, id: "office_desk", label: "office desks", aliases: ["office desk", "desk", "desks", "mesa", "mesa escritorio", "mesa de escritorio"] },
  { pdm: 317, id: "writing_desk", label: "writing desks (escrivaninhas)", aliases: ["writing desk", "escrivaninha"] },
  { pdm: 10984, id: "armchair", label: "armchairs (poltronas)", aliases: ["armchair", "armchairs", "poltrona"] },
  { pdm: 4661, id: "school_desk", label: "school desk-chairs (carteiras escolares)", aliases: ["school desk", "school desks", "student desk", "carteira escolar", "carteira"] },
  { pdm: 4080, id: "school_chair", label: "school chairs", aliases: ["school chair", "school chairs", "cadeira escolar"] },
  { pdm: 18749, id: "school_table", label: "school tables", aliases: ["school table", "school tables", "mesa escolar"] },
  { pdm: 4079, id: "stackable_chair", label: "stackable chairs", aliases: ["stackable chair", "stacking chair", "cadeira empilhavel"] },
  { pdm: 16315, id: "visitor_chair", label: "chairs on a beam (longarinas)", aliases: ["visitor chair", "waiting room chair", "chair on beam", "longarina", "cadeira longarina"] },
  { pdm: 336, id: "drawer_unit", label: "mobile drawer units (gaveteiros)", aliases: ["drawer unit", "pedestal drawers", "gaveteiro", "gaveteiro movel"] },
  { pdm: 9660, id: "meeting_table", label: "rectangular meeting tables", aliases: ["meeting table", "conference table", "mesa reuniao", "mesa de reuniao"] },
  { pdm: 1454, id: "whiteboard", label: "whiteboards", aliases: ["whiteboard", "whiteboards", "quadro branco"] },
  { pdm: 333, id: "safe", label: "safes (cofres)", aliases: ["safe", "safes", "cofre"] },
  { pdm: 3246, id: "counter", label: "counters (balcões)", aliases: ["counter", "reception counter", "balcao"] },
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The furniture family asked for: plain words (English or Portuguese) or an explicit 'pdm:310'. Throws InputError listing what is recognised. */
export function resolveProduct(what: string, cpv?: string): Product {
  const m = /^pdm:\s*(\d{1,6})$/i.exec((cpv ?? "").trim());
  if (cpv && !m) throw new InputError("For Brazil, cpv must be a Compras.gov.br product-family code as 'pdm:310' (or leave it out).");
  if (m) {
    const known = PRODUCTS.find((p) => p.pdm === Number(m[1]));
    return known ?? { pdm: Number(m[1]), id: `pdm_${m[1]}`, label: `catalogue family ${m[1]}`, aliases: [] };
  }
  const q = norm(what);
  const hit = PRODUCTS.find((p) => p.aliases.some((a) => norm(a) === q)) ?? PRODUCTS.find((p) => p.aliases.some((a) => q.length >= 4 && (norm(a).includes(q) || q.includes(norm(a)))));
  if (hit) return hit;
  throw new InputError(`Brazil covers office and school furniture only. Say one of: ${PRODUCTS.map((p) => p.aliases[0]).join(", ")}.`);
}

export function buildUrl(pdm: number, page: number, from: string, to: string, uf?: string): string {
  const q = new URLSearchParams({
    pagina: String(page),
    tamanhoPagina: String(PAGE_SIZE),
    tipo: "codigoPdm",
    codigo: String(pdm),
    dataCompraInicio: from,
    dataCompraFim: to,
  });
  if (uf) q.set("estado", uf);
  return `${BASE}?${q.toString()}`;
}

export interface Award {
  key: string;
  date: string;
  unitPrice: number;
}

/** UF of the buyer: two letters. Throws InputError for anything else. */
export function ufOf(area: string | undefined): string | undefined {
  const a = (area ?? "").trim().toUpperCase();
  if (!a) return undefined;
  if (!/^[A-Z]{2}$/.test(a)) throw new InputError("For Brazil, buyer_area is the two-letter state code of the buying body, for example SP, RJ, MG or DF.");
  return a;
}

/** Rows of one response page -> awards. Zero, negative and absurd prices are dropped; a row counts once. Throws SourceError when the shape is unknown. */
export function parseAwards(json: any): { awards: Award[]; pages: number } {
  if (!json || !Array.isArray(json.resultado)) throw new SourceError("Compras.gov.br answered in a format we do not recognise", "missing resultado");
  const awards: Award[] = [];
  for (const r of json.resultado) {
    const price = Number(r?.precoUnitario);
    const date = typeof r?.dataCompra === "string" ? r.dataCompra.slice(0, 10) : "";
    if (!(price > 0) || price > 5_000_000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    awards.push({ key: `${r?.idCompra ?? ""}|${r?.codigoItemCatalogo ?? ""}|${price}|${date}`, date, unitPrice: price });
  }
  return { awards, pages: Number(json.totalPaginas) || 1 };
}

export type Fetcher = (url: string) => Promise<any>;

export interface FurnitureInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months?: number;
  baseUrl?: string;
  fetcher?: Fetcher;
  now?: Date;
}

export async function brFurniture(input: FurnitureInput): Promise<PriceAnswer> {
  const product = resolveProduct(input.what, input.cpv);
  const uf = ufOf(input.buyer_area);
  const months = Math.min(60, Math.max(1, Math.round(input.months ?? 24)));
  const win = monthsWindow(months, input.now);
  const started = Date.now();
  const get = input.fetcher ?? ((u: string) => fetchJson(u, {}, Math.max(3000, BUDGET_MS - (Date.now() - started))));
  const seen = new Map<string, Award>();
  let pagesRead = 0;
  let cutShort = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let parsed: { awards: Award[]; pages: number };
    try {
      parsed = parseAwards(await get(buildUrl(product.pdm, page, win.from, win.to, uf)));
    } catch (err) {
      // The publisher's API is slow: later pages may time out. Keep what page 1.. already gave; page 1 failing is a real failure.
      if (page > 1 && err instanceof SourceError) {
        cutShort = true;
        break;
      }
      throw err;
    }
    pagesRead = page;
    for (const a of parsed.awards) if (!seen.has(a.key)) seen.set(a.key, a);
    if (page >= parsed.pages) break;
    if (Date.now() - started > BUDGET_MS * 0.5) {
      cutShort = true;
      break;
    }
  }
  const list = [...seen.values()];
  const summary: PriceSummary | null = summarise(list.map((a) => a.unitPrice));
  const newest = list.reduce((m, a) => (a.date > m ? a.date : m), "");
  const where = uf ? `public bodies in the Brazilian state ${uf}` : "Brazilian public bodies";
  return buildAnswer({
    source: INFO,
    query: { country: "BR", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}), ...(uf ? { buyer_area: uf } : {}), months },
    summary,
    currency: "BRL",
    unit: "per unit, agreed in a public purchase",
    period: { from: win.from, to: newest || win.to },
    method:
      `Compras.gov.br price-research awards for the federal catalogue family ${product.pdm} (${product.label}), purchases dated ${win.from} to ${win.to}` +
      (uf ? `, buying bodies in ${uf}` : "") +
      `. Each row is the unit price in reais that a public body agreed for one item in one purchase; median and 10th–90th percentile of up to ${MAX_PAGES * PAGE_SIZE} newest awards. ` +
      "Public purchase prices (often bulk and tender prices), not shop prices; suppliers are never read or named.",
    describe: (s) =>
      `${where} agreed a median unit price of ${fmtMoney(s.median, "BRL")} for ${product.label} ` +
      `(typical range ${fmtMoney(s.low, "BRL")} to ${fmtMoney(s.high, "BRL")}, 10th to 90th percentile, ${s.count} awards). ` +
      "These are prices in public purchases, not what a household pays in a shop.",
    baseUrl: input.baseUrl,
    evidence: { label: "Unit price in a public purchase", meaning: "The price per unit a Brazilian public body agreed in a purchase award. Often a bulk or tender price; not a retail price." },
    extra: {
      value_basis: "unit price per item in a public purchase award; not a retail price",
      catalogue_family: product.pdm,
      product: product.id,
      ...(newest ? { newest_award_used: newest } : {}),
      pages_read: pagesRead,
      ...(cutShort ? { partial: "the publisher's API was slow, so only the first pages of awards were read" } : {}),
      free_tier_only: true,
    },
  });
}
