// DE wholesale fruit and vegetables: BLE (Bundesanstalt fuer Landwirtschaft und Ernaehrung) "Markt- und Preisbericht Obst und Gemuese",
// weekly wholesale market report, open data on open-data.ble.de (CKAN datastore, key-free).
// Format checked 2026-10-22 from GitHub's servers (probe):
//   GET https://open-data.ble.de/api/3/action/datastore_search?resource_id=d92b81a6-af6a-482f-b1bc-0a7138bf11d1&limit=500
//       &filters={"Woche (KW)":"202642","Verkaufsgebiet":"Deutschland"}
// = 200 JSON, 304 records for week 42 of 2026 (317 for week 41). Fields (all text): Nummerierung, Woche (KW), Herkunftsland, Produktgruppe,
// Produkt, Grosse, Verkaufsgebiet (Deutschland | Hamburg | Berlin | Muenchen | Frankfurt), Einheit ("€ /100 kg"), Wert ("244", "1.200").
// "Woche (KW)" is year + ISO week number WITHOUT zero padding: "202642" = 2026 week 42, "20265" = 2026 week 5.
// Row order in the table is not chronological, so the newest week is found by asking for the weeks one by one.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const SITE = "https://open-data.ble.de";
export const RESOURCE_ID = "d92b81a6-af6a-482f-b1bc-0a7138bf11d1";
export const PAGE_URL = "https://open-data.ble.de/dataset/markt-und-preisbericht-obst-und-gemuese";
export const LICENCE_URL = "https://www.govdata.de/dl-de/zero-2-0";

export const INFO: SourceInfo = {
  id: "de-ble-wholesale",
  country: "DE",
  category: "wholesale-fresh-food (fruit and vegetables at the wholesale markets)",
  name: "BLE: weekly market and price report for fruit and vegetables",
  publisher: "Bundesanstalt für Landwirtschaft und Ernährung (BLE), German federal government",
  what_is_recorded:
    "For each fruit or vegetable by country of origin, variety and size, the wholesale price in euro per 100 kg that the BLE reports each week from the German wholesale markets (national figure, and for Hamburg, Berlin, Munich and Frankfurt).",
  price_type: "posted_price",
  freshness: "Weekly (calendar week); each answer states the week its price applies to",
  licence: "Datenlizenz Deutschland – Zero – Version 2.0 (dl-de/zero-2-0)",
  licence_url: LICENCE_URL,
  attribution: "Source: Bundesanstalt für Landwirtschaft und Ernährung (BLE), Markt- und Preisbericht Obst und Gemüse, open-data.ble.de (Datenlizenz Deutschland – Zero – Version 2.0).",
  homepage: PAGE_URL,
  limits:
    "Wholesale market quotations reported by the BLE, not shop prices, not individual sales and not paid prices; the BLE gives no number of transactions. " +
    "One quotation per origin, variety and size, so the headline is the median of the quotations for the product that week, not a price for one lot. The BLE may change or withdraw the file.",
};

export const METHOD =
  "German wholesale fruit and vegetables: for the newest calendar week that the BLE has published, we take every national quotation (Verkaufsgebiet Deutschland) for the product, " +
  "convert euro per 100 kg to euro per kg, and report the median of those quotations with the cheapest and dearest one. " +
  "A quotation is the BLE's weekly wholesale price for one origin, variety and size, so the median is a middle quotation, not a list of sales; no sample size is given. " +
  "The change on the previous week compares the same calculation for that week.";

// ---------- parsing ----------

export interface Quote {
  week: string; // "202642"
  origin: string; // Herkunftsland
  group: string; // Produktgruppe, e.g. Äpfel
  variety: string; // Produkt, e.g. Elstar ("" when the file has "/")
  size: string; // Grosse ("" when "/")
  eurPerKg: number;
}

/** "1.200" -> 1200, "244" -> 244, "95,5" -> 95.5. null when it is not a number. */
export function parseWert(s: unknown): number | null {
  const t = String(s ?? "").trim();
  if (!t || t === "/" || t === "-") return null;
  const n = /,/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "")) : Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const clean = (s: unknown) => {
  const t = String(s ?? "").trim();
  return t === "/" ? "" : t;
};

/** Quotations from a datastore_search answer. Throws SourceError when the layout has changed. */
export function parseQuotes(json: any): Quote[] {
  const records = json?.result?.records;
  if (!json?.success || !Array.isArray(records)) throw new SourceError("The BLE open-data service answered in an unexpected format; this source needs updating.");
  const out: Quote[] = [];
  for (const r of records) {
    if (r?.Verkaufsgebiet !== "Deutschland") continue;
    if (String(r?.Einheit ?? "").replace(/\s+/g, "") !== "€/100kg") continue;
    const w = parseWert(r.Wert);
    const group = clean(r.Produktgruppe);
    if (w === null || !group) continue;
    out.push({ week: String(r["Woche (KW)"] ?? ""), origin: clean(r.Herkunftsland), group, variety: clean(r.Produkt), size: clean(r.Grosse), eurPerKg: w / 100 });
  }
  if (records.length && !out.length) throw new SourceError("The BLE price file had no usable national quotations; this source needs updating.");
  return out;
}

/** "202642" -> the Monday of ISO week 42 of 2026 ("2026-10-12"); null for anything else. */
export function weekMonday(code: string): string | null {
  const m = /^(20\d{2})(\d{1,2})$/.exec(code);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(Date.UTC(year, 0, 4 - (dow - 1) + (week - 1) * 7));
  return monday.toISOString().slice(0, 10);
}

/** The ISO week code of a date in the file's format: 2026-10-22 -> "202643". */
export function weekCodeOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}${week}`;
}

/** The previous week's code ("202642" -> "202641", "20261" -> "202552"). */
export function previousWeekCode(code: string): string | null {
  const monday = weekMonday(code);
  if (!monday) return null;
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return weekCodeOf(d);
}

// ---------- matching ----------

const fold = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** English and common German words -> the BLE Produktgruppe(s) (folded). */
const ALIASES: Record<string, string[]> = {
  apple: ["aepfel"], apples: ["aepfel"], apfel: ["aepfel"], aepfel: ["aepfel"],
  pear: ["birnen"], pears: ["birnen"], birne: ["birnen"], birnen: ["birnen"],
  cucumber: ["gurken"], cucumbers: ["gurken"], gurke: ["gurken"], gurken: ["gurken"],
  tomato: ["tomaten"], tomatoes: ["tomaten"], tomate: ["tomaten"], tomaten: ["tomaten"],
  pepper: ["gemuesepaprika"], peppers: ["gemuesepaprika"], paprika: ["gemuesepaprika"], "bell pepper": ["gemuesepaprika"], capsicum: ["gemuesepaprika"],
  grape: ["tafeltrauben"], grapes: ["tafeltrauben"], trauben: ["tafeltrauben"], tafeltrauben: ["tafeltrauben"],
  kiwi: ["kiwis", "kiwi gold"], kiwis: ["kiwis", "kiwi gold"], kiwifruit: ["kiwis", "kiwi gold"],
  plum: ["zwetschgen", "pflaumen"], plums: ["zwetschgen", "pflaumen"], zwetschgen: ["zwetschgen"], pflaumen: ["pflaumen"],
  lemon: ["zitronen"], lemons: ["zitronen"], zitronen: ["zitronen"],
  zucchini: ["zucchini"], courgette: ["zucchini"], courgettes: ["zucchini"],
  orange: ["orangen"], oranges: ["orangen"], orangen: ["orangen"],
  mandarin: ["mandarinen", "clementinen", "satsumas"], mandarins: ["mandarinen", "clementinen", "satsumas"], tangerine: ["mandarinen", "clementinen", "satsumas"], mandarinen: ["mandarinen"],
  clementine: ["clementinen"], clementines: ["clementinen"], clementinen: ["clementinen"],
  satsuma: ["satsumas"], satsumas: ["satsumas"],
  onion: ["zwiebeln"], onions: ["zwiebeln"], zwiebel: ["zwiebeln"], zwiebeln: ["zwiebeln"],
  aubergine: ["auberginen"], aubergines: ["auberginen"], eggplant: ["auberginen"], auberginen: ["auberginen"],
  strawberry: ["erdbeeren"], strawberries: ["erdbeeren"], erdbeeren: ["erdbeeren"],
  cauliflower: ["blumenkohl"], blumenkohl: ["blumenkohl"],
  carrot: ["moehren"], carrots: ["moehren"], moehren: ["moehren"], karotten: ["moehren"],
  peach: ["pfirsiche"], peaches: ["pfirsiche"], pfirsiche: ["pfirsiche"],
  nectarine: ["nektarinen"], nectarines: ["nektarinen"], nektarinen: ["nektarinen"],
  banana: ["bananen"], bananas: ["bananen"], bananen: ["bananen"],
  "iceberg lettuce": ["eissalat"], iceberg: ["eissalat"], eissalat: ["eissalat"],
  lettuce: ["kopfsalat", "eissalat", "bunte salate", "endivien"], salad: ["kopfsalat", "eissalat", "bunte salate", "endivien"], kopfsalat: ["kopfsalat"],
  "brussels sprouts": ["rosenkohl"], sprouts: ["rosenkohl"], rosenkohl: ["rosenkohl"],
  leek: ["lauch"], leeks: ["lauch"], lauch: ["lauch"], porree: ["lauch"],
  endive: ["endivien"], endives: ["endivien"], endivien: ["endivien"],
  cherry: ["kirschen"], cherries: ["kirschen"], kirschen: ["kirschen"],
};

/** Names the BLE uses, in English, for the help text. */
export function productHelp(quotes: Quote[]): string {
  return [...new Set(quotes.map((q) => q.group))].sort((a, b) => a.localeCompare(b, "de")).join(", ");
}

/** Quotations for what was asked: through the alias list first, then by any word of the BLE's own product name or variety. */
export function matchQuotes(quotes: Quote[], asked: string): Quote[] {
  const a = fold(asked);
  if (!a) return [];
  const groups = ALIASES[a];
  if (groups) return quotes.filter((q) => groups.includes(fold(q.group)));
  const words = a.split(" ");
  const byGroup = quotes.filter((q) => words.every((w) => fold(q.group).split(" ").includes(w)));
  if (byGroup.length) return byGroup;
  // a variety such as "elstar" or "cox orange": every word must be in the product group + variety text
  return quotes.filter((q) => {
    const hay = fold(`${q.group} ${q.variety}`).split(" ");
    return words.every((w) => hay.includes(w));
  });
}

// ---------- statistics ----------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function medianOf(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- answer ----------

export interface WeekQuotes {
  week: string;
  quotes: Quote[];
}

export function deWholesaleFromWeeks(latest: WeekQuotes, previous: WeekQuotes | null, input: { product?: string; baseUrl?: string }): PriceAnswer {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'apples', 'tomatoes', 'cucumbers' or 'carrots'.");
  const found = matchQuotes(latest.quotes, asked);
  const monday = weekMonday(latest.week);
  const base = { source: INFO, query: { country: "DE", product: asked }, currency: "EUR", method: METHOD, baseUrl: input.baseUrl };
  if (!found.length) {
    return buildStatisticAnswer({
      ...base, value: null, measure: "median", unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "",
      extra: { note: `No German wholesale quotation for '${asked}' in the BLE's report for week ${latest.week.slice(4)} of ${latest.week.slice(0, 4)}. The report covers: ${productHelp(latest.quotes)}.` },
    });
  }
  const prices = found.map((q) => q.eurPerKg);
  const value = r3(medianOf(prices));
  const min = r3(Math.min(...prices));
  const max = r3(Math.max(...prices));
  const prevFound = previous ? matchQuotes(previous.quotes, asked) : [];
  const prevMedian = prevFound.length ? r3(medianOf(prevFound.map((q) => q.eurPerKg))) : null;
  const changePct = prevMedian ? Math.round(((value - prevMedian) / prevMedian) * 1000) / 10 : null;
  const groups = [...new Set(found.map((q) => q.group))];
  const name = groups.length === 1 ? groups[0] : asked;
  const weekNo = latest.week.slice(4);
  const year = latest.week.slice(0, 4);
  const quotationsList = [...found]
    .sort((a, b) => a.eurPerKg - b.eurPerKg)
    .slice(0, 40)
    .map((q) => ({ origin: q.origin, variety: q.variety, size: q.size, eur_per_kg: r3(q.eurPerKg) }));
  return buildStatisticAnswer({
    ...base,
    query: { country: "DE", product: asked, item: name },
    value,
    measure: "median",
    unit: "per kg",
    min: found.length > 1 ? min : null,
    max: found.length > 1 ? max : null,
    period: { from: monday, to: monday ? new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10) : null },
    reference_period: `${year}-KW${weekNo}`,
    describe: (x) =>
      `Wholesale ${name} in Germany: median €${x} per kg across ${found.length} national BLE quotation${found.length === 1 ? "" : "s"}` +
      (found.length > 1 ? ` (from €${min} to €${max})` : "") + `, calendar week ${weekNo} of ${year}.`,
    note:
      "Median of the BLE's weekly national wholesale quotations (one per origin, variety and size): a quoted wholesale-market price, not a shop price and not a paid price. " +
      "Quotations are not weighted by volume.",
    extra: {
      item: name,
      quotations: found.length,
      week: latest.week,
      iso_week: `${year}-W${weekNo.padStart(2, "0")}`,
      previous_week_median_eur_per_kg: prevMedian,
      change_on_previous_week_percent: changePct,
      origins: [...new Set(found.map((q) => q.origin).filter(Boolean))],
      cheapest_to_dearest: quotationsList,
      price_basis: "posted (quoted) wholesale price, EUR per 100 kg converted to per kg",
      market: "German wholesale markets, national figure (Verkaufsgebiet Deutschland)",
    },
  });
}

// ---------- fetching ----------

async function getJson(url: string, timeoutMs = 25000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", accept: "application/json" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return JSON.parse(await res.text());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    if (err instanceof SyntaxError) throw new SourceError("The BLE open-data service did not return JSON.");
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export function weekUrl(week: string): string {
  const filters = JSON.stringify({ "Woche (KW)": week, Verkaufsgebiet: "Deutschland" });
  return `${SITE}/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=1000&filters=${encodeURIComponent(filters)}`;
}

type WeekFetcher = (week: string) => Promise<Quote[]>;

const fetchWeek: WeekFetcher = async (week) => parseQuotes(await getJson(weekUrl(week)));

/** The newest week with national quotations, looking back from `now` (the BLE report appears in the week after, and some weeks are skipped). */
export async function newestWeeks(now: Date, get: WeekFetcher = fetchWeek, maxLookBack = 8): Promise<{ latest: WeekQuotes; previous: WeekQuotes | null }> {
  let code: string | null = weekCodeOf(now);
  let latest: WeekQuotes | null = null;
  for (let i = 0; i < maxLookBack && code; i++) {
    const quotes = await get(code);
    if (quotes.length) {
      latest = { week: code, quotes };
      break;
    }
    code = previousWeekCode(code);
  }
  if (!latest) throw new SourceError("The BLE price report had no quotations for the last eight weeks; the source may have stopped publishing.");
  const prevCode = previousWeekCode(latest.week);
  let previous: WeekQuotes | null = null;
  if (prevCode) {
    try {
      const q = await get(prevCode);
      if (q.length) previous = { week: prevCode, quotes: q };
    } catch {
      previous = null; // the comparison is optional
    }
  }
  return { latest, previous };
}

let cache: { at: number; value: { latest: WeekQuotes; previous: WeekQuotes | null } } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

export async function deWholesale(input: { product?: string; baseUrl?: string }, get: WeekFetcher = fetchWeek, now: Date = new Date()): Promise<PriceAnswer> {
  if (!input.product?.trim()) throw new InputError("product is required, for example 'apples', 'tomatoes', 'cucumbers' or 'carrots'.");
  let value: { latest: WeekQuotes; previous: WeekQuotes | null };
  if (get === fetchWeek && cache && Date.now() - cache.at < CACHE_MS) value = cache.value;
  else {
    value = await newestWeeks(now, get);
    if (get === fetchWeek) cache = { at: Date.now(), value };
  }
  return deWholesaleFromWeeks(value.latest, value.previous, input);
}
