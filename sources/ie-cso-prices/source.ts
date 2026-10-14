// Ireland: average prices of selected consumer items, from the Central Statistics Office (CSO) PxStat table CPM12
// ("National Average Price"). Format checked live on 2026-10-14 through the GitHub probe.
// One JSON-stat request per answer (the whole table is about 90 KB: 76 items x 178 months), no bulk download, no key.
//
// What the CSO publishes: for each of ~76 standard consumer items (a 2 litre carton of full-fat milk, an 800 g sliced pan,
// half a dozen large eggs ...) the national average shelf price each month, calculated from the prices its price collectors
// record in shops for the Consumer Price Index. One figure per item and month: no distribution, no number of quotes. So the
// answer is an official statistic: value + measure "average", range fields null, sample_size null.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { fetchJsonStat, JsonStatTable, periodRange } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "ie-cso-prices",
  country: "IE (Ireland)",
  category: "groceries (average shop prices of selected consumer items)",
  name: "National Average Price of selected consumer items (PxStat table CPM12), Consumer Price Index",
  publisher: "Central Statistics Office (CSO), Ireland",
  what_is_recorded:
    "For about 76 standard consumer items (groceries, drinks, a few services), the national average shop price each month, calculated by the CSO from the shelf prices " +
    "its price collectors record in shops for the Consumer Price Index. One published average per item and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly, published with the Consumer Price Index (usually the second week of the following month); each answer states its reference month",
  licence:
    "Creative Commons Attribution 4.0 (CC BY 4.0). The CSO states: \"Statistical information on this website is accessible free of charge and licensed under Creative Commons Attribution (CC BY 4.0).\"",
  licence_url: "https://www.cso.ie/en/aboutus/whoweare/copyrightpolicy/",
  attribution:
    "Source: Central Statistics Office, Ireland, PxStat table CPM12 'National Average Price' (average prices of selected consumer items, Consumer Price Index), https://data.cso.ie/table/CPM12. " +
    "Licensed under CC BY 4.0. Prices are passed on as published; the change on a year earlier is calculated by ProofPrice.",
  homepage: "https://data.cso.ie/table/CPM12",
  limits:
    "National averages only (no regional prices), for the CSO's standard items and pack sizes; the CSO does not say how many price quotes stand behind an average. " +
    "These are shop shelf prices recorded for the Consumer Price Index, not receipts, and not the price at any one shop or online. " +
    "The CSO covers about 76 items: there is no coffee, no mince and no breakfast cereal, for example. A few items have gaps in some months.",
};

export const CPM12_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CPM12/JSON-stat/2.0/en";
export const TABLE_CODE = "CPM12";

// ---------- the items: everyday words -> CSO item codes ----------

/** CSO item codes of CPM12 with our plain definitions. The first definition that lists a word is the default for that word. */
export const ITEMS: ItemDef[] = [
  { code: "10630", label: "Full-fat milk, per 2 litres", unit: "per 2 litres", words: ["milk", "whole milk", "full fat milk", "full-fat milk", "fresh milk", "2 litre milk", "2l milk", "cow's milk"] },
  { code: "10640", label: "Low-fat milk, per litre", unit: "per litre", words: ["low fat milk", "low-fat milk", "skimmed milk", "semi skimmed milk", "skim milk", "light milk", "1 litre milk", "1l milk"] },
  { code: "10040", label: "White sliced pan bread, large (800 g)", unit: "per 800 g loaf", words: ["bread", "white bread", "sliced bread", "white sliced bread", "white loaf", "loaf", "pan bread"] },
  { code: "10050", label: "Brown sliced pan bread, large (800 g)", unit: "per 800 g loaf", words: ["brown bread", "wholemeal bread", "brown sliced bread", "brown loaf"] },
  { code: "10730", label: "Large eggs, per half dozen", unit: "per 6 eggs", words: ["eggs", "egg", "large eggs", "half dozen eggs", "6 eggs"] },
  { code: "10740", label: "Medium eggs, per half dozen", unit: "per 6 eggs", words: ["medium eggs", "medium egg"] },
  { code: "10750", label: "Butter, per lb (454 g)", unit: "per lb (454 g)", words: ["butter"] },
  { code: "10680", label: "Irish cheddar cheese, per kg", unit: "per kg", words: ["cheese", "cheddar", "cheddar cheese", "irish cheddar"] },
  { code: "10370", label: "Uncooked chicken, medium size whole bird (1.6 kg)", unit: "per 1.6 kg whole chicken", words: ["chicken", "whole chicken", "fresh chicken", "roast chicken"] },
  { code: "10310", label: "Beef, sliced or diced pieces, per kg", unit: "per kg", words: ["beef", "diced beef", "stewing beef", "beef pieces"] },
  { code: "10280", label: "Sirloin steak, per kg", unit: "per kg", words: ["steak", "sirloin steak", "sirloin"] },
  { code: "10290", label: "Striploin steak, per kg", unit: "per kg", words: ["striploin steak", "striploin"] },
  { code: "10300", label: "Roast beef (topside or rib), per kg", unit: "per kg", words: ["roast beef", "beef roast", "topside"] },
  { code: "10320", label: "Pork loin chops, per kg", unit: "per kg", words: ["pork", "pork chops", "pork chop"] },
  { code: "10330", label: "Pork steak, per kg", unit: "per kg", words: ["pork steak"] },
  { code: "10340", label: "Lamb, whole or half leg, per kg", unit: "per kg", words: ["lamb", "leg of lamb", "lamb leg"] },
  { code: "10350", label: "Lamb loin chops, per kg", unit: "per kg", words: ["lamb chops", "lamb chop", "lamb loin chops"] },
  { code: "10360", label: "Lamb gigot chops, per kg", unit: "per kg", words: ["gigot chops", "lamb gigot chops"] },
  { code: "10400", label: "Lamb's liver, per kg", unit: "per kg", words: ["lamb's liver", "liver"] },
  { code: "10410", label: "Ham fillet, per kg", unit: "per kg", words: ["ham", "ham fillet"] },
  { code: "10420", label: "Cooked ham, per kg", unit: "per kg", words: ["cooked ham", "sliced ham"] },
  { code: "10440", label: "Best back rashers, per kg", unit: "per kg", words: ["bacon", "rashers", "back rashers", "back bacon"] },
  { code: "10450", label: "Pork sausages, per kg", unit: "per kg", words: ["sausages", "sausage", "pork sausages"] },
  { code: "10540", label: "Fresh salmon, per kg", unit: "per kg", words: ["salmon", "fresh salmon"] },
  { code: "10590", label: "Smoked salmon, per kg", unit: "per kg", words: ["smoked salmon"] },
  { code: "10530", label: "Fresh fillet of cod, per kg", unit: "per kg", words: ["cod", "fish", "cod fillet", "white fish"] },
  { code: "10520", label: "Fresh fillet of whiting, per kg", unit: "per kg", words: ["whiting"] },
  { code: "10550", label: "Fresh fillet of plaice, per kg", unit: "per kg", words: ["plaice"] },
  { code: "10570", label: "Fresh hake, per kg", unit: "per kg", words: ["hake"] },
  { code: "10850", label: "Bananas, per kg", unit: "per kg", words: ["bananas", "banana"] },
  { code: "10840", label: "Grapes, per kg", unit: "per kg", words: ["grapes", "grape"] },
  { code: "10910", label: "Tomatoes, per kg", unit: "per kg", words: ["tomatoes", "tomato"] },
  { code: "11040", label: "Tinned tomatoes, per 400 g", unit: "per 400 g tin", words: ["tinned tomatoes", "canned tomatoes", "chopped tomatoes"] },
  { code: "10920", label: "Onions, per kg", unit: "per kg", words: ["onions", "onion"] },
  { code: "10940", label: "Broccoli, per kg", unit: "per kg", words: ["broccoli"] },
  { code: "10950", label: "Carrots, per kg", unit: "per kg", words: ["carrots", "carrot"] },
  { code: "10960", label: "Mushrooms, per kg", unit: "per kg", words: ["mushrooms", "mushroom"] },
  { code: "11090", label: "Potatoes, 2.5 kg bag", unit: "per 2.5 kg bag", words: ["potatoes", "potato", "2.5kg potatoes"] },
  { code: "11095", label: "Potatoes, 7.5 kg bag", unit: "per 7.5 kg bag", words: ["7.5kg potatoes", "big bag of potatoes"] },
  { code: "11100", label: "Potatoes, 10 kg bag", unit: "per 10 kg bag", words: ["10kg potatoes"] },
  { code: "10190", label: "Spaghetti, per 500 g", unit: "per 500 g", words: ["pasta", "spaghetti"] },
  { code: "10020", label: "Self-raising flour (white), per 2 kg", unit: "per 2 kg", words: ["flour", "self raising flour", "white flour"] },
  { code: "10030", label: "Wholemeal flour (brown), per 2 kg", unit: "per 2 kg", words: ["wholemeal flour", "brown flour"] },
  { code: "11150", label: "White granulated sugar, per kg", unit: "per kg", words: ["sugar", "white sugar", "granulated sugar"] },
  { code: "11570", label: "Tea bags, pack of 80", unit: "per 80 tea bags", words: ["tea", "tea bags", "teabags"] },
  { code: "11640", label: "Orange juice, per litre", unit: "per litre", words: ["orange juice", "juice"] },
  { code: "11160", label: "Jam, per lb (454 g)", unit: "per lb (454 g)", words: ["jam"] },
  { code: "11180", label: "Marmalade, per lb (454 g)", unit: "per lb (454 g)", words: ["marmalade"] },
  { code: "11760", label: "Lager, take-home (50 cl can)", unit: "per 50 cl can", words: ["beer", "lager", "can of lager", "lager can", "can of beer"] },
  { code: "11780", label: "Stout, take-home (50 cl can)", unit: "per 50 cl can", words: ["stout", "stout can", "guinness", "beer can"] },
  { code: "11740", label: "Cider, take-home (50 cl can)", unit: "per 50 cl can", words: ["cider"] },
  { code: "11730", label: "Wine, take-home (75 cl bottle)", unit: "per 75 cl bottle", words: ["wine", "bottle of wine", "red wine", "white wine", "table wine"] },
  { code: "11680", label: "Whiskey, take-home (70 cl bottle)", unit: "per 70 cl bottle", words: ["whiskey", "whisky"] },
  { code: "11700", label: "Vodka, take-home (70 cl bottle)", unit: "per 70 cl bottle", words: ["vodka"] },
  { code: "11690", label: "Brandy, take-home (70 cl bottle)", unit: "per 70 cl bottle", words: ["brandy"] },
  { code: "11710", label: "Cream liqueur, take-home (70 cl bottle)", unit: "per 70 cl bottle", words: ["cream liqueur", "baileys"] },
  { code: "11750", label: "Sherry, take-home (75 cl bottle)", unit: "per 75 cl bottle", words: ["sherry"] },
  { code: "12170", label: "Lager, draught in a bar (1 pint)", unit: "per pint", words: ["pint", "pint of lager", "pint of beer", "draught lager", "lager pint"] },
  { code: "12160", label: "Stout, draught in a bar (1 pint)", unit: "per pint", words: ["pint of stout", "pint of guinness", "guinness pint", "stout pint", "draught stout"] },
  { code: "12190", label: "Cider, draught in a bar (1 pint)", unit: "per pint", words: ["pint of cider", "cider pint"] },
  { code: "12200", label: "Ale, draught in a bar (1 pint)", unit: "per pint", words: ["pint of ale", "ale pint", "ale"] },
  { code: "12180", label: "Lager, bottle in a bar (33 cl)", unit: "per 33 cl bottle", words: ["bottle of lager in a bar", "bar bottle lager"] },
  { code: "12270", label: "Wine in a bar (187 ml bottle)", unit: "per 187 ml bottle", words: ["glass of wine", "wine in a bar", "bar wine", "pub wine"] },
];

// ---------- reading the table (pure) ----------

export interface MonthValue {
  /** "2026-09" */
  month: string;
  value: number;
}

export interface CsoReading {
  itemCode: string;
  csoLabel: string;
  series: MonthValue[]; // every month the CSO holds a price for this item, oldest first
  latest: MonthValue;
  yearAgo: MonthValue | null;
  previous: MonthValue | null;
  tableLatestMonth: string | null; // newest month of the whole table
  tableTitle: string | null;
  tableUpdated: string | null;
}

/** "202609" -> "2026-09"; anything else is returned as given. */
export function monthFromCode(code: string): string {
  const m = /^(\d{4})(\d{2})$/.exec(code);
  return m ? `${m[1]}-${m[2]}` : code;
}

export function shiftMonth(month: string, delta: number): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "September 2026" */
export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

/** The time and item dimension ids of the cube. The CSO bakes a classification version into the item id (C02363V03422), so find them by role. */
export function findDimensions(table: JsonStatTable): { time: string; item: string } | null {
  const time = table.ids.find((id) => /^TLIST/i.test(id));
  const item = table.ids.find((id) => id !== time && !/^STATISTIC$/i.test(id));
  return time && item ? { time, item } : null;
}

/** Everything the CSO holds for one item code: the series, the latest month, a year before and the month before. Null when the code is not in the table or has no prices. */
export function readItem(table: JsonStatTable, code: string): CsoReading | null {
  const dims = findDimensions(table);
  if (!dims) return null;
  const series = table.rows
    .filter((r) => r[dims.item] === code && typeof r.value === "number" && r.value > 0)
    .map((r) => ({ month: monthFromCode(String(r[dims.time])), value: r.value as number }))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const at = (month: string | null) => (month ? series.find((s) => s.month === month) ?? null : null);
  const times = table.codes[dims.time] ?? [];
  return {
    itemCode: code,
    csoLabel: table.labels[dims.item]?.[code] ?? code,
    series,
    latest,
    yearAgo: at(shiftMonth(latest.month, -12)),
    previous: at(shiftMonth(latest.month, -1)),
    tableLatestMonth: times.length ? monthFromCode(times[times.length - 1]) : null,
    tableTitle: table.label,
    tableUpdated: table.updated,
  };
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const eur = (v: number) => `€${v.toFixed(2)}`;

export function changeOver(from: MonthValue | null, to: MonthValue): null | { from_month: string; from_value: number; change_percent: number; change_amount: number } {
  if (!from || !(from.value > 0)) return null;
  return {
    from_month: from.month,
    from_value: from.value,
    change_percent: roundTo(((to.value - from.value) / from.value) * 100, 1),
    change_amount: roundTo(to.value - from.value, 3),
  };
}

function changeWords(c: NonNullable<ReturnType<typeof changeOver>>, label: string): string {
  if (c.change_percent === 0) return ` That is unchanged from ${label} (${eur(c.from_value)}).`;
  return ` That is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than a year earlier (${eur(c.from_value)} in ${label}).`;
}

/** How many whole months before `today` the reference month is. */
export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 0;
  return today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

const IRELAND_WORDS = new Set(["ie", "ireland", "irl", "national", "nationwide", "all", "whole country", "republic of ireland", "eire"]);

export function csoMethod(): string {
  return (
    "The Central Statistics Office (CSO) publishes, each month with the Consumer Price Index, the national average shop price of about 76 standard consumer items (table CPM12), " +
    "calculated from the shelf prices its price collectors record in shops. ProofPrice returns the published average for the item's latest month, unchanged, with the same month a year earlier, " +
    "the month before and the last 13 months. No range is calculated: the CSO gives one average and does not say how many price quotes are behind it. These are shop prices recorded for the index, not receipts."
  );
}

export interface CsoQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function csoAnswer(reading: CsoReading | null, def: ItemDef | null, related: ItemDef[], q: CsoQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "IE", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", method: csoMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !IRELAND_WORDS.has(q.region.trim().toLowerCase())
      ? `The CSO publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of Ireland.`
      : undefined;

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def
      ? `The CSO table holds no price for "${def.label}" (item ${def.code}).`
      : `The CSO's average-price table has no standard item for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`,
      extra: { available_items: exampleWords(ITEMS, 60), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const r = reading;
  const today = q.today ?? new Date();
  const range = periodRange(r.latest.month);
  const behind = monthsBehind(r.latest.month, today);
  const yoy = changeOver(r.yearAgo, r.latest);
  const mom = changeOver(r.previous, r.latest);
  const notes: string[] = [];
  if (r.tableLatestMonth && r.latest.month < r.tableLatestMonth) {
    notes.push(`The CSO has no price for this item in ${monthWords(r.tableLatestMonth)}; this is its latest available month.`);
  }
  if (behind >= 4) notes.push(`Old data: the newest price the CSO holds for this item is from ${monthWords(r.latest.month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Ireland",
    item: { code: def.code, definition: def.label, unit: def.unit, cso_label: r.csoLabel, asked_for: q.item },
    what_this_is: "Average shelf price recorded by CSO price collectors in shops for the Consumer Price Index. Not a receipt and not the price at any one shop.",
    reference_month: r.latest.month,
    reference_month_label: monthWords(r.latest.month),
    change_on_year_earlier: yoy
      ? { reference_month: yoy.from_month, value: yoy.from_value, change_percent: yoy.change_percent, change_amount: yoy.change_amount }
      : null,
    change_on_previous_month: mom
      ? { reference_month: mom.from_month, value: mom.from_value, change_percent: mom.change_percent, change_amount: mom.change_amount }
      : null,
    last_13_months: r.series.slice(-13).map((s) => ({ month: s.month, value: s.value })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    dataset: { code: TABLE_CODE, title: r.tableTitle, updated: r.tableUpdated, latest_month_in_table: r.tableLatestMonth, url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: r.latest.value,
    unit: def.unit,
    period: range ?? { from: null, to: null },
    reference_period: r.latest.month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Ireland the national average shop price of "${def.label}" was ${eur(v)} in ${monthWords(r.latest.month)}` +
      ` (Consumer Price Index price collection, not receipts).` +
      (yoy ? changeWords(yoy, monthWords(yoy.from_month)) : " No price for the same month a year earlier is available.") +
      (behind >= 4 ? ` Old data: this item has not been priced since ${monthWords(r.latest.month)}.` : ""),
    extra,
  });
}

// ---------- the request ----------

export async function ieCsoPrices(input: CsoQuery, o: FetchOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'white bread' or 'eggs'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return csoAnswer(null, null, [], input);
  const table = await fetchJsonStat(CPM12_URL, o);
  const reading = readItem(table, m.primary.code);
  return csoAnswer(reading, m.primary, m.related, input);
}
