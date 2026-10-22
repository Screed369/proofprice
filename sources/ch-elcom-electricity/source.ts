// CH electricity: ElCom (Swiss Federal Electricity Commission) tariffs per canton and for Switzerland, from the LINDAS linked-data service.
// Format checked live on 2026-10-22 through the GitHub probe (SPARQL GET, no key, CSV answer). Terms: opendata.swiss "Open use"
// (commercial use allowed, citing the source recommended; read on opendata.swiss/en/terms-of-use and the dataset record 2026-10-22).
// These are published regulated tariffs (posted), NOT individual bills. Values come in Rappen (Rp) per kWh: 100 Rp = 1 CHF.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, retryOnce, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const ENDPOINT = "https://lindas.admin.ch/query";
export const GRAPH = "https://lindas.admin.ch/elcom/electricityprice";
const DIM = "https://energy.ld.admin.ch/elcom/electricityprice/dimension/";
const CAT = "https://energy.ld.admin.ch/elcom/electricityprice/category/";
const PROD = "https://energy.ld.admin.ch/elcom/electricityprice/product/";
const CUBE_CANTON = "https://energy.ld.admin.ch/elcom/electricityprice-canton/observation/";
const CUBE_SWISS = "https://energy.ld.admin.ch/elcom/electricityprice-swiss/observation/";

export const INFO: SourceInfo = {
  id: "ch-elcom-electricity",
  country: "CH",
  category: "energy (published household electricity tariffs)",
  name: "Strompreise / Electricity tariffs (ElCom, via LINDAS)",
  publisher: "ElCom (Eidgenössische Elektrizitätskommission), data published on opendata.swiss and LINDAS",
  what_is_recorded:
    "For each ElCom household consumption profile (H1 to H8, by annual use), the electricity tariff in Rappen per kWh for the standard product and the cheapest product, " +
    "split into energy, grid use, charges and the federal aid fee, for Switzerland as a whole or for one canton. Yearly figures; never individual bills.",
  price_type: "posted_price",
  freshness: "Yearly: ElCom publishes next year's tariffs in autumn; each answer states the tariff year",
  licence: "opendata.swiss terms of use: Open use (commercial use allowed, citing the source recommended)",
  licence_url: "https://opendata.swiss/en/terms-of-use",
  attribution:
    "Source: ElCom, Electricity tariff per provider (opendata.swiss / LINDAS), Open use. " +
    "Converted from Rappen to CHF per kWh by ProofPrice.",
  homepage: "https://www.strompreis.elcom.admin.ch/",
  limits:
    "Published tariffs per consumption profile, not what any household paid on a bill. The open-data record does not say whether VAT is included, so we do not claim either. " +
    "Only the national and the canton level are offered here (not single municipalities or suppliers). Electricity only (no gas).",
};

/** Swiss cantons by BFS number, which is the number LINDAS uses in https://ld.admin.ch/canton/<n>. */
export const CANTONS: Record<string, { id: number; name: string }> = {
  ZH: { id: 1, name: "Zürich" }, BE: { id: 2, name: "Bern" }, LU: { id: 3, name: "Luzern" }, UR: { id: 4, name: "Uri" },
  SZ: { id: 5, name: "Schwyz" }, OW: { id: 6, name: "Obwalden" }, NW: { id: 7, name: "Nidwalden" }, GL: { id: 8, name: "Glarus" },
  ZG: { id: 9, name: "Zug" }, FR: { id: 10, name: "Fribourg" }, SO: { id: 11, name: "Solothurn" }, BS: { id: 12, name: "Basel-Stadt" },
  BL: { id: 13, name: "Basel-Landschaft" }, SH: { id: 14, name: "Schaffhausen" }, AR: { id: 15, name: "Appenzell Ausserrhoden" },
  AI: { id: 16, name: "Appenzell Innerrhoden" }, SG: { id: 17, name: "St. Gallen" }, GR: { id: 18, name: "Graubünden" },
  AG: { id: 19, name: "Aargau" }, TG: { id: 20, name: "Thurgau" }, TI: { id: 21, name: "Ticino" }, VD: { id: 22, name: "Vaud" },
  VS: { id: 23, name: "Valais" }, NE: { id: 24, name: "Neuchâtel" }, GE: { id: 25, name: "Genève" }, JU: { id: 26, name: "Jura" },
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string> = {
  zurich: "ZH", berne: "BE", lucerne: "LU", geneva: "GE", geneve: "GE", genf: "GE", fribourg: "FR", freiburg: "FR", neuchatel: "NE",
  valais: "VS", wallis: "VS", ticino: "TI", tessin: "TI", vaud: "VD", waadt: "VD", grisons: "GR", graubunden: "GR", basel: "BS", stgallen: "SG", sanktgallen: "SG",
};

/** "ZH", "zurich", "Zürich" -> the canton; null when unknown. */
export function findCanton(raw: string): { code: string; id: number; name: string } | null {
  const k = fold(raw);
  if (!k) return null;
  const upper = raw.trim().toUpperCase();
  if (CANTONS[upper]) return { code: upper, ...CANTONS[upper] };
  if (ALIASES[k]) return { code: ALIASES[k], ...CANTONS[ALIASES[k]] };
  for (const [code, c] of Object.entries(CANTONS)) if (fold(c.name) === k) return { code, ...c };
  return null;
}

export const DEFAULT_PROFILE = "H4";

/** "h4", "4", "H 4" -> "H4"; throws for anything outside H1..H8. */
export function normaliseProfile(raw?: string): string {
  const s = (raw ?? "").toString().trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return DEFAULT_PROFILE;
  const m = /^H?([1-8])$/.exec(s);
  if (!m) throw new InputError("consumption_band must be an ElCom household profile H1 to H8 (default H4). Leave it out for H4.");
  return `H${m[1]}`;
}

export function normaliseEnergy(raw?: string): "electricity" {
  const s = (raw ?? "").trim().toLowerCase();
  if (["electricity", "electric", "power"].includes(s)) return "electricity";
  throw new InputError('Switzerland: only energy "electricity" is available from this source (ElCom electricity tariffs; no gas).');
}

export interface Obs {
  period: number;
  category: string; // H1..H8
  product: string; // standard | cheapest
  total: number; // Rp/kWh
  energy: number;
  gridusage: number;
  charge: number;
  aidfee: number;
}

/** Minimal CSV reader (quotes, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

/** The SPARQL query: every profile, standard and cheapest product, tariff years from `fromYear`, for the national cube or one canton. */
export function buildQuery(canton: { id: number } | null, fromYear: number): string {
  const prefix = canton ? `${CUBE_CANTON}${canton.id}-` : CUBE_SWISS;
  return (
    "PREFIX d: <" + DIM + ">\n" +
    "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n" +
    `SELECT ?period ?category ?product ?total ?energy ?gridusage ?charge ?aidfee FROM <${GRAPH}> WHERE {\n` +
    "  ?obs a <https://cube.link/Observation> ; d:period ?period ; d:category ?category ; d:product ?product ; d:total ?total ;\n" +
    "       d:energy ?energy ; d:gridusage ?gridusage ; d:charge ?charge ; d:aidfee ?aidfee .\n" +
    `  FILTER(STRSTARTS(STR(?obs), "${prefix}"))\n` +
    `  FILTER(xsd:integer(STR(?period)) >= ${fromYear})\n` +
    "}"
  );
}

export function queryUrl(canton: { id: number } | null, fromYear: number): string {
  return `${ENDPOINT}?query=${encodeURIComponent(buildQuery(canton, fromYear))}`;
}

const tail = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

/** Parse the SELECT result (CSV, header: period,category,product,total,energy,gridusage,charge,aidfee). Rows with missing numbers are dropped. */
export function parseObservations(csv: string): Obs[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.trim());
  const idx = (n: string) => head.indexOf(n);
  const need = ["period", "category", "product", "total", "energy", "gridusage", "charge", "aidfee"];
  for (const n of need) if (idx(n) < 0) throw new SourceError("ElCom answer has an unexpected layout", `missing column ${n}`);
  const out: Obs[] = [];
  for (const r of rows.slice(1)) {
    const num = (n: string) => (r[idx(n)] === "" || r[idx(n)] === undefined ? NaN : Number(r[idx(n)]));
    const o: Obs = {
      period: num("period"), category: tail(r[idx("category")] ?? ""), product: tail(r[idx("product")] ?? ""),
      total: num("total"), energy: num("energy"), gridusage: num("gridusage"), charge: num("charge"), aidfee: num("aidfee"),
    };
    if (!Number.isFinite(o.period) || !Number.isFinite(o.total) || o.total <= 0 || !/^H[1-8]$/.test(o.category)) continue;
    out.push(o);
  }
  return out;
}

/** Rappen per kWh -> CHF per kWh, 4 decimals. */
const chf = (rp: number) => Math.round(rp * 100) / 10000;

export interface ChQuery { energy?: string; canton?: string; consumption_band?: string; taxes?: string; baseUrl?: string; today?: Date }

/** Pure: build the answer from parsed observations. */
export function chElectricityAnswer(obs: Obs[], q: ChQuery): PriceAnswer {
  normaliseEnergy(q.energy);
  const taxes = (q.taxes ?? "all").toString().trim().toLowerCase();
  if (taxes && taxes !== "all") {
    throw new InputError('Switzerland: ElCom publishes one total tariff (energy + grid use + charges + federal aid fee); taxes must be "all" or left out.');
  }
  const profile = normaliseProfile(q.consumption_band);
  let canton: { code: string; id: number; name: string } | null = null;
  if (q.canton && q.canton.trim()) {
    canton = findCanton(q.canton);
    if (!canton) throw new InputError(`canton "${q.canton}" not found. Use the two-letter code, for example ZH, BE, GE, VD, TI. Leave it out for Switzerland as a whole.`);
  }
  const query = { country: "CH", energy: "electricity", consumption_band: profile, ...(canton ? { canton: canton.code } : {}) };
  const place = canton ? `canton ${canton.name}` : "Switzerland";
  const method =
    `Switzerland electricity: the household tariff ElCom publishes for profile ${profile}, standard product, for ${place}, tariff year in force, converted from Rappen to CHF per kWh. ` +
    "A published tariff figure (energy + grid use + charges + federal aid fee), not a count of paid bills.";
  const mine = obs.filter((o) => o.category === profile && o.product === "standard");
  if (mine.length === 0) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: canton ? "average" : "median", currency: "CHF", unit: "per kWh",
      period: { from: null, to: null }, reference_period: "", method, describe: () => "", baseUrl: q.baseUrl,
    });
  }
  // ElCom publishes next year's tariffs in autumn: the headline is the tariff year in force now, the announced next year goes in extra.
  const thisYear = (q.today ?? new Date()).getUTCFullYear();
  const inForce = mine.filter((o) => o.period <= thisYear);
  const next = mine.filter((o) => o.period > thisYear).sort((a, b) => a.period - b.period)[0];
  if (inForce.length === 0) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: canton ? "average" : "median", currency: "CHF", unit: "per kWh",
      period: { from: null, to: null }, reference_period: "", method, describe: () => "", baseUrl: q.baseUrl,
    });
  }
  const year = Math.max(...inForce.map((o) => o.period));
  const head = inForce.find((o) => o.period === year)!;
  const prev = inForce.filter((o) => o.period < year).sort((a, b) => b.period - a.period)[0];
  const cheapest = obs.find((o) => o.category === profile && o.product === "cheapest" && o.period === year);
  const profiles: Record<string, number> = {};
  for (const o of obs) if (o.product === "standard" && o.period === year) profiles[o.category] = chf(o.total);
  const value = chf(head.total);
  return buildStatisticAnswer({
    source: INFO, query, value, measure: canton ? "average" : "median", currency: "CHF", unit: "per kWh",
    period: { from: `${year}-01-01`, to: `${year}-12-31` }, reference_period: String(year), sample_size: null, method, baseUrl: q.baseUrl,
    note: "Published ElCom tariff for a standard household profile (energy + grid use + charges + federal aid fee); the open-data record does not state VAT treatment.",
    describe: (v) => `${canton ? canton.name : "Switzerland"} household profile ${profile}, standard product, ${year}: ${v.toFixed(4)} CHF per kWh.`,
    extra: {
      profile, tariff_year: year, place: canton ? canton.name : "Switzerland",
      components_chf_per_kwh: { energy: chf(head.energy), grid_use: chf(head.gridusage), charges: chf(head.charge), federal_aid_fee: chf(head.aidfee) },
      ...(cheapest ? { cheapest_product_chf_per_kwh: chf(cheapest.total) } : {}),
      ...(next ? { announced_next_year: next.period, announced_next_year_chf_per_kwh: chf(next.total) } : {}),
      ...(prev ? { previous_year: prev.period, previous_year_chf_per_kwh: chf(prev.total) } : {}),
      other_profiles_standard_chf_per_kwh: profiles,
      tax_level: "as published by ElCom (VAT treatment not stated in the open-data record)",
    },
  });
}

const ATTEMPT_MS = 9000;

async function fetchCsv(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/csv", "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function chElectricity(q: ChQuery, today: Date = new Date()): Promise<PriceAnswer> {
  normaliseEnergy(q.energy);
  normaliseProfile(q.consumption_band);
  let canton: { id: number } | null = null;
  if (q.canton && q.canton.trim()) {
    canton = findCanton(q.canton);
    if (!canton) throw new InputError(`canton "${q.canton}" not found. Use the two-letter code, for example ZH, BE, GE, VD, TI. Leave it out for Switzerland as a whole.`);
  }
  const csv = await retryOnce(() => fetchCsv(queryUrl(canton, today.getUTCFullYear() - 2), ATTEMPT_MS));
  return chElectricityAnswer(parseObservations(csv), { ...q, today });
}
