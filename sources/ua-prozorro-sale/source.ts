// Ukrainian public asset sales (Prozorro.Sale): what state, municipal and bankrupt-estate assets (vehicles, equipment, real estate, land,
// farm produce) actually sold for at electronic auction. Open data of the Prozorro.Sale platform, free reuse including commercial, source link
// mandatory (https://prozorro.sale/opendata/, read 2026-10-24 by the Verifier).
// Format checked 2026-10-24 from GitHub's servers (probes uasale-e1..e3, plain GET, no key):
//   GET https://procedure.prozorro.sale/api/search/byDateModified/<ISO date>?limit=100 -> JSON array of FULL procedure objects (25-80 KB each),
//   header x-resultlength = rows returned. Next page: largest dateModified of the page + 1 ms. descending=1 answers 404.
//   A finished sale has status "complete", sellingMethod e.g. "commercialSell-english", "landArrested-priorityEnglish", "bankRuptcy-english",
//   contracts[0] = {status:"active", value:{amount:900000.0, currency:"UAH"}, dateSigned:"2026-06-19T04:04:47.000000Z"},
//   items[0] = {classification:{scheme:"CAV", id:"34000000-7"}, address:{region:{uk_UA:"Миколаївська область"}}, quantity, unit}.
//   Leases ("...Lease-...", "landRental-...") are rent, not a sale price: left out. procedure.value is the START price: never used.
// The objects hold owners, bidders, contact names, phones and e-mails. Only status, sellingMethod, the contract amount and date, the first
// item's classification code and region are ever read; nothing else is kept. The feed is far too big to walk per request, so harvest()
// reads it once a day and the library keeps aggregates only.
import { SourceError, InputError, fetchJson } from "../../lib/http";
import { summarise, MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ua-prozorro-sale",
  country: "UA (Ukraine)",
  category: "auctions (public asset sale prices)",
  name: "Prozorro.Sale: concluded sales of public and bankrupt-estate assets",
  publisher: "Prozorro.Sale (state enterprise operating the Ukrainian electronic auction system for public assets)",
  what_is_recorded:
    "One concluded sale of an asset (vehicle, equipment, real estate, land, farm produce) at an electronic auction, with the signed contract amount, signing date and region. Rentals are left out.",
  price_type: "transaction",
  freshness: "Daily collection of the newest 60 days of signed sale contracts",
  licence:
    "Prozorro.Sale open data: 'Будь-яка особа може вільно копіювати, публікувати, поширювати, використовувати, у тому числі в комерційних цілях ... з обов'язковим посиланням на джерело' (anyone may freely copy, publish, distribute and use it, including commercially, with a mandatory link to the source)",
  licence_url: "https://prozorro.sale/opendata/",
  attribution: "Source: Prozorro.Sale (prozorro.sale), open data. Aggregated by ProofPrice (changed: medians and percentiles only).",
  homepage: "https://prozorro.sale/opendata/",
  limits:
    "Contract amount in hryvnia (UAH) for the whole lot as signed; whether VAT is included differs by sale and is not stated per lot. One lot may hold several items or a large plot, so a median per lot is not a price per unit. Rentals and leases are left out. Groups come from the product code of the first item. Aggregates only, never a lot, a seller, a buyer or a place below region level.",
};

export const UA_EVIDENCE = {
  label: "Concluded public asset sales (signed contract amount)",
  meaning:
    "The contract amount signed after an electronic auction of a state, municipal or bankrupt-estate asset on Prozorro.Sale, in UAH for the whole lot. Not a start price and not a rent.",
};

// ---------- groups and regions ----------

export const GROUPS = ["vehicles", "machinery", "electronics", "furniture", "real-estate", "land", "farm-produce", "other", "any"] as const;
export type Group = (typeof GROUPS)[number];

/** CAV product code (first two digits) to a group. CAV follows the CPV: 34 transport equipment, 04 real estate, 06 land. */
export function groupOfCav(id: string | undefined | null): Group {
  const d = String(id ?? "").slice(0, 2);
  if (d === "34") return "vehicles";
  if (d === "16" || d === "42" || d === "43") return "machinery";
  if (d === "30" || d === "31" || d === "32" || d === "38") return "electronics";
  if (d === "39") return "furniture";
  if (d === "04") return "real-estate";
  if (d === "06") return "land";
  if (d === "03") return "farm-produce";
  return "other";
}

const GROUP_ALIASES: Record<string, Group> = {
  vehicle: "vehicles", car: "vehicles", cars: "vehicles", truck: "vehicles", trucks: "vehicles", tractor: "machinery", tractors: "machinery",
  machine: "machinery", equipment: "machinery", "heavy-equipment": "machinery", computers: "electronics", computer: "electronics", laptops: "electronics",
  "office-furniture": "furniture", building: "real-estate", buildings: "real-estate", property: "real-estate", premises: "real-estate",
  apartment: "real-estate", apartments: "real-estate", "real-estate": "real-estate", realty: "real-estate", plot: "land", plots: "land", farmland: "land",
  grain: "farm-produce", wheat: "farm-produce", crops: "farm-produce", all: "any", everything: "any",
};

export function groupFor(what: string): Group | null {
  const slug = what.toLowerCase().trim().replace(/[\s_&]+/g, "-");
  if ((GROUPS as readonly string[]).includes(slug)) return slug as Group;
  return GROUP_ALIASES[slug] ?? null;
}

/** Region key (English slug) by the Ukrainian stem of the oblast name. Kyiv city is its own key. */
const OBLASTS: [string, string, string][] = [
  ["вінницьк", "vinnytsia", "Vinnytsia"], ["волинськ", "volyn", "Volyn"], ["дніпропетровськ", "dnipropetrovsk", "Dnipropetrovsk"],
  ["донецьк", "donetsk", "Donetsk"], ["житомирськ", "zhytomyr", "Zhytomyr"], ["закарпатськ", "zakarpattia", "Zakarpattia"],
  ["запорізьк", "zaporizhzhia", "Zaporizhzhia"], ["івано-франківськ", "ivano-frankivsk", "Ivano-Frankivsk"], ["київськ", "kyiv-oblast", "Kyiv oblast"],
  ["кіровоградськ", "kirovohrad", "Kirovohrad"], ["луганськ", "luhansk", "Luhansk"], ["львівськ", "lviv", "Lviv"], ["миколаївськ", "mykolaiv", "Mykolaiv"],
  ["одеськ", "odesa", "Odesa"], ["полтавськ", "poltava", "Poltava"], ["рівненськ", "rivne", "Rivne"], ["сумськ", "sumy", "Sumy"],
  ["тернопільськ", "ternopil", "Ternopil"], ["харківськ", "kharkiv", "Kharkiv"], ["херсонськ", "kherson", "Kherson"], ["хмельницьк", "khmelnytskyi", "Khmelnytskyi"],
  ["черкаськ", "cherkasy", "Cherkasy"], ["чернівецьк", "chernivtsi", "Chernivtsi"], ["чернігівськ", "chernihiv", "Chernihiv"],
];
export const REGION_LABELS: Record<string, string> = { "kyiv-city": "Kyiv city", ...Object.fromEntries(OBLASTS.map(([, k, l]) => [k, l])) };

/** The region key of a Ukrainian region text from the feed ("Миколаївська область", "м. Київ"), or null. */
export function regionOfUk(text: string | undefined | null): string | null {
  const t = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(м\.?\s*)?київ$/.test(t) || t === "місто київ") return "kyiv-city";
  for (const [stem, key] of OBLASTS) if (t.startsWith(stem)) return key;
  return null;
}

/** A region typed by a caller (English name, with or without "oblast") to a key, or null. "Kyiv" alone means the city. */
export function regionFor(input: string | undefined): string | null {
  if (!input?.trim()) return null;
  const lower = input.toLowerCase();
  const oblast = /\b(oblast|region|province)\b/.test(lower);
  const slug = lower.replace(/\b(oblast|region|province|city)\b/g, " ").replace(/[\s_]+/g, " ").trim().replace(/ /g, "-");
  if (slug === "kyiv" || slug === "kiev") return oblast ? "kyiv-oblast" : "kyiv-city";
  const aliases: Record<string, string> = { kharkov: "kharkiv", lvov: "lviv", odessa: "odesa", dnipro: "dnipropetrovsk", khmelnitsky: "khmelnytskyi", zaporozhye: "zaporizhzhia", transcarpathia: "zakarpattia", "kyiv-oblast": "kyiv-oblast" };
  const k = aliases[slug] ?? slug;
  return k in REGION_LABELS && k !== "kyiv-city" ? k : null;
}

// ---------- one procedure to one sale ----------

export interface Sale {
  id: string;
  group: Group;
  region: string | null;
  date: string; // YYYY-MM-DD the contract was signed
  price: number; // UAH, whole lot
}

const RENT_RE = /lease|rent|оренд/i;

/** Pure. A finished sale (not a lease) with a signed UAH contract amount, or null. Reads nothing about people. */
export function saleOf(p: any): Sale | null {
  if (!p || p.status !== "complete") return null;
  const method = String(p.sellingMethod ?? "");
  if (!method || RENT_RE.test(method)) return null;
  const contracts = Array.isArray(p.contracts) ? p.contracts.filter((c: any) => c?.status === "active") : [];
  if (!contracts.length) return null;
  let price = 0;
  let date = "";
  for (const c of contracts) {
    const amount = Number(c?.value?.amount);
    const cur = String(c?.value?.currency ?? "UAH").toUpperCase();
    if (!(amount > 0) || cur !== "UAH") return null;
    price += amount;
    const d = String(c?.dateSigned ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > date) date = d;
  }
  if (!date || !(price > 0)) return null;
  const item = Array.isArray(p.items) ? p.items[0] : null;
  const id = String(p._id ?? p.auctionId ?? "");
  if (!id) return null;
  return { id, group: groupOfCav(item?.classification?.id), region: regionOfUk(item?.address?.region?.uk_UA), date, price };
}

/** Pure. Library rows: item = group (and "any"), area = region key or ALL; nothing under 5 sales; one sale counts once. */
export function dailyRows(sales: Iterable<Sale>, from: string, to: string): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (area: string, item: string, price: number) => {
    const k = `${area}\u0000${item}`;
    const g = groups.get(k);
    if (g) g.push(price);
    else groups.set(k, [price]);
  };
  const seen = new Set<string>();
  for (const s of sales) {
    if (s.date < from || s.date > to || seen.has(s.id)) continue;
    seen.add(s.id);
    for (const item of [s.group, "any"]) {
      add(NATIONAL, item, s.price);
      if (s.region) add(s.region, item, s.price);
    }
  }
  const rows: DailyRow[] = [];
  for (const [k, prices] of groups) {
    const [area, item] = k.split("\u0000");
    const s = summarise(prices);
    if (!s || s.count < MIN_PUBLISH) continue;
    rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

// ---------- the daily collector ----------

export const API = "https://procedure.prozorro.sale/api/search/byDateModified";
export const WINDOW_DAYS = 60;
export const PAGE_SIZE = 100;
export const TIME_BUDGET_MS = 8 * 60 * 1000; // the collector gives a source 10 minutes
const UA_HEADER = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const windowStart = (to: string, days = WINDOW_DAYS): string => new Date(Date.parse(to + "T00:00:00Z") - days * 86400000).toISOString().slice(0, 10);

/** Next page cursor: the largest dateModified of the page plus one millisecond (ISO, UTC). */
export function nextCursor(page: any[]): string | null {
  let max = "";
  for (const p of page) {
    const d = String(p?.dateModified ?? "");
    if (d > max) max = d;
  }
  const ms = Date.parse(max);
  return Number.isFinite(ms) ? new Date(ms + 1).toISOString() : null;
}

export type Getter = (url: string) => Promise<any>;
const httpGet: Getter = (url) => fetchJson(url, { headers: { "user-agent": UA_HEADER, accept: "application/json" } }, 90000);

export interface HarvestOptions {
  get?: Getter;
  budgetMs?: number;
  maxPages?: number;
}

export async function uaSaleHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const get = o.get ?? httpGet;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const maxPages = o.maxPages ?? 1500;
  let cursor: string | null = `${from}T00:00:00.000Z`;
  let pages = 0;
  let seenProcedures = 0;
  let reached = from;
  const sales = new Map<string, Sale>();
  while (cursor && pages < maxPages && Date.now() - started < budget) {
    const page = await get(`${API}/${cursor}?limit=${PAGE_SIZE}`);
    if (!Array.isArray(page)) throw new SourceError("Prozorro.Sale answered with something other than a list: the API may have changed");
    pages++;
    seenProcedures += page.length;
    for (const p of page) {
      const s = saleOf(p);
      if (s) sales.set(s.id, s);
    }
    if (page.length < PAGE_SIZE) {
      reached = to; // the end of the feed: everything up to now has been read
      cursor = null;
      break;
    }
    const next = nextCursor(page);
    if (!next || next <= cursor) throw new SourceError("Prozorro.Sale paging did not advance");
    reached = next.slice(0, 10);
    cursor = next;
  }
  if (!pages) throw new SourceError("Could not read Prozorro.Sale");
  // A window that stops before today would be a shorter period than the answer claims: refuse it (the last good copy stays).
  if (reached < windowStart(to, 2)) {
    throw new SourceError(`Prozorro.Sale read only up to ${reached} in ${pages} pages and ${Math.round((Date.now() - started) / 1000)} s: not publishing a partial window`);
  }
  if (!seenProcedures) throw new SourceError("Prozorro.Sale held no procedures in the window");
  const rows = dailyRows(sales.values(), from, to);
  if (!rows.length) throw new SourceError("Prozorro.Sale held no usable concluded sales in the window: the format may have changed");
  return {
    date: to,
    currency: "UAH",
    unit: "per lot",
    rows,
    note: `${seenProcedures} procedures read in ${pages} pages; ${sales.size} concluded sales (not leases) signed ${from} to ${to}.`,
  };
}

// ---------- the answer ----------

export interface UaSaleInput {
  what: string;
  state?: string;
  baseUrl?: string;
}

export const GROUP_LABEL: Record<Group, string> = {
  vehicles: "vehicles and transport equipment", machinery: "machinery and farm or industrial equipment", electronics: "electronics and electrical equipment",
  furniture: "furniture", "real-estate": "real estate (buildings and premises)", land: "land", "farm-produce": "farm produce", other: "other assets", any: "assets of all kinds",
};

export async function uaPublicSales(input: UaSaleInput): Promise<PriceAnswer> {
  const group = groupFor(input.what);
  if (!group) {
    throw new InputError(`Ukraine: "${input.what}" is not a group we summarise. Use one of: ${GROUPS.join(", ")} (or a word such as 'truck', 'building', 'land').`);
  }
  let region = NATIONAL;
  let regionLabel = "Ukraine";
  if (input.state?.trim()) {
    const k = regionFor(input.state);
    if (!k) throw new InputError(`Unknown Ukrainian region '${input.state}'. Use a region name such as ${Object.values(REGION_LABELS).slice(0, 6).join(", ")} ('Kyiv' alone means the city).`);
    region = k;
    regionLabel = REGION_LABELS[k];
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Ukrainian public asset sales have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === region && r.item === group);
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO,
      query: { country: "UA", what: group, ...(region !== NATIONAL ? { state: regionLabel } : {}) },
      summary: null, currency: "UAH", unit: "per lot", period: { from, to: day.date },
      method: "Concluded asset sales on Prozorro.Sale in the newest 60 days.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} concluded ${group} sales in ${regionLabel} in the newest 60 days`, newest_collection: day.date },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} concluded sales of ${GROUP_LABEL[group]} are recorded in ${regionLabel} for ${from} to ${day.date}, so no price range is published. Try the group 'any' or leave out the region.`;
    return a;
  }
  return buildAnswer({
    source: INFO,
    query: { country: "UA", what: group, ...(region !== NATIONAL ? { state: regionLabel } : {}) },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "UAH",
    unit: "per lot",
    period: { from, to: day.date },
    method:
      `Median and 10th–90th percentile of the signed contract amount on concluded Prozorro.Sale auctions of state, municipal and bankrupt-estate assets (${GROUP_LABEL[group]}, ${regionLabel}) signed ${from} to ${day.date}. ` +
      "Rentals and leases are left out; start prices are never used. The amount is for the whole lot, so it is not a price per unit or per square metre. No range under 5 sales.",
    describe: (s) =>
      `Concluded Prozorro.Sale auctions of ${GROUP_LABEL[group]} in ${regionLabel} closed at a median of ${fmtMoney(s.median, "UAH")} per lot ` +
      `(10th–90th percentile ${fmtMoney(s.low, "UAH")} to ${fmtMoney(s.high, "UAH")}); public and bankrupt-estate assets, not retail prices; VAT treatment varies by sale.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "signed contract amount for the whole lot after an electronic auction (not a start price, not rent)", newest_collection: day.date },
    evidence: UA_EVIDENCE,
  });
}
