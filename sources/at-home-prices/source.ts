// Austria home prices from STATISTIK AUSTRIA "Immobilien-Durchschnittspreise": one spreadsheet (.ods, about 90 KB) with the
// median price per m² of living area for houses and owner-occupied flats, per year since 2015, for Austria, the nine
// Bundesländer, the 100 most populous municipalities and the political districts (Bezirke, Vienna's 23 districts included):
// https://www.statistik.at/fileadmin/pages/222/SonderauswertungImmobilienDurchschnittspreise.ods
//
// The file is small, changes once a year (late May) and is read through a six-hour in-memory cache, so the publisher is hit at most
// a few times a day, never once per request. It holds no sample counts, so it cannot go into the price library (which keeps
// only rows with at least five records), which is why this source has no harvest().
// Formats below were checked live on 2026-10-14 (see fixtures.ts).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { OdsSheet, readOds } from "./ods";

export const FILE_URL = "https://www.statistik.at/fileadmin/pages/222/SonderauswertungImmobilienDurchschnittspreise.ods";
export const PAGE_URL = "https://www.statistik.at/statistiken/volkswirtschaft-und-oeffentliche-finanzen/preise-und-preisindizes/immobilien-durchschnittspreise";
export const LICENCE_URL = "https://www.statistik.at/ueber-uns/aufgaben-und-grundsaetze/rechtsgrundlagen/impressum";

export const INFO: SourceInfo = {
  id: "at-home-prices",
  country: "AT (Austria)",
  category: "home sales (official median price per m²)",
  name: "Immobilien-Durchschnittspreise: median price per m² of houses and owner-occupied flats, by district, municipality and Bundesland",
  // Kept short: buildStatisticAnswer appends "Official median published by <publisher> for <year>.", and a longer publisher read as
  // "purchase contracts from the land register for 2025", as if the figure rested on one year's contracts. The land register is in what_is_recorded.
  publisher: "STATISTIK AUSTRIA (Bundesanstalt Statistik Österreich)",
  what_is_recorded:
    "For Austria, its nine Bundesländer (Vienna included), the 100 most populous municipalities and the political districts (Bezirke; Vienna's 23 districts included), and each year from 2015: " +
    "the median price per square metre of living area paid for houses and for owner-occupied flats, calculated by STATISTIK AUSTRIA from the purchase contracts in the land register " +
    "(purchases by private households; cleaned, where possible, of demolitions, share transactions, building-rights sales, hire-purchase and other data errors). To smooth small samples, the contracts of the four earlier years are revalued to the " +
    "reference year with a regression model, so a figure rests on the contracts of five years (2021 to 2025 for 2025). One published figure per place, type and year; never individual sales or addresses; " +
    "a district or municipality figure is left out when fewer than 10 transactions remain after processing.",
  price_type: "official_statistic",
  freshness: "Annual: the previous year's figures are published in late May (the 2025 figures appeared on 28 May 2026); each answer states its year",
  licence:
    "STATISTIK AUSTRIA imprint (Impressum): \"Unter Angabe der Quelle „STATISTIK AUSTRIA“ ist es bei korrekter Wiedergabe gestattet, Inhalte für kommerzielle und nicht-kommerzielle Zwecke zu vervielfältigen, " +
    "verbreiten und öffentlich zugänglich zu machen. Bei auszugsweiser Verwendung oder sonstiger Veränderung von Dateninhalten wie Tabellen, Grafiken oder Texten ist ein Hinweis anzubringen, " +
    "dass die verwendeten Inhalte bearbeitet wurden.\" (With the source STATISTIK AUSTRIA named and correct reproduction, reuse for commercial and non-commercial purposes is allowed; extracts or changes must carry a note that the content was edited.) " +
    "The imprint adds that separate licences apply to STATISTIK AUSTRIA's Open Data portal; this spreadsheet is published on statistik.at, not on that portal, and carries no Creative Commons label.",
  licence_url: LICENCE_URL,
  attribution:
    "Source: STATISTIK AUSTRIA, Immobilien-Durchschnittspreise. Edited by ProofPrice (bearbeitet): the figures are passed on as published; the percentage changes and the comparisons with the " +
    "Bundesland and with Austria are calculated by ProofPrice. This is not an endorsement by STATISTIK AUSTRIA.",
  homepage: PAGE_URL,
  limits:
    "Model-based statistics, not one year's sales: each figure revalues four earlier years of contracts to the reference year, so it moves slowly and can differ from what a single year's sales would show. " +
    "STATISTIK AUSTRIA's own caution: \"Kleinräumige Medianwerte stellen keine reine Preisveränderung dar, sondern enthalten auch Qualitäts- und Standortfaktoren\" (small-area medians are not pure price changes: they also reflect quality and location mix), and earlier years are revised every year, so a series can differ from older publications. " +
    "Per m² of living area, not per home; houses and flats only (no land, no new-build split, no size split in this spreadsheet). Statistik Austria does not publish the number of sales behind a figure; it leaves a district or municipality figure out " +
    "when fewer than 10 transactions remain after processing, so small districts have gaps in some years. Annual, so the newest figure is 5 to 17 months old. Municipality figures exist for the 100 most populous municipalities only; elsewhere the district (Bezirk) figure applies.",
};

// ---------- the spreadsheet (pure) ----------

export type Level = "country" | "state" | "municipality" | "district";
export type Kind = "house" | "apartment";

export interface Area {
  level: Level;
  /** As published, footnote marks removed: "Graz", "Baden", "Wien 2.,Leopoldstadt", "Kärnten". */
  name: string;
  /** Municipality code (5 digits) or district code (3 digits); "" for Austria and the Bundesländer. */
  code: string;
  /** Bundesland name; "" for Austria. */
  state: string;
  house: Record<number, number>;
  apartment: Record<number, number>;
  /** Vienna district number (1 to 23) for the districts of Vienna. */
  vienna?: number;
}

export interface AtData {
  areas: Area[];
  /** The newest year with any figure in the file. */
  latestYear: number;
  /** The date the file says it was created (ISO), if it says. */
  created: string | null;
}

export const STATES = ["Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg", "Steiermark", "Tirol", "Vorarlberg", "Wien"] as const;

/** Lower case, accents removed, ß as ss, Sankt as st, punctuation to single spaces. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(sankt|saint)\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

const cleanName = (s: string) => s.replace(/\s*\d+\)/g, "").replace(/\s+/g, " ").trim();

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** The Bundesland a municipality or district code belongs to: its first digit (1 Burgenland ... 9 Wien). */
export function stateOfCode(code: string): string {
  const d = Number(code[0]);
  return d >= 1 && d <= 9 ? STATES[d - 1] : "";
}

const VIENNA_DISTRICT = /^Wien\s+(\d{1,2})\.\s*,\s*(.+)$/;

type SheetClass = { kind: Kind | null; level: Level };
function classify(sheetName: string): SheetClass | null {
  const n = foldName(sheetName);
  if (/bauperiode|grund/.test(n)) return null;
  if (n === "bundeslander" || n === "bundeslaender") return { kind: null, level: "state" };
  const kind: Kind | null = /wohnung/.test(n) ? "apartment" : /hauser|haeuser/.test(n) ? "house" : null;
  if (!kind) return null;
  return { kind, level: /gemeinden/.test(n) ? "municipality" : "district" };
}

/** Read the sheets of the spreadsheet. Throws SourceError if none of the expected tables is found. */
export function parseWorkbook(sheets: OdsSheet[]): AtData {
  const areas = new Map<string, Area>();
  const get = (level: Level, name: string, code: string): Area => {
    const key = `${level}|${code || name}`;
    let a = areas.get(key);
    if (!a) {
      const vienna = level === "district" ? VIENNA_DISTRICT.exec(name) : null;
      a = {
        level,
        name: vienna ? `Wien ${Number(vienna[1])}.,${vienna[2].trim()}` : name,
        code,
        state: level === "country" ? "" : level === "state" ? name : stateOfCode(code),
        house: {},
        apartment: {},
        ...(vienna ? { vienna: Number(vienna[1]) } : {}),
      };
      areas.set(key, a);
    }
    return a;
  };
  let created: string | null = null;

  for (const s of sheets) {
    for (const row of s.rows) {
      const m = /Erstellt am (\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(row[0] ?? "");
      if (m) created = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    const c = classify(s.name);
    if (!c) continue;

    if (c.level === "state") {
      // Two or three blocks one under the other: a title row ("Durchschnittliche Häuserpreise in den Bundesländern..."), a row with the years,
      // then Österreich and the nine Bundesländer. The land-price block is skipped.
      let kind: Kind | null = null;
      let years: number[] = [];
      for (const row of s.rows) {
        const first = (row[0] ?? "").trim();
        if (/^Durchschnittliche/i.test(first)) {
          kind = /h(ä|ae)user/i.test(first) ? "house" : /wohnung/i.test(first) ? "apartment" : null;
          years = [];
          continue;
        }
        const rest = row.slice(1);
        if (!first && rest.length >= 3 && rest.every((x) => /^\d{4}$/.test(x))) {
          years = rest.map(Number);
          continue;
        }
        if (!kind || !years.length || !first) continue;
        const state = STATES.find((n) => foldName(n) === foldName(cleanName(first)));
        const isAustria = /^(österreich|oesterreich)$/i.test(cleanName(first));
        if (!state && !isAustria) continue;
        const area = isAustria ? get("country", "Österreich", "") : get("state", state!, "");
        rest.forEach((cell, i) => {
          const v = num(cell);
          if (v !== null && Number.isInteger(years[i])) area[kind!][years[i]] = v;
        });
      }
      continue;
    }

    // District and municipality tables: a header row ("Bz. Nr. | Bezirk | 2015 | ..." or "Gem. Kennziffer | Gemeindename | 2015 | ..."), then one row per place.
    let years: number[] | null = null;
    for (const row of s.rows) {
      const first = (row[0] ?? "").trim();
      if (/^(Bz\.?\s*Nr|Gem\.?\s*Kennziffer)/i.test(first)) {
        years = row.slice(2).map((x) => (/^\d{4}$/.test(x.trim()) ? Number(x) : NaN));
        continue;
      }
      if (!years || !/^\d{3,5}$/.test(first) || !(row[1] ?? "").trim()) continue;
      const area = get(c.level, cleanName(row[1]), first);
      row.slice(2).forEach((cell, i) => {
        const v = num(cell);
        if (v !== null && Number.isInteger(years![i])) area[c.kind!][years![i]] = v;
      });
    }
  }

  const list = [...areas.values()];
  const withFigures = list.filter((a) => Object.keys(a.house).length + Object.keys(a.apartment).length > 0);
  if (!withFigures.some((a) => a.level === "country") || !withFigures.some((a) => a.level === "district")) {
    throw new SourceError("STATISTIK AUSTRIA's price spreadsheet has an unexpected layout (no Austria row or no district table)");
  }
  const years = withFigures.flatMap((a) => [...Object.keys(a.house), ...Object.keys(a.apartment)].map(Number));
  return { areas: list, latestYear: Math.max(...years), created };
}

// ---------- finding a place (pure) ----------

const NATIONAL_WORDS = new Set(["osterreich", "austria", "autriche", "at", "national", "nationwide", "whole country", "country", "oesterreich"]);
const STATE_ALIASES: Record<string, string> = {
  carinthia: "karnten", kaernten: "karnten", "lower austria": "niederosterreich", niederoesterreich: "niederosterreich", "upper austria": "oberosterreich",
  oberoesterreich: "oberosterreich", styria: "steiermark", tyrol: "tirol", vienna: "wien", vienne: "wien", wien: "wien",
};
const MUNICIPALITY_ALIASES: Record<string, string> = { vienna: "wien", vienne: "wien" };

export interface Query {
  /** Folded name to look for ("" for Austria). */
  q: string;
  force: Level | null;
  vienna: number | null;
  postcode: string | null;
}

/** Turn what the caller typed into a folded name, a level if they named one ("Bezirk Baden", "Land Salzburg"), a Vienna district number and a postcode. */
export function parseQuery(input: string): Query {
  let q = foldName(input.split(";")[0]);
  let postcode: string | null = null;
  let force: Level | null = null;
  let vienna: number | null = null;

  // "Wien, Austria" -> "wien"; but "Lower Austria" and "Upper Austria" are Bundesländer, not a town in Austria
  if (!/^(lower|upper)\s+austria$/.test(q)) q = q.replace(/\s+(austria|osterreich|oesterreich|autriche)$/, "").trim();
  const lead = /^(\d{4})\s+(.+)$/.exec(q);
  if (lead) {
    postcode = lead[1];
    q = lead[2];
  }
  const trail = /^(.+?)\s+(\d{4})$/.exec(q);
  if (trail) {
    postcode = trail[2];
    q = trail[1];
  }
  // A Vienna district first ("Wien 21", "Vienna 21st district", "2nd district of Vienna", "21. Bezirk"), before "district" is read as a level word.
  const v =
    /^(?:wien|vienna|vienne)\s+(?:bezirk\s+|district\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+.*)?$/.exec(q) ??
    /^(\d{1,2})\s*(?:st|nd|rd|th|ter|te)?\s+(?:bezirk|district|arrondissement)(?:\s+(?:of|in|von|de)?\s*(?:wien|vienna|vienne))?$/.exec(q);
  if (v && Number(v[1]) >= 1 && Number(v[1]) <= 23) {
    vienna = Number(v[1]);
    q = "wien";
  } else {
    const st = /^(?:bundesland|land|state of|federal state of|province of)\s+(.+)$/.exec(q) ?? /^(.+?)\s+(?:state|bundesland)$/.exec(q);
    if (st) {
      force = "state";
      q = st[1];
    }
    const di = /^(?:bezirk|politischer bezirk|district of|district)\s+(.+)$/.exec(q) ?? /^(.+?)\s+(?:bezirk|district)$/.exec(q);
    if (di) {
      force = "district";
      q = di[1];
    }
  }
  return { q, force, vienna, postcode };
}

/** The Vienna district number for a Vienna postcode (1010 to 1230), or null. */
export function viennaDistrictOfPostcode(postcode: string | null | undefined): number | null {
  const m = /^1(0[1-9]|1\d|2[0-3])0$/.exec((postcode ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** "Wien 2.,Leopoldstadt" -> "Wien 2 (Leopoldstadt)"; a district -> "Bezirk Baden"; others as published. */
export function areaLabel(a: Area): string {
  if (a.level === "country") return "Austria";
  if (a.vienna) return `Wien ${a.vienna} (${a.name.replace(VIENNA_DISTRICT, "$2").trim()})`;
  if (a.level === "district") return `Bezirk ${a.name}`;
  return a.name;
}

export const LEVEL_NAME: Record<Level, string> = { country: "country", state: "Bundesland (federal state)", municipality: "municipality", district: "district (Bezirk)" };
const RANK: Record<Level, number> = { municipality: 0, district: 1, state: 2, country: 3 };

interface Keys {
  strong: string[];
  weak: string[];
}
function keysOf(a: Area): Keys {
  const f = foldName(a.name);
  if (a.level === "country") return { strong: ["osterreich", "austria"], weak: [] };
  if (a.level === "state") return { strong: [f, ...Object.entries(STATE_ALIASES).filter(([, to]) => to === f).map(([from]) => from)], weak: [] };
  if (a.vienna) {
    const rest = foldName(a.name.replace(VIENNA_DISTRICT, "$2"));
    return { strong: [`wien ${a.vienna} ${rest}`, `wien ${a.vienna}`, rest], weak: [] };
  }
  const weak = new Set<string>();
  const noStadt = f.replace(/ stadt$/, "");
  if (noStadt !== f) weak.add(noStadt);
  const head = f.split(/ (?:am|an der|im|bei|in) /)[0];
  if (head !== f && head.length >= 4) weak.add(head);
  const strong = [f];
  if (a.level === "municipality") for (const [from, to] of Object.entries(MUNICIPALITY_ALIASES)) if (to === f) strong.push(from);
  return { strong, weak: [...weak] };
}

export type AtLookup =
  | { kind: "found"; area: Area; also: Area[] }
  | { kind: "similar"; options: Area[] }
  | { kind: "none" };

const variants = (q: string) => [q, q.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")].filter((x, i, l) => l.indexOf(x) === i);

export const hasFigures = (a: Area) => Object.keys(a.house).length + Object.keys(a.apartment).length > 0;

/**
 * Find the place a query names. Only a full name resolves; a municipality comes before a district and a district before a Bundesland of the same name.
 * Places without any figure (Rust, for instance) are skipped unless includeEmpty is set.
 */
export function findArea(areas: Area[], query: Query, o: { includeEmpty?: boolean } = {}): AtLookup {
  const usable = o.includeEmpty ? areas : areas.filter(hasFigures);
  if (query.vienna !== null) {
    const d = usable.find((a) => a.vienna === query.vienna);
    return d ? { kind: "found", area: d, also: [] } : { kind: "none" };
  }
  const q = query.q;
  if (!q || NATIONAL_WORDS.has(q)) {
    const at = usable.find((a) => a.level === "country");
    return at ? { kind: "found", area: at, also: [] } : { kind: "none" };
  }
  const index = new Map<string, Area[]>();
  const weakIndex = new Map<string, Area[]>();
  for (const a of usable) {
    const k = keysOf(a);
    for (const s of k.strong) index.set(s, [...(index.get(s) ?? []), a]);
    for (const w of k.weak) weakIndex.set(w, [...(weakIndex.get(w) ?? []), a]);
  }
  for (const v of variants(q)) {
    let hits = index.get(v) ?? [];
    if (query.force) hits = hits.filter((a) => a.level === query.force);
    if (hits.length) {
      const sorted = [...hits].sort((a, b) => RANK[a.level] - RANK[b.level]);
      const best = sorted[0];
      const also = sorted.slice(1).filter((a) => a.level !== best.level);
      return { kind: "found", area: best, also };
    }
  }
  for (const v of variants(q)) {
    let hits = [...new Set(weakIndex.get(v) ?? [])];
    if (query.force) hits = hits.filter((a) => a.level === query.force);
    if (!hits.length) continue;
    // "Klagenfurt" is both the municipality "Klagenfurt am Wörthersee" and the district "Klagenfurt Stadt": the municipality, the district listed beside it.
    const sorted = [...hits].sort((a, b) => RANK[a.level] - RANK[b.level]);
    const top = sorted.filter((a) => a.level === sorted[0].level);
    if (top.length === 1) return { kind: "found", area: top[0], also: sorted.slice(1).filter((a) => a.level !== top[0].level) };
    return { kind: "similar", options: sorted };
  }
  if (q.length < 3) return { kind: "none" };
  const words = q.split(" ");
  const similar = new Set<Area>();
  for (const a of usable) {
    if (a.level === "country") continue;
    const names = [...keysOf(a).strong, ...keysOf(a).weak];
    if (names.some((n) => words.every((w) => n.split(" ").some((x) => x === w || (w.length >= 4 && x.startsWith(w)))))) similar.add(a);
  }
  return similar.size ? { kind: "similar", options: [...similar].sort((a, b) => RANK[a.level] - RANK[b.level] || a.name.localeCompare(b.name)) } : { kind: "none" };
}

// ---------- the answer (pure) ----------

export const KIND_WORDS: Record<Kind, string> = { house: "houses (Wohnhäuser)", apartment: "owner-occupied flats (Eigentumswohnungen)" };

export const TYPE_ASK = ["any", "house", "apartment", "flat-maisonette", "condo", "villa", "detached", "semi-detached", "terraced"] as const;
export type AskType = (typeof TYPE_ASK)[number];
/** What each request maps to; null = a kind of home Statistik Austria does not split out. */
const TYPE_KIND: Record<AskType, Kind | null | "any"> = {
  any: "any",
  house: "house",
  apartment: "apartment",
  "flat-maisonette": "apartment",
  condo: "apartment",
  villa: null,
  detached: null,
  "semi-detached": null,
  terraced: null,
};

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const latestOf = (series: Record<number, number>): { year: number; value: number } | null => {
  const years = Object.keys(series).map(Number).sort((a, b) => b - a);
  return years.length ? { year: years[0], value: series[years[0]] } : null;
};

const METHOD =
  "STATISTIK AUSTRIA publishes once a year the median price per m² of living area paid for houses and for owner-occupied flats, per district, per large municipality, per Bundesland and for Austria, calculated from the land register's purchase contracts. " +
  "To smooth small samples, the contracts of the four earlier years are revalued to the reference year with a regression model. ProofPrice passes on the published figure for the latest year the place has, unchanged, " +
  "with the year before it, the figure for the Bundesland and for Austria and the history since 2015. No range is calculated: the spreadsheet gives one median and does not say how many sales are behind it.";

export interface AtQuery {
  town: string | null;
  postcode: string | null;
  property_type: AskType;
  baseUrl?: string;
}

function noMatch(q: AtQuery, place: string, summary: string, extra?: Record<string, unknown>): PriceAnswer {
  const none = buildStatisticAnswer({
    source: INFO,
    query: { country: "AT", town: place, property_type: q.property_type },
    value: null,
    measure: "median",
    currency: "EUR",
    unit: "per m²",
    period: { from: null, to: null },
    reference_period: "",
    method: METHOD,
    describe: () => "",
    baseUrl: q.baseUrl,
  });
  return { ...none, summary, ...(extra ? { extra } : {}) };
}

function pctWords(pct: number, prevLabel: string, prevValue: number): string {
  if (pct === 0) return ` That is unchanged from ${prevLabel} (${fmtMoney(prevValue, "EUR")} per m²).`;
  return ` That is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than in ${prevLabel} (${fmtMoney(prevValue, "EUR")} per m²).`;
}

/** The finished answer from the parsed spreadsheet. Returns no_matches for anything the spreadsheet has no figure for. */
export function atAnswer(data: AtData, q: AtQuery): PriceAnswer {
  const want = TYPE_KIND[q.property_type];
  const query = parseQuery(q.town ?? "");
  const pcDistrict = viennaDistrictOfPostcode(q.postcode ?? query.postcode);
  let vienna = query.vienna;
  if (vienna === null && pcDistrict !== null && (!query.q || ["wien", "vienna", "vienne"].includes(query.q))) vienna = pcDistrict;
  const found = findArea(data.areas, { ...query, vienna });
  if (found.kind === "none") {
    const empty = findArea(data.areas, { ...query, vienna }, { includeEmpty: true });
    if (empty.kind === "found") {
      return noMatch(
        q,
        areaLabel(empty.area),
        `STATISTIK AUSTRIA publishes no house or flat price for ${areaLabel(empty.area)} in any year since 2015 (a district or municipality figure is left out when fewer than 10 transactions remain after processing). Try the neighbouring district or the Bundesland.`,
      );
    }
  }
  if (found.kind !== "found") {
    const said = q.town ?? "";
    const did = found.kind === "similar" ? ` Did you mean ${found.options.slice(0, 8).map((a) => `${areaLabel(a)} (${LEVEL_NAME[a.level]})`).join("; ")}? Ask again with the full name.` : "";
    return noMatch(
      q,
      said || "Austria",
      `STATISTIK AUSTRIA's price spreadsheet has no place called '${said}'.${did} It covers Austria, the nine Bundesländer, the 100 most populous municipalities and the districts (Bezirke), including Vienna's 23 districts ` +
        `('Wien 2' or postcode 1020 for Leopoldstadt). For a smaller town, give the district it lies in.`,
    );
  }
  const { area, also } = found;
  const label = areaLabel(area);

  if (want === null) {
    // Depth Builder 2026-10-29: villa/detached/semi-detached/terraced used to end in no_matches. STATISTIK AUSTRIA has one figure for all houses,
    // so pass that on, labelled as the all-houses figure (never presented as the figure for the sub-type asked).
    const base = atAnswer(data, { ...q, property_type: "house" });
    if (base.status !== "ok") return base;
    return {
      ...base,
      query: { ...base.query, property_type: q.property_type },
      summary:
        `STATISTIK AUSTRIA does not split houses into detached, semi-detached, terraced or villas, so there is no figure for '${q.property_type}' on its own. ` +
        `This is the published figure for all houses (Wohnhäuser) together. ${base.summary}`,
      extra: { ...(base.extra ?? {}), widened_from: q.property_type, widened_to: "house" },
    };
  }

  if (want === "any") {
    const parts = (["house", "apartment"] as const).flatMap((k) => {
      const l = latestOf(area[k]);
      return l ? [{ key: k, description: KIND_WORDS[k], reference_period: String(l.year), median: l.value }] : [];
    });
    const said = parts.length
      ? `In ${label}: ` + parts.map((x) => `${x.description}, median ${fmtMoney(x.median, "EUR")} per m² (${x.reference_period})`).join("; ") + "."
      : `STATISTIK AUSTRIA has no published house or flat price for ${label}.`;
    if (parts.length) {
      // No type asked: pass on both published medians. The headline is the owner-occupied flat figure (house if the place has no flat figure); both sit in extra.by_type.
      const headKind: Kind = parts.some((x) => x.key === "apartment") ? "apartment" : "house";
      const base = atAnswer(data, { ...q, property_type: headKind });
      if (base.status !== "ok") return base;
      return {
        ...base,
        query: { ...base.query, property_type: q.property_type },
        summary:
          `${said} STATISTIK AUSTRIA publishes houses and flats separately, with no figure for both together, so the headline price is for ${KIND_WORDS[headKind]}; ` +
          `ask with property_type 'house' or 'apartment' to choose. These are official annual medians per m² of living area (not per home), with no sample size published.`,
        extra: { ...(base.extra ?? {}), by_type: parts, headline_property_type: headKind },
      };
    }
    return noMatch(q, label, `STATISTIK AUSTRIA publishes houses and flats separately, with no figure for both together. ${said} Ask again with property_type 'house' or 'apartment' for the full answer.`, { by_type: parts });
  }

  const kind: Kind = want;
  const latest = latestOf(area[kind]);
  if (!latest) {
    const other = kind === "house" ? "apartment" : "house";
    const o = latestOf(area[other]);
    return noMatch(
      q,
      label,
      `STATISTIK AUSTRIA has no published price for ${KIND_WORDS[kind]} in ${label} (a figure is left blank where there were too few sales).` +
        (o ? ` It does publish ${KIND_WORDS[other]}: ${fmtMoney(o.value, "EUR")} per m² for ${o.year}.` : ""),
    );
  }
  const year = latest.year;
  const prevValue = area[kind][year - 1];
  const previous = prevValue ? { year: year - 1, value: prevValue, change_percent: roundTo(((latest.value - prevValue) / prevValue) * 100, 1) } : null;

  const same = (a: Area | undefined) => {
    const v = a?.[kind][year];
    return a && v ? { name: areaLabel(a), reference_period: String(year), median: v, area_vs_this_percent: roundTo(((latest.value - v) / v) * 100, 1) } : null;
  };
  const austria = area.level === "country" ? null : same(data.areas.find((a) => a.level === "country"));
  const stateArea = area.level === "district" || area.level === "municipality" ? data.areas.find((a) => a.level === "state" && a.name === area.state) : undefined;
  let stateFigure = stateArea ? same(stateArea) : null;
  if (stateFigure && stateArea!.name === area.name && stateFigure.median === latest.value) stateFigure = null; // Vienna is both city and Bundesland: one figure, not two

  const otherKind: Kind = kind === "house" ? "apartment" : "house";
  const otherLatest = latestOf(area[otherKind]);
  const alsoPublished = also
    .map((a) => ({ a, v: a[kind][year] ?? latestOf(a[kind])?.value }))
    .filter((x) => x.v && x.v !== latest.value)
    .map((x) => ({ level: LEVEL_NAME[x.a.level], name: areaLabel(x.a), median: x.v }));

  const notes: string[] = [`Based on purchase contracts from ${year - 4} to ${year}, the earlier years revalued to ${year} with a regression model (STATISTIK AUSTRIA's method).`];
  if (year < data.latestYear) {
    notes.push(`STATISTIK AUSTRIA has no ${data.latestYear} figure for ${label} (too few sales); the newest it has is for ${year}, so this figure is ${data.latestYear - year} year${data.latestYear - year === 1 ? "" : "s"} older than the rest of the file.`);
  }
  const series = Object.keys(area[kind]).map(Number).sort((a, b) => a - b).map((y) => ({ reference_period: String(y), value: area[kind][y] }));
  const extra: Record<string, unknown> = {
    region: { name: label, published_as: area.name, level: LEVEL_NAME[area.level], code: area.code || null, bundesland: area.state || null },
    property_type_published: { key: kind, description: KIND_WORDS[kind] },
    reference_period_label: String(year),
    data_window: `${year - 4}-${year}`,
    previous_period: previous ? { reference_period: String(previous.year), value: previous.value, change_percent: previous.change_percent } : null,
    austria_median: austria,
    bundesland_median: stateFigure,
    other_property_type: otherLatest ? { key: otherKind, description: KIND_WORDS[otherKind], reference_period: String(otherLatest.year), median: otherLatest.value } : null,
    also_published: alsoPublished,
    series,
    definition: "Median price per m² of living area paid for the type of home, from land-register purchase contracts, with the four earlier years revalued to the reference year by a regression model.",
    dataset: { url: FILE_URL, page: PAGE_URL, created: data.created },
  };
  const typeWords = KIND_WORDS[kind];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "AT", town: label, property_type: q.property_type },
    value: latest.value,
    measure: "median",
    currency: "EUR",
    unit: "per m²",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method: METHOD,
    note: notes.join(" "),
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In ${label} the median price paid for ${typeWords} was ${fmtMoney(v, "EUR")} per m² of living area (not per home) for ${year}, ` +
      `a model figure from purchase contracts of ${year - 4} to ${year}, the earlier years revalued to ${year}.` +
      (previous ? pctWords(previous.change_percent, String(previous.year), previous.value) : "") +
      (austria ? ` The Austrian median for ${year} was ${fmtMoney(austria.median, "EUR")} per m² (${label} is ${Math.abs(austria.area_vs_this_percent)}% ${austria.area_vs_this_percent >= 0 ? "above" : "below"} it).` : "") +
      (stateFigure ? ` The ${stateArea!.name} median was ${fmtMoney(stateFigure.median, "EUR")} per m².` : ""),
    extra,
  });
}

// ---------- fetching ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
export type FileFetcher = () => Promise<Buffer>;

export async function downloadFile(): Promise<Buffer> {
  try {
    const res = await fetch(FILE_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, FILE_URL, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SourceError("Source timed out", FILE_URL);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  }
}

export function parseFile(buf: Buffer): AtData {
  let sheets: OdsSheet[];
  try {
    sheets = readOds(buf, { maxRowsPerSheet: 5000 });
  } catch (err: any) {
    throw new SourceError(`STATISTIK AUSTRIA's price spreadsheet could not be read (${String(err?.message ?? err)})`);
  }
  return parseWorkbook(sheets);
}

export const CACHE_MS = 6 * 3600 * 1000;
let cache: { at: number; data: AtData } | null = null;
/** Test hook. */
export function clearCache(): void {
  cache = null;
}

/** The parsed spreadsheet, from the in-memory copy when it is under six hours old. If a refresh fails the older copy is used. */
export async function loadData(o: { fetcher?: FileFetcher; now?: number } = {}): Promise<AtData> {
  const now = o.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.data;
  try {
    const data = parseFile(await (o.fetcher ?? downloadFile)());
    cache = { at: now, data };
    return data;
  } catch (err) {
    if (cache) return cache.data;
    throw err;
  }
}

export async function atHomePrices(
  input: { town?: string; postcode?: string; property_type?: string; baseUrl?: string },
  o: { data?: AtData; fetcher?: FileFetcher; now?: number } = {},
): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").trim().toLowerCase() || "any";
  if (!(TYPE_ASK as readonly string[]).includes(type)) {
    throw new InputError(`property_type must be one of: ${TYPE_ASK.join(", ")}`);
  }
  const postcode = (input.postcode ?? "").trim() || null;
  if (!postcode && !(input.town ?? "").trim()) {
    throw new InputError("A place is required: give the town or district as town (for example town=Wien, town=Graz, town=Tirol) or a Vienna postcode (postcode=1020). town=Austria gives the national figure.");
  }
  if (postcode && !input.town && viennaDistrictOfPostcode(postcode) === null) {
    throw new InputError("STATISTIK AUSTRIA publishes Austrian home prices by district, municipality and Bundesland; only Vienna postcodes (1010 to 1230) can be matched. Give the town or district as town.");
  }
  const data = o.data ?? (await loadData({ fetcher: o.fetcher, now: o.now }));
  return atAnswer(data, { town: input.town ?? null, postcode, property_type: type as AskType, baseUrl: input.baseUrl });
}
