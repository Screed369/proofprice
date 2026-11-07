// Brazil raw milk paid to producers: IBGE "Pesquisa Trimestral do Leite", SIDRA table 1086 (https://sidra.ibge.gov.br/tabela/1086).
// The table holds, per quarter, for Brazil and each of the 27 states, the average price (R$ per litre) that dairies paid for raw milk
// (variable 2522, "Preço médio") and the number of dairies that reported a price (variable 396, "Número de informantes do preço do leite").
// Format checked live on 2026-11-07 from the cloud workspace (plain GET, no key); see fixtures.ts.
// One published figure per territory and quarter, so every answer is an official statistic (no range, no sample size).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { resolveFetcher } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "br-ibge-milk",
  country: "BR (Brazil)",
  category: "farm-gate-prices (raw milk paid to producers)",
  name: "Quarterly Milk Survey: average price of raw milk paid to producers (IBGE, SIDRA table 1086, Pesquisa Trimestral do Leite)",
  publisher: "IBGE (Instituto Brasileiro de Geografia e Estatística)",
  what_is_recorded:
    "The average price, in reais per litre, that dairies and cooperatives under inspection paid for raw milk delivered by producers in the quarter, for Brazil and for each state, " +
    "with the number of dairies that reported a price. One published figure per territory and quarter; never individual farms or deliveries.",
  price_type: "official_statistic",
  freshness: "Quarterly; the newest quarter on 7 Nov 2026 was Q2 2026 (published about four months after the quarter ends)",
  licence:
    "IBGE open data (SIDRA). IBGE's terms page could not be read by ProofPrice on 7 Nov 2026 (Cloudflare challenge), so the licence is not cleared for reuse beyond the free tier: this source is free tier only and never charged for.",
  licence_url: "https://sidra.ibge.gov.br/tabela/1086",
  attribution:
    "Source: IBGE, Pesquisa Trimestral do Leite, SIDRA table 1086 (https://sidra.ibge.gov.br/tabela/1086). Figures are passed on as published; ProofPrice adds the change on the previous quarter and a year earlier.",
  homepage: "https://sidra.ibge.gov.br/tabela/1086",
  limits:
    "A quarterly average price paid by dairies under official inspection to milk producers, in reais per litre, not a retail price, a sale or a live price. IBGE suppresses a state's figure when too few dairies report it (shown as X), " +
    "so some states have gaps. No distribution is published, so there is no range; the number of dairies that reported is given in the answer but is not a count of sales.",
};

export const SIDRA_BASE = "https://apisidra.ibge.gov.br";
/** Brasil (n1) and every state (n3); price (2522) and informants (396); the newest 6 quarters; "Total do trimestre" (c12716/115236). */
export const sidraUrl = (quarters = 6, base = SIDRA_BASE) =>
  `${base}/values/t/1086/n1/all/n3/all/v/2522,396/p/last%20${quarters}/c12716/115236?formato=json`;

export interface Territory { code: string; uf: string; name: string }
/** IBGE territory codes: 1 = Brazil, the others are the 27 states. */
export const BRAZIL: Territory = { code: "1", uf: "BR", name: "Brazil" };
export const STATES: Territory[] = [
  ["11", "RO", "Rondônia"], ["12", "AC", "Acre"], ["13", "AM", "Amazonas"], ["14", "RR", "Roraima"], ["15", "PA", "Pará"], ["16", "AP", "Amapá"],
  ["17", "TO", "Tocantins"], ["21", "MA", "Maranhão"], ["22", "PI", "Piauí"], ["23", "CE", "Ceará"], ["24", "RN", "Rio Grande do Norte"],
  ["25", "PB", "Paraíba"], ["26", "PE", "Pernambuco"], ["27", "AL", "Alagoas"], ["28", "SE", "Sergipe"], ["29", "BA", "Bahia"],
  ["31", "MG", "Minas Gerais"], ["32", "ES", "Espírito Santo"], ["33", "RJ", "Rio de Janeiro"], ["35", "SP", "São Paulo"], ["41", "PR", "Paraná"],
  ["42", "SC", "Santa Catarina"], ["43", "RS", "Rio Grande do Sul"], ["50", "MS", "Mato Grosso do Sul"], ["51", "MT", "Mato Grosso"],
  ["52", "GO", "Goiás"], ["53", "DF", "Distrito Federal"],
].map(([code, uf, name]) => ({ code, uf, name }));
export const STATE_NAMES = STATES.map((s) => s.name);

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** A state by name (with or without accents), two-letter code or IBGE code; null for the whole country (empty, "Brazil", "BR", "Brasil"). Throws InputError for anything else. */
export function resolveTerritory(raw: unknown): Territory {
  const r = typeof raw === "string" ? fold(raw) : "";
  if (!r || ["br", "brazil", "brasil", "national", "country", "all", "nacional"].includes(r)) return BRAZIL;
  const hit = STATES.find((s) => fold(s.name) === r || s.uf.toLowerCase() === r || s.code === r || fold(s.name).replace(/^estado d[eo] /, "") === r.replace(/^estado d[eo] /, ""));
  if (hit) return hit;
  throw new InputError(`Give a Brazilian state as region (for example São Paulo, Minas Gerais, Rio Grande do Sul or its two-letter code such as SP), or leave region out for the national figure. "${String(raw)}" is not one.`);
}

const MILK_WORDS = new Set(["milk", "raw milk", "cow milk", "cows milk", "cow s milk", "leite", "leite cru", "leite cru resfriado", "dairy"]);
export function isMilk(raw: unknown): boolean {
  return MILK_WORDS.has(fold(typeof raw === "string" ? raw : String(raw ?? "")));
}

// ---------- reading the answer (pure) ----------

export interface Point { quarter: string; price: number; informants: number | null }

/** SIDRA "formato=json": the first element names the columns, then one object per cell. Returns, per territory code, its quarters (oldest first). Suppressed cells (X, -, ..., ...) are left out. */
export function readSidra(json: unknown): Map<string, Point[]> {
  if (!Array.isArray(json) || json.length < 2 || typeof json[0] !== "object") throw new SourceError("Unexpected response from IBGE SIDRA (no rows)");
  const head = json[0] as Record<string, string>;
  if (!/Preço|Preco|Variável/.test(String(head.D2N ?? "")) || !/Trimestre/.test(String(head.D3N ?? ""))) {
    throw new SourceError("IBGE changed the layout of SIDRA table 1086; this source needs updating.");
  }
  const price = new Map<string, Map<string, number>>();
  const inf = new Map<string, Map<string, number>>();
  const put = (m: Map<string, Map<string, number>>, t: string, q: string, v: number) => {
    if (!m.has(t)) m.set(t, new Map());
    m.get(t)!.set(q, v);
  };
  for (const r of json.slice(1) as Array<Record<string, string>>) {
    const raw = String(r.V ?? "");
    if (!/^\d+(\.\d+)?$/.test(raw)) continue;
    const v = Number(raw);
    if (r.D2C === "2522" && v > 0) put(price, String(r.D1C), String(r.D3C), v);
    else if (r.D2C === "396") put(inf, String(r.D1C), String(r.D3C), v);
  }
  const out = new Map<string, Point[]>();
  for (const [t, qs] of price) {
    out.set(
      t,
      [...qs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([quarter, p]) => ({ quarter, price: p, informants: inf.get(t)?.get(quarter) ?? null })),
    );
  }
  return out;
}

/** "202602" -> { from: "2026-04-01", to: "2026-06-30" } */
export function quarterRange(q: string): { from: string; to: string } {
  const x = /^(\d{4})0([1-4])$/.exec(q);
  if (!x) throw new SourceError(`Unexpected quarter code from IBGE: ${q}`);
  const y = Number(x[1]);
  const n = Number(x[2]);
  const startM = (n - 1) * 3 + 1;
  const last = new Date(Date.UTC(y, startM + 2, 0)).getUTCDate();
  const pad = (v: number) => String(v).padStart(2, "0");
  return { from: `${y}-${pad(startM)}-01`, to: `${y}-${pad(startM + 2)}-${pad(last)}` };
}
export const quarterWords = (q: string) => q.replace(/^(\d{4})0([1-4])$/, (_, y, n) => `Q${n} ${y}`);
export function shiftQuarter(q: string, delta: number): string {
  const x = /^(\d{4})0([1-4])$/.exec(q)!;
  const idx = Number(x[1]) * 4 + (Number(x[2]) - 1) + delta;
  return `${Math.floor(idx / 4)}0${(idx % 4) + 1}`;
}

const change = (now: number, then: number | undefined, quarter: string) =>
  then ? { reference_quarter: quarter, value: Number(then.toFixed(4)), change_percent: Math.round(((now - then) / then) * 1000) / 10 } : null;

export interface Ask { region?: string; baseUrl?: string }
const ITEM = "raw milk paid to producers (BRL per litre)";
export const itemName = () => ITEM;

export function answerFor(t: Territory, pts: Point[], newestAnywhere: string | null, ask: Ask): PriceAnswer {
  const placeName = t === BRAZIL ? "Brazil" : t.name;
  const latest = pts.length ? pts[pts.length - 1] : null;
  const base = { source: INFO, query: { country: "BR", product: "milk", ...(t === BRAZIL ? {} : { region: t.name }) }, measure: "average" as const, currency: "BRL", unit: "per litre", baseUrl: ask.baseUrl };
  if (!latest) {
    return buildStatisticAnswer({
      ...base, value: null, period: { from: null, to: null }, reference_period: "",
      method: "Brazil (IBGE Quarterly Milk Survey): the latest quarterly average price paid to milk producers.",
      describe: () => "",
      note: `IBGE publishes no price for ${placeName} in the latest quarters (it withholds a figure when too few dairies report).`,
    });
  }
  const by = new Map(pts.map((x) => [x.quarter, x.price]));
  const qoq = change(latest.price, by.get(shiftQuarter(latest.quarter, -1)), shiftQuarter(latest.quarter, -1));
  const yoy = change(latest.price, by.get(shiftQuarter(latest.quarter, -4)), shiftQuarter(latest.quarter, -4));
  const notes = [
    `A quarterly average price paid to milk producers by dairies under official inspection in ${placeName} for ${quarterWords(latest.quarter)}: not a retail price, a sale or a live price.`,
  ];
  if (newestAnywhere && latest.quarter < newestAnywhere) notes.push(`IBGE withheld the figure for ${placeName} in ${quarterWords(newestAnywhere)}, so this is the newest quarter it did publish.`);
  const fmt = (v: number) => fmtMoney(v, "BRL");
  return buildStatisticAnswer({
    ...base,
    value: latest.price,
    period: quarterRange(latest.quarter),
    reference_period: latest.quarter,
    method:
      "Brazil (IBGE): the quarterly average price that dairies under inspection paid for raw milk, from IBGE's Pesquisa Trimestral do Leite (SIDRA table 1086). " +
      "We pass on the published average and its quarter, with the change on the previous quarter and a year earlier that we calculate from two published averages; it is an average, not a sale, and no range is calculated.",
    describe: (v) =>
      `In ${quarterWords(latest.quarter)} dairies in ${placeName} paid milk producers on average ${fmt(v)} per litre of raw milk, as published by IBGE (a quarterly average, not a sale or a live price). ` +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from a year earlier (${fmt(yoy.value)} in ${quarterWords(yoy.reference_quarter)}).`
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${fmt(yoy.value)} in ${quarterWords(yoy.reference_quarter)}).`
        : "IBGE holds no price for the same quarter a year earlier."),
    note: notes.join(" "),
    extra: {
      country_name: "Brazil",
      region: placeName,
      what_this_is: "Quarterly average price paid by dairies under official inspection to milk producers, published by IBGE. Not a sale, not a retail price and not a live price.",
      reference_quarter: latest.quarter,
      reference_quarter_label: quarterWords(latest.quarter),
      dairies_reporting_a_price: latest.informants,
      change_on_previous_quarter: qoq,
      change_on_year_earlier: yoy,
      last_quarters: pts.map((x) => ({ quarter: quarterWords(x.quarter), value: x.price })),
      price_is_seasonal: "Milk prices in Brazil swing with the seasons (dry-season months are dearer): compare with the same quarter a year earlier.",
    },
  });
}

// ---------- the request ----------

export interface IbgeOptions extends FetchOptions { apiBase?: string }

export async function ibgeMilkPrices(input: { product?: string; region?: string; baseUrl?: string }, o: IbgeOptions = {}): Promise<PriceAnswer> {
  if (input.product !== undefined && input.product !== "" && !isMilk(input.product)) {
    throw new InputError(`For Brazil, IBGE publishes the price paid to producers for raw milk only. Ask for product "milk". "${input.product}" is not available.`);
  }
  const t = resolveTerritory(input.region);
  const get = resolveFetcher(o);
  const series = readSidra(await get(sidraUrl(6, o.apiBase)));
  const all = [...series.values()].map((p) => p[p.length - 1]?.quarter).filter(Boolean) as string[];
  const newestAnywhere = all.sort().pop() ?? null;
  return answerFor(t, series.get(t.code) ?? [], newestAnywhere, { region: input.region, baseUrl: input.baseUrl });
}

// ---------- daily copy (stale-if-error) ----------

/** Pure: one library row per territory for the newest quarter IBGE has for Brazil; territories without a published price are left out. */
export function harvestRows(series: Map<string, Point[]>): HarvestResult {
  const br = series.get(BRAZIL.code);
  if (!br || !br.length) throw new SourceError("IBGE returned no national milk price");
  const quarter = br[br.length - 1].quarter;
  const rows: DailyRow[] = [];
  for (const t of [BRAZIL, ...STATES]) {
    const pt = series.get(t.code)?.find((x) => x.quarter === quarter);
    if (pt) rows.push({ area: t.uf, item: ITEM, n: NO_COUNT, median: pt.price, low: pt.price, high: pt.price, min: pt.price, max: pt.price });
  }
  return {
    date: quarterRange(quarter).to,
    currency: "BRL",
    unit: "per litre",
    rows,
    note: `IBGE Quarterly Milk Survey, ${quarterWords(quarter)}: published quarterly averages paid to milk producers, not counts of sales (the number of reporting dairies is not a count of sales).`,
  };
}

export async function ibgeMilkHarvest(o: IbgeOptions = {}): Promise<HarvestResult> {
  const get = resolveFetcher(o);
  return harvestRows(readSidra(await get(sidraUrl(6, o.apiBase))));
}

/** Where a request lives in the library, without asking IBGE. */
export function ibgeMilkHistoryKey(p: { product?: string; region?: string }): { area: string; item: string; label: string } | null {
  if (p.product !== undefined && p.product !== "" && !isMilk(p.product)) return null;
  try {
    const t = resolveTerritory(p.region);
    return { area: t.uf, item: ITEM, label: `${t === BRAZIL ? "Brazil" : t.name}, raw milk paid to producers` };
  } catch {
    return null;
  }
}

// kept for the registry's fetch signature in tests
export { fetchJson };
