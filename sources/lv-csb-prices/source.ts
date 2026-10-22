// Latvia: average retail prices of selected goods, from the Central Statistical Bureau (CSB) table PCC010m
// ("Average retail prices of selected commodity (euro per 1 kg, if other - specified)"), PxWeb v1 API on data.stat.gov.lv.
// Metadata format checked live on 2026-10-22 through the GitHub probe (GET). The data call is a PxWeb POST (JSON query, json-stat2).
//
// The CSB publishes one national average shop price per item and month (150 items, monthly since 2005): a survey average,
// no distribution and no record count. So the answer is an official statistic: value + measure "average", range fields null,
// sample_size null. We keep the grocery and drink items (codes 01.* and 02.1.*); fuel, fares, haircuts and tobacco are left out.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { parseJsonStat, periodRange } from "../../lib/adapters";
import type { JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "lv-csb-prices",
  country: "LV (Latvia)",
  category: "groceries (average shop prices of selected goods)",
  name: "Average retail prices of selected commodity (table PCC010m), Official Statistics Portal of Latvia",
  publisher: "Central Statistical Bureau of Latvia (CSB)",
  what_is_recorded:
    "For about 130 food and drink items, the national average retail price each month (euro per kg, litre or the pack stated), from the shop prices the CSB records for its price statistics. " +
    "One published average per item and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly, usually in the second week of the following month; each answer states its reference month",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0). The CSB's official statistics service states: \"Data is provided under CC BY 4.0 license.\"",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Central Statistical Bureau of Latvia (CSB), Official Statistics Portal, table PCC010m 'Average retail prices of selected commodity', https://data.stat.gov.lv. " +
    "Licensed under CC BY 4.0. Prices are passed on as published; the change on a year earlier is calculated by ProofPrice.",
  homepage: "https://data.stat.gov.lv/pxweb/en/OSP_PUB/START__VEK__PC__PCC/PCC010m/",
  limits:
    "National averages only (no regional prices), for the CSB's standard items and pack sizes; the CSB does not say how many price quotes stand behind an average. " +
    "These are shop shelf prices recorded for price statistics, not receipts, and not the price at any one shop or online. " +
    "Some items are priced only in some months, and the CSB changed some item definitions in February 2026, so compare months with care.",
};

export const TABLE_CODE = "PCC010m";
export const TABLE_URL = "https://data.stat.gov.lv/api/v1/en/OSP_PUB/START/VEK/PC/PCC/PCC010m";
/** Months asked for: 14 gives the latest month, the month before and the same month a year earlier even when the newest month is missing. */
export const MONTHS_ASKED = 14;

// ---------- the items: everyday words -> CSB item codes ----------
// Codes and labels are exactly the CSB's (metadata read 2026-10-22). The first definition that lists a word is the default for it.
export const ITEMS: ItemDef[] = [
  { code: "01.1.1.2.1.205", label: "Wheat flour, 1 kg", unit: "per kg", words: ["wheat flour", "flour", "white flour", "plain flour"] },
  { code: "01.1.1.3.1.304", label: "Wheat bread, 1 kg", unit: "per kg", words: ["wheat bread", "bread", "white bread", "sliced bread", "loaf", "loaf of bread"] },
  { code: "01.1.1.3.1.307", label: "Rye bread, 1 kg", unit: "per kg", words: ["rye bread", "dark bread", "black bread", "latvian rye bread"] },
  { code: "01.1.2.2.1.101", label: "Beef with bone, 1 kg", unit: "per kg", words: ["beef with bone", "beef"] },
  { code: "01.1.2.2.2.204", label: "Pork with bone, 1 kg", unit: "per kg", words: ["pork with bone", "pork"] },
  { code: "01.1.2.2.4.401", label: "Chicken, 1 kg", unit: "per kg", words: ["chicken", "whole chicken", "chicken meat"] },
  { code: "01.1.4.2.0.203", label: "Milk, 1 l", unit: "per litre", words: ["milk", "cow's milk", "whole milk", "fresh milk"] },
  { code: "01.1.5.1.1.101", label: "Vegetable oil, 1 l", unit: "per litre", words: ["vegetable oil", "cooking oil", "oil"] },
  { code: "01.2.2.0.1.101", label: "Ground coffee, 1 kg", unit: "per kg", words: ["ground coffee", "coffee"] },
  { code: "01.2.3.0.2.202", label: "Tea bags, 50 g", unit: "per 50 g", words: ["tea bags", "tea", "teabags"] },
  { code: "01.2.5.0.0.101", label: "Mineral water, 1.5 l", unit: "per 1.5 litres", words: ["mineral water", "water", "bottled water"] },
  { code: "02.1.2.1.0.102", label: "Wine, 1 l", unit: "per litre", words: ["wine", "red wine", "white wine", "table wine", "bottle of wine"] },
  { code: "02.1.3.0.0.101", label: "Beer, 4.0-5.5%, 1 l", unit: "per litre", words: ["beer 4.0-5.5%", "beer", "lager"] },
  { code: "01.1.1.1.2.101", label: "Rice, 1 kg", unit: "per kg", words: ["rice"] },
  { code: "01.1.1.1.4.207", label: "Barley groats, 1 kg", unit: "per kg", words: ["barley groats"] },
  { code: "01.1.1.1.9.203", label: "Buckwheat, 1 kg", unit: "per kg", words: ["buckwheat"] },
  { code: "01.1.1.2.1.206", label: "Semolina, 1 kg", unit: "per kg", words: ["semolina"] },
  { code: "01.1.1.3.1.302", label: "Rye-wheat bread, 1kg", unit: "per kg", words: ["rye-wheat bread"] },
  { code: "01.1.1.3.1.303", label: "Grain bread, 1 kg", unit: "per kg", words: ["grain bread"] },
  { code: "01.1.1.3.1.305", label: "Toaster bread, 1 kg", unit: "per kg", words: ["toaster bread"] },
  { code: "01.1.1.3.1.306", label: "Fine rye bread, 1 kg", unit: "per kg", words: ["fine rye bread"] },
  { code: "01.1.1.3.9.404", label: "Cake, 1 kg", unit: "per kg", words: ["cake"] },
  { code: "01.1.1.4.0.204", label: "Flaked oats, 1 kg", unit: "per kg", words: ["flaked oats"] },
  { code: "01.1.1.4.0.701", label: "Cornflakes, 250 g", unit: "per 250 g", words: ["cornflakes"] },
  { code: "01.1.1.5.0.601", label: "Pasta, 500 g", unit: "per 500 g", words: ["pasta"] },
  { code: "01.1.2.2.1.103", label: "Ground beef, 1 kg", unit: "per kg", words: ["ground beef"] },
  { code: "01.1.2.2.2.205", label: "Pork without bone, 1 kg", unit: "per kg", words: ["pork without bone"] },
  { code: "01.1.2.2.2.206", label: "Minced pork, 1 kg", unit: "per kg", words: ["minced pork"] },
  { code: "01.1.2.2.4.402", label: "Chicken legs, 1 kg", unit: "per kg", words: ["chicken legs"] },
  { code: "01.1.2.2.4.403", label: "Chicken fillet, 1 kg", unit: "per kg", words: ["chicken fillet"] },
  { code: "01.1.2.3.2.705", label: "Dried or smoked pork, 1 kg", unit: "per kg", words: ["dried or smoked pork"] },
  { code: "01.1.2.3.9.706", label: "Smoked chicken, 1 kg", unit: "per kg", words: ["smoked chicken"] },
  { code: "01.1.2.5.1.701", label: "Sausage boiled, 1 kg", unit: "per kg", words: ["sausage boiled"] },
  { code: "01.1.2.5.1.702", label: "Sausages, small, 1 kg", unit: "per kg", words: ["sausages small"] },
  { code: "01.1.2.5.1.703", label: "Sausage, smoked, 1 kg", unit: "per kg", words: ["sausage smoked"] },
  { code: "01.1.2.5.1.704", label: "Sausage, cold smoked, 1 kg", unit: "per kg", words: ["sausage cold smoked"] },
  { code: "01.1.2.5.2.805", label: "Canned stewed meat, 250 g", unit: "per 250 g", words: ["canned stewed meat"] },
  { code: "01.1.2.5.9.801", label: "Minced meat, 1 kg", unit: "per kg", words: ["minced meat"] },
  { code: "01.1.2.5.9.804", label: "Marinated meat, 1 kg", unit: "per kg", words: ["marinated meat"] },
  { code: "01.1.3.1.1.102", label: "Carp, fresh or chilled, 1 kg", unit: "per kg", words: ["carp fresh or chilled"] },
  { code: "01.1.3.1.1.103", label: "Freshwater fish fillet, frozen, kg", unit: "per kg", words: ["freshwater fish fillet frozen"] },
  { code: "01.1.3.1.2.103", label: "Salmon, chilled, 1 kg", unit: "per kg", words: ["salmon chilled"] },
  { code: "01.1.3.1.2.104", label: "Salmon fillet, 1 kg", unit: "per kg", words: ["salmon fillet"] },
  { code: "01.1.3.1.4.202", label: "Gadiformes fillet, frozen, kg", unit: "per kg", words: ["gadiformes fillet frozen"] },
  { code: "01.1.3.1.1.202", label: "Frozen fish fillet, 1 kg", unit: "per kg", words: ["frozen fish fillet"] },
  { code: "01.1.3.2.9.501", label: "Mackerel, smoked, 1 kg", unit: "per kg", words: ["mackerel smoked"] },
  { code: "01.1.3.3.2.601", label: "Herring rolls, 1 kg", unit: "per kg", words: ["herring rolls"] },
  { code: "01.1.3.3.2.603", label: "Sprats in oil, 240 g", unit: "per 240 g", words: ["sprats in oil"] },
  { code: "01.1.3.4.1.401", label: "Shrimp, frozen, 500 g", unit: "per 500 g", words: ["shrimp frozen"] },
  { code: "01.1.4.3.3.602", label: "Cream 35%, 1 kg", unit: "per kg", words: ["cream 35%", "cream"] },
  { code: "01.1.4.5.0.501", label: "Curd, 1 kg", unit: "per kg", words: ["curd"] },
  { code: "01.1.4.5.0.502", label: "Cheese, 1 kg", unit: "per kg", words: ["cheese"] },
  { code: "01.1.4.5.0.503", label: "Processed cheese, 200 g", unit: "per 200 g", words: ["processed cheese"] },
  { code: "01.1.4.5.0.504", label: "Cream cheese, 200 g", unit: "per 200 g", words: ["cream cheese"] },
  { code: "01.1.4.5.0.505", label: "Camembert cheese, 1 kg", unit: "per kg", words: ["camembert cheese"] },
  { code: "01.1.4.6.0.401", label: "Yoghurt, 1 kg", unit: "per kg", words: ["yoghurt"] },
  { code: "01.1.4.6.0.402", label: "Yoghurt drink, 100 g", unit: "per 100 g", words: ["yoghurt drink"] },
  { code: "01.1.4.6.0.403", label: "Plain yoghurt, 1 kg", unit: "per kg", words: ["plain yoghurt"] },
  { code: "01.1.4.6.0.601", label: "Sour cream, 1 kg", unit: "per kg", words: ["sour cream"] },
  { code: "01.1.4.6.0.603", label: "Kefir, 1 kg", unit: "per kg", words: ["kefir"] },
  { code: "01.1.4.7.0.604", label: "Sweet curd snack, 50 g", unit: "per 50 g", words: ["sweet curd snack"] },
  { code: "01.1.4.8.1.701", label: "Eggs, 10 pcs", unit: "per 10 eggs", words: ["eggs", "egg", "10 eggs"] },
  { code: "01.1.5.1.1.102", label: "Sunflower oil, 1 l", unit: "per litre", words: ["sunflower oil"] },
  { code: "01.1.5.1.3.301", label: "Olive oil, 1 l", unit: "per litre", words: ["olive oil"] },
  { code: "01.1.5.1.9.401", label: "Rapeseed oil, 1 l", unit: "per litre", words: ["rapeseed oil"] },
  { code: "01.1.5.2.1.101", label: "Butter, 1 kg", unit: "per kg", words: ["butter"] },
  { code: "01.1.5.3.0.201", label: "Margarine, 1 kg", unit: "per kg", words: ["margarine"] },
  { code: "01.1.6.1.1.109", label: "Avocados, 1 piece", unit: "per piece", words: ["avocados"] },
  { code: "01.1.6.1.2.104", label: "Bananas, 1 kg", unit: "per kg", words: ["bananas"] },
  { code: "01.1.6.2.2.105", label: "Lemons, 1 kg", unit: "per kg", words: ["lemons"] },
  { code: "01.1.6.2.3.103", label: "Oranges, 1 kg", unit: "per kg", words: ["oranges"] },
  { code: "01.1.6.3.1.101", label: "Apples, 1 kg", unit: "per kg", words: ["apples"] },
  { code: "01.1.6.3.2.102", label: "Pears, 1 kg", unit: "per kg", words: ["pears"] },
  { code: "01.1.6.4.5.107", label: "Strawberries, 1 kg", unit: "per kg", words: ["strawberries"] },
  { code: "01.1.6.4.6.115", label: "Blueberries, 1 kg", unit: "per kg", words: ["blueberries"] },
  { code: "01.1.6.5.1.106", label: "Grapes, 1 kg", unit: "per kg", words: ["grapes"] },
  { code: "01.1.6.5.2.118", label: "Kiwi fruit, 1 kg", unit: "per kg", words: ["kiwi fruit"] },
  { code: "01.1.6.5.3.116", label: "Melons, 1 kg", unit: "per kg", words: ["melons"] },
  { code: "01.1.6.7.1.301", label: "Raisins, 1 kg", unit: "per kg", words: ["raisins"] },
  { code: "01.1.6.8.8.302", label: "Peanuts, 1 kg", unit: "per kg", words: ["peanuts"] },
  { code: "01.1.6.9.2.401", label: "Canned fruit, 1 kg", unit: "per kg", words: ["canned fruit"] },
  { code: "01.1.7.1.2.101", label: "Cabbage, 1 kg", unit: "per kg", words: ["cabbage"] },
  { code: "01.1.7.1.2.108", label: "Chinese cabbage, 1 kg", unit: "per kg", words: ["chinese cabbage"] },
  { code: "01.1.7.2.1.106", label: "Sweet pepper, 1 kg", unit: "per kg", words: ["sweet pepper"] },
  { code: "01.1.7.2.2.105", label: "Cucumbers, 1 kg", unit: "per kg", words: ["cucumbers"] },
  { code: "01.1.7.2.4.104", label: "Tomatoes, 1 kg", unit: "per kg", words: ["tomatoes"] },
  { code: "01.1.7.2.5.113", label: "Squash/zucchini, 1 kg", unit: "per kg", words: ["squash/zucchini"] },
  { code: "01.1.7.2.5.114", label: "Pumpkins, 1 kg", unit: "per kg", words: ["pumpkins"] },
  { code: "01.1.7.4.1.102", label: "Carrots, 1 kg", unit: "per kg", words: ["carrots"] },
  { code: "01.1.7.4.2.112", label: "Garlic, 1 kg", unit: "per kg", words: ["garlic"] },
  { code: "01.1.7.4.3.103", label: "Onions, 1 kg", unit: "per kg", words: ["onions"] },
  { code: "01.1.7.4.4.107", label: "Spring onions, 1 kg", unit: "per kg", words: ["spring onions"] },
  { code: "01.1.7.5.1.403", label: "Potatoes, 1 kg", unit: "per kg", words: ["potatoes"] },
  { code: "01.1.7.6.1.301", label: "Dried beans, 1 kg", unit: "per kg", words: ["dried beans"] },
  { code: "01.1.7.8.0.201", label: "Frozen vegetables , 1 kg", unit: "per kg", words: ["frozen vegetables"] },
  { code: "01.1.7.9.2.302", label: "Canned green peas, 500 g", unit: "per 500 g", words: ["canned green peas"] },
  { code: "01.1.7.9.2.303", label: "Canned sweet corn, 500 g", unit: "per 500 g", words: ["canned sweet corn"] },
  { code: "01.1.7.9.2.304", label: "Canned pickled cucumbers, 1 kg", unit: "per kg", words: ["canned pickled cucumbers"] },
  { code: "01.1.7.9.2.306", label: "Pickled beetroots, 1 kg", unit: "per kg", words: ["pickled beetroots"] },
  { code: "01.1.7.9.4.404", label: "Frozen fries, 1 kg", unit: "per kg", words: ["frozen fries"] },
  { code: "01.1.7.9.9.501", label: "Crisps, 75 g", unit: "per 75 g", words: ["crisps"] },
  { code: "01.1.8.1.2.101", label: "Sugar, 1 kg", unit: "per kg", words: ["sugar"] },
  { code: "01.1.8.3.1.203", label: "Honey, 1 kg", unit: "per kg", words: ["honey"] },
  { code: "01.1.8.3.9.202", label: "Jam, 1 kg", unit: "per kg", words: ["jam"] },
  { code: "01.1.8.5.1.302", label: "Chocolates candies, 1 kg", unit: "per kg", words: ["chocolates candies"] },
  { code: "01.1.8.5.1.304", label: "Chocolate bar (>50% cocoa), 100 g", unit: "per 100 g", words: ["chocolate bar (>50% cocoa)", "chocolate bar (>"] },
  { code: "01.1.8.5.9.303", label: "Chocolate bar, 60 g", unit: "per 60 g", words: ["chocolate bar"] },
  { code: "01.1.8.6.0.501", label: "Ice cream, large package, 1000 ml", unit: "per 1000 ml", words: ["ice cream large package"] },
  { code: "01.1.8.6.0.502", label: "Ice cream, small package, 1000 ml", unit: "per 1000 ml", words: ["ice cream small package"] },
  { code: "01.1.9.1.2.803", label: "Meat dumplings, 1 kg", unit: "per kg", words: ["meat dumplings"] },
  { code: "01.1.9.3.1.201", label: "Coarse salt, 1 kg", unit: "per kg", words: ["coarse salt"] },
  { code: "01.1.9.3.9.102", label: "Tomato sauce, 1 kg", unit: "per kg", words: ["tomato sauce"] },
  { code: "01.1.9.3.9.103", label: "Mustard, 1 kg", unit: "per kg", words: ["mustard"] },
  { code: "01.1.9.3.9.104", label: "Mayonnaise, 1 kg", unit: "per kg", words: ["mayonnaise"] },
  { code: "01.1.9.4.0.109", label: "Dill, 1 kg", unit: "per kg", words: ["dill"] },
  { code: "01.1.9.4.0.203", label: "Mixed seasonings, 250 g", unit: "per 250 g", words: ["mixed seasonings"] },
  { code: "01.2.1.0.0.301", label: "Fruit and vegetable juices, 1 l", unit: "per litre", words: ["fruit and vegetable juices"] },
  { code: "01.2.2.0.1.102", label: "Instant coffee, 100 g", unit: "per 100 g", words: ["instant coffee"] },
  { code: "01.2.3.0.2.201", label: "Black tea, 1 kg", unit: "per kg", words: ["black tea"] },
  { code: "01.2.5.0.0.102", label: "Still mineral water, 1.5 l", unit: "per 1.5 litres", words: ["still mineral water"] },
  { code: "01.2.6.0.0.201", label: "Carbonated soft drinks, 1 l", unit: "per litre", words: ["carbonated soft drinks"] },
  { code: "01.2.6.0.0.203", label: "Kvass, 1 l", unit: "per litre", words: ["kvass"] },
  { code: "02.1.1.0.0.101", label: "Vodka, 1 l", unit: "per litre", words: ["vodka"] },
  { code: "02.1.1.0.0.102", label: "Brandy, 1 l", unit: "per litre", words: ["brandy"] },
  { code: "02.1.1.0.0.103", label: "Riga black balsam, 1 l", unit: "per litre", words: ["riga black balsam"] },
  { code: "02.1.1.0.0.104", label: "Whiskey, 1 l", unit: "per litre", words: ["whiskey"] },
  { code: "02.1.2.1.0.101", label: "Sparkling wine, 0.75 l", unit: "per 0.75 litres", words: ["sparkling wine"] },
  { code: "02.1.9.0.0.201", label: "Alcoholic cocktail, 1 l", unit: "per litre", words: ["alcoholic cocktail"] },
];

// ---------- reading the table (pure) ----------

export interface MonthValue {
  /** "2026-09" */
  month: string;
  value: number;
}

/** "2026M09" -> "2026-09"; anything else is returned as given. */
export function monthFromCode(code: string): string {
  const m = /^(\d{4})M(\d{2})$/.exec(code);
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

/** How many whole months before `today` the reference month is. */
export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 0;
  return today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

export interface CsbReading {
  itemCode: string;
  csbLabel: string;
  series: MonthValue[]; // every month in the answer that holds a price for this item, oldest first
  latest: MonthValue;
  yearAgo: MonthValue | null;
  previous: MonthValue | null;
  tableLatestMonth: string | null; // newest month the answer asked for
  tableTitle: string | null;
}

/** The item and time dimension ids of the cube (found by name, so a renamed dimension fails loudly instead of silently). */
export function findDimensions(table: JsonStatTable): { time: string; item: string } | null {
  const time = table.ids.find((id) => /^TIME$/i.test(id));
  const item = table.ids.find((id) => /^GOODS_SERVICES$/i.test(id));
  return time && item ? { time, item } : null;
}

/** Everything the answer holds for one item code. Null when the code is not in the answer or has no price. */
export function readItem(table: JsonStatTable, code: string): CsbReading | null {
  const dims = findDimensions(table);
  if (!dims) throw new SourceError("The CSB table has changed shape: the item and time dimensions were not found.");
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
    csbLabel: table.labels[dims.item]?.[code] ?? code,
    series,
    latest,
    yearAgo: at(shiftMonth(latest.month, -12)),
    previous: at(shiftMonth(latest.month, -1)),
    tableLatestMonth: times.length ? monthFromCode(times[times.length - 1]) : null,
    tableTitle: table.label,
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

const LATVIA_WORDS = new Set(["lv", "latvia", "lva", "national", "nationwide", "all", "whole country", "republic of latvia", "latvija"]);

export function csbMethod(): string {
  return (
    "The Central Statistical Bureau of Latvia (CSB) publishes, each month, the national average retail price of about 130 food and drink items (table PCC010m), " +
    "from the shop prices it records for its price statistics. ProofPrice returns the published average for the item's latest month, unchanged, with the same month a year earlier, " +
    "the month before and the last 13 months. No range is calculated: the CSB gives one average and does not say how many price quotes are behind it. These are shop prices recorded for statistics, not receipts."
  );
}

export interface CsbQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function csbAnswer(reading: CsbReading | null, def: ItemDef | null, related: ItemDef[], q: CsbQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "LV", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", method: csbMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !LATVIA_WORDS.has(q.region.trim().toLowerCase())
      ? `The CSB publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of Latvia.`
      : undefined;

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def
      ? `The CSB table holds no price for "${def.label}" (item ${def.code}) in the last ${MONTHS_ASKED} months.`
      : `The CSB's average-price table has no standard item for "${q.item}".`;
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
    notes.push(`The CSB has no price for this item in ${monthWords(r.tableLatestMonth)}; this is its latest available month.`);
  }
  if (behind >= 4) notes.push(`Old data: the newest price the CSB holds for this item is from ${monthWords(r.latest.month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Latvia",
    item: { code: def.code, definition: def.label, unit: def.unit, csb_label: r.csbLabel, asked_for: q.item },
    what_this_is: "Average shop price recorded by the Central Statistical Bureau of Latvia for its price statistics. Not a receipt and not the price at any one shop.",
    reference_month: r.latest.month,
    reference_month_label: monthWords(r.latest.month),
    change_on_year_earlier: yoy ? { reference_month: yoy.from_month, value: yoy.from_value, change_percent: yoy.change_percent, change_amount: yoy.change_amount } : null,
    change_on_previous_month: mom ? { reference_month: mom.from_month, value: mom.from_value, change_percent: mom.change_percent, change_amount: mom.change_amount } : null,
    last_13_months: r.series.slice(-13).map((s) => ({ month: s.month, value: s.value })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    dataset: { code: TABLE_CODE, title: r.tableTitle, latest_month_in_answer: r.tableLatestMonth, url: INFO.homepage },
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
      `In Latvia the national average shop price of "${def.label}" was ${eur(v)} in ${monthWords(r.latest.month)}` +
      ` (Central Statistical Bureau price statistics, not receipts).` +
      (yoy ? changeWords(yoy, monthWords(yoy.from_month)) : " No price for the same month a year earlier is available.") +
      (behind >= 4 ? ` Old data: this item has not been priced since ${monthWords(r.latest.month)}.` : ""),
    extra,
  });
}

// ---------- the request ----------

export interface CsbOptions {
  /** Replace the POST (tests). Default: lib/http fetchJson. */
  poster?: (url: string, body: unknown) => Promise<unknown>;
  timeoutMs?: number;
}

/** The PxWeb v1 query for one item and the newest months. */
export function buildQuery(code: string): { query: Array<{ code: string; selection: { filter: string; values: string[] } }>; response: { format: string } } {
  return {
    query: [
      { code: "GOODS_SERVICES", selection: { filter: "item", values: [code] } },
      { code: "ContentsCode", selection: { filter: "item", values: [TABLE_CODE] } },
      { code: "TIME", selection: { filter: "top", values: [String(MONTHS_ASKED)] } },
    ],
    response: { format: "json-stat2" },
  };
}

export async function lvCsbPrices(input: CsbQuery, o: CsbOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'bread' or 'eggs'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return csbAnswer(null, null, [], input);
  const post = o.poster ?? ((url, body) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, o.timeoutMs ?? 20000));
  const table = parseJsonStat(await post(TABLE_URL, buildQuery(m.primary.code)));
  const reading = readItem(table, m.primary.code);
  return csbAnswer(reading, m.primary, m.related, input);
}
