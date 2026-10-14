// Canada: monthly average retail prices of 110 selected products (food, drink, a few household items) from Statistics Canada,
// table 18-10-0245-01 ("Monthly average retail prices for selected products"), read through the key-free Web Data Service (WDS).
// Formats checked live on 2026-10-14 (see fixtures.ts). Dimensions: 1 Geography (Canada, ten provinces, Whitehorse, Yellowknife), 2 Products (110).
// Monthly since January 2017, Canadian dollars. Statistics Canada derives the averages from TRANSACTION data supplied by Canadian grocery
// retailers (table footnote 1) and publishes ONE average per product, region and month: no distribution and no count of transactions, so
// every answer is an official statistic (value + measure "average", range fields null, sample_size null).
// A request is two small WDS calls (table description, then the latest 14 months of the product in all 13 regions), cached in memory.
// Statistics Canada cautions that these averages are not fully comparable from one month to the next (the make-up of a product category changes);
// the answer repeats that next to every change on a year earlier.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";
import {
  CubeDimension, CubeMember, DataSeries, Poster, changePercent, coordinate, dimension, latestPeriods, loadCubeMeta, memberByName, monthOf, monthRange,
  monthWords, monthsBehind, newestUsable, roundTo, shiftMonth, usable,
} from "../_ca-statcan/wds";
import { OPEN_LICENCE_TEXT, OPEN_LICENCE_URL, openLicenceAttribution, openLicenceNotice } from "../_ca-statcan/licence";
import { plain, provinceFor } from "../_ca-statcan/geo";

export const PRODUCT_ID = 18100245;
export const TABLE_NAME = "Table 18-10-0245-01 Monthly average retail prices for selected products";

export const INFO: SourceInfo = {
  id: "ca-statcan-prices",
  country: "CA (Canada)",
  category: "groceries (monthly average retail prices)",
  name: "Monthly average retail prices for selected products (Statistics Canada table 18-10-0245-01)",
  publisher: "Statistics Canada",
  what_is_recorded:
    "For 110 selected products (milk, eggs, bread, butter, beef, chicken, fruit and vegetables, coffee, toothpaste ...) the average retail price each month for Canada, the ten provinces, Whitehorse and Yellowknife, " +
    "derived by Statistics Canada from transaction data supplied by Canadian grocery retailers, in a standard size for each product. One published average per product, region and month; never a shop or a shopper.",
  price_type: "official_statistic",
  freshness:
    "Monthly, not live: Statistics Canada publishes each month's averages about five weeks after the month ends (August 2026 was released on 7 October 2026), and every answer states its reference month",
  licence: OPEN_LICENCE_TEXT,
  licence_url: OPEN_LICENCE_URL,
  attribution: openLicenceAttribution(TABLE_NAME),
  homepage: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810024501",
  limits:
    "A monthly average for one standard size of each of 110 products, not the price in a particular shop and not a range: Statistics Canada gives no distribution and no count of transactions. " +
    "Regions are Canada, the ten provinces, Whitehorse and Yellowknife (the two territories only since September 2025, and not every product, for confidentiality); no cities or postcodes. " +
    "Statistics Canada cautions that these averages may not be fully comparable from one month to another, because the composition of a product category changes, and that they should not be used as a representative measure of pure price change through time; " +
    "the data are subject to revision. For price change over time Statistics Canada's Consumer Price Index is the right measure.",
};

// ---------- the items: everyday words -> Statistics Canada's product names ----------

const D = (code: number, label: string, unit: string, words: string): ItemDef => ({ code: String(code), label, unit, words: words.split("|").map((w) => w.trim()) });

/**
 * The 110 products of table 18-10-0245-01. `label` is the table's own product name (the live table is matched on it, so a renamed or renumbered
 * product is noticed), `code` is its member id on 2026-10-14. The first definition that lists a word is the default for it.
 */
export const ITEMS: ItemDef[] = [
  // dairy and eggs
  D(14, "Milk, 2 litres", "per 2 litres", "milk|2 litre milk|2 l milk|carton of milk"),
  D(13, "Milk, 1 litre", "per litre", "1 litre milk|litre of milk|1 l milk"),
  D(15, "Milk, 4 litres", "per 4 litres", "4 litre milk|4 l milk|jug of milk|bag of milk|gallon of milk"),
  D(81, "Soy milk, 1.89 litres", "per 1.89 litres", "soy milk|soya milk"),
  D(82, "Nut milk, 1.89 litres", "per 1.89 litres", "nut milk|almond milk|plant milk"),
  D(16, "Cream, 1 litre", "per litre", "cream"),
  D(17, "Butter, 454 grams", "per 454 grams", "butter"),
  D(83, "Margarine, 907 grams", "per 907 grams", "margarine"),
  D(18, "Block cheese, 500 grams", "per 500 grams", "cheese|block cheese|cheddar|cheddar cheese"),
  D(19, "Yogurt, 500 grams", "per 500 grams", "yogurt|yoghurt"),
  D(20, "Eggs, 1 dozen", "per dozen", "eggs|egg|dozen eggs|a dozen eggs"),
  // meat and fish
  D(4, "Ground beef, per kilogram", "per kilogram", "ground beef|beef|beef mince|mince|minced beef|hamburger|hamburger meat|burger meat"),
  D(2, "Beef striploin cuts, per kilogram", "per kilogram", "steak|striploin|strip loin|striploin steak|strip steak"),
  D(3, "Beef top sirloin cuts, per kilogram", "per kilogram", "sirloin|sirloin steak|top sirloin|top sirloin steak"),
  D(41, "Beef rib cuts, per kilogram", "per kilogram", "rib steak|ribeye|beef ribs|prime rib|rib roast"),
  D(1, "Beef stewing cuts, per kilogram", "per kilogram", "stewing beef|stew beef|beef for stew|beef stew"),
  D(5, "Pork loin cuts, per kilogram", "per kilogram", "pork|pork loin|pork chops|pork chop"),
  D(6, "Pork rib cuts, per kilogram", "per kilogram", "pork ribs|pork rib|spare ribs"),
  D(42, "Pork shoulder cuts, per kilogram", "per kilogram", "pork shoulder|pulled pork|pork butt"),
  D(7, "Whole chicken, per kilogram", "per kilogram", "chicken|whole chicken|roast chicken|fresh chicken"),
  D(8, "Chicken breasts, per kilogram", "per kilogram", "chicken breast|chicken breasts|boneless chicken breast"),
  D(9, "Chicken thigh, per kilogram", "per kilogram", "chicken thigh|chicken thighs"),
  D(43, "Chicken drumsticks, per kilogram", "per kilogram", "chicken drumstick|chicken drumsticks|chicken leg|chicken legs|drumsticks"),
  D(10, "Bacon, 500 grams", "per 500 grams", "bacon"),
  D(11, "Wieners, 400 grams", "per 400 grams", "wieners|hot dogs|hot dog|frankfurters"),
  D(78, "Salmon, per kilogram", "per kilogram", "salmon|salmon fillet|fresh salmon"),
  D(79, "Shrimp, 300 grams", "per 300 grams", "shrimp|prawns"),
  D(44, "Canned salmon, 213 grams", "per 213 grams", "canned salmon|tinned salmon"),
  D(12, "Canned tuna, 170 grams", "per 170 grams", "canned tuna|tuna|tinned tuna"),
  D(80, "Meatless burgers, 226 grams", "per 226 grams", "meatless burgers|veggie burgers|plant based burgers|vegan burgers"),
  // fruit
  D(21, "Apples, per kilogram", "per kilogram", "apples"),
  D(22, "Oranges, per kilogram", "per kilogram", "oranges"),
  D(23, "Oranges, 1.36 kilograms", "per 1.36 kilograms", "bag of oranges|3 lb oranges"),
  D(24, "Bananas, per kilogram", "per kilogram", "bananas"),
  D(25, "Pears, per kilogram", "per kilogram", "pears"),
  D(26, "Lemons, unit", "each", "lemons"),
  D(45, "Limes, unit", "each", "limes"),
  D(27, "Grapes, per kilogram", "per kilogram", "grapes"),
  D(28, "Cantaloupe, unit", "each", "cantaloupe|melon"),
  D(84, "Strawberries, 454 grams", "per 454 grams", "strawberries"),
  D(29, "Avocado, unit", "each", "avocado|avocados"),
  // vegetables
  D(46, "Potatoes, per kilogram", "per kilogram", "potatoes"),
  D(30, "Potatoes, 4.54 kilograms", "per 4.54 kilograms", "bag of potatoes|10 lb potatoes"),
  D(47, "Sweet potatoes, per kilogram", "per kilogram", "sweet potatoes"),
  D(31, "Tomatoes, per kilogram", "per kilogram", "tomatoes"),
  D(32, "Cabbage, per kilogram", "per kilogram", "cabbage"),
  D(33, "Carrots, 1.36 kilograms", "per 1.36 kilograms", "carrots"),
  D(34, "Onions, per kilogram", "per kilogram", "onions"),
  D(35, "Onions, 1.36 kilograms", "per 1.36 kilograms", "bag of onions"),
  D(36, "Celery, unit", "each", "celery"),
  D(37, "Cucumber, unit", "each", "cucumber|cucumbers"),
  D(38, "Mushrooms, 227 grams", "per 227 grams", "mushrooms"),
  D(48, "Iceberg lettuce, unit", "each", "lettuce|iceberg lettuce"),
  D(49, "Romaine lettuce, unit", "each", "romaine lettuce|romaine"),
  D(39, "Broccoli, unit", "each", "broccoli"),
  D(40, "Peppers, per kilogram", "per kilogram", "peppers|bell peppers|sweet peppers"),
  D(85, "Squash, per kilogram", "per kilogram", "squash"),
  D(86, "Salad greens, 142 grams", "per 142 grams", "salad greens|salad|mixed greens"),
  // frozen
  D(50, "Frozen french fried potatoes, 750 grams", "per 750 grams", "french fries|frozen fries|frozen french fries"),
  D(51, "Frozen green beans, 750 grams", "per 750 grams", "frozen green beans"),
  D(52, "Frozen broccoli, 500 grams", "per 500 grams", "frozen broccoli"),
  D(53, "Frozen corn, 750 grams", "per 750 grams", "frozen corn"),
  D(54, "Frozen mixed vegetables, 750 grams", "per 750 grams", "frozen mixed vegetables|frozen vegetables"),
  D(55, "Frozen peas, 750 grams", "per 750 grams", "frozen peas|peas"),
  D(87, "Frozen pizza, 390 grams", "per 390 grams", "frozen pizza|pizza"),
  D(88, "Frozen spinach, 300 grams", "per 300 grams", "frozen spinach"),
  D(89, "Frozen strawberries, 600 grams", "per 600 grams", "frozen strawberries"),
  // bakery, cereals, baking
  D(56, "White bread, 675 grams", "per 675 grams", "bread|white bread|sliced bread|loaf|loaf of bread|white loaf"),
  D(90, "Flatbread and pita, 500 grams", "per 500 grams", "pita|flatbread|pita bread|flatbread and pita"),
  D(91, "Crackers and crisp breads, 200 grams", "per 200 grams", "crackers"),
  D(92, "Cookies and sweet biscuits, 300 grams", "per 300 grams", "cookies|cookie|biscuits"),
  D(57, "Dry or fresh pasta, 500 grams", "per 500 grams", "pasta|spaghetti|macaroni"),
  D(94, "White rice, 2 kilograms", "per 2 kilograms", "rice|white rice"),
  D(93, "Brown rice, 900 grams", "per 900 grams", "brown rice"),
  D(58, "Cereal, 400 grams", "per 400 grams", "cereal|breakfast cereal"),
  D(59, "Wheat flour, 2.5 kilograms", "per 2.5 kilograms", "flour|wheat flour|white flour|all purpose flour"),
  D(60, "White sugar, 2 kilograms", "per 2 kilograms", "sugar|white sugar"),
  // drinks
  D(62, "Orange juice, 2 litres", "per 2 litres", "orange juice|juice"),
  D(61, "Apple juice, 2 litres", "per 2 litres", "apple juice"),
  D(63, "Roasted or ground coffee, 340 grams", "per 340 grams", "coffee|ground coffee|roast coffee|roasted coffee"),
  D(64, "Tea (20 bags)", "per 20 tea bags", "tea|tea bags"),
  // pantry
  D(65, "Ketchup, 1 litre", "per litre", "ketchup|catsup"),
  D(66, "Vegetable oil, 3 litres", "per 3 litres", "vegetable oil|cooking oil|oil"),
  D(95, "Canola oil, 3 litres", "per 3 litres", "canola oil"),
  D(96, "Olive oil, 1 litre", "per litre", "olive oil"),
  D(67, "Baby food, 128 millilitres", "per 128 millilitres", "baby food"),
  D(97, "Infant formula, 900 grams", "per 900 grams", "infant formula|baby formula|formula"),
  D(68, "Peanut butter, 1 kilogram", "per kilogram", "peanut butter"),
  D(69, "Mayonnaise, 890 millilitres", "per 890 millilitres", "mayonnaise|mayo"),
  D(70, "Canned baked beans, 398 millilitres", "per 398 millilitres", "baked beans|canned baked beans"),
  D(71, "Canned tomatoes, 796 millilitres", "per 796 millilitres", "canned tomatoes|tinned tomatoes"),
  D(72, "Canned soup, 284 millilitres", "per 284 millilitres", "canned soup|soup|tinned soup"),
  D(73, "Canned beans and lentils, 540 millilitres", "per 540 millilitres", "canned beans|canned lentils|canned beans and lentils|beans"),
  D(98, "Canned corn, 341 millilitres", "per 341 millilitres", "canned corn|corn|sweetcorn"),
  D(99, "Canned peach, 398 millilitres", "per 398 millilitres", "canned peaches|canned peach"),
  D(100, "Canned pear, 398 millilitres", "per 398 millilitres", "canned pears|canned pear"),
  D(74, "Dried lentils, 900 grams", "per 900 grams", "lentils|dried lentils|dry lentils"),
  D(101, "Dry beans and legumes, 900 grams", "per 900 grams", "dried beans|dry beans|legumes|dry beans and legumes"),
  D(102, "Tofu, 350 grams", "per 350 grams", "tofu"),
  D(103, "Hummus, 227 grams", "per 227 grams", "hummus"),
  D(104, "Salsa, 418 millilitres", "per 418 millilitres", "salsa"),
  D(105, "Pasta sauce, 650 millilitres", "per 650 millilitres", "pasta sauce|spaghetti sauce"),
  D(106, "Salad dressing, 475 millilitres", "per 475 millilitres", "salad dressing|dressing"),
  D(107, "Almonds, 200 grams", "per 200 grams", "almonds"),
  D(108, "Peanuts, 450 grams", "per 450 grams", "peanuts"),
  D(109, "Sunflower seeds, 400 grams", "per 400 grams", "sunflower seeds"),
  // personal care and household
  D(75, "Deodorant, 85 grams", "per 85 grams", "deodorant"),
  D(76, "Toothpaste, 100 millilitres", "per 100 millilitres", "toothpaste"),
  D(77, "Shampoo, 400 millilitres", "per 400 millilitres", "shampoo"),
  D(110, "Laundry detergent, 4.43 litres", "per 4.43 litres", "laundry detergent|detergent"),
];

/** A short comma-separated list of everyday words, for the parameter notes. */
export const exampleItems = (max: number) => exampleWords(ITEMS, max).join(", ");

// ---------- regions ----------

const NATIONAL_WORDS = new Set(["canada", "ca", "national", "nationwide", "country", "all"]);

/** Big cities -> their province, so "Toronto" is answered with the Ontario average and says so. Keys are plain(). */
const CITY_PROVINCE: Record<string, string> = {
  toronto: "Ontario", ottawa: "Ontario", hamilton: "Ontario", london: "Ontario", mississauga: "Ontario", brampton: "Ontario", kitchener: "Ontario",
  windsor: "Ontario", sudbury: "Ontario", "thunder bay": "Ontario", kingston: "Ontario", barrie: "Ontario", oshawa: "Ontario", guelph: "Ontario",
  montreal: "Quebec", "quebec city": "Quebec", laval: "Quebec", gatineau: "Quebec", sherbrooke: "Quebec", "trois rivieres": "Quebec", saguenay: "Quebec",
  vancouver: "British Columbia", victoria: "British Columbia", surrey: "British Columbia", burnaby: "British Columbia", kelowna: "British Columbia",
  abbotsford: "British Columbia", richmond: "British Columbia", nanaimo: "British Columbia",
  calgary: "Alberta", edmonton: "Alberta", "red deer": "Alberta", lethbridge: "Alberta", "fort mcmurray": "Alberta",
  winnipeg: "Manitoba", brandon: "Manitoba",
  regina: "Saskatchewan", saskatoon: "Saskatchewan",
  halifax: "Nova Scotia",
  "saint john": "New Brunswick", moncton: "New Brunswick", fredericton: "New Brunswick",
  charlottetown: "Prince Edward Island", summerside: "Prince Edward Island",
  "saint johns": "Newfoundland and Labrador", "corner brook": "Newfoundland and Labrador", "mount pearl": "Newfoundland and Labrador",
};

/** The published member for a province or territory name ("Ontario", "Yukon" -> "Whitehorse, Yukon"). */
function memberForProvince(published: CubeMember[], province: string): CubeMember | undefined {
  const p = plain(province);
  return published.find((m) => plain(m.name) === p) ?? published.find((m) => plain(m.name).endsWith(` ${p}`));
}

/**
 * Turn what a person typed into one of the 13 regions of the table. Nothing or "Canada" is the national average. A province, its postcode
 * letters ("ON") or a territory is used directly; "Whitehorse" and "Yellowknife" are regions of their own; "Toronto" or "Toronto, ON" is answered
 * with the province's average and a note says so (the table has no cities). Anything else throws an InputError that lists the regions.
 */
export function resolveRegion(geo: CubeDimension, region?: string): { member: CubeMember; note?: string } {
  const published = geo.members.filter((m) => !m.terminated);
  const canada = memberByName(geo, "Canada");
  if (!canada) throw new SourceError("Statistics Canada changed table 18-10-0245-01 (no Canada member); this source needs updating.");
  const raw = (region ?? "").trim();
  const q = plain(raw).replace(/ canada$/, "");
  if (!q || NATIONAL_WORDS.has(q)) return { member: canada };

  const names = published.map((m) => m.name).join("; ");
  const direct = published.find((m) => plain(m.name) === q || plain(m.name.split(",")[0]) === q);
  if (direct) return { member: direct };

  const prov = provinceFor(raw);
  if (prov) {
    if (prov.name === "Nunavut") throw new InputError("Statistics Canada does not publish average prices for Nunavut in this table. Regions: " + names + ".");
    const m = memberForProvince(published, prov.name);
    if (m) {
      const note = plain(m.name) === plain(prov.name) ? undefined : `'${raw}' is answered with ${m.name}, the only ${prov.name} figure Statistics Canada publishes.`;
      return { member: m, note };
    }
  }

  const bits = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const first = plain(bits[0] ?? "");
  const lastProv = bits.length > 1 ? provinceFor(bits[bits.length - 1]) : undefined;
  const provName = lastProv?.name ?? CITY_PROVINCE[first];
  if (provName && provName !== "Nunavut") {
    const m = memberForProvince(published, provName);
    if (m) {
      return { member: m, note: `Statistics Canada publishes provincial averages, not city averages: '${raw}' is answered with the ${m.name} average.` };
    }
  }
  throw new InputError(
    `'${raw}' is not a region in this table. Statistics Canada publishes Canada, the ten provinces, Whitehorse (Yukon) and Yellowknife (Northwest Territories): ${names}. ` +
      `Give one of them (a city such as Toronto is answered with its province), or leave region out for Canada.`,
  );
}

// ---------- the reading (pure) ----------

export interface PricesReading {
  region: { id: number; name: string };
  month: string; // YYYY-MM
  value: number;
  /** WDS status of the headline figure: 0 normal, 7 = "E" (use with caution). */
  status: number;
  previous: { month: string; value: number } | null;
  yearAgo: { month: string; value: number } | null;
  last12: { month: string; value: number }[];
  releaseTime: string | null;
  /** The same product and month in the other regions that have a figure. */
  others: { id: number; region: string; value: number }[];
  /** The newest month the table holds for any series. */
  tableEnd: string | null;
}

/** series[i] belongs to regions[i]. */
export function readPrices(series: DataSeries[], regions: { id: number; name: string }[], regionId: number, tableEnd: string | null): PricesReading | null {
  const idx = regions.findIndex((r) => r.id === regionId);
  if (idx < 0) return null;
  const head = series[idx];
  const latest = newestUsable(head);
  if (!head || !latest) return null;
  const month = monthOf(latest.period);
  const at = (s: DataSeries | undefined, m: string) => {
    const p = s?.points.find((x) => monthOf(x.period) === m);
    return usable(p) ? { month: m, value: p.value } : null;
  };
  const last12: { month: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const p = at(head, shiftMonth(month, -i));
    if (p) last12.push(p);
  }
  const others: PricesReading["others"] = [];
  regions.forEach((r, i) => {
    if (r.id === regionId) return;
    const p = at(series[i], month);
    if (p) others.push({ id: r.id, region: r.name, value: p.value });
  });
  return {
    region: regions[idx],
    month,
    value: latest.value,
    status: latest.status,
    previous: at(head, shiftMonth(month, -1)),
    yearAgo: at(head, shiftMonth(month, -12)),
    last12,
    releaseTime: latest.releaseTime,
    others,
    tableEnd: tableEnd ? monthOf(tableEnd) : null,
  };
}

// ---------- the answer (pure) ----------

export const CAUTION =
  "Statistics Canada cautions that these average prices may not be fully comparable from one month to another, because the composition of a product category changes, and should not be used as a representative measure of pure price change through time. Data are subject to revision.";

export function caPricesMethod(): string {
  return (
    "Canada (groceries): Statistics Canada's monthly average retail price of 110 selected products (table 18-10-0245-01), derived from transaction data supplied by Canadian grocery retailers, " +
    "for Canada, the provinces, Whitehorse and Yellowknife. We read the latest 14 months through the Web Data Service and pass on the published average for the product, region and month; " +
    "the changes on the previous month and on a year earlier are calculated by ProofPrice from two published averages. No range is calculated. " +
    "Statistics Canada cautions that these averages may not be fully comparable from month to month."
  );
}

export interface CaPricesQuery {
  item: string;
  /** The region as the person gave it; shown in the query echo. */
  region?: string;
  baseUrl?: string;
  today?: Date;
}

const cad = (v: number) => fmtMoney(v, "CAD");

export function caPricesAnswer(
  reading: PricesReading | null,
  def: ItemDef | null,
  related: ItemDef[],
  q: CaPricesQuery,
  ctx: { regionAsked: { id: number; name: string }; regionNote?: string; tableTitle?: string },
): PriceAnswer {
  const regionName = reading?.region.name ?? ctx.regionAsked.name;
  const query: Record<string, unknown> = { country: "CA", item: q.item, ...(q.region ? { region: regionName } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "CAD", method: caPricesMethod(), baseUrl: q.baseUrl };

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const territory = /Yukon|Northwest/.test(regionName);
    const hint = def
      ? `Statistics Canada publishes no recent average price for "${def.label}" in ${regionName}` +
        (territory ? " (for confidentiality, not every product is published for Yukon and the Northwest Territories)" : "") +
        `. Try Canada (leave region out) or another region.`
      : `Statistics Canada's average-price table has no standard item for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} ${def ? "" : `Try one of: ${exampleWords(ITEMS, 30).join(", ")}.`}`.trim(),
      extra: {
        ...(def ? {} : { available_items: exampleWords(ITEMS, 110) }),
        ...(def ? { other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })) } : {}),
        ...(ctx.regionNote ? { region_note: ctx.regionNote } : {}),
      },
    };
  }

  const r = reading;
  const today = q.today ?? new Date();
  const range = monthRange(r.month);
  const behind = monthsBehind(r.month, today);
  const change = (from: { month: string; value: number } | null) =>
    from ? { reference_month: from.month, value: from.value, change_percent: changePercent(r.value, from.value), change_amount: roundTo(r.value - from.value, 2) } : null;
  const mom = change(r.previous);
  const yoy = change(r.yearAgo);
  const territory = /Yukon|Northwest/.test(r.region.name);

  const notes: string[] = [
    `An average for ${monthWords(r.month)} that Statistics Canada derives from transaction data supplied by Canadian grocery retailers, for one standard size of the product: not the price in one shop and not a live price.`,
    CAUTION,
  ];
  if (territory) notes.push("Yukon and Northwest Territories figures start with September 2025, and not every product is published there, for confidentiality.");
  if (r.status === 7) notes.push("Statistics Canada marks this figure E: use with caution.");
  if (r.month >= "2024-01" && r.month <= "2024-12") {
    notes.push("From the January 2024 reference month Statistics Canada added data from more grocery retailers, so changes on a year earlier during 2024 should be read with extra caution.");
  }
  if (r.tableEnd && r.month < r.tableEnd) notes.push(`Statistics Canada has no newer average for this product and region than ${monthWords(r.month)} (the table's newest month is ${monthWords(r.tableEnd)}).`);
  if (behind >= 3) notes.push(`Old data: the newest average Statistics Canada holds for this product and region is from ${monthWords(r.month)}, ${behind} months ago.`);
  if (ctx.regionNote) notes.push(ctx.regionNote);

  const where = r.region.name === "Canada" ? "Canada" : r.region.name;
  return buildStatisticAnswer({
    ...base,
    value: r.value,
    unit: def.unit,
    period: range,
    reference_period: r.month,
    note: notes.join(" "),
    describe: (v) =>
      `In ${where} the average retail price of "${def.label}" was ${cad(v)} in ${monthWords(r.month)}, as published by Statistics Canada from grocery retailers' transaction data (not a live or single-shop price). ` +
      (yoy
        ? (yoy.change_percent === 0
            ? `That is unchanged from a year earlier (${cad(yoy.value)} in ${monthWords(yoy.reference_month)})`
            : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${cad(yoy.value)} in ${monthWords(yoy.reference_month)})`) +
          `; Statistics Canada cautions that these averages are not fully comparable over time.`
        : "Statistics Canada holds no average for the same month a year earlier.") +
      (behind >= 3 ? ` Old data: ${behind} months old.` : ""),
    extra: {
      country_name: "Canada",
      region: { name: r.region.name, wds_member_id: r.region.id },
      item: { code: def.code, definition: def.label, unit: def.unit, asked_for: q.item },
      what_this_is:
        "Monthly average retail price for a standard size of the product, derived by Statistics Canada from transaction data supplied by Canadian grocery retailers. Not a receipt, not one shop's price and not a live price.",
      reference_month: r.month,
      reference_month_label: monthWords(r.month),
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      ...(yoy ? {} : { change_on_year_earlier_unavailable: "Statistics Canada holds no average for this product and region in the same month a year earlier." }),
      last_12_months: r.last12.map((p) => ({ month: p.month, value: p.value })),
      other_regions_same_month: r.others.map((o) => ({ region: o.region, value: o.value })),
      other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
      statcan_caution: CAUTION,
      dataset: { name: ctx.tableTitle ?? "Monthly average retail prices for selected products", table: "18-10-0245-01", url: INFO.homepage, released: r.releaseTime },
      attribution_notice: openLicenceNotice(TABLE_NAME, monthWords(r.month)),
      ...(ctx.regionNote ? { region_note: ctx.regionNote } : {}),
    },
  });
}

// ---------- the request ----------

export async function caStatcanPrices(input: CaPricesQuery, post?: Poster): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'eggs' or 'bread'.");

  const meta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const products = dimension(meta, 2, "Products");
  const asked = resolveRegion(geo, input.region);
  const m = matchItem(ITEMS, item);
  if (!m.primary) return caPricesAnswer(null, null, [], input, { regionAsked: asked.member, regionNote: asked.note, tableTitle: meta.title });

  const product = memberByName(products, m.primary.label);
  if (!product) throw new SourceError(`Statistics Canada changed table 18-10-0245-01 (no product "${m.primary.label}"); this source needs updating.`);

  const regions = geo.members.filter((g) => !g.terminated).map((g) => ({ id: g.id, name: g.name }));
  const coords = regions.map((g) => coordinate([g.id, product.id]));
  const series = await latestPeriods(PRODUCT_ID, coords, 14, post);
  const reading = readPrices(series, regions, asked.member.id, meta.endDate);
  return caPricesAnswer(reading, m.primary, m.related, input, { regionAsked: asked.member, regionNote: asked.note, tableTitle: meta.title });
}
