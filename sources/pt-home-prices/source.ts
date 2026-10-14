// Portugal home prices from Statistics Portugal (INE), indicator 0012241 "Median value of dwellings sales in the last 12 months
// (Methodology 2022 - EUR/m2) by Geographic location (NUTS - 2024) and Dwelling typology; Quarterly".
// One JSON request per question to INE's own indicator API (no bulk file, no key). Formats below were checked live on 2026-10-14
// through the GitHub probe (see fixtures.ts).
//
// What INE publishes: for the country, the mainland and autonomous regions, NUTS II/III regions and 58 municipalities, each
// quarter, the MEDIAN price per square metre of the dwellings sold in the 12 months up to the end of that quarter, in total and by
// number of bedrooms. One figure, no distribution, no record count. So the answer is an official statistic: value + measure "median",
// range fields null, sample_size null.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { PT_PLACES, PtLevel, PtPlace } from "./places";

export const INDICATOR = "0012241";
export const API_BASE = "https://www.ine.pt/ine/json_indicador/pindica.jsp";
export const INDICATOR_URL = "https://www.ine.pt/bddXplorer/htdocs/minfo.jsp?var_cd=0012241&lingua=EN";

export const INFO: SourceInfo = {
  id: "pt-home-prices",
  country: "PT (Portugal)",
  category: "home sales (official median price per m²)",
  name: "Median value of dwellings sales in the last 12 months, EUR per m², by region and dwelling typology (INE indicator 0012241)",
  publisher: "Statistics Portugal (Instituto Nacional de Estatística, INE)",
  what_is_recorded:
    "For Portugal, its mainland and autonomous regions, NUTS II and III regions and 58 municipalities, and each quarter: the median sale price per square metre of the dwellings sold in the 12 months " +
    "up to the end of that quarter, in total and by number of bedrooms. INE's 'Statistics on house prices at local level' (Methodology 2022). One published figure per place, quarter and typology; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness: "Quarterly, published about three and a half months after the quarter ends (the 1st Quarter 2026 figures were released on 17 July 2026); each answer states its quarter",
  licence:
    "Creative Commons Attribution 4.0 (CC BY). INE terms and conditions of use, 'Open data and intellectual property': \"The copyright of all contents of this website is the property of Statistics Portugal. " +
    "The statistical data made available on this website is free of charge and can be used and reused by the users in accordance with the Creative Commons CC BY Attribuition 4.0 license provided that the source is acknowledged, as follows: " +
    "Source: Instituto Nacional de Estatística – Portugal (Statistics Portugal) (identification of the statistical information mentioned; reference period of the information). " +
    "Users may download or copy documents for personal or commercial use, but Statistics Portugal shall continue to own the respective copyright. Should the user modify the original data, it must be explicitly mentioned.\"",
  licence_url: "https://www.ine.pt/xportal/xmain?xpid=INE&xpgid=ine_cont_inst&INST=3585857",
  attribution:
    "Source: Instituto Nacional de Estatística – Portugal (Statistics Portugal), indicator 0012241, Median value of dwellings sales in the last 12 months (€/m²), reference period as stated in the answer; reused under CC BY 4.0. " +
    "Figures are passed on as published; the percentage changes and the comparison with the national figure are calculated by ProofPrice. This is not an endorsement by INE.",
  homepage: INDICATOR_URL,
  limits:
    "A median price per square metre of the dwellings sold in the last 12 months, not a price per home and not a valuation: a place's figure moves as the mix of homes sold changes. " +
    "INE publishes it for Portugal, its regions and 58 municipalities only (the Lisbon and Porto metropolitan areas, the Algarve, Coimbra, Leiria, Braga, Guimarães, Barcelos, Vila Nova de Famalicão, Funchal and a few others); there is no figure for other towns or for postcodes. " +
    "INE splits it by number of bedrooms, not by house or apartment, so property_type only supports 'any'. INE does not say how many sales stand behind each figure. " +
    "Each quarter's window overlaps the previous quarter's by nine months, so quarter-on-quarter changes move slowly; compare with the year earlier.",
};

export type Fetcher = (url: string) => Promise<unknown>;
export interface FetchOptions {
  fetcher?: Fetcher;
  /** The clock (tests). */
  now?: Date;
}
// INE's servers can be slow, and a request with a period code they do not know hangs: we only ever ask for "all periods" (Dim1=T).
const defaultFetcher: Fetcher = (url) => fetchJson(url, {}, 25000);

// ---------- place names (pure) ----------

/** Lower case, accents removed, curly quotes straightened, punctuation to spaces, spaces collapsed. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Spellings people use (English names, old names) -> INE's name, both folded. */
export const ALIASES: Record<string, string> = {
  lisbon: "lisboa",
  oporto: "porto",
  gaia: "vila nova de gaia",
  "vila nova gaia": "vila nova de gaia",
  famalicao: "vila nova de famalicao",
  "greater lisbon": "grande lisboa",
  "lisbon area": "grande lisboa",
  "lisbon metropolitan area": "grande lisboa",
  "greater porto": "area metropolitana do porto",
  "grande porto": "area metropolitana do porto",
  "porto metropolitan area": "area metropolitana do porto",
  "oporto metropolitan area": "area metropolitana do porto",
  "setubal peninsula": "peninsula de setubal",
  azores: "regiao autonoma dos acores",
  acores: "regiao autonoma dos acores",
  "the azores": "regiao autonoma dos acores",
  madeira: "regiao autonoma da madeira",
  "madeira island": "regiao autonoma da madeira",
  mainland: "continente",
  "mainland portugal": "continente",
  "central portugal": "centro",
  "northern portugal": "norte",
  "north portugal": "norte",
  "central alentejo": "alentejo central",
  "upper alentejo": "alto alentejo",
  "lower alentejo": "baixo alentejo",
  "alentejo coast": "alentejo litoral",
  "west portugal": "oeste",
};

/** Words that mean "the whole country". */
const NATIONAL_WORDS = new Set(["portugal", "pt", "national", "nacional", "all", "whole country", "country", "entire country", "nationwide"]);

const LEVEL_RANK: Record<PtLevel, number> = { municipality: 0, nuts3: 1, nuts2: 2, area: 3, country: 4 };

export const LEVEL_NAME: Record<PtLevel, string> = {
  country: "the whole country",
  area: "mainland or autonomous region",
  nuts2: "NUTS II region",
  nuts3: "NUTS III sub-region",
  municipality: "municipality",
};

/** The places with their folded names. Where two levels share a name (Grande Lisboa, Algarve, the island regions) the finer level wins. */
const BY_NAME: { fold: string; place: PtPlace }[] = (() => {
  const best = new Map<string, PtPlace>();
  for (const p of PT_PLACES) {
    const f = foldName(p.name);
    const cur = best.get(f);
    if (!cur || LEVEL_RANK[p.level] < LEVEL_RANK[cur.level]) best.set(f, p);
  }
  return [...best].map(([fold, place]) => ({ fold, place }));
})();

export type PlaceLookup = { kind: "found"; place: PtPlace } | { kind: "similar"; options: PtPlace[] } | { kind: "none" };

/** Match what the caller typed to a place INE publishes. Only an exact name (after aliases and abbreviations) resolves: Portuguese place names are
 *  often the start of a longer one ("Vila Real" is not "Vila Real de Santo António"), so a partial match is offered as a suggestion, never answered. */
export function findPlace(input: string): PlaceLookup {
  // "Lisboa, Portugal" / "Porto (Portugal)": the first part names the place.
  let q = foldName(input.split(",")[0].replace(/\([^)]*\)/g, " "));
  q = q.replace(/^(municipality of|concelho de|concelho do|city of|cidade de|cidade do|town of|distrito de)\s+/, "").replace(/\s+(municipality|concelho|city)$/, "");
  q = q.replace(/^s /, "sao ").replace(/^sta /, "santa ").replace(/^sto /, "santo ");
  if (!q) return { kind: "none" };
  if (NATIONAL_WORDS.has(q)) return { kind: "found", place: PT_PLACES[0] };
  q = ALIASES[q] ?? q;
  const exact = BY_NAME.find((b) => b.fold === q);
  if (exact) return { kind: "found", place: exact.place };
  if (q.length < 3) return { kind: "none" };
  const words = q.split(" ");
  const similar = BY_NAME.filter((b) => {
    const bw = b.fold.split(" ");
    return words.every((w) => bw.includes(w) || (w.length >= 4 && bw.some((x) => x.startsWith(w))));
  });
  if (similar.length) {
    return { kind: "similar", options: similar.map((b) => b.place).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.name.localeCompare(b.name)) };
  }
  return { kind: "none" };
}

/** A short plain statement of what INE covers, for "no figure for that place" answers. */
export function coverageText(): string {
  const muni = PT_PLACES.filter((p) => p.level === "municipality").map((p) => p.name);
  const main = ["Lisboa", "Porto", "Cascais", "Sintra", "Oeiras", "Amadora", "Almada", "Braga", "Coimbra", "Faro", "Funchal", "Guimarães", "Leiria", "Loulé", "Matosinhos", "Portimão", "Vila Nova de Gaia"];
  return (
    `INE publishes this figure for Portugal as a whole, the mainland and the autonomous regions (Açores, Madeira), the Algarve and other NUTS regions, and ${muni.length} municipalities ` +
    `(the Lisbon and Porto metropolitan areas, the Algarve and the larger cities), among them ${main.filter((n) => muni.includes(n)).join(", ")}.`
  );
}

// ---------- the INE reply (pure) ----------

export interface PtRow {
  year: number;
  quarter: number; // 1-4
  label: string; // as INE prints it: "1st Quarter 2026"
  geo: string; // INE geography code, "PT" for the country
  geoName: string;
  typology: string; // "T" = total, "1".."4" = bedrooms
  typologyName: string;
  value: number;
}

const PERIOD_RE = /^([1-4])(?:st|nd|rd|th) Quarter (\d{4})$/;

export interface IneReply {
  rows: PtRow[];
  /** INE's own label of the newest period ("1st Quarter 2026"). */
  latestLabel: string | null;
  /** Date INE last updated the indicator. */
  updated: string | null;
}

/** Parse the JSON of pindica.jsp. Throws SourceError when INE answers with an error message or an unrecognised shape. */
export function parseIne(json: unknown): IneReply {
  const top: any = Array.isArray(json) ? json[0] : json;
  if (!top || typeof top !== "object") throw new SourceError("INE Portugal returned an unexpected reply");
  const failure = top.Sucesso?.Falso?.[0];
  if (failure) throw new SourceError(`INE Portugal could not answer: ${String(failure.Msg ?? "unknown error").slice(0, 200)}`);
  if (!top.Dados || typeof top.Dados !== "object") throw new SourceError("INE Portugal returned an unexpected reply (no data)");
  const rows: PtRow[] = [];
  for (const [label, list] of Object.entries<any>(top.Dados)) {
    const m = PERIOD_RE.exec(label);
    if (!m || !Array.isArray(list)) continue;
    for (const r of list) {
      const value = Number(String(r?.valor ?? "").replace(/\s/g, "").replace(",", "."));
      if (!r?.geocod || !r?.dim_3 || !Number.isFinite(value) || value <= 0) continue;
      rows.push({
        year: Number(m[2]),
        quarter: Number(m[1]),
        label,
        geo: String(r.geocod),
        geoName: String(r.geodsg ?? ""),
        typology: String(r.dim_3),
        typologyName: String(r.dim_3_t ?? r.dim_3),
        value,
      });
    }
  }
  return {
    rows,
    latestLabel: typeof top.UltimoPref === "string" ? top.UltimoPref : null,
    updated: typeof top.DataUltimoAtualizacao === "string" ? top.DataUltimoAtualizacao : null,
  };
}

/** Request URL: every quarter, total and the four bedroom classes, for the place and for Portugal as a whole. */
export function apiUrl(place: PtPlace): string {
  const geos = place.code === "PT" ? "PT" : `${place.code},PT`;
  return `${API_BASE}?op=2&varcd=${INDICATOR}&Dim1=T&Dim2=${geos}&Dim3=T,1,2,3,4&lang=EN`;
}

// ---------- reading it (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const pct = (now: number, then: number) => roundTo(((now - then) / then) * 100, 1);
const qIndex = (r: { year: number; quarter: number }) => r.year * 4 + (r.quarter - 1);

export interface Point {
  year: number;
  quarter: number;
  value: number;
}
export interface PtReading {
  place: PtPlace;
  year: number;
  quarter: number;
  label: string;
  value: number;
  previousQuarter: (Point & { change_percent: number }) | null;
  yearEarlier: (Point & { change_percent: number }) | null;
  national: (Point & { difference_percent: number }) | null;
  nationalLatest: Point | null;
  bedrooms: { typology: string; name: string; value: number }[];
  series: Point[];
  updated: string | null;
}

/** Latest total for the place with its comparisons. Null if INE holds no figure for the place. */
export function readPt(reply: IneReply, place: PtPlace): PtReading | null {
  const total = (geo: string) => {
    const byQuarter = new Map<number, PtRow>(); // one figure per quarter, even if INE repeats a row
    for (const r of reply.rows) if (r.geo === geo && r.typology === "T") byQuarter.set(qIndex(r), r);
    return [...byQuarter.values()].sort((a, b) => qIndex(a) - qIndex(b));
  };
  const mine = total(place.code);
  if (!mine.length) return null;
  const latest = mine[mine.length - 1];
  const at = (list: PtRow[], idx: number) => list.find((r) => qIndex(r) === idx);
  const pt = (r: PtRow): Point => ({ year: r.year, quarter: r.quarter, value: r.value });
  const prev = at(mine, qIndex(latest) - 1);
  const yearAgo = at(mine, qIndex(latest) - 4);
  const nat = total("PT");
  const natSame = at(nat, qIndex(latest));
  const isNational = place.code === "PT";
  const bedrooms = reply.rows
    .filter((r) => r.geo === place.code && r.typology !== "T" && qIndex(r) === qIndex(latest))
    .sort((a, b) => a.typology.localeCompare(b.typology))
    .map((r) => ({ typology: r.typology, name: r.typologyName, value: r.value }));
  return {
    place,
    year: latest.year,
    quarter: latest.quarter,
    label: latest.label,
    value: latest.value,
    previousQuarter: prev ? { ...pt(prev), change_percent: pct(latest.value, prev.value) } : null,
    yearEarlier: yearAgo ? { ...pt(yearAgo), change_percent: pct(latest.value, yearAgo.value) } : null,
    national: natSame && !isNational ? { ...pt(natSame), difference_percent: pct(latest.value, natSame.value) } : null,
    nationalLatest: nat.length ? pt(nat[nat.length - 1]) : null,
    bedrooms,
    series: mine.slice(-12).map(pt),
    updated: reply.updated,
  };
}

// ---------- the answer (pure) ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const quarterRef = (p: { year: number; quarter: number }) => `${p.year}-Q${p.quarter}`;
const quarterEnd = (p: { year: number; quarter: number }) => new Date(Date.UTC(p.year, p.quarter * 3, 0));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const endLabel = (p: { year: number; quarter: number }) => `${MONTHS[p.quarter * 3 - 1]} ${p.year}`;
/** The 12 months the figure covers: from the first day 11 months before the quarter's last month to the quarter's last day. */
export function windowOf(p: { year: number; quarter: number }): { from: string; to: string } {
  const to = quarterEnd(p);
  return { from: iso(new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1))), to: iso(to) };
}

function change(pctValue: number, when: string, ref: string, v: number): string {
  if (pctValue === 0) return ` That is unchanged from ${when} (${ref}: ${fmtMoney(v, "EUR")} per m²).`;
  return ` That is ${Math.abs(pctValue)}% ${pctValue > 0 ? "higher" : "lower"} than ${when} (${ref}: ${fmtMoney(v, "EUR")} per m²).`;
}

export interface PtQuery {
  place: string | null; // as asked; null = national
  property_type: string;
  baseUrl?: string;
  apiUrl?: string;
  now?: Date;
  /** Places with a similar name that INE does publish, offered when the asked place has no figure. */
  similar?: PtPlace[];
}

const METHOD =
  "INE (Statistics Portugal) publishes every quarter the median price per square metre of the dwellings sold in the previous 12 months, per region and municipality (indicator 0012241). " +
  "ProofPrice passes on the published figure for the latest quarter INE holds, unchanged, with the previous quarter, the year earlier, the national median, the split by number of bedrooms and a short history. " +
  "No range is calculated: INE gives one median and does not say how many sales are behind it. The figure is a price per m², not per home.";

/** The finished answer for a reading (or for no reading). Pure. */
export function ptAnswer(reading: PtReading | null, q: PtQuery): PriceAnswer {
  const query = { country: "PT", town: reading?.place.name ?? q.place ?? "Portugal", property_type: q.property_type };
  const base = { source: INFO, query, measure: "median" as const, currency: "EUR", unit: "per m²", method: METHOD, baseUrl: q.baseUrl };
  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const did = q.similar?.length ? ` Did you mean ${q.similar.slice(0, 6).map((p) => `${p.name} (${LEVEL_NAME[p.level]})`).join("; ")}? Ask again with the full name.` : "";
    return { ...none, summary: `INE publishes no median price per m² for ${q.place ?? "Portugal"} in indicator ${INDICATOR}.${did} ${coverageText()}` };
  }
  const r = reading;
  const w = windowOf(r);
  const now = q.now ?? new Date();
  const notes: string[] = [];
  const natLatest = r.nationalLatest;
  if (natLatest && qIndex(r) < qIndex(natLatest)) {
    notes.push(`The latest figure INE holds for ${r.place.name} is for ${r.label}; the national figure runs to ${quarterRef(natLatest)}.`);
  }
  const ageDays = (now.getTime() - quarterEnd(r).getTime()) / 86400000;
  if (ageDays > 300) notes.push(`This figure is for the 12 months to ${endLabel(r)}, more than ten months ago: INE has not published a newer one for this place.`);
  const where = r.place.level === "country" ? "Portugal" : r.place.level === "municipality" ? r.place.name : `${r.place.name} (${LEVEL_NAME[r.place.level]})`;
  const extra: Record<string, unknown> = {
    region: { code: r.place.code, name: r.place.name, level: LEVEL_NAME[r.place.level] },
    reference_period_label: r.label,
    window: `the 12 months to the end of ${endLabel(r)}`,
    previous_quarter: r.previousQuarter ? { reference_period: quarterRef(r.previousQuarter), value: r.previousQuarter.value, change_percent: r.previousQuarter.change_percent } : null,
    year_earlier: r.yearEarlier ? { reference_period: quarterRef(r.yearEarlier), value: r.yearEarlier.value, change_percent: r.yearEarlier.change_percent } : null,
    national_median: r.national ? { reference_period: quarterRef(r.national), value: r.national.value, place_vs_national_percent: r.national.difference_percent } : null,
    by_bedrooms: r.bedrooms.map((b) => ({ dwelling_typology: b.name, value: b.value })),
    series: r.series.map((s) => ({ reference_period: quarterRef(s), value: s.value })),
    published: r.updated,
    definition:
      "Median sale price per square metre of the dwellings sold in the 12 months up to the end of the quarter (INE 'Statistics on house prices at local level', Methodology 2022). Per m², not per home. By bedrooms, not by house or apartment.",
    indicator: { id: INDICATOR, url: INDICATOR_URL },
    ...(q.apiUrl ? { ine_api_url: q.apiUrl } : {}),
  };
  return buildStatisticAnswer({
    ...base,
    value: r.value,
    period: w,
    reference_period: quarterRef(r),
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where} the median sale price of dwellings sold in the 12 months to ${endLabel(r)} was ${fmtMoney(v, "EUR")} per m².` +
      (r.yearEarlier ? change(r.yearEarlier.change_percent, "a year earlier", quarterRef(r.yearEarlier), r.yearEarlier.value) : "") +
      (r.previousQuarter ? change(r.previousQuarter.change_percent, "the previous quarter", quarterRef(r.previousQuarter), r.previousQuarter.value) : "") +
      (r.national
        ? ` The national median for the same period was ${fmtMoney(r.national.value, "EUR")} per m² (${Math.abs(r.national.difference_percent)}% ${r.national.difference_percent >= 0 ? "above" : "below"}).`
        : ""),
    extra,
  });
}

// ---------- the request ----------

export async function ptHomePrices(
  input: { town?: string; postcode?: string; property_type?: string; baseUrl?: string },
  o: FetchOptions = {},
): Promise<PriceAnswer> {
  const fetcher = o.fetcher ?? defaultFetcher;
  const now = o.now ?? new Date();
  const type = (input.property_type ?? "any").trim().toLowerCase() || "any";
  if (input.postcode && !input.town) {
    throw new InputError("INE publishes Portuguese home prices by region and municipality, not by postcode. Give the municipality as town (for example Lisboa or Porto), or omit it for the national median.");
  }

  let place: PtPlace = PT_PLACES[0];
  if (input.town) {
    const found = findPlace(input.town);
    if (found.kind !== "found") {
      return ptAnswer(null, { place: input.town, property_type: type, baseUrl: input.baseUrl, now, similar: found.kind === "similar" ? found.options : undefined });
    }
    place = found.place;
  }

  if (type !== "any") {
    // INE splits by number of bedrooms, not by house or apartment. Say so rather than hand back an all-dwellings figure as if it were one type's.
    const none = buildStatisticAnswer({
      source: INFO,
      query: { country: "PT", town: place.name, property_type: type },
      value: null,
      measure: "median",
      currency: "EUR",
      unit: "per m²",
      period: { from: null, to: null },
      reference_period: "",
      method: METHOD,
      describe: () => "",
      baseUrl: input.baseUrl,
    });
    return {
      ...none,
      summary: `INE publishes the Portuguese median price per m² for all dwellings together and by number of bedrooms, not by house or apartment, so there is no official figure for property_type '${type}'. Ask without property_type: the answer then includes the split by bedrooms.`,
    };
  }

  const url = apiUrl(place);
  const reading = readPt(parseIne(await fetcher(url)), place);
  return ptAnswer(reading, { place: input.town ?? null, property_type: type, baseUrl: input.baseUrl, apiUrl: url, now });
}
