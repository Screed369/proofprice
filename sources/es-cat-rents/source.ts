// Catalonia (Spain): average rent of newly signed home leases per municipality, from the rental-deposit register of
// INCASOL (Generalitat de Catalunya). Every legal lease must lodge its deposit (fiança), so these are agreed rents.
// Dataset qww9-bvhh on analisi.transparenciacatalunya.cat (Socrata). Format checked live 2026-10-16 from GitHub's servers
// (fixtures/barcelona.json, fixtures/sabadell.json): one row per municipality and period, rent is the MEAN of the period,
// municipalities with fewer than 6 contracts are left out by the publisher.
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { socrataUrl, parseSoda, soqlString } from "../../lib/adapters";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "es-cat-rents",
  country: "ES (Catalonia)",
  category: "rent (registered lease deposits)",
  name: "Average rent of new leases by municipality (INCASOL rental-deposit register, Generalitat de Catalunya)",
  publisher: "Institut Català del Sòl (INCASOL), Departament de Territori, Habitatge i Transició Ecològica, Generalitat de Catalunya",
  what_is_recorded:
    "Average monthly rent in euros of home leases newly signed and lodged with INCASOL (the legal rental deposit), by municipality and quarter, with the number of contracts behind each average.",
  price_type: "official_statistic",
  freshness: "Quarterly, a few weeks after each quarter ends; the daily collector keeps a copy for history and outages",
  licence: "Generalitat de Catalunya open data: reuse allowed with attribution (dataset licence field says 'See terms of use')",
  licence_url: "https://administraciodigital.gencat.cat/ca/dades/dades-obertes/informacio-practica/llicencies/",
  attribution: "Source: Departament de Territori, Habitatge i Transició Ecològica, Generalitat de Catalunya (INCASOL), open data.",
  homepage: "https://analisi.transparenciacatalunya.cat/d/qww9-bvhh",
  limits:
    "An average (mean) per municipality and quarter, not a median or a range: INCASOL publishes no individual rents. Covers Catalonia only. Municipalities with fewer than 6 new contracts in the period are not published. No split by size or type of home. Only leases lodged with INCASOL are counted.",
};

const DOMAIN = "analisi.transparenciacatalunya.cat";
const DATASET = "qww9-bvhh";

export interface DepositRow {
  code: string;
  name: string;
  year: number;
  period: string;
  rent: number;
  contracts: number;
}

/** Quarter windows: Catalan period label -> [first month, last month]. Only single quarters are used. */
const QUARTERS: Record<string, [number, number]> = {
  "gener-març": [1, 3],
  "abril-juny": [4, 6],
  "juliol-setembre": [7, 9],
  "octubre-desembre": [10, 12],
};

export function norm(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[·.]/g, "").replace(/['’`]/g, " ").replace(/\s+/g, " ").trim();
}

/** "Canonja, la" -> "la canonja"; "Ampolla, l'" -> "l ampolla" style key so both orders match. */
export function nameKey(s: string): string {
  const m = s.match(/^(.*),\s*(l'|l’|la|el|les|els|lo|los)\s*$/i);
  const base = m ? `${m[2]} ${m[1]}` : s;
  return norm(base).replace(/^(l |la |el |les |els |lo |los )/, "");
}

export function parseRows(json: unknown): DepositRow[] {
  const out: DepositRow[] = [];
  for (const r of parseSoda(json)) {
    const rent = Number(r.renda);
    const contracts = Number(r.habitatges);
    const year = Number(r.any);
    if (r.ambit_territorial !== "Municipi" || !r.nom_territori || !Number.isFinite(rent) || rent <= 0 || !Number.isFinite(contracts) || !Number.isFinite(year)) continue;
    out.push({ code: String(r.codi_territorial ?? ""), name: String(r.nom_territori), year, period: String(r.periode), rent, contracts });
  }
  return out;
}

export function quarterDates(year: number, period: string): { from: string; to: string; label: string } | null {
  const q = QUARTERS[period];
  if (!q) return null;
  const last = new Date(Date.UTC(year, q[1], 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${p(q[0])}-01`, to: `${year}-${p(q[1])}-${p(last)}`, label: `${year}-Q${Math.ceil(q[1] / 3)}` };
}

/** Latest single-quarter row of one municipality, or null. */
export function latestQuarter(rows: DepositRow[]): DepositRow | null {
  const q = rows.filter((r) => QUARTERS[r.period]);
  q.sort((a, b) => b.year - a.year || QUARTERS[b.period][0] - QUARTERS[a.period][0]);
  return q[0] ?? null;
}

/** Pick the municipality the user meant from the rows found. Exact name wins; otherwise one match is needed. */
export function pickMunicipality(rows: DepositRow[], town: string): DepositRow[] {
  const key = nameKey(town);
  const names = new Map<string, string>(); // code -> name
  for (const r of rows) names.set(r.code, r.name);
  const exact = [...names].filter(([, n]) => nameKey(n) === key);
  const hits = exact.length ? exact : [...names].filter(([, n]) => nameKey(n).includes(key));
  if (hits.length === 0) return [];
  if (hits.length > 1) {
    const list = hits.slice(0, 6).map(([, n]) => n).join(", ");
    throw new InputError(`'${town}' matches several Catalan municipalities (${list}). Give the exact name.`);
  }
  return rows.filter((r) => r.code === hits[0][0]);
}

export function buildUrl(town: string): string {
  const t = town.toUpperCase().replace(/['’]/g, "_").replace(/[%]/g, "");
  return socrataUrl(DOMAIN, DATASET, {
    where: `ambit_territorial = 'Municipi' AND upper(nom_territori) like ${soqlString("%" + t + "%")}`,
    order: ["any DESC", "nom_territori ASC"],
    limit: 400,
  });
}

export interface EsCatInput { town?: string; baseUrl?: string }

export async function esCatRent(input: EsCatInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const town = input.town?.trim();
  if (!town || town.length < 2) {
    throw new InputError("Give a Catalan municipality in town, e.g. town=Barcelona, Sabadell or Girona.");
  }
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  let rows: DepositRow[];
  try {
    rows = parseRows(await get(buildUrl(town)));
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError("The Catalonia open-data portal did not answer just now; try again later.");
  }
  const mine = pickMunicipality(rows, town);
  const latest = latestQuarter(mine);
  if (!latest) {
    throw new InputError(`No published rent for '${town}'. INCASOL publishes only Catalan municipalities with at least 6 new leases in a quarter.`);
  }
  const dates = quarterDates(latest.year, latest.period)!;
  const prev = mine.filter((r) => QUARTERS[r.period] && r.year === latest.year - 1 && r.period === latest.period)[0];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "ES", town: latest.name },
    value: Math.round(latest.rent),
    measure: "average",
    currency: "EUR",
    unit: "per month",
    period: { from: dates.from, to: dates.to },
    reference_period: dates.label,
    sample_size: latest.contracts,
    method:
      "Catalonia (INCASOL rental-deposit register): the average monthly rent of the home leases newly lodged in the municipality in the latest published quarter, with the number of contracts. We pass on the published average; it is a mean of agreed rents, not a median or a range.",
    describe: (v) => `The average rent of ${latest.contracts} new home leases in ${latest.name} (Catalonia) was ${fmtMoney(v, "EUR")} a month in ${dates.label}.`,
    note: "Mean of new leases, all home types and sizes.",
    baseUrl: input.baseUrl,
    extra: {
      municipality: { name: latest.name, ine_code: latest.code },
      new_contracts_in_quarter: latest.contracts,
      same_quarter_last_year: prev ? { period: quarterDates(prev.year, prev.period)!.label, average_rent: Math.round(prev.rent), contracts: prev.contracts } : null,
      rent_kind: "mean monthly rent of newly lodged leases (registered rental deposits)",
    },
  });
}

/** Library key for a municipality: the accent-free, article-first name key (both "Canonja, la" and "La Canonja" give "canonja"). */
export function esCatHistoryKey(p: { town?: string }): { area: string; item: string; label: string } | null {
  const town = p.town?.trim();
  if (!town || town.length < 2) return null;
  return { area: nameKey(town), item: "new-leases", label: `${town} (Catalonia)` };
}

/** SoQL for the collector: every municipality row of the last two calendar years in one request. */
export function harvestUrl(now: Date = new Date()): string {
  return socrataUrl(DOMAIN, DATASET, {
    where: `ambit_territorial = 'Municipi' AND any >= ${now.getUTCFullYear() - 1}`,
    order: ["any DESC", "codi_territorial ASC"],
    limit: 20000,
  });
}

/** One row per municipality for the newest single quarter INCASOL has published anywhere. Municipalities whose own newest
 *  quarter is older are left out (the figure would not describe the date). n is the real contract count (INCASOL leaves out
 *  municipalities with fewer than 6, and the library gate drops anything under 5 again). */
export function esCatHarvestRows(rows: DepositRow[]): HarvestResult {
  const newest = latestQuarter(rows);
  if (!newest) throw new SourceError("The INCASOL rents dataset has no single-quarter municipality rows");
  const dates = quarterDates(newest.year, newest.period)!;
  const seen = new Set<string>();
  const out: HarvestResult["rows"] = [];
  for (const r of rows) {
    if (r.year !== newest.year || r.period !== newest.period) continue;
    const area = nameKey(r.name);
    if (!area || seen.has(area)) continue;
    seen.add(area);
    const rent = Math.round(r.rent);
    out.push({ area, item: "new-leases", n: r.contracts, median: rent, low: rent, high: rent, min: rent, max: rent });
  }
  if (out.length < 20) throw new SourceError(`The INCASOL rents dataset gave only ${out.length} municipalities for ${dates.label}`);
  return {
    date: dates.to,
    currency: "EUR",
    unit: "per month",
    rows: out,
    note: `INCASOL rental-deposit register, average monthly rent of new home leases by municipality for ${dates.label}. Published means (not medians), with the number of contracts.`,
  };
}

export async function esCatHarvest(fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 60000)): Promise<HarvestResult> {
  return esCatHarvestRows(parseRows(await fetcher(harvestUrl())));
}
