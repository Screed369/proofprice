// Canada: annual landed value per kilogram of wild-caught sea fish and shellfish, from Fisheries and Oceans Canada (DFO) "Commercial Fisheries,
// Canada, annual" (open.canada.ca dataset 6e16f703-9c57-46c9-9194-6573398c17e6). Format checked 2026-11-04.
// One CSV: Year, Province, Species Group, Species, Quantity (kgs), Value (CAD); 1990 to 2024; Windows-1252; numbers with thousands commas inside
// quotes; "x" or empty = suppressed, 0 = no landings; a footer of text lines after the data. The file has NO price column: the price is
// Value / Quantity, the average value fishers were paid at the wharf (landed value) for that species, province and year. It is one derived
// annual average per row: no distribution, no record count, so every answer is an official statistic (range fields null, sample_size null).
// The file name carries the year range ("1990-2024 ... EN.csv") and changes each year: it is resolved from the dataset's CKAN record.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { ckanPackage, latestResource } from "../../lib/adapters";
import type { CkanPackage } from "../../lib/adapters";

export const DATASET_ID = "6e16f703-9c57-46c9-9194-6573398c17e6";
export const PORTAL = "https://open.canada.ca/data";
export const DATASET_URL = `${PORTAL}/en/dataset/${DATASET_ID}`;
export const OGL_URL = "https://open.canada.ca/en/open-government-licence-canada";
const USER_AGENT = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "ca-fisheries-landings",
  country: "CA (Canada)",
  category: "farm-gate prices (annual landed value of sea fish and shellfish)",
  name: "Commercial Fisheries, Canada, annual (Fisheries and Oceans Canada)",
  publisher: "Fisheries and Oceans Canada (DFO)",
  what_is_recorded:
    "For about 30 sea fish and shellfish species (lobster, snow crab, shrimp, scallop, salmon, herring, cod, haddock, halibut ...) the weight landed and the value paid to fishers, each year since 1990, for Canada, the Atlantic region and each coastal province. " +
    "We divide value by weight to give the average landed value per kilogram: one derived annual average per species, area and year; never a sale.",
  price_type: "official_statistic",
  freshness: "Annual, not live: DFO publishes the year just ended about ten months later (the file read on 4 November 2026 runs to 2024), and every answer states its year",
  licence: `Open Government Licence - Canada. "You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose." (${OGL_URL})`,
  licence_url: OGL_URL,
  attribution: "Contains information licensed under the Open Government Licence – Canada. Source: Fisheries and Oceans Canada, Commercial Fisheries, Canada, annual (landings and landed value).",
  homepage: DATASET_URL,
  limits:
    "An annual average landed value (what fishers were paid at the wharf, derived as value divided by weight) for one species in one area, not a retail or restaurant price, not a range and not a single trade: the file gives no distribution and no count. " +
    "Fishing areas are Canada, the Atlantic region, British Columbia and the Atlantic provinces; Ontario and the prairie provinces are not in the file. A species with no landings, or a suppressed figure, has no price. " +
    "Species not listed are grouped in an 'other' category. Figures are preliminary for recent years and subject to revision. About ten months behind.",
};

// ---------- species: everyday words -> the file's own names ----------

export interface SpeciesDef {
  /** The file's own species name. */
  label: string;
  words: string[];
}
const S = (label: string, words: string): SpeciesDef => ({ label, words: words.split("|").map((w) => w.trim().toLowerCase()) });

/** The species of the 2024 file (totals left out: they are not one product). The first definition that lists a word is the default for it. */
export const SPECIES: SpeciesDef[] = [
  S("Lobster", "lobster|lobsters|american lobster"),
  S("Snow crab", "snow crab|snow crabs|crab|crabs|queen crab"),
  S("Other crabs", "other crabs|dungeness crab|rock crab|king crab"),
  S("Shrimp", "shrimp|shrimps|prawn|prawns"),
  S("Scallop", "scallop|scallops"),
  S("Clams", "clams|clam"),
  S("Sea urchin", "sea urchin|urchin|sea urchins"),
  S("Sea cucumber", "sea cucumber|sea cucumbers"),
  S("Other shellfish", "other shellfish|shellfish|oysters|oyster|mussels|mussel|squid"),
  S("Salmon", "salmon|wild salmon|pacific salmon"),
  S("Herring", "herring"),
  S("Mackerel", "mackerel"),
  S("Capelin", "capelin"),
  S("Alewife", "alewife|gaspereau"),
  S("Eel", "eel|eels"),
  S("Elvers", "elvers|elver|glass eels"),
  S("Tuna", "tuna|bluefin tuna"),
  S("Swordfish", "swordfish"),
  S("Shark", "shark"),
  S("Silversides", "silversides|silverside"),
  S("Other pelagics", "other pelagics"),
  S("Cod", "cod|atlantic cod"),
  S("Haddock", "haddock"),
  S("Halibut", "halibut"),
  S("Greenland halibut/turbot", "turbot|greenland halibut"),
  S("Pollock", "pollock"),
  S("Redfish", "redfish|ocean perch"),
  S("Hake", "hake"),
  S("Flounders and soles", "flounder|flounders|sole|soles|plaice"),
  S("Skate", "skate"),
  S("Other groundfish", "other groundfish|groundfish"),
  S("Marine plants", "marine plants|seaweed|kelp"),
];

export const exampleSpecies = (max: number) => SPECIES.map((s) => s.words[0]).slice(0, max).join(", ");

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function matchSpecies(query: string): SpeciesDef | null {
  const q = plain(query);
  if (!q) return null;
  const direct = SPECIES.find((s) => plain(s.label) === q || s.words.includes(q));
  if (direct) return direct;
  let best: { s: SpeciesDef; len: number } | null = null;
  for (const s of SPECIES) {
    for (const w of s.words) if (w.length >= 3 && ` ${q} `.includes(` ${w} `) && (!best || w.length > best.len)) best = { s, len: w.length };
  }
  return best?.s ?? null;
}

// ---------- areas ----------

/** The file's own area names. "Canada" is the national total, "Atlantic" the four Atlantic provinces together. */
export const AREAS = ["Canada", "Atlantic", "British Columbia", "Nova Scotia", "New Brunswick", "Prince Edward Island", "Newfoundland and Labrador", "Quebec"];
const AREA_WORDS: Record<string, string> = {
  canada: "Canada", national: "Canada", ca: "Canada", atlantic: "Atlantic", "atlantic canada": "Atlantic", "atlantic provinces": "Atlantic",
  "british columbia": "British Columbia", bc: "British Columbia", pacific: "British Columbia", vancouver: "British Columbia",
  "nova scotia": "Nova Scotia", ns: "Nova Scotia", halifax: "Nova Scotia", "new brunswick": "New Brunswick", nb: "New Brunswick", moncton: "New Brunswick",
  "prince edward island": "Prince Edward Island", pei: "Prince Edward Island", pe: "Prince Edward Island", charlottetown: "Prince Edward Island",
  "newfoundland and labrador": "Newfoundland and Labrador", newfoundland: "Newfoundland and Labrador", labrador: "Newfoundland and Labrador", nl: "Newfoundland and Labrador",
  "st johns": "Newfoundland and Labrador", quebec: "Quebec", qc: "Quebec",
};

export function resolveArea(region: string | undefined): { area: string; note?: string } {
  const raw = (region ?? "").trim();
  if (!raw) return { area: "Canada" };
  const q = plain(raw).replace(/, canada$/, "").replace(/ canada$/, "");
  const hit = AREA_WORDS[q] ?? AREA_WORDS[plain(raw)];
  if (hit) return { area: hit };
  const bits = raw.split(",").map((s) => plain(s)).filter(Boolean);
  for (const b of [...bits].reverse()) if (AREA_WORDS[b]) return { area: AREA_WORDS[b], note: `DFO publishes provincial and regional totals, not local ones: '${raw}' is answered with the ${AREA_WORDS[b]} figure.` };
  throw new InputError(`'${raw}' is not an area in DFO's landings file. Give one of: ${AREAS.join(", ")} (leave region out for Canada as a whole).`);
}

// ---------- the CSV ----------

export interface LandingRow {
  year: number;
  area: string;
  group: string;
  species: string;
  kg: number | null;
  cad: number | null;
}

/** Split one CSV line (double quotes, "" inside quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** "105,249,198" -> 105249198; "x", "" or text -> null. */
export function parseNumber(s: string | undefined): number | null {
  const t = (s ?? "").replace(/[\s ,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Parse the landings file. Rows whose Year is not a four-digit number (the footer) are dropped. Throws when the columns are not the known ones. */
export function parseLandings(text: string): LandingRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsvLine(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iy = col(/^year$/), ip = col(/^province$/), ig = col(/group/), is = col(/^species$/), iq = col(/^quantity/), iv = col(/^value/);
  if ([iy, ip, ig, is, iq, iv].some((i) => i < 0)) throw new SourceError("DFO's landings file does not have the expected columns (Year, Province, Species Group, Species, Quantity, Value)");
  const rows: LandingRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    if (!/^\d{4}$/.test((c[iy] ?? "").trim())) continue;
    rows.push({ year: Number(c[iy]), area: (c[ip] ?? "").trim(), group: (c[ig] ?? "").trim(), species: (c[is] ?? "").trim(), kg: parseNumber(c[iq]), cad: parseNumber(c[iv]) });
  }
  if (!rows.length) throw new SourceError("DFO's landings file held no data rows");
  return rows;
}

export interface YearPrice {
  year: number;
  perKg: number;
  kg: number;
  cad: number;
}

/** Landed value per kg by year for one species and area, newest first. Years with no landings or a suppressed figure are left out. */
export function priceSeries(rows: LandingRow[], species: string, area: string): { series: YearPrice[]; group: string | null; lastYear: number | null; unpublished: number[] } {
  const mine = rows.filter((r) => r.species === species && r.area === area);
  const series: YearPrice[] = [];
  const unpublished: number[] = [];
  for (const r of mine) {
    if (r.kg !== null && r.cad !== null && r.kg > 0 && r.cad > 0) series.push({ year: r.year, perKg: r.cad / r.kg, kg: r.kg, cad: r.cad });
    else unpublished.push(r.year);
  }
  series.sort((a, b) => b.year - a.year);
  const lastYear = rows.reduce((m, r) => Math.max(m, r.year), 0) || null;
  return { series, group: mine[0]?.group ?? null, lastYear, unpublished: unpublished.sort((a, b) => b - a) };
}

// ---------- fetch ----------

const TTL_MS = 24 * 3600 * 1000;
let cache: { at: number; rows: LandingRow[]; file: string; modified: string | null } | null = null;
export function clearLandingsCache(): void {
  cache = null;
}

export type PackageGetter = () => Promise<CkanPackage>;
export type FileGetter = (url: string) => Promise<ArrayBuffer>;

const defaultPackage: PackageGetter = () => ckanPackage(PORTAL, DATASET_ID, { timeoutMs: 20000 });
const defaultFile: FileGetter = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/csv,*/*" }, signal: ctrl.signal });
    if (!res.ok) throw new SourceError(`Fisheries and Oceans Canada answered HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError("Could not reach Fisheries and Oceans Canada for its landings file");
  } finally {
    clearTimeout(timer);
  }
};

/** The newest English landings file of the dataset, parsed. Cached for a day. The file is Windows-1252. */
export async function loadLandings(getPackage: PackageGetter = defaultPackage, getFile: FileGetter = defaultFile) {
  const custom = getPackage !== defaultPackage || getFile !== defaultFile;
  if (!custom && cache && Date.now() - cache.at < TTL_MS) return cache;
  const pkg = await getPackage();
  const res = latestResource(pkg.resources, { format: "CSV", nameMatches: /landings/i }) ?? null;
  const en = pkg.resources.filter((r) => r.format === "CSV" && /landings EN/i.test(r.name)).sort((a, b) => b.name.localeCompare(a.name))[0] ?? res;
  if (!en?.url) throw new SourceError("The Fisheries and Oceans Canada dataset lists no landings CSV");
  const text = new TextDecoder("windows-1252").decode(await getFile(en.url));
  const loaded = { at: Date.now(), rows: parseLandings(text), file: en.name, modified: pkg.metadataModified };
  if (!custom) cache = loaded;
  return loaded;
}

// ---------- the answer ----------

const cad = (v: number) => fmtMoney(v, "CAD");
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function caFisheriesMethod(): string {
  return (
    "Canada (sea fish and shellfish): Fisheries and Oceans Canada publishes, for each species, area and year, the weight landed and the value paid to fishers. " +
    "We divide value by weight to give the average landed value per kilogram. It is one derived annual average, not a sale and not a retail price, and no range is calculated."
  );
}

export async function caFisheriesPrices(
  q: { species: string; region?: string; baseUrl?: string },
  getPackage?: PackageGetter,
  getFile?: FileGetter,
): Promise<PriceAnswer> {
  const word = (q.species ?? "").trim();
  if (!word) throw new InputError(`species is required, for example 'lobster', 'snow crab', 'salmon', 'herring' or 'cod'.`);
  const { area, note: areaNote } = resolveArea(q.region);
  const def = matchSpecies(word);
  const query = { country: "CA", species: word, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "CAD", method: caFisheriesMethod(), baseUrl: q.baseUrl };
  if (!def) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `DFO's landings file has no species "${word}". Try one of: ${exampleSpecies(30)}.`, extra: { available_species: SPECIES.map((s) => s.words[0]) } };
  }
  const { rows, file } = await loadLandings(getPackage, getFile);
  const { series, group, lastYear, unpublished } = priceSeries(rows, def.label, area);
  const now = series[0];
  if (!now) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: `DFO publishes no landed value for ${def.label.toLowerCase()} in ${area}: no landings are recorded there, or the figures are suppressed. Try Canada as a whole or another area.`,
      extra: { ...(areaNote ? { region_note: areaNote } : {}), areas: AREAS },
    };
  }
  const prev = series.find((s) => s.year === now.year - 1) ?? null;
  const notes: string[] = [
    `An annual average landed value: what fishers were paid at the wharf for ${def.label.toLowerCase()} in ${now.year}, worked out as value divided by weight from DFO's landings file. Not a retail price, not a single sale; figures are preliminary and subject to revision.`,
  ];
  if (lastYear && now.year < lastYear) notes.push(`DFO has no landed value for this species and area in ${lastYear}: the newest year with one is ${now.year}.`);
  if (areaNote) notes.push(areaNote);
  const perKg = round2(now.perKg);
  return buildStatisticAnswer({
    ...base,
    value: perKg,
    unit: "per kg",
    period: { from: `${now.year}-01-01`, to: `${now.year}-12-31` },
    reference_period: String(now.year),
    note: notes.join(" "),
    describe: (v) =>
      `In ${area === "Canada" ? "Canada" : area} fishers were paid on average ${cad(v)} per kg for ${def.label.toLowerCase()} in ${now.year} (landed value, from DFO's annual landings: ${Math.round(now.kg / 1000).toLocaleString("en-CA")} tonnes landed for ${cad(Math.round(now.cad))}). ` +
      (prev ? `That is ${pct(now.perKg, prev.perKg) >= 0 ? "up" : "down"} ${Math.abs(pct(now.perKg, prev.perKg))}% on ${prev.year} (${cad(round2(prev.perKg))} per kg). ` : "") +
      "An annual average, not a retail price or a single sale.",
    extra: {
      species: def.label,
      species_group: group,
      area,
      landed_tonnes: Math.round(now.kg / 1000),
      landed_value_cad: Math.round(now.cad),
      change_on_previous_year: prev ? { reference_year: prev.year, value: round2(prev.perKg), change_percent: pct(now.perKg, prev.perKg) } : null,
      last_years: series.slice(0, 6).map((s) => ({ year: s.year, value: round2(s.perKg) })),
      ...(unpublished.length ? { years_without_a_published_price: unpublished.slice(0, 6) } : {}),
      file,
      areas: AREAS,
    },
  });
}
