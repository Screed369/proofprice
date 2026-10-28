// Malaysia: monthly fish and seafood prices at three levels (landing/ex-vessel, wholesale, retail), OpenDOSM data catalogue "fish_prices".
// Format checked 2026-10-22 through the probe workflow (GitHub Actions; the workspace shell cannot reach storage.data.gov.my):
//   GET https://storage.data.gov.my/agriculture/fish_prices.csv -> 200, 3,574,760 bytes, no key, header
//   date,level,species,price
//   2009-01-01,ex_vessel,kebasi_selangat,1.78
// One row per month (date is the 1st), level (ex_vessel | wholesale | retail) and species (Malay slug); price is ringgit per kg.
// About 150 species/groups per level (fish, prawns, crabs, shellfish, squid). The file is sorted by block, not by date, so the newest
// month is found by reading everything. The catalogue gives one published average per row and no record count, so every answer is an
// official statistic (no range, no sample size). A bulk file: the collector (harvest) reads it once a day, answers come from the library.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const CSV_URL = "https://storage.data.gov.my/agriculture/fish_prices.csv";
export const AREA = "Malaysia";

export const INFO: SourceInfo = {
  id: "my-dosm-fish",
  country: "MY (Malaysia)",
  category: "farm-gate prices (monthly fish and seafood prices at landing, wholesale and retail)",
  name: "Fish prices (OpenDOSM data catalogue)",
  publisher: "Department of Statistics Malaysia (DOSM), via the OpenDOSM data catalogue",
  what_is_recorded:
    "For about 150 kinds of fish, prawns, crabs, shellfish and squid, the average price per kilogram each month at three levels: ex-vessel (the first sale at landing, what fishers receive), wholesale and retail, in Malaysian ringgit. " +
    "One published monthly average per species and level; never a single sale.",
  price_type: "official_statistic",
  freshness: "Monthly, not live: when checked on 28 October 2026 the newest month DOSM publishes was December 2025 (its 'last updated' date is not the data period); our copy is refreshed daily and every answer names its month",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Department of Statistics Malaysia (DOSM), OpenDOSM data catalogue, Fish prices (open.dosm.gov.my/data-catalogue/fish_prices), CC BY 4.0. Changed by ProofPrice: we pass on the newest published monthly average and name its month.",
  homepage: "https://open.dosm.gov.my/data-catalogue/fish_prices",
  limits:
    "A monthly average price per kilogram for one species and one level, as published: no range and no count of sales. Species are named in Malay as in the file (a few English names are matched for convenience). " +
    "Ex-vessel is the price at first sale at landing, wholesale the price between traders, retail the price in shops and markets: only ex-vessel is what fishers receive. " +
    "Not every species is published every month; a species with no figure in the newest month is left out. Figures can be revised.",
};

export type Level = "ex_vessel" | "wholesale" | "retail";
export const LEVELS: Level[] = ["ex_vessel", "wholesale", "retail"];
const LEVEL_LABEL: Record<Level, string> = { ex_vessel: "ex-vessel (landing)", wholesale: "wholesale", retail: "retail" };

// ---------- parsing the CSV ----------

export interface FishPoint {
  month: string; // YYYY-MM
  price: number;
}
export type SeriesMap = Map<string, FishPoint[]>; // key "<level>:<species>"

/** Pure: read the whole CSV into one sorted series per level and species. Malformed rows, unknown levels and non-positive prices are skipped. */
export function parseFishCsv(text: string): SeriesMap {
  const out: SeriesMap = new Map();
  const lines = text.split(/\r?\n/);
  const head = (lines[0] ?? "").trim().toLowerCase();
  if (head !== "date,level,species,price") throw new SourceError(`The OpenDOSM fish price file has an unexpected header "${head.slice(0, 60)}": the format may have changed and this source needs updating.`);
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length !== 4) continue;
    const [date, level, species, price] = p;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !LEVELS.includes(level as Level) || !/^[a-z0-9_]+$/.test(species)) continue;
    const v = Number(price);
    if (!Number.isFinite(v) || v <= 0) continue;
    const key = `${level}:${species}`;
    const arr = out.get(key) ?? [];
    arr.push({ month: date.slice(0, 7), price: v });
    out.set(key, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

export const lastDayOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// ---------- daily copy ----------

/** Pure: one library row per level and species for the newest month any series has; series that stopped earlier are left out.
 *  Each row is one published average: n is NO_COUNT (no count of sales is published) and the range fields repeat the figure. */
export function fishHarvestRows(series: SeriesMap): HarvestResult {
  let newest = "";
  for (const arr of series.values()) newest = arr[arr.length - 1].month > newest ? arr[arr.length - 1].month : newest;
  const rows = [...series.entries()]
    .filter(([, arr]) => arr[arr.length - 1].month === newest)
    .map(([key, arr]) => {
      const v = arr[arr.length - 1].price;
      return { area: AREA, item: key, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    })
    .sort((a, b) => a.item.localeCompare(b.item));
  if (rows.length < 20) throw new SourceError(`The OpenDOSM fish price file has only ${rows.length} species with a price in ${newest || "any month"}: the format may have changed and this source needs updating.`);
  return {
    date: lastDayOf(newest),
    currency: "MYR",
    unit: "per kg",
    rows,
    note: `OpenDOSM fish_prices: monthly average price per kg for ${monthWords(newest)}, by level (ex_vessel, wholesale, retail) and species (item = level:species). Published averages, not counts of sales (no count is published).`,
  };
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";
export const harvestOptions = { retryDelayMs: 2000 };

export async function fishHarvest(fetchText?: () => Promise<string>): Promise<HarvestResult> {
  const get =
    fetchText ??
    (async () => {
      let last = "";
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(CSV_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(90000) });
          if (res.ok) return await res.text();
          last = `HTTP ${res.status}`;
        } catch (e: any) {
          last = String(e?.message ?? e);
        }
        if (i < 2) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
      }
      throw new SourceError(`Could not download the OpenDOSM fish price file: ${last}`);
    });
  return fishHarvestRows(parseFishCsv(await get()));
}

// ---------- asking in everyday words ----------

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^ikan[\s_-]+/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** English words people use -> the Malay name the file starts its species with. Only well-known, unambiguous equivalents. */
export const ENGLISH: Record<string, string[]> = {
  mackerel: ["kembong", "tenggiri"],
  "indian_mackerel": ["kembong"],
  kembung: ["kembong"],
  "spanish_mackerel": ["tenggiri"],
  pomfret: ["bawal"],
  prawn: ["udang"],
  prawns: ["udang"],
  shrimp: ["udang"],
  shrimps: ["udang"],
  squid: ["sotong"],
  cuttlefish: ["sotong"],
  crab: ["ketam"],
  crabs: ["ketam"],
  grouper: ["kerapu"],
  barramundi: ["siakap"],
  seabass: ["siakap"],
  sea_bass: ["siakap"],
  anchovy: ["bilis"],
  anchovies: ["bilis"],
  shark: ["yu"],
  stingray: ["pari"],
  ray: ["pari"],
  oyster: ["tiram"],
  oysters: ["tiram"],
  tuna: ["tongkol"],
  scad: ["selar"],
  trevally: ["selar"],
  threadfin: ["senangin", "kurau"],
  sardine: ["tamban"],
  sardines: ["tamban"],
};

/** English names shown beside a Malay species when the match is certain enough to print. */
export const ENGLISH_LABEL: Record<string, string> = {
  kembong: "Indian mackerel", tenggiri: "Spanish mackerel", bilis: "anchovy", siakap: "barramundi (sea bass)", kerapu: "grouper", yu: "shark", pari: "ray",
  tiram: "oyster", selar: "scad (trevally)", bawal: "pomfret", udang: "prawn", sotong: "squid or cuttlefish", ketam: "crab", tongkol: "tuna", tamban: "sardine",
};

export const speciesLabel = (slug: string): string => {
  const words = slug.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const en = ENGLISH_LABEL[slug.split("_")[0]];
  return en ? `${words} (${en})` : words;
};

/** English words that name a whole family in the file (several Malay kinds): the kind we answer with when nothing more specific is asked. The other kinds are always listed in other_matches. */
export const DEFAULT_KIND: Record<string, string> = {
  squid: "sotong_katak",
  cuttlefish: "sotong_katak",
};

export interface Resolved {
  primary: string | null;
  candidates: string[];
}

/** Pure: which species in the file does a plain-words request mean? An exact name wins; otherwise one clear candidate; otherwise a list to choose from. */
export function resolveSpecies(query: string, slugs: string[]): Resolved {
  const q = norm(query);
  if (!q) return { primary: null, candidates: [] };
  if (slugs.includes(q)) return { primary: q, candidates: [q] };
  const prefixes = ENGLISH[q] ?? ENGLISH[q.split("_")[0]] ?? null;
  let cands: string[];
  if (prefixes) cands = slugs.filter((s) => prefixes.some((p) => s === p || s.startsWith(`${p}_`)));
  else cands = slugs.filter((s) => s.startsWith(`${q}_`) || s.endsWith(`_${q}`) || s.includes(`_${q}_`));
  if (!cands.length && prefixes === null && q.length >= 4) cands = slugs.filter((s) => s.includes(q));
  const bare = cands.filter((c) => prefixes?.includes(c));
  const dflt = DEFAULT_KIND[q];
  if (dflt && cands.includes(dflt)) return { primary: dflt, candidates: cands };
  if (cands.length === 1) return { primary: cands[0], candidates: cands };
  if (bare.length === 1 && prefixes?.length === 1) return { primary: bare[0], candidates: cands };
  return { primary: null, candidates: cands };
}

const LEVEL_WORDS: Record<string, Level> = {
  ex_vessel: "ex_vessel", exvessel: "ex_vessel", landing: "ex_vessel", landed: "ex_vessel", boat: "ex_vessel", vessel: "ex_vessel", fisher: "ex_vessel", fishermen: "ex_vessel", farm_gate: "ex_vessel",
  wholesale: "wholesale", market: "wholesale", trader: "wholesale",
  retail: "retail", shop: "retail", consumer: "retail", supermarket: "retail",
};
export function parseLevel(text: string | undefined): Level {
  if (!text || !text.trim()) return "ex_vessel";
  const l = LEVEL_WORDS[norm(text)];
  if (!l) throw new InputError('level must be "ex_vessel" (the price fishers get at landing, the default), "wholesale" or "retail".');
  return l;
}

// ---------- the answer ----------

export interface FishQuery {
  product: string;
  level?: string;
  baseUrl?: string;
}
interface LibLike {
  date: string;
  rows: { area: string; item: string; n: number; median: number }[];
}

const SENTENCE: Record<Level, (name: string, v: string, m: string) => string> = {
  ex_vessel: (name, v, m) => `At the first sale at landing (ex-vessel), fishers in Malaysia received on average ${v} per kg for ${name} in ${m}`,
  wholesale: (name, v, m) => `The average wholesale price of ${name} in Malaysia was ${v} per kg in ${m}`,
  retail: (name, v, m) => `The average retail price of ${name} in Malaysia was ${v} per kg in ${m}`,
};

export function fishAnswer(lib: LibLike, q: FishQuery, now = new Date()): PriceAnswer {
  const level = parseLevel(q.level);
  const month = lib.date.slice(0, 7);
  const slugs = [...new Set(lib.rows.map((r) => r.item.split(":")[1]))].sort();
  const { primary, candidates } = resolveSpecies(q.product, slugs);
  const base = {
    source: INFO,
    query: { country: "MY", product: q.product, level },
    measure: "average" as const,
    currency: "MYR",
    method:
      "Malaysia (fish prices): the Department of Statistics Malaysia publishes one monthly average price per kilogram for each species and level (ex-vessel, wholesale, retail). We pass on the newest published average and its month; it is a monthly average, not a sale and not a live price, and no range is calculated.",
    baseUrl: q.baseUrl,
  };
  if (!primary) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: candidates.length
        ? `"${q.product}" matches several kinds in the Malaysian fish price file; ask for one of them by name: ${candidates.slice(0, 12).map(speciesLabel).join("; ")}.`
        : `The Malaysian fish price file has no species "${q.product}". Species are named in Malay (for example kembong, tenggiri, bawal_putih, udang_harimau, sotong_katak, siakap, kerapu); English words such as mackerel, prawn, squid or crab also work.`,
      extra: candidates.length ? { candidates: candidates.map((c) => ({ product: c, name: speciesLabel(c) })) } : { available_products: slugs.slice(0, 200) },
    };
  }
  const get = (l: Level) => lib.rows.find((r) => r.item === `${l}:${primary}`);
  const row = get(level);
  if (!row) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const have = LEVELS.filter((l) => get(l));
    return {
      ...none,
      summary: `The file has no ${LEVEL_LABEL[level]} price for ${speciesLabel(primary)} in ${monthWords(month)}.${have.length ? ` It does have: ${have.map((l) => LEVEL_LABEL[l]).join(", ")}.` : ""}`,
      extra: { available_levels: have },
    };
  }
  const byLevel: Record<string, number> = {};
  for (const l of LEVELS) {
    const r = get(l);
    if (r) byLevel[l] = r.median;
  }
  const behind = (now.getUTCFullYear() - Number(month.slice(0, 4))) * 12 + (now.getUTCMonth() + 1 - Number(month.slice(5, 7)));
  const name = speciesLabel(primary);
  const notes = [
    `A monthly average price per kilogram for ${monthWords(month)} at the ${LEVEL_LABEL[level]} level: not a sale and not a live price.`,
  ];
  if (level !== "ex_vessel") notes.push(`This is the ${LEVEL_LABEL[level]} price, not what fishers receive; the ex-vessel price is in by_level.`);
  if (candidates.length > 1 && DEFAULT_KIND[norm(q.product)] === primary)
    notes.push(`"${q.product}" covers several kinds in the file; this is ${name}. The other kinds are in other_matches: ask for one by name.`);
  if (behind >= 4) notes.push(`Old data: the newest month in the file is ${monthWords(month)}, ${behind} months ago.`);
  return buildStatisticAnswer({
    ...base,
    query: { country: "MY", product: q.product, level, species: primary },
    value: row.median,
    unit: "per kg",
    period: { from: `${month}-01`, to: lastDayOf(month) },
    reference_period: month,
    note: notes.join(" "),
    describe: (v) => `${SENTENCE[level](name, fmtMoney(v, "MYR"), monthWords(month))}, as published by the Department of Statistics Malaysia (a monthly average, not a sale or a live price).` + (behind >= 4 ? ` Old data: ${behind} months old.` : ""),
    extra: {
      country_name: "Malaysia",
      species: { slug: primary, name },
      level: { value: level, label: LEVEL_LABEL[level] },
      what_this_is: "Monthly average price per kilogram published by the Department of Statistics Malaysia. Ex-vessel = first sale at landing (what fishers receive); wholesale = between traders; retail = in shops and markets.",
      by_level: byLevel,
      reference_month: month,
      reference_month_label: monthWords(month),
      ...(candidates.length > 1 ? { other_matches: candidates.filter((c) => c !== primary).map((c) => ({ product: c, name: speciesLabel(c) })) } : {}),
      dataset: { name: "Fish prices", url: INFO.homepage },
    },
  });
}

export function myFish(q: FishQuery, readLib: () => LibLike | null, now = new Date()): PriceAnswer {
  if (!q.product || !q.product.trim()) throw new InputError("Give a product: a fish or seafood such as 'mackerel', 'kembong', 'prawn' or 'squid'.");
  const lib = readLib();
  if (!lib) throw new SourceError("Not yet available: the Malaysian fish price figures appear after the next collection (the price library has no data for this source yet).");
  return fishAnswer(lib, q, now);
}

/** Where a request lives in the library, from the species in our newest stored day. */
export function fishHistoryKey(p: { product?: string; level?: string }, rows: { area: string; item: string }[]): { area: string; item: string; label: string } | null {
  if (!p.product || !rows.length) return null;
  let level: Level;
  try {
    level = parseLevel(p.level);
  } catch {
    return null;
  }
  const slug = resolveSpecies(p.product, [...new Set(rows.map((r) => r.item.split(":")[1]))]).primary;
  if (!slug || !rows.some((r) => r.item === `${level}:${slug}`)) return null;
  return { area: AREA, item: `${level}:${slug}`, label: `${speciesLabel(slug)}, ${LEVEL_LABEL[level]}` };
}
