// United Kingdom: monthly landed price of sea fish and shellfish by species, from the Marine Management Organisation's (MMO) "UK Sea Fisheries
// Statistics" monthly release on GOV.UK (Open Government Licence v3.0). Format checked live on 2026-11-12.
// The release page https://www.gov.uk/government/statistics/monthly-sea-fisheries-statistics-<month>-<year> (content API at /api/content/...) lists an
// .xlsx and an .ods twin whose URLs carry a random hash and change every month, so the link is read from the page each time. Sheet "Table 3" =
// landings of UK vessels into ALL ports by species: row 3 holds the reporting month as an Excel date serial (46266 = 1 Sep 2026), row 4 the headers
// (Live weight of landings (t) | Value | Price), row 5 the units (£000s, £/tonne), then one row per species: A empty, B species, C tonnes, D value in
// £ thousand, E price in £/tonne (an empty string when the weight or value is zero), group totals (Demersal, Pelagic, Shellfish) and "All Fish".
// The workbook holds only the latest month. The price is the first-sale (landed) price paid to fishers: one published average per species and
// month, with no distribution and no count of sales, so every answer is an official statistic (range fields null, sample_size null).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";
import { NO_COUNT } from "../../lib/stats";
import { downloadFile, govukContent, monthlySlugs, xlsxAttachments } from "../../lib/gov-uk";
import { excelDate, readXlsx } from "../../categories/rent/xlsx";
import type { Cell, Sheet } from "../../categories/rent/xlsx";

export const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
export const SLUG_PREFIX = "monthly-sea-fisheries-statistics";
export const HOMEPAGE = "https://www.gov.uk/government/collections/uk-sea-fisheries-annual-statistics";

export const INFO: SourceInfo = {
  id: "gb-mmo-sea-fish",
  country: "GB (United Kingdom)",
  category: "farm-gate prices (monthly landed price of sea fish and shellfish)",
  name: "UK Sea Fisheries Statistics, monthly (Marine Management Organisation)",
  publisher: "Marine Management Organisation (MMO), with Defra",
  what_is_recorded:
    "For about 40 species of sea fish and shellfish (cod, haddock, plaice, sole, mackerel, herring, lobster, crab, scallops, nephrops ...) and for the demersal, pelagic and shellfish groups, " +
    "the weight landed by UK vessels into all ports in the month, the value paid to fishers and the average price per tonne. First-sale (landed) prices, one published figure per species and month.",
  price_type: "official_statistic",
  freshness:
    "Monthly, not live: the MMO publishes each month's figures about the 30th of the following month (September 2026 was published on 30 October 2026); the latest month is provisional and every answer states its month",
  licence: `Open Government Licence v3.0. "All content is available under the Open Government Licence v3.0, except where otherwise stated" (${OGL_URL})`,
  licence_url: OGL_URL,
  attribution: "Contains public sector information licensed under the Open Government Licence v3.0. Source: Marine Management Organisation, UK Sea Fisheries Statistics.",
  homepage: HOMEPAGE,
  limits:
    "A monthly average landed price (what fishers were paid at first sale) for one species across all UK vessels and ports, not a shop, restaurant or wholesale-market price, not a range and not a single sale: " +
    "the MMO gives no distribution and no count of sales. One figure for the whole United Kingdom (including the Channel Islands and Isle of Man); no split by port or nation in this answer. " +
    "Species with no landings in the month have no price. Figures are provisional and revised. Only the newest month is read.",
};

// ---------- species: everyday words -> the workbook's own names ----------

export interface SpeciesDef {
  /** The workbook's own row label. */
  label: string;
  /** Plain-English name used in answers. */
  name: string;
  group: "Demersal" | "Pelagic" | "Shellfish" | "All";
  words: string[];
}
const S = (label: string, group: SpeciesDef["group"], words: string, name?: string): SpeciesDef => ({
  label,
  name: name ?? label.toLowerCase(),
  group,
  words: words.split("|").map((w) => w.trim().toLowerCase()),
});

/** Rows of Table 3. The first definition listing a word is its default. */
export const SPECIES: SpeciesDef[] = [
  S("Cod", "Demersal", "cod|atlantic cod"),
  S("Haddock", "Demersal", "haddock"),
  S("Plaice", "Demersal", "plaice"),
  S("Sole", "Demersal", "sole|dover sole"),
  S("Lemon Sole", "Demersal", "lemon sole"),
  S("Hake", "Demersal", "hake"),
  S("Whiting", "Demersal", "whiting"),
  S("Saithe", "Demersal", "saithe|coley|coalfish", "saithe (coley)"),
  S("Pollack (Lythe)", "Demersal", "pollack|pollock|lythe", "pollack"),
  S("Ling", "Demersal", "ling"),
  S("Monks or Anglers", "Demersal", "monkfish|monks|anglers|anglerfish|monk", "monkfish"),
  S("Megrim", "Demersal", "megrim"),
  S("Turbot", "Demersal", "turbot"),
  S("Brill", "Demersal", "brill"),
  S("Halibut", "Demersal", "halibut"),
  S("Bass", "Demersal", "bass|sea bass"),
  S("Bream", "Demersal", "bream|sea bream"),
  S("Mullet", "Demersal", "mullet|grey mullet|red mullet"),
  S("Gurnard", "Demersal", "gurnard|gurnards"),
  S("Dogfish", "Demersal", "dogfish|rock salmon"),
  S("Skates and Rays", "Demersal", "skate|skates|ray|rays|skates and rays"),
  S("Witch", "Demersal", "witch"),
  S("Sand Eels", "Demersal", "sand eels|sand eel|sandeel|sandeels"),
  S("Other Demersal", "Demersal", "other demersal"),
  S("Mackerel", "Pelagic", "mackerel"),
  S("Herring", "Pelagic", "herring"),
  S("Pilchards or Sardines", "Pelagic", "sardine|sardines|pilchard|pilchards", "pilchards or sardines"),
  S("Horse Mackerel", "Pelagic", "horse mackerel|scad"),
  S("Blue Whiting", "Pelagic", "blue whiting"),
  S("Bluefin Tuna", "Pelagic", "tuna|bluefin tuna", "bluefin tuna"),
  S("Other Pelagic", "Pelagic", "other pelagic"),
  S("Lobsters", "Shellfish", "lobster|lobsters", "lobster"),
  S("Crabs", "Shellfish", "crab|crabs|brown crab|edible crab", "crab"),
  S("Nephrops", "Shellfish", "nephrops|langoustine|langoustines|scampi|dublin bay prawn|dublin bay prawns", "nephrops (langoustine)"),
  S("Shrimps and Prawns", "Shellfish", "shrimp|shrimps|prawn|prawns|shrimps and prawns", "shrimps and prawns"),
  S("Scallops", "Shellfish", "scallop|scallops"),
  S("Cockles", "Shellfish", "cockle|cockles"),
  S("Mussels", "Shellfish", "mussel|mussels"),
  S("Oysters", "Shellfish", "oyster|oysters"),
  S("Whelks", "Shellfish", "whelk|whelks"),
  S("Squid", "Shellfish", "squid"),
  S("Cuttlefish", "Shellfish", "cuttlefish"),
  S("Octopus", "Shellfish", "octopus"),
  S("Other Shellfish", "Shellfish", "other shellfish"),
  S("Demersal", "Demersal", "demersal|demersal fish|whitefish|white fish", "demersal fish (all species)"),
  S("Pelagic", "Pelagic", "pelagic|pelagic fish", "pelagic fish (all species)"),
  S("Shellfish", "Shellfish", "shellfish", "shellfish (all species)"),
  S("All Fish", "All", "all fish|fish|all species|seafood", "all fish and shellfish"),
];

export const exampleSpecies = (max: number) => SPECIES.map((s) => s.words[0]).slice(0, max).join(", ");

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function matchSpecies(query: string): SpeciesDef | null {
  const q = plain(query);
  if (!q) return null;
  const direct = SPECIES.find((s) => plain(s.label) === q || s.words.includes(q));
  if (direct) return direct;
  let best: { s: SpeciesDef; len: number } | null = null;
  for (const s of SPECIES) {
    for (const w of s.words) {
      // "fish" alone is the all-species row; do not let it capture phrases such as "fish and chips".
      if (w.length >= 3 && w !== "fish" && ` ${q} `.includes(` ${w} `) && (!best || w.length > best.len)) best = { s, len: w.length };
    }
  }
  return best?.s ?? null;
}

// ---------- the workbook ----------

export interface SpeciesMonth {
  label: string;
  tonnes: number;
  valueGbp: number; // pounds (the sheet gives thousands)
  perTonne: number | null; // GBP per tonne; null when the sheet gives no price
}
export interface MonthTable {
  /** First day of the reporting month, YYYY-MM-DD. */
  month: string;
  rows: SpeciesMonth[];
}

const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);

/** Pure: Table 3 of the workbook. Throws when the sheet or its headers are not the known ones. */
export function parseTable(sheets: Sheet[]): MonthTable {
  const sheet = sheets.find((s) => /^table\s*3$/i.test(s.name.trim()));
  if (!sheet) throw new SourceError("The MMO workbook has no 'Table 3' sheet: the format has changed and this source needs updating.");
  const head = sheet.rows.findIndex((r) => r.some((c) => typeof c === "string" && /^live weight/i.test(c)));
  if (head < 0) throw new SourceError("The MMO 'Table 3' sheet has no 'Live weight' header: the format has changed and this source needs updating.");
  const header = sheet.rows[head]!;
  const iw = header.findIndex((c) => typeof c === "string" && /^live weight/i.test(c));
  const iv = header.findIndex((c) => typeof c === "string" && /^value/i.test(c));
  const ip = header.findIndex((c) => typeof c === "string" && /^price/i.test(c));
  if (iw < 0 || iv < 0 || ip < 0) throw new SourceError("The MMO 'Table 3' sheet does not have the Live weight, Value and Price columns.");
  let month: string | null = null;
  for (const r of sheet.rows.slice(0, head)) {
    for (const c of r) {
      const d = excelDate(c);
      if (d) month = d.slice(0, 7) + "-01";
    }
  }
  if (!month) throw new SourceError("The MMO 'Table 3' sheet does not give its reporting month.");
  const rows: SpeciesMonth[] = [];
  for (const r of sheet.rows.slice(head + 1)) {
    const label = typeof r[1] === "string" ? r[1].trim() : "";
    if (!label) continue;
    const tonnes = num(r[iw]);
    const valueK = num(r[iv]);
    if (tonnes === null || valueK === null) continue; // notes and blank lines
    rows.push({ label, tonnes, valueGbp: valueK * 1000, perTonne: num(r[ip]) });
  }
  if (!rows.length) throw new SourceError("The MMO 'Table 3' sheet held no species rows.");
  return { month, rows };
}

/** The price of one species in the month, or null when none is published (no landings, or a blank price). */
export function speciesPrice(t: MonthTable, label: string): { perKg: number; tonnes: number; valueGbp: number } | null {
  const r = t.rows.find((x) => x.label.toLowerCase() === label.toLowerCase());
  if (!r) return null;
  const perTonne = r.perTonne ?? (r.tonnes > 0 && r.valueGbp > 0 ? r.valueGbp / r.tonnes : null);
  if (perTonne === null || !(perTonne > 0) || !(r.tonnes > 0)) return null;
  return { perKg: perTonne / 1000, tonnes: r.tonnes, valueGbp: r.valueGbp };
}

// ---------- fetch ----------

export type TableGetter = () => Promise<MonthTable>;
const TTL_MS = 12 * 3600 * 1000;
let cache: { at: number; table: MonthTable } | null = null;
export function clearTableCache(): void {
  cache = null;
}

/** Pure: the workbook URL of a release page record (the .xlsx attachment). */
export function workbookUrl(page: unknown): string | null {
  const a = xlsxAttachments(page);
  return a.find((x) => /sea_fisheries_statistics/i.test(x.url))?.url ?? a[0]?.url ?? null;
}

export async function liveTable(now: Date = new Date()): Promise<MonthTable> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.table;
  let url: string | null = null;
  for (const slug of monthlySlugs(SLUG_PREFIX, now, 4)) {
    try {
      url = workbookUrl(await govukContent(`/government/statistics/${slug}`));
    } catch {
      url = null; // not published yet (404) or a hiccup: try the month before
    }
    if (url) break;
  }
  if (!url) throw new SourceError("Could not find the MMO monthly sea fisheries release on GOV.UK.");
  if (new URL(url).host !== "assets.publishing.service.gov.uk") throw new SourceError("The MMO release links to an unexpected host; this source needs updating.");
  const table = parseTable(readXlsx(await downloadFile(url, 15_000_000, 45000)));
  cache = { at: Date.now(), table };
  return table;
}

// ---------- the answer ----------

const gbp = (v: number) => fmtMoney(v, "GBP");
const round2 = (v: number) => Math.round(v * 100) / 100;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export function monthEnd(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function gbSeaFishMethod(): string {
  return (
    "United Kingdom (sea fish and shellfish): the Marine Management Organisation publishes, each month, the weight landed by UK vessels into all ports, the value paid to fishers and the price per tonne for each species. " +
    "We pass on the newest published month, converted to pounds per kilogram. It is the first-sale (landed) price paid to fishers, one published average per species, not a shop or market price, and no range is calculated."
  );
}

export async function gbSeaFishPrices(q: { species: string; region?: string; baseUrl?: string }, get: TableGetter = liveTable): Promise<PriceAnswer> {
  const word = (q.species ?? "").trim();
  if (!word) throw new InputError("species is required, for example 'cod', 'haddock', 'mackerel', 'lobster' or 'scallops'.");
  const def = matchSpecies(word);
  const query = { country: "GB", species: word, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "GBP", method: gbSeaFishMethod(), baseUrl: q.baseUrl };
  const empty = { value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" };
  if (!def) {
    const none = buildStatisticAnswer({ ...base, ...empty });
    return { ...none, summary: `The MMO's landings table has no species "${word}". Try one of: ${exampleSpecies(30)}.`, extra: { available_species: SPECIES.map((s) => s.words[0]) } };
  }
  const table = await get();
  const now = speciesPrice(table, def.label);
  if (!now) {
    const none = buildStatisticAnswer({ ...base, ...empty });
    return {
      ...none,
      summary: `The MMO publishes no landed price for ${def.name} in ${monthWords(table.month)}: no landings were recorded for it that month. Try another species or a group such as 'demersal', 'pelagic' or 'shellfish'.`,
      extra: { reference_month: table.month.slice(0, 7) },
    };
  }
  const regionNote = q.region && !/^(uk|united kingdom|gb|great britain|britain)$/i.test(q.region.trim()) ? `The MMO figure covers all UK vessels and ports: '${q.region}' is answered with the UK figure.` : undefined;
  const notes = [
    `A monthly average landed price: what fishers were paid at first sale for ${def.name} in ${monthWords(table.month)}, from the MMO's table of UK vessels' landings into all ports (value divided by weight, converted from pounds per tonne). Not a shop, restaurant or market price, not a single sale; provisional and revised later.`,
  ];
  if (regionNote) notes.push(regionNote);
  const perKg = round2(now.perKg);
  return buildStatisticAnswer({
    ...base,
    value: perKg,
    unit: "per kg",
    period: { from: table.month, to: monthEnd(table.month) },
    reference_period: table.month.slice(0, 7),
    note: notes.join(" "),
    describe: (v) =>
      `UK fishers were paid on average ${gbp(v)} per kg for ${def.name} in ${monthWords(table.month)} (landed price at first sale: ${Math.round(now.tonnes).toLocaleString("en-GB")} tonnes landed for ${gbp(Math.round(now.valueGbp))}). ` +
      "A monthly average for the whole UK, not a shop or market price.",
    extra: {
      species: def.label,
      species_group: def.group === "All" ? null : def.group,
      price_per_tonne_gbp: Math.round(now.perKg * 1000),
      landed_tonnes: Math.round(now.tonnes * 10) / 10,
      landed_value_gbp: Math.round(now.valueGbp),
      reference_month: table.month.slice(0, 7),
    },
  });
}

// ---------- daily library copy (stale-if-error and history) ----------

/** Pure: one library row per species with a published price for the newest month (n is NO_COUNT: one published average). */
export function harvestRows(t: MonthTable): HarvestResult {
  const rows: DailyRow[] = [];
  for (const sp of SPECIES) {
    const p = speciesPrice(t, sp.label);
    if (!p) continue;
    const v = round2(p.perKg);
    rows.push({ area: NATIONAL, item: sp.label, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  }
  if (!rows.length) throw new SourceError("The MMO table held no landed price for the month.");
  return {
    date: monthEnd(t.month),
    currency: "GBP",
    unit: "per kg",
    rows,
    note: `MMO UK Sea Fisheries Statistics, ${monthWords(t.month)} (provisional): landed price per kg, one published UK average per species, not counts of sales (no count is published).`,
  };
}

export async function gbSeaFishHarvest(get: TableGetter = async () => {
  clearTableCache();
  return liveTable();
}): Promise<HarvestResult> {
  return harvestRows(await get());
}

/** Where a request lives in the library, without asking GOV.UK. */
export function gbSeaFishHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const def = matchSpecies(String(p.product ?? ""));
  return def ? { area: NATIONAL, item: def.label, label: `United Kingdom, ${def.name} (landed price)` } : null;
}
