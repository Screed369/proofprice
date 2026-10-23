// Brazil: pump prices surveyed by ANP (Agência Nacional do Petróleo, Gás Natural e Biocombustíveis).
// ANP's field survey (Levantamento de Preços de Combustíveis) visits a sample of stations every week and publishes the
// station-level results as one open CSV per month. Those files are big (about 9 MB for petrol and ethanol, 4 MB for diesel),
// so the daily collector (harvest) turns them into aggregates (median, 10th-90th percentile, count per state and municipality)
// for the newest survey week, and answers come from the price library. Never one station's price: aggregates of 5+ stations.

import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { SourceError, InputError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Fuel, stripAccents } from "../../lib/fuels";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "br-fuel",
  country: "BR (Brazil)",
  category: "fuel (pump prices)",
  name: "Levantamento de Preços de Combustíveis – série de preços por revenda (dados abertos)",
  publisher: "ANP – Agência Nacional do Petróleo, Gás Natural e Biocombustíveis (Brazil)",
  what_is_recorded:
    "Retail selling price (Valor de Venda) of regular petrol (gasolina comum) and diesel S10 that ANP's field survey records at a sample of Brazilian fuel stations each week: station, product, collection date and price per litre.",
  price_type: "posted_pump_price",
  freshness:
    "ANP publishes the survey as one file per month, so the newest survey week is usually one to four weeks old. Our copy is refreshed daily, and every answer states the survey week it describes",
  licence:
    "UNCONFIRMED: ANP's open-data page for the series (gov.br/anp, Série histórica de preços de combustíveis) states no licence. Brazil's federal open-data decree binds ANP: open data are released 'sob licença aberta que permita sua livre utilização, consumo ou cruzamento, limitando-se a creditar a autoria ou a fonte' and there is 'permissão irrestrita de reuso das bases de dados publicadas em formato aberto' (Decreto 8.777/2016, art. 2 III and 3 IV). But ANP's website terms say 'É autorizada a reprodução total ou parcial, sem fins lucrativos, do conteúdo, mediante a citação obrigatória da fonte' (https://www.gov.br/anp/pt-br/acesso-a-informacao/termos-de-uso-privacidade-e-seguranca-1). Whether that non-profit clause reaches the open datasets has not been confirmed with ANP (permission requested).",
  licence_url: "https://www2.camara.leg.br/legin/fed/decret/2016/decreto-8777-11-maio-2016-783082-normaatualizada-pe.pdf",
  attribution:
    "Fonte: ANP – Agência Nacional do Petróleo, Gás Natural e Biocombustíveis, Levantamento de Preços de Combustíveis (dados abertos), https://www.gov.br/anp. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis",
  limits:
    "A weekly survey of a sample of stations, not every station: a place's figure rests on the stations ANP surveyed there, and a place with fewer than 5 surveyed stations in the week is not published. " +
    "Only regular petrol (gasolina comum, which Brazilian law blends with ethanol; it is not RON 95) and diesel S10 are covered; ethanol, additive petrol, natural gas (GNV) and LPG are not. " +
    "ANP publishes the survey in monthly files, so the newest week can be several weeks old (the survey week is stated in every answer). Pump selling prices observed by the survey (Brazilian reais per litre, taxes included), not receipts.",
};

// ---------- fuels ----------

/** The ANP product (column Produto) behind each ProofPrice fuel. */
export const BR_PRODUCT: Partial<Record<Fuel, string>> = { petrol95: "GASOLINA", diesel: "DIESEL S10" };
const FUEL_BY_PRODUCT: Record<string, Fuel> = { GASOLINA: "petrol95", "DIESEL S10": "diesel" };
export const BR_LABEL: Partial<Record<Fuel, string>> = { petrol95: "Regular petrol (gasolina comum)", diesel: "Diesel S10" };

// ---------- states and places ----------

export const BR_STATES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** Normalised form used in library keys and for matching what a caller types: no accents, upper case, single spaces. */
export const brKey = (s: string) => stripAccents(s).replace(/[+_]/g, " ").replace(/\s+/g, " ").trim();

const STATE_BY_NAME = new Map(Object.entries(BR_STATES).map(([code, name]) => [brKey(name), code]));

/** A two-letter state code from a code or a name ("sp", "São Paulo", "Minas Gerais"), or null. */
export function brState(input: string): string | null {
  const k = brKey(input);
  if (BR_STATES[k]) return k;
  return STATE_BY_NAME.get(k.replace(/^(ESTADO|STATE) (DE|DO|DA|OF) /, "")) ?? null;
}

export interface BrPlace {
  area: string; // library key: "ALL", "SP" or "SP:SAO PAULO"
  label: string;
}

/** Municipality keys in the newest library day, by normalised name -> states, so 'São Paulo' needs no state. Cached per day. */
let indexCache: { date: string; byName: Map<string, string[]> } | null = null;
function municipalityIndex(): Map<string, string[]> {
  const date = readMeta(INFO.id)?.last_date ?? "";
  if (indexCache && indexCache.date === date) return indexCache.byName;
  const byName = new Map<string, string[]>();
  for (const r of readLatestDay(INFO.id)?.rows ?? []) {
    const i = r.area.indexOf(":");
    if (i < 0) continue;
    const uf = r.area.slice(0, i);
    const name = r.area.slice(i + 1);
    const list = byName.get(name) ?? [];
    if (!list.includes(uf)) list.push(uf);
    byName.set(name, list);
  }
  indexCache = { date, byName };
  return byName;
}

/** Where a request lives in the library. Returns null when a municipality is not held (too few surveyed stations). */
export function resolveBrPlace(
  p: { area?: string; town?: string; postcode?: string },
  index: () => Map<string, string[]> = municipalityIndex,
): BrPlace | null {
  if (p.postcode) throw new InputError("Brazil: postcodes (CEP) are not used. Give a state as area (e.g. 'SP') and/or a municipality as town (e.g. 'São Paulo').");
  const area = p.area?.trim();
  const town = p.town?.replace(/\+/g, " ").trim();
  let uf: string | null = null;
  if (area && !/^(ALL|BRAZIL|BRASIL)$/i.test(area)) {
    uf = brState(area);
    if (!uf) throw new InputError(`Unknown Brazilian state '${area}'. Use a two-letter code such as SP, RJ or MG, or the state's name.`);
  }
  if (!town) return uf ? { area: uf, label: `${BR_STATES[uf]} (state)` } : { area: NATIONAL, label: "Brazil" };
  const name = brKey(town);
  if (uf) return { area: `${uf}:${name}`, label: `${town}, ${uf}` };
  const states = index().get(name);
  if (!states) return null;
  if (states.length > 1) throw new InputError(`'${town}' exists in several states (${states.sort().join(", ")}): add area=<state>, e.g. area=${states[0]}.`);
  return { area: `${states[0]}:${name}`, label: `${town}, ${states[0]}` };
}

// ---------- the ANP monthly files ----------

export const ANP_BASE = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/dsan";
export type AnpGroup = "gasolina-etanol" | "diesel-gnv";

export function anpFileUrl(year: number, month: number, group: AnpGroup): string {
  const mm = String(month).padStart(2, "0");
  return `${ANP_BASE}/${year}/${mm}-dados-abertos-precos-${year}-${mm}-${group}.csv`;
}

/** The current month and the two before it, newest first. */
export function candidateMonths(now = new Date(), count = 3): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push({ year: y, month: m });
    m--;
    if (m < 1) {
      m = 12;
      y--;
    }
  }
  return out;
}

export interface BrRecord {
  uf: string;
  municipality: string; // normalised
  product: string; // "GASOLINA" | "DIESEL S10"
  date: string; // ISO
  price: number;
  station: string; // CNPJ digits, or name + street when missing
}

/** One survey observation per line; ';' separated, decimal comma, dd/mm/yyyy dates, first line is the header. */
export function parseAnpCsv(text: string): BrRecord[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines[0].split(";").map((h) => brKey(h));
  const col = (name: string) => header.findIndex((h) => h === name);
  const iUf = col("ESTADO - SIGLA");
  const iMun = col("MUNICIPIO");
  const iName = col("REVENDA");
  const iCnpj = col("CNPJ DA REVENDA");
  const iStreet = col("NOME DA RUA");
  const iProduct = col("PRODUTO");
  const iDate = col("DATA DA COLETA");
  const iPrice = col("VALOR DE VENDA");
  const iUnit = col("UNIDADE DE MEDIDA");
  if ([iUf, iMun, iProduct, iDate, iPrice].some((i) => i < 0)) {
    throw new SourceError("Unexpected layout in the ANP price file (columns not found)", header.join("|").slice(0, 200));
  }
  const out: BrRecord[] = [];
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const f = line.split(";");
    if (f.length < header.length) continue;
    const product = brKey(f[iProduct]);
    if (!FUEL_BY_PRODUCT[product]) continue;
    if (iUnit >= 0 && !/LITRO/i.test(f[iUnit])) continue;
    const price = Number(f[iPrice].trim().replace(",", "."));
    const date = anpDate(f[iDate]);
    const uf = f[iUf].trim().toUpperCase();
    if (!date || !BR_STATES[uf] || !Number.isFinite(price) || price < 1 || price > 30) continue;
    const cnpj = iCnpj >= 0 ? f[iCnpj].replace(/\D/g, "") : "";
    out.push({
      uf,
      municipality: brKey(f[iMun]),
      product,
      date,
      price,
      station: cnpj || `${iName >= 0 ? f[iName] : ""}|${iStreet >= 0 ? f[iStreet] : ""}`,
    });
  }
  return out;
}

function anpDate(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

/** The newest survey week: records from the 7 days ending at the newest collection date, one price per station and product
 *  (the latest one if a station was visited twice). */
export function latestWeek(records: BrRecord[]): { date: string; stations: BrRecord[] } {
  let date = "";
  for (const r of records) if (r.date > date) date = r.date;
  if (!date) throw new SourceError("The ANP price files held no usable prices");
  const from = addDays(date, -6);
  const seen = new Map<string, BrRecord>();
  for (const r of records) {
    if (r.date < from) continue;
    const k = `${r.station}\u0000${r.product}`;
    const prev = seen.get(k);
    if (!prev || r.date > prev.date) seen.set(k, r);
  }
  return { date, stations: [...seen.values()] };
}

/** Library rows for the newest survey week: Brazil (ALL), each state (UF) and each municipality (UF:NAME), per fuel. */
export function brDailyRows(records: BrRecord[]): HarvestResult {
  const { date, stations } = latestWeek(records);
  const flat: { area: string; item: string; price: number }[] = [];
  for (const s of stations) {
    const item = FUEL_BY_PRODUCT[s.product];
    flat.push({ area: NATIONAL, item, price: s.price }, { area: s.uf, item, price: s.price }, { area: `${s.uf}:${s.municipality}`, item, price: s.price });
  }
  return {
    date,
    currency: "BRL",
    unit: "per litre",
    rows: aggregateDaily(flat, false),
    note: `ANP weekly survey: the 7 days ending ${date}. Areas: ALL = Brazil, UF = state, UF:NAME = municipality (5+ surveyed stations). Items: petrol95 = gasolina comum, diesel = diesel S10.`,
  };
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function fetchMonth(year: number, month: number, group: AnpGroup): Promise<string | null> {
  const url = anpFileUrl(year, month, group);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, accept: "text/csv,*/*" }, signal: AbortSignal.timeout(240000) });
  } catch (e: any) {
    throw new SourceError("Could not reach the ANP open-data files", String(e?.cause?.code ?? e?.message ?? e));
  }
  if (res.status === 404) return null; // the month is not published yet
  if (!res.ok) throw new SourceError(`ANP returned HTTP ${res.status}`, url, res.status);
  return await res.text();
}

/** Daily collector: the two newest monthly files of each product group (so a week that straddles a month end is whole). */
export async function brHarvest(now = new Date()): Promise<HarvestResult> {
  const records: BrRecord[] = [];
  for (const group of ["gasolina-etanol", "diesel-gnv"] as AnpGroup[]) {
    let found = 0;
    for (const { year, month } of candidateMonths(now)) {
      const text = await fetchMonth(year, month, group);
      if (text === null) continue;
      for (const r of parseAnpCsv(text)) records.push(r);
      if (++found === 2) break;
    }
    if (!found) throw new SourceError(`No ANP monthly file found for ${group} in the last three months`);
  }
  return brDailyRows(records);
}

// ---------- answers ----------

export function brHistoryKey(p: { area?: string; town?: string; postcode?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!BR_PRODUCT[p.fuel as Fuel]) return null;
  let place: BrPlace | null;
  try {
    place = resolveBrPlace(p);
  } catch {
    return null;
  }
  return place ? { area: place.area, item: p.fuel, label: `${place.label}, Brazil` } : null;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function brAnswerFromRow(
  row: DailyRow & { date: string },
  q: { fuel: Fuel; place: BrPlace; query: Record<string, unknown>; libraryDate: string; now?: string; baseUrl?: string },
): PriceAnswer {
  const now = q.now ?? today();
  const age = Math.max(0, daysBetween(row.date, now));
  const label = BR_LABEL[q.fuel] ?? q.fuel;
  const old = age > 28;
  return buildAnswer({
    source: INFO,
    query: q.query,
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "BRL",
    unit: "per litre",
    period: { from: addDays(row.date, -6), to: row.date },
    method:
      "Median and 10th–90th percentile of the pump selling prices that ANP's weekly survey recorded at the stations it visited in the place, over the 7 days ending on the date shown (one price per station). " +
      "It is a sample of stations, not every station. Place and fuel as described in the summary; ProofPrice copies the ANP files once a day.",
    describe: (x) =>
      `${label} in ${q.place.label}: median ${fmtMoney(x.median, "BRL")} per litre in ANP's survey of the week ending ${row.date}; typical range (10th–90th percentile) ${fmtMoney(x.low, "BRL")}–${fmtMoney(x.high, "BRL")} across the surveyed stations (posted pump prices, taxes included).` +
      (old ? ` This is old data: ${age} days have passed since that survey week.` : ""),
    baseUrl: q.baseUrl,
    extra: {
      coverage: "surveyed_stations_only",
      survey_week_ending: row.date,
      data_age_days: age,
      stations_surveyed: row.n,
      ...(old ? { stale_warning: `The newest ANP survey week for this place ended ${age} days ago.` } : {}),
      ...(row.date < q.libraryDate
        ? { note: `This place had fewer than ${MIN_PUBLISH} surveyed stations in the newest week (${q.libraryDate}); the figure is from ${row.date}.` }
        : {}),
    },
  });
}

export async function brFuelNow(input: { area?: string; town?: string; postcode?: string; fuel: Fuel; baseUrl?: string }): Promise<PriceAnswer> {
  if (!BR_PRODUCT[input.fuel]) throw new InputError("Fuel must be petrol95 (regular petrol, gasolina comum) or diesel (diesel S10) for Brazil.");
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects ANP's fuel price survey daily; figures appear after the first collection.");
  const place = resolveBrPlace(input);
  const query = { country: "BR", area: input.area ?? null, town: input.town ?? null, fuel: input.fuel };
  const label = place?.label ?? input.town ?? "Brazil";
  const rows = place
    ? readDaily(INFO.id, { area: place.area, item: input.fuel, from: addDays(meta.last_date, -35), to: meta.last_date }).filter((r) => r.n >= MIN_PUBLISH)
    : [];
  const row = rows[rows.length - 1];
  if (!place || !row) {
    const a = buildAnswer({
      source: INFO,
      query,
      summary: null,
      currency: "BRL",
      unit: "per litre",
      period: { from: null, to: null },
      method: "ANP's weekly survey of pump prices; a place is published when the survey recorded at least 5 stations there.",
      describe: () => "",
      baseUrl: input.baseUrl,
      extra: {
        note: `ANP surveys a sample of stations each week. ${label} had fewer than ${MIN_PUBLISH} surveyed stations in the last five weeks (or the name is not a municipality ANP surveys). Try the state (area, e.g. 'SP') or a larger municipality.`,
      },
    });
    return a;
  }
  return brAnswerFromRow(row, { fuel: input.fuel, place, query, libraryDate: meta.last_date, baseUrl: input.baseUrl });
}
