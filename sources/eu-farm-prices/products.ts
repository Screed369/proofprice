// The products this source answers for, and how each one maps onto the European Commission Agri-food data portal API.
// Everything here is plain data plus tiny pure helpers. The portal has one endpoint per sector; a "family" below is one endpoint.
// The names and codes (product names, pig classes, beef codes, farming methods, F&V product names) are the ones the API itself lists
// at its /products, /productCodes, /farmingMethods endpoints, checked live on 2026-10-14.

import { InputError } from "../../lib/http";

export type Family = "cereal" | "beef" | "pig" | "sheep" | "poultry" | "egg" | "milk" | "dairy" | "oliveoil" | "fruitveg";
export type PriceUnit = "tonne" | "100kg" | "head";

/** One concrete series the portal publishes. A product lists several in order of preference (wheat: milling, then feed). */
export interface Variant {
  /** The value in the API row that identifies it (product name, class, code, farming method, variety). Shown to the caller. */
  id: string;
  /** A self-contained noun phrase for sentences ("milling (bread-making) wheat"). Empty: use the product's own name. */
  label: string;
  match: (valueInRow: string) => boolean;
}

export interface Product {
  key: string; // the name we accept and show: "wheat", "pig", "olive oil"
  family: Family;
  /** Noun phrase for sentences when no variant label applies: "wheat", "pig carcasses", "raw cow's milk". */
  name: string;
  group: string;
  aliases: string[];
  variants: Variant[];
  /** Values for the API's own filter parameter (product codes, classes, names), to keep the response small. Absent: the family has none we rely on. */
  filter?: string[];
  unit: PriceUnit;
}

const lc = (s: string) => s.toLowerCase();
const exact = (...names: string[]) => (v: string) => names.some((n) => lc(n) === lc(v.trim()));
const startsWith = (prefix: string) => (v: string) => lc(v.trim()).startsWith(lc(prefix));
const variant = (id: string, label: string, match?: (v: string) => boolean): Variant => ({ id, label, match: match ?? exact(id) });

/** Kilograms in one price unit; null when the unit is not a weight (piglets are priced per head). */
export function kgPerUnit(unit: PriceUnit): number | null {
  return unit === "tonne" ? 1000 : unit === "100kg" ? 100 : null;
}
export const UNIT_TEXT: Record<PriceUnit, string> = { tonne: "per tonne", "100kg": "per 100 kg", head: "per head" };

// ---------- beef: carcass classification codes (EU grid: category letter, conformation letter, fat class digit) ----------

const BEEF_CATEGORY: Record<string, string> = { A: "young bull", B: "bull", C: "steer", D: "cow", E: "heifer", Z: "young cattle" };

export function beefCodeLabel(code: string): string {
  if (code === "ACZURO") return "adult male cattle carcasses (national indicative price)";
  if (code === "CALVES-LT8MONTHS") return "calves slaughtered under 8 months old";
  const m = /^([A-Z])([A-Z])([1-5])$/.exec(code);
  return m && BEEF_CATEGORY[m[1]] ? `${BEEF_CATEGORY[m[1]]} carcasses (class ${code})` : `beef carcasses (${code})`;
}
const beef = (...codes: string[]) => codes.map((c) => variant(c, beefCodeLabel(c)));

// ---------- the catalogue ----------

const PRODUCTS: Product[] = [];
const add = (p: Omit<Product, "aliases"> & { aliases?: string[] }) => PRODUCTS.push({ aliases: [], ...p });

const CEREALS = "Cereals (per tonne)";
const MILLING_WHEAT = variant("Milling wheat", "milling (bread-making) wheat", exact("Milling wheat", "Breadmaking common wheat", "Breadmaking common wheat - TVT"));
const FEED_WHEAT = variant("Feed wheat", "feed wheat");
const FEED_BARLEY = variant("Feed barley", "feed barley");
const MALTING_BARLEY = variant("Malting barley", "malting barley", startsWith("Malting barley"));
add({ key: "wheat", family: "cereal", name: "wheat", group: CEREALS, unit: "tonne", filter: ["BLTPAN", "BLTFOUR"], variants: [MILLING_WHEAT, FEED_WHEAT], aliases: ["bread wheat", "common wheat", "soft wheat"] });
add({ key: "milling wheat", family: "cereal", name: "milling wheat", group: CEREALS, unit: "tonne", filter: ["BLTPAN"], variants: [MILLING_WHEAT], aliases: ["breadmaking wheat"] });
add({ key: "feed wheat", family: "cereal", name: "feed wheat", group: CEREALS, unit: "tonne", filter: ["BLTFOUR"], variants: [FEED_WHEAT] });
add({ key: "durum wheat", family: "cereal", name: "durum wheat", group: CEREALS, unit: "tonne", filter: ["DUR"], variants: [variant("Durum wheat", "durum wheat")], aliases: ["durum"] });
add({ key: "barley", family: "cereal", name: "barley", group: CEREALS, unit: "tonne", filter: ["ORGFOUR", "ORGBRAS"], variants: [FEED_BARLEY, MALTING_BARLEY] });
add({ key: "malting barley", family: "cereal", name: "malting barley", group: CEREALS, unit: "tonne", filter: ["ORGBRAS"], variants: [MALTING_BARLEY] });
add({ key: "maize", family: "cereal", name: "feed maize", group: CEREALS, unit: "tonne", filter: ["MAI"], variants: [variant("Feed maize", "feed maize")], aliases: ["corn", "feed maize", "grain maize"] });
add({
  key: "rye", family: "cereal", name: "rye", group: CEREALS, unit: "tonne", filter: ["SEGPAN", "SEGFOUR"],
  variants: [variant("Milling rye", "milling rye", exact("Milling rye", "Rye of breadmaking quality")), variant("Feed rye", "feed rye")],
});
add({
  key: "oats", family: "cereal", name: "oats", group: CEREALS, unit: "tonne", filter: ["AVO", "AVOMILL"],
  variants: [variant("Feed oats", "feed oats"), variant("Milling oats", "milling oats")], aliases: ["oat"],
});
add({ key: "triticale", family: "cereal", name: "triticale", group: CEREALS, unit: "tonne", filter: ["TRI"], variants: [variant("Triticale", "triticale")] });

const BEEF = "Beef (per 100 kg of carcass)";
add({ key: "beef", family: "beef", name: "beef carcasses", group: BEEF, unit: "100kg", filter: ["ACZURO", "AR3", "AO3", "AU3", "AR2", "AO2", "AU2"], variants: beef("ACZURO", "AR3", "AO3", "AU3", "AR2", "AO2", "AU2"), aliases: ["beef carcass", "cattle", "bull beef", "adult male cattle"] });
add({ key: "young bull", family: "beef", name: "young bull carcasses", group: BEEF, unit: "100kg", filter: ["AR3", "AO3", "AU3", "AR2", "AO2", "AU2"], variants: beef("AR3", "AO3", "AU3", "AR2", "AO2", "AU2"), aliases: ["young bulls", "bull"] });
add({ key: "steer", family: "beef", name: "steer carcasses", group: BEEF, unit: "100kg", filter: ["CR3", "CO3", "CU3", "CR4", "CO4", "CU4", "CU2"], variants: beef("CR3", "CO3", "CU3", "CR4", "CO4", "CU4", "CU2"), aliases: ["steers", "bullock"] });
add({ key: "heifer", family: "beef", name: "heifer carcasses", group: BEEF, unit: "100kg", filter: ["ER3", "EO3", "EU3", "ER4", "EO4", "EU4", "ER2", "EO2", "EU2"], variants: beef("ER3", "EO3", "EU3", "ER4", "EO4", "EU4", "ER2", "EO2", "EU2"), aliases: ["heifers"] });
add({ key: "cow", family: "beef", name: "cow carcasses", group: BEEF, unit: "100kg", filter: ["DO3", "DO2", "DO4", "DR3", "DP3", "DP2", "DR4"], variants: beef("DO3", "DO2", "DO4", "DR3", "DP3", "DP2", "DR4"), aliases: ["cows", "cull cow", "cow beef"] });
add({ key: "calf", family: "beef", name: "calves", group: BEEF, unit: "100kg", filter: ["CALVES-LT8MONTHS"], variants: beef("CALVES-LT8MONTHS"), aliases: ["calves", "veal", "veal calf"] });

const MEAT = "Pigs, lamb and poultry meat (per 100 kg; piglets per head)";
add({
  key: "pig", family: "pig", name: "pig carcasses", group: MEAT, unit: "100kg", filter: ["S", "E", "R", "SE"],
  variants: [
    variant("E", "pig carcasses (class E)"),
    variant("Average S + E", "pig carcasses (average of classes S and E)"),
    variant("S", "pig carcasses (class S)"),
    variant("R", "pig carcasses (class R)"),
  ],
  aliases: ["pigs", "pork", "pigmeat", "pig meat", "pig carcass", "hog", "hogs"],
});
add({ key: "piglet", family: "pig", name: "piglets", group: MEAT, unit: "head", filter: ["Piglet"], variants: [variant("Piglet", "piglets")], aliases: ["piglets"] });
add({
  key: "lamb", family: "sheep", name: "lamb", group: MEAT, unit: "100kg",
  variants: [variant("Heavy Lamb", "heavy lamb"), variant("Light Lamb", "light lamb")], aliases: ["lambs", "sheep", "sheepmeat", "sheep meat"],
});
add({ key: "heavy lamb", family: "sheep", name: "heavy lamb", group: MEAT, unit: "100kg", variants: [variant("Heavy Lamb", "heavy lamb")] });
add({ key: "light lamb", family: "sheep", name: "light lamb", group: MEAT, unit: "100kg", variants: [variant("Light Lamb", "light lamb")] });
add({ key: "chicken", family: "poultry", name: "whole chicken (broiler)", group: MEAT, unit: "100kg", variants: [variant("Whole broiler (65%)", "whole chicken (broiler, 65% carcass)")], aliases: ["broiler", "broilers", "chickens", "whole chicken", "poultry"] });
add({ key: "chicken breast", family: "poultry", name: "chicken breast fillet", group: MEAT, unit: "100kg", variants: [variant("Breast Fillet", "chicken breast fillet")], aliases: ["chicken breast fillet", "breast fillet"] });
add({ key: "chicken legs", family: "poultry", name: "chicken legs", group: MEAT, unit: "100kg", variants: [variant("Legs", "chicken legs")], aliases: ["chicken leg", "legs"] });

const EGGS = "Eggs (per 100 kg)";
const METHODS: Array<[string, string]> = [["Barn", "barn eggs"], ["Cage", "cage eggs"], ["Free range", "free-range eggs"], ["Organic", "organic eggs"]];
add({
  key: "eggs", family: "egg", name: "eggs", group: EGGS, unit: "100kg", filter: METHODS.map(([m]) => m),
  variants: METHODS.map(([m, l]) => variant(m, l)), aliases: ["egg", "hen eggs", "table eggs"],
});
for (const [m, l] of METHODS) add({ key: l.replace("free-range", "free range"), family: "egg", name: l, group: EGGS, unit: "100kg", filter: [m], variants: [variant(m, l)] });

const DAIRY = "Milk and dairy (per 100 kg)";
add({ key: "milk", family: "milk", name: "raw cow's milk", group: DAIRY, unit: "100kg", filter: ["Raw milk"], variants: [variant("Raw milk", "raw cow's milk")], aliases: ["raw milk", "cow milk", "cows milk", "cow's milk", "farm milk", "milk price"] });
add({ key: "organic milk", family: "milk", name: "organic raw milk", group: DAIRY, unit: "100kg", filter: ["Organic raw milk"], variants: [variant("Organic raw milk", "organic raw milk")], aliases: ["organic raw milk"] });
const dairy = (key: string, code: string, name: string, aliases: string[] = []) =>
  add({ key, family: "dairy", name, group: DAIRY, unit: "100kg", filter: [code], variants: [variant(code, name)], aliases });
dairy("butter", "BUTTER", "butter");
dairy("skimmed milk powder", "SMP", "skimmed milk powder", ["smp", "skim milk powder", "skimmed milk"]);
dairy("whole milk powder", "WMP", "whole milk powder", ["wmp", "full cream milk powder"]);
dairy("cheddar", "CHEDDAR", "cheddar cheese", ["cheddar cheese"]);
dairy("gouda", "GOUDA", "gouda cheese", ["gouda cheese"]);
dairy("edam", "EDAM", "edam cheese", ["edam cheese"]);
dairy("emmental", "EMMENTAL", "emmental cheese", ["emmental cheese", "emmentaler"]);
dairy("whey powder", "WHEYPOWDER", "whey powder", ["whey"]);
dairy("cream", "CREAM", "cream");
dairy("drinking milk", "DRINKING MILK", "drinking milk", ["pasteurised milk", "shop milk"]);

const OLIVE = "Olive oil (per 100 kg)";
const EVOO = variant("Extra virgin olive oil (up to 0.8%)", "extra virgin olive oil");
const VOO = variant("Virgin olive oil (up to 2%)", "virgin olive oil");
const LAMP = variant("Lampante olive oil (2%)", "lampante olive oil");
add({ key: "olive oil", family: "oliveoil", name: "olive oil", group: OLIVE, unit: "100kg", filter: [EVOO.id, VOO.id], variants: [EVOO, VOO], aliases: ["evoo"] });
add({ key: "extra virgin olive oil", family: "oliveoil", name: "extra virgin olive oil", group: OLIVE, unit: "100kg", filter: [EVOO.id], variants: [EVOO], aliases: ["extra virgin"] });
add({ key: "virgin olive oil", family: "oliveoil", name: "virgin olive oil", group: OLIVE, unit: "100kg", filter: [VOO.id], variants: [VOO], aliases: ["virgin"] });
add({ key: "lampante olive oil", family: "oliveoil", name: "lampante olive oil", group: OLIVE, unit: "100kg", filter: [LAMP.id], variants: [LAMP], aliases: ["lampante"] });

// Fruit and vegetables (per 100 kg). The portal publishes, per product, several varieties at several stages of the supply chain. Per stage we
// prefer its "national weighted average of all types and varieties" line, then its "all types and varieties" line, and otherwise average the
// varieties it reports. filter[0] is the portal's own product name; the portal writes each row's variety as "<product> - <variety>".
const FV_VARIETIES: Variant[] = [
  { id: "national weighted average", label: "", match: (v) => /national weighted average/i.test(v) },
  { id: "all types and varieties", label: "", match: (v) => /all types and varieties|all sweet varieties|all varieties/i.test(v) },
  { id: "simple average of the varieties reported", label: "", match: () => true },
];
const FRUIT_VEG: Array<[key: string, apiName: string, aliases: string[]]> = [
  ["apples", "Apples", ["apple"]], ["pears", "Pears", ["pear"]], ["peaches", "Peaches", ["peach"]], ["nectarines", "Nectarines", ["nectarine"]],
  ["apricots", "Apricots", ["apricot"]], ["cherries", "Cherries", ["cherry"]], ["plums", "Plums", ["plum"]], ["strawberries", "Strawberries", ["strawberry"]],
  ["oranges", "Oranges", ["orange"]], ["lemons", "Lemons", ["lemon"]], ["mandarins", "Mandarins", ["mandarin"]], ["clementines", "Clementines", ["clementine"]],
  ["bananas", "Bananas", ["banana"]], ["table grapes", "Table Grapes", ["grapes", "grape"]], ["kiwis", "Kiwis Hayward", ["kiwi", "kiwifruit", "kiwi fruit"]],
  ["melons", "Melons", ["melon"]], ["water melons", "Water Melons", ["watermelon", "watermelons", "water melon"]],
  ["tomatoes", "Tomatoes", ["tomato"]], ["cucumbers", "Cucumbers", ["cucumber"]], ["courgettes", "Courgettes", ["courgette", "zucchini"]],
  ["peppers", "Peppers", ["pepper", "bell peppers", "capsicum"]], ["egg plants", "Egg Plants", ["aubergine", "aubergines", "eggplant", "eggplants"]],
  ["lettuces", "Lettuces", ["lettuce"]], ["cauliflowers", "Cauliflowers", ["cauliflower"]], ["carrots", "Carrots", ["carrot"]], ["onions", "Onions", ["onion"]],
  ["cabbage", "Cabbage", ["cabbages"]], ["leeks", "Leeks", ["leek"]], ["garlic", "Garlic", []], ["mushrooms", "Cultivated Mushrooms", ["mushroom", "cultivated mushrooms"]],
  ["beans", "Beans", ["bean", "green beans"]], ["asparagus", "Asparagus", []], ["avocados", "Avocados", ["avocado"]],
];
for (const [key, apiName, aliases] of FRUIT_VEG) {
  add({ key, family: "fruitveg", name: key, group: "Fruit and vegetables (per 100 kg)", unit: "100kg", filter: [apiName], variants: FV_VARIETIES, aliases });
}

export const CATALOGUE: readonly Product[] = PRODUCTS;

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s+/g, " ");

const INDEX = new Map<string, Product>();
for (const p of CATALOGUE) {
  for (const k of [p.key, ...p.aliases]) {
    const n = norm(k);
    if (INDEX.has(n) && INDEX.get(n) !== p) throw new Error(`Duplicate product name "${n}": ${INDEX.get(n)!.key} and ${p.key}`);
    INDEX.set(n, p);
  }
}

/** Groups in catalogue order, each with its product names: the list shown to callers. */
export function productGroups(): Array<{ group: string; keys: string[] }> {
  const out: Array<{ group: string; keys: string[] }> = [];
  for (const p of CATALOGUE) {
    let g = out.find((x) => x.group === p.group);
    if (!g) out.push((g = { group: p.group, keys: [] }));
    g.keys.push(p.key);
  }
  return out;
}

export function productHelp(): string {
  return productGroups().map((g) => `${g.group}: ${g.keys.join(", ")}`).join(". ");
}

/** "Wheat", "pig meat", "tomato" -> the Product. Throws InputError with the list of products when unknown. */
export function resolveProduct(raw?: string): Product {
  const n = norm(raw ?? "");
  if (!n) throw new InputError(`product is required. Choose one of: ${productHelp()}.`);
  const hit = INDEX.get(n) ?? INDEX.get(n.endsWith("s") ? n.slice(0, -1) : `${n}s`) ?? INDEX.get(n.replace(/ prices?$/, ""));
  if (!hit) throw new InputError(`"${raw}" is not a product we cover. Choose one of: ${productHelp()}.`);
  return hit;
}
