// Australia: Meat & Livestock Australia (MLA) National Livestock Reporting Service saleyard indicators, read from the key-free
// MLA statistics API (https://api-mlastatistics.mla.com.au). Formats checked live on 2026-10-22 through the GitHub probe (see source.test.ts).
// /indicator lists 19 national indicators; /report/5?indicatorID=N&fromDate&toDate returns one row per calendar day:
// { calendar_date, species_id, indicator_id, indicator_desc, indicator_units, head_count, indicator_value }.
// An indicator is MLA's weighted average of prices paid for the animals sold at saleyard auctions that day (head_count animals).
// Weekends repeat Friday's row unchanged (carry-forward): those repeats are not new trading days and are skipped.
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";

export const API = "https://api-mlastatistics.mla.com.au";
export const ATTRIBUTION_LINE = "Reproduced courtesy of Meat & Livestock Australia Limited - www.mla.com.au";

export const INFO: SourceInfo = {
  id: "au-mla-livestock",
  country: "AU (Australia)",
  category: "wholesale fresh food (cattle and sheep saleyard auction indicators)",
  name: "National Livestock Reporting Service saleyard indicators (Meat & Livestock Australia)",
  publisher: "Meat & Livestock Australia (MLA), National Livestock Reporting Service",
  what_is_recorded:
    "For 19 national indicators (young cattle, feeder and restocker steers and heifers, heavy steers, cows, light, trade, heavy, Merino and restocker lambs, mutton, online sales) the weighted average price paid at Australian saleyard auctions each trading day, with the number of animals sold. Never one animal or one buyer.",
  price_type: "transaction",
  freshness: "Daily on trading days (MLA updates at midnight AEST); every answer states the trading day it describes",
  licence: "MLA Market Report and Information Terms of Use: non-exclusive, royalty-free licence to use, copy, reproduce, publish, distribute and commercialise the Data; attribution required",
  licence_url: "https://www.mla.com.au/general/Terms-and-conditions/data-and-information/",
  attribution: ATTRIBUTION_LINE,
  homepage: "https://www.mla.com.au/prices-markets/statistics/api",
  limits:
    "A weighted average of auction prices for one indicator on one day, published by MLA: not the price of a particular animal, farm or sale, not a futures price and not a retail meat price. Cattle indicators are cents per kilogram (carcase weight 'cwt' or live weight 'lwt' as the indicator says), the online indicators for lambs and sheep are dollars per head. National indicators only. MLA may change or withdraw the data on notice; MLA-only answers stay on the free tier.",
};

export interface Indicator {
  id: number;
  desc: string;
  units: string;
  species: "Cattle" | "Sheep";
  words: string[];
}
const I = (id: number, desc: string, units: string, species: "Cattle" | "Sheep", words: string): Indicator => ({ id, desc, units, species, words: words.split("|").map((w) => w.trim()) });

/** MLA's /indicator list on 2026-10-22. The first indicator that lists a word is the default for it. */
export const INDICATORS: Indicator[] = [
  I(0, "Eastern Young Cattle Indicator", "c/kg cwt", "Cattle", "cattle|beef cattle|young cattle|eastern young cattle|beef|slaughter cattle|eyci"),
  I(1, "Western Young Cattle Indicator", "c/kg cwt", "Cattle", "western young cattle|western cattle"),
  I(2, "National Restocker Yearling Steer Indicator", "c/kg lwt", "Cattle", "restocker steers|yearling steers|restocker yearling steer"),
  I(3, "National Feeder Steer Indicator", "c/kg lwt", "Cattle", "feeder steers|feeder cattle|feeder steer"),
  I(4, "National Heavy Steer Indicator", "c/kg lwt", "Cattle", "steers|heavy steers|heavy steer"),
  I(5, "National Heavy Dairy Cow Indicator", "c/kg lwt", "Cattle", "dairy cows|heavy dairy cow|dairy cow"),
  I(6, "National Light Lamb Indicator", "c/kg cwt", "Sheep", "light lamb|light lambs"),
  I(7, "National Trade Lamb Indicator", "c/kg cwt", "Sheep", "lamb|lambs|trade lamb|trade lambs"),
  I(8, "National Heavy Lamb Indicator", "c/kg cwt", "Sheep", "heavy lamb|heavy lambs"),
  I(9, "National Merino Lamb Indicator", "c/kg cwt", "Sheep", "merino lamb|merino lambs"),
  I(10, "National Restocker Lamb Indicator", "c/kg cwt", "Sheep", "restocker lamb|restocker lambs"),
  I(11, "National Mutton Indicator", "c/kg cwt", "Sheep", "mutton|sheep|ewes|adult sheep"),
  I(12, "National Restocker Yearling Heifer Indicator", "c/kg lwt", "Cattle", "restocker heifers|yearling heifers|heifers"),
  I(13, "National Processor Cow Indicator", "c/kg lwt", "Cattle", "cows|processor cows|cull cows|processor cow"),
  I(14, "National Young Cattle Indicator", "c/kg lwt", "Cattle", "national young cattle|young cattle live weight"),
  I(15, "Online Young Cattle Indicator", "c/kg lwt", "Cattle", "online cattle|online young cattle"),
  I(16, "Online Lamb Indicator", "$/head", "Sheep", "online lamb|online lambs"),
  I(17, "National Feeder Heifer Indicator", "c/kg lwt", "Cattle", "feeder heifers|feeder heifer"),
  I(18, "Online Sheep Indicator", "$/head", "Sheep", "online sheep"),
];

const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const exampleProducts = (max: number) =>
  INDICATORS.map((i) => i.words[0]).filter((w, i, a) => a.indexOf(w) === i).slice(0, max).join(", ");

export function matchIndicator(query: string): { primary: Indicator | null; related: Indicator[] } {
  const q = plain(query);
  if (!q) return { primary: null, related: [] };
  const has = (w: string) => INDICATORS.find((i) => i.words.map(plain).includes(w));
  let primary = has(q) ?? (q.endsWith("s") ? has(q.slice(0, -1)) : has(`${q}s`)) ?? INDICATORS.find((i) => plain(i.desc.replace(/ Indicator$/, "")) === q) ?? null;
  if (!primary) {
    let best: { i: Indicator; len: number } | null = null;
    for (const i of INDICATORS) {
      for (const w of i.words.map(plain)) {
        if (w.length >= 3 && ` ${q} `.includes(` ${w} `) && (!best || w.length > best.len)) best = { i, len: w.length };
      }
    }
    primary = best?.i ?? null;
  }
  if (!primary) return { primary: null, related: [] };
  const related = INDICATORS.filter((i) => i !== primary && i.species === primary!.species);
  return { primary, related };
}

// ---------- parsing ----------

export interface Reading {
  date: string;
  value: number;
  head: number;
  desc: string;
  units: string;
}

/** Pure: the usable trading days of a /report/5 reply, oldest first. A day is dropped when it repeats the previous day's value and head
 *  count exactly (weekend carry-forward), when its value is not a positive number, or when fewer than 5 animals stand behind it. */
export function parseReport(json: any): Reading[] {
  const data = Array.isArray(json?.data) ? json.data : null;
  if (!data) throw new SourceError("MLA returned an unexpected reply (no data list); this source needs updating.");
  const rows = data
    .map((r: any) => ({
      date: String(r.calendar_date ?? "").slice(0, 10),
      value: Number(r.indicator_value),
      head: Number(r.head_count),
      desc: String(r.indicator_desc ?? ""),
      units: String(r.indicator_units ?? ""),
    }))
    .filter((r: Reading) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a: Reading, b: Reading) => a.date.localeCompare(b.date));
  const out: Reading[] = [];
  let prev: Reading | null = null;
  for (const r of rows) {
    const repeat = prev && prev.value === r.value && prev.head === r.head;
    prev = r;
    if (repeat) continue;
    if (!Number.isFinite(r.value) || r.value <= 0 || !Number.isFinite(r.head) || r.head < 5) continue;
    out.push(r);
  }
  return out;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86400000);

export type Getter = (url: string) => Promise<any>;
const get: Getter = (url) => fetchJson(url, {}, 20000);

export async function readIndicator(ind: Indicator, today: Date, days: number, getter: Getter = get): Promise<Reading[]> {
  const url = `${API}/report/5?indicatorID=${ind.id}&fromDate=${isoDay(daysBefore(today, days))}&toDate=${isoDay(today)}`;
  return parseReport(await getter(url));
}

const cents = (v: number) => Math.round(v * 10) / 10;
/** MLA publishes cattle and sheep indicators in Australian CENTS per kg; answers and the library carry Australian DOLLARS so a figure
 *  labelled AUD is never 100 times too big (audit 22 Oct 2026: the lamb page showed "A$1,151" for 1,151 cents per kg). */
export const toAud = (v: number, units: string) => (units === "$/head" ? v : Math.round(v * 100) / 10000);
export const unitWords = (u: string) =>
  u === "c/kg cwt" ? "cents per kg carcase weight" : u === "c/kg lwt" ? "cents per kg live weight" : u === "$/head" ? "dollars per head" : u;
export const unitShort = (u: string) => (u === "c/kg cwt" ? "per kg carcase weight" : u === "c/kg lwt" ? "per kg live weight" : u === "$/head" ? "per head" : u);

const monthDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
};

export function buildLivestockAnswer(ind: Indicator, readings: Reading[], q: { product: string; region?: string }, today: Date, baseUrl?: string): PriceAnswer {
  const query = { country: "AU", product: q.product, ...(q.region ? { region: q.region } : {}) };
  const latest = readings[readings.length - 1];
  const dollars = ind.units === "$/head";
  const aud = (v: number) => toAud(v, ind.units);
  const money = (v: number) => fmtMoney(aud(v), "AUD") + (dollars ? "" : ` (${cents(v)} cents)`);
  const monthAgo = latest ? [...readings].reverse().find((r) => r.date <= isoDay(daysBefore(new Date(`${latest.date}T00:00:00Z`), 28))) : undefined;
  const change = latest && monthAgo ? { reference_date: monthAgo.date, value: aud(monthAgo.value), change_percent: Math.round(((latest.value - monthAgo.value) / monthAgo.value) * 1000) / 10 } : null;
  const age = latest ? Math.round((today.getTime() - new Date(`${latest.date}T00:00:00Z`).getTime()) / 86400000) : 0;
  const notes = [
    "MLA's weighted average of prices paid at saleyard auctions on one trading day; not one animal, not a futures price and not a retail meat price.",
    ...(q.region ? [`MLA publishes these as national indicators here, so the region "${q.region}" was not used; the answer is national.`] : []),
    ...(age > 10 ? [`Old data: the newest trading day MLA holds for this indicator is ${age} days old.`] : []),
  ];
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: latest ? aud(latest.value) : null,
    measure: "average",
    currency: "AUD",
    unit: unitShort(ind.units),
    period: latest ? { from: latest.date, to: latest.date } : { from: null, to: null },
    reference_period: latest ? latest.date : "",
    sample_size: latest ? latest.head : null,
    method:
      "Meat & Livestock Australia's National Livestock Reporting Service indicator: the weighted average price paid for the animals sold at Australian saleyard auctions on the trading day, with the number of animals sold. " +
      "We pass on the newest trading day (weekend repeats of Friday's figure are skipped), converted from MLA's cents per kg to Australian dollars per kg; the sample size is animals sold, not sales records. No range is calculated.",
    note: notes.join(" "),
    baseUrl,
    ending: `${ATTRIBUTION_LINE}.`,
    evidence: { label: "Published market indicator", meaning: "A weighted average of prices paid at saleyard auctions, calculated and published by Meat & Livestock Australia; the sample size is the number of animals sold." },
    describe: () =>
      `The ${ind.desc.replace(/ Indicator$/, "").toLowerCase()} averaged ${money(latest.value)} ${dollars ? "per head" : `per kg ${ind.units.endsWith("cwt") ? "carcase weight" : "live weight"}`} at Australian saleyards on ${monthDay(latest.date)}` +
      ` (${latest.head.toLocaleString("en-AU")} animals sold), as published by Meat & Livestock Australia.` +
      (change ? ` That is ${change.change_percent === 0 ? "unchanged" : `${Math.abs(change.change_percent)}% ${change.change_percent > 0 ? "higher" : "lower"}`} than on ${monthDay(change.reference_date)}.` : ""),
    extra: {
      country_name: "Australia",
      indicator: { id: ind.id, name: ind.desc, species: ind.species, published_units: ind.units, asked_for: q.product },
      published_value: latest?.value ?? null,
      ...(dollars ? {} : { aud_per_kg: Math.round(latest.value) / 100 }),
      animals_sold: latest?.head ?? null,
      trading_day: latest?.date ?? null,
      change_on_about_4_weeks_earlier: change,
      last_trading_days: readings.slice(-10).reverse().map((r) => ({ date: r.date, value: aud(r.value), animals_sold: r.head })),
      other_indicators_same_species: matchIndicator(q.product).related.map((r) => ({ product: r.words[0], indicator: r.desc })),
      what_this_is: "Daily weighted average of prices paid at Australian saleyard auctions, published by Meat & Livestock Australia. Not one animal, not a futures price and not a retail price.",
      attribution_notice: ATTRIBUTION_LINE,
    },
  });
}

export async function auLivestock(input: { product: string; region?: string; today?: Date; baseUrl?: string }, getter: Getter = get): Promise<PriceAnswer> {
  const text = input.product?.trim();
  if (!text) throw new InputError(`product is required: cattle or sheep in everyday words such as ${exampleProducts(8)}.`);
  const m = matchIndicator(text);
  const today = input.today ?? new Date();
  if (!m.primary) {
    throw new InputError(`Australia: no MLA saleyard indicator matches "${text}". Try one of: ${exampleProducts(30)}.`);
  }
  const readings = await readIndicator(m.primary, today, 45, getter);
  return buildLivestockAnswer(m.primary, readings, { product: text, region: input.region?.trim() || undefined }, today, input.baseUrl);
}

// ---------- daily copy (stale-if-error and history) ----------

// Item names carry "AUD" since 22 Oct 2026, when the library switched from MLA's cents to dollars, so no series mixes the two units.
export const livestockItem = (i: Indicator) => `${i.desc} (AUD ${unitShort(i.units)})`;

/** Pure: one library row per indicator for the newest trading day any indicator has; indicators that lag behind it are left out. Each row's n is the head count. */
export function livestockHarvestRows(all: { ind: Indicator; readings: Reading[] }[]): HarvestResult {
  const latest = all.filter((a) => a.readings.length).map((a) => ({ ind: a.ind, r: a.readings[a.readings.length - 1] }));
  if (!latest.length) throw new SourceError("MLA returned no usable saleyard indicator");
  const date = latest.map((l) => l.r.date).sort().pop()!;
  return {
    date,
    currency: "AUD",
    unit: "per kg (carcase or live weight) or per head",
    rows: latest
      .filter((l) => l.r.date === date)
      .map((l) => {
        const v = toAud(l.r.value, l.ind.units);
        return { area: "Australia", item: livestockItem(l.ind), n: l.r.head, median: v, low: v, high: v, min: v, max: v };
      }),
    note: "Meat & Livestock Australia NLRS saleyard indicators: weighted average auction prices for the trading day, in Australian dollars (converted from MLA's cents per kg); n is the number of animals sold.",
  };
}

export async function livestockHarvest(today: Date = new Date(), getter: Getter = get): Promise<HarvestResult> {
  const all: { ind: Indicator; readings: Reading[] }[] = [];
  for (const ind of INDICATORS) all.push({ ind, readings: await readIndicator(ind, today, 10, getter) });
  return livestockHarvestRows(all);
}

export function livestockHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const ind = matchIndicator(p.product ?? "").primary;
  return ind ? { area: "Australia", item: livestockItem(ind), label: ind.desc.replace(/ Indicator$/, "") } : null;
}
