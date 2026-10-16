// Brazil: average building cost per square metre by state, from IBGE's SINAPI survey (Sistema Nacional de Pesquisa de Custos e
// Indices da Construcao Civil, run by IBGE with Caixa Economica Federal). Published monthly on IBGE's SIDRA API, table 2296.
// Format checked live on 2026-10-16 from GitHub's servers (key-free JSON, see fixtures/): the first array element is a header
// object, then one object per cell with V (value, text), D1C/D1N (territory code/name), D2C (variable) and D3C (month YYYYMM).
//   variable 48   = average cost per m2, BRL            variable 2119 = materials part, BRL per m2
//   variable 2120 = labour part, BRL per m2
// Unit costs are a survey of prices, not invoices: price type official_statistic. The Caixa website itself is behind a WAF; IBGE is not.
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-sinapi",
  country: "BR (Brazil)",
  category: "construction (official building cost per m2)",
  name: "SINAPI average building cost per square metre by state (IBGE SIDRA, table 2296)",
  publisher: "IBGE (Instituto Brasileiro de Geografia e Estatistica), with Caixa Economica Federal",
  what_is_recorded:
    "Monthly average cost in BRL of building one square metre (materials plus labour) for each of the 27 states and for Brazil, with the materials and labour parts shown separately. Survey of unit prices collected by IBGE; no number of observations is published.",
  price_type: "official_statistic",
  freshness: "Monthly; the latest month on 16 Oct 2026 was September 2026",
  licence: "IBGE public statistics (open data, no key). IBGE asks users to cite the source; no separate licence text was found, so we only pass on the published figure with attribution.",
  licence_url: "https://www.ibge.gov.br/en/statistics/economic/prices-and-costs/17025-national-system-of-costs-and-indexes-for-the-construction-industry.html",
  attribution: "Source: IBGE - Sistema Nacional de Pesquisa de Custos e Indices da Construcao Civil (SINAPI), SIDRA table 2296.",
  homepage: "https://sidra.ibge.gov.br/tabela/2296",
  limits:
    "A survey average of unit costs per square metre for a reference building, not a list of invoices or what any one builder paid: no range and no sample size. It excludes land, design fees and the builder's profit. Values are in current Brazilian reais (BRL).",
};

export const TABLE = "2296";
export const VARS = { total: "48", material: "2119", labour: "2120" } as const;
export type Component = keyof typeof VARS;

export const STATES: Record<string, { uf: string; name: string }> = {
  "11": { uf: "RO", name: "Rondônia" }, "12": { uf: "AC", name: "Acre" }, "13": { uf: "AM", name: "Amazonas" }, "14": { uf: "RR", name: "Roraima" },
  "15": { uf: "PA", name: "Pará" }, "16": { uf: "AP", name: "Amapá" }, "17": { uf: "TO", name: "Tocantins" }, "21": { uf: "MA", name: "Maranhão" },
  "22": { uf: "PI", name: "Piauí" }, "23": { uf: "CE", name: "Ceará" }, "24": { uf: "RN", name: "Rio Grande do Norte" }, "25": { uf: "PB", name: "Paraíba" },
  "26": { uf: "PE", name: "Pernambuco" }, "27": { uf: "AL", name: "Alagoas" }, "28": { uf: "SE", name: "Sergipe" }, "29": { uf: "BA", name: "Bahia" },
  "31": { uf: "MG", name: "Minas Gerais" }, "32": { uf: "ES", name: "Espírito Santo" }, "33": { uf: "RJ", name: "Rio de Janeiro" }, "35": { uf: "SP", name: "São Paulo" },
  "41": { uf: "PR", name: "Paraná" }, "42": { uf: "SC", name: "Santa Catarina" }, "43": { uf: "RS", name: "Rio Grande do Sul" }, "50": { uf: "MS", name: "Mato Grosso do Sul" },
  "51": { uf: "MT", name: "Mato Grosso" }, "52": { uf: "GO", name: "Goiás" }, "53": { uf: "DF", name: "Distrito Federal" },
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();

export interface Territory {
  /** IBGE code: "1" for Brazil, otherwise the two-digit state code. */
  code: string;
  name: string;
  national: boolean;
}

/** Match a state by name, two-letter code or IBGE code; empty / "Brazil" is the national figure. */
export function matchTerritory(input?: string): Territory {
  const q = norm(input ?? "");
  if (!q || ["brazil", "brasil", "br", "national", "nationwide", "whole country", "all"].includes(q)) return { code: "1", name: "Brasil", national: true };
  for (const [code, s] of Object.entries(STATES)) {
    if (q === norm(s.name) || q === s.uf.toLowerCase() || q === code) return { code, name: s.name, national: false };
  }
  const part = Object.entries(STATES).filter(([, s]) => q.length >= 4 && norm(s.name).includes(q));
  if (part.length === 1) return { code: part[0][0], name: part[0][1].name, national: false };
  throw new InputError(
    `'${input}' is not a Brazilian state. Use a state name or two-letter code (for example 'São Paulo', 'SP', 'Bahia'), or leave area out for Brazil as a whole.`,
  );
}

export function sidraUrl(t: Territory): string {
  const level = t.national ? "n1/1" : `n3/${t.code}`;
  return `https://apisidra.ibge.gov.br/values/t/${TABLE}/${level}/v/${Object.values(VARS).join(",")}/p/last%202`;
}

export interface Cell {
  territory: string;
  variable: string;
  month: string; // YYYYMM
  value: number;
}

/** Parse a SIDRA response (array; first element is the header object). */
export function parseSidra(json: unknown): Cell[] {
  if (!Array.isArray(json) || json.length < 1 || typeof json[0] !== "object" || !json[0] || !("D3C" in (json[0] as object))) {
    throw new SourceError("IBGE changed the format of its SIDRA answer; this source needs updating.");
  }
  const out: Cell[] = [];
  for (const r of json.slice(1) as Record<string, string>[]) {
    const value = Number(r.V);
    if (!r.D1C || !r.D2C || !/^\d{6}$/.test(r.D3C ?? "") || !Number.isFinite(value) || value <= 0) continue;
    out.push({ territory: r.D1C, variable: r.D2C, month: r.D3C, value });
  }
  return out;
}

export interface Pick {
  month: string;
  value: number;
  previous: { month: string; value: number } | null;
}

export function pick(cells: Cell[], territory: string, variable: string): Pick | null {
  const rows = cells.filter((c) => c.territory === territory && c.variable === variable).sort((a, b) => a.month.localeCompare(b.month));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  return { month: last.month, value: last.value, previous: prev ? { month: prev.month, value: prev.value } : null };
}

const iso = (m: string) => `${m.slice(0, 4)}-${m.slice(4)}`;
function monthRange(m: string): { from: string; to: string } {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(4));
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${iso(m)}-01`, to: `${iso(m)}-${String(last).padStart(2, "0")}` };
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(4)) - 1]} ${m.slice(0, 4)}`;

export interface BrSinapiInput {
  area?: string;
  component?: string;
  baseUrl?: string;
}

export async function brSinapi(input: BrSinapiInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const comp = (input.component ?? "total") as Component;
  if (!(comp in VARS)) throw new InputError('component must be "total", "material" or "labour".');
  const territory = matchTerritory(input.area);
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  const cells = parseSidra(await get(sidraUrl(territory)));
  const main = pick(cells, territory.code, VARS[comp]);
  const parts = {
    total: pick(cells, territory.code, VARS.total),
    material: pick(cells, territory.code, VARS.material),
    labour: pick(cells, territory.code, VARS.labour),
  };
  const label = comp === "total" ? "average cost of building" : comp === "material" ? "materials part of the cost of building" : "labour part of the cost of building";
  const changePct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
  const where = territory.national ? "Brazil" : territory.name;

  return buildStatisticAnswer({
    source: INFO,
    query: { country: "BR", area: territory.name, component: comp },
    value: main ? main.value : null,
    measure: "average",
    currency: "BRL",
    unit: "per m2",
    period: main ? monthRange(main.month) : { from: null, to: null },
    reference_period: main ? iso(main.month) : "",
    method:
      "Brazil (IBGE, SINAPI, SIDRA table 2296): the average cost of building one square metre in the state (or Brazil as a whole) for the latest month published, with the materials and labour parts. We pass on the published average and its month; it is a survey of unit costs, not a range built from invoices.",
    describe: (v) => `The ${label} one square metre in ${where} was ${fmtMoney(v, "BRL")} in ${monthName(main!.month)}.`,
    note: "Survey average of unit costs per m2 (excludes land, design fees and profit).",
    baseUrl: input.baseUrl,
    extra: main
      ? {
          territory: { name: territory.name, ibge_code: territory.code },
          component: comp,
          previous_month: main.previous ? { month: iso(main.previous.month), value: main.previous.value, change_percent: changePct(main.value, main.previous.value) } : null,
          by_component: {
            total: parts.total?.value ?? null,
            material: parts.material?.value ?? null,
            labour: parts.labour?.value ?? null,
          },
          cost_kind: "survey average of unit costs per m2",
        }
      : undefined,
  });
}
