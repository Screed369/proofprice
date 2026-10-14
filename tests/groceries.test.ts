// Tests for the grocery category: the shared word matcher, the parameter checks and the tool description.
import { test } from "node:test";
import assert from "node:assert/strict";
import category from "../categories/groceries";
import { ItemDef, exampleWords, matchItem, normaliseWords, singular } from "../categories/groceries/items";
import { CATEGORIES, sourcesFor, toolDescription } from "../lib/registry";

const DEFS: ItemDef[] = [
  { code: "1", label: "Whole milk, per 2 litres", unit: "per 2 litres", words: ["milk", "whole milk", "full fat milk"] },
  { code: "2", label: "Semi-skimmed milk, per 2 litres", unit: "per 2 litres", words: ["semi skimmed milk", "low fat milk"] },
  { code: "3", label: "White bread, sliced, 800 g", unit: "per 800 g loaf", words: ["bread", "white bread", "sliced bread"] },
  { code: "4", label: "Potatoes, loose, per kg", unit: "per kg", words: ["potatoes", "potato"] },
  { code: "5", label: "Large eggs, per dozen", unit: "per dozen", words: ["eggs", "egg", "dozen eggs"] },
];

test("singular: plurals fold, double-s and -us words stay", () => {
  assert.equal(singular("eggs"), "egg");
  assert.equal(singular("potatoes"), "potato");
  assert.equal(singular("berries"), "berry");
  assert.equal(singular("peaches"), "peach");
  assert.equal(singular("glass"), "glass");
  assert.equal(singular("citrus"), "citrus");
  assert.equal(singular("gas"), "gas");
});

test("normaliseWords: case, accents, punctuation and filler words", () => {
  assert.equal(normaliseWords("A pint of Lagers!"), "pint lager");
  assert.equal(normaliseWords("  What is the price of Café au lait? "), "cafe au lait");
  assert.equal(normaliseWords("1% milk"), "1% milk");
  assert.equal(normaliseWords("fish & chips"), "fish and chip");
  assert.equal(normaliseWords(""), "");
  assert.equal(normaliseWords("the price of"), "");
});

test("matchItem: exact words first (table order), then every-word partial matches, never a loose guess", () => {
  assert.equal(matchItem(DEFS, "milk").primary?.code, "1");
  assert.equal(matchItem(DEFS, "Milk").primary?.code, "1");
  assert.equal(matchItem(DEFS, "low fat milk").primary?.code, "2");
  assert.equal(matchItem(DEFS, "a dozen eggs").primary?.code, "5");
  assert.equal(matchItem(DEFS, "potato").primary?.code, "4");
  assert.deepEqual(matchItem(DEFS, "milk").related.map((d) => d.code), ["2"], "the other milk is listed as related");
  // partial: every asked word appears in the item's words or label
  assert.equal(matchItem(DEFS, "sliced white bread").primary?.code, "3");
  assert.equal(matchItem(DEFS, "800 g bread").primary?.code, "3");
  // no loose matches
  assert.equal(matchItem(DEFS, "caviar").primary, null);
  assert.equal(matchItem(DEFS, "milk chocolate").primary, null);
  assert.equal(matchItem(DEFS, "").primary, null);
  assert.equal(matchItem(DEFS, "the price of").primary, null);
});

test("exampleWords: one word per definition, no repeats, capped", () => {
  assert.deepEqual(exampleWords(DEFS), ["milk", "semi skimmed milk", "bread", "potatoes", "eggs"]);
  assert.deepEqual(exampleWords(DEFS, 2), ["milk", "semi skimmed milk"]);
});

test("category: names, cache and parameters are the published contract", () => {
  assert.equal(category.id, "groceries");
  assert.equal(category.tool, "pricepaid_grocery_prices");
  assert.equal(category.restPath, "groceries");
  assert.equal(category.title, "Grocery and everyday prices");
  assert.equal(category.cacheSeconds, 86400);
  assert.deepEqual(Object.keys(category.params).sort(), ["item", "region"]);
  assert.deepEqual(category.required, ["item"]);
  assert.ok(CATEGORIES.some((c) => c.id === "groceries"));
});

test("category.prepare: item is required and trimmed, region is trimmed or dropped", () => {
  const prepare = category.prepare!;
  assert.deepEqual(prepare({ country: "IE", item: "  milk " }), { country: "IE", item: "milk" });
  assert.deepEqual(prepare({ country: "US", item: "eggs", region: " south " }), { country: "US", item: "eggs", region: "south" });
  assert.deepEqual(prepare({ country: "US", item: "eggs", region: "   " }), { country: "US", item: "eggs" });
  assert.throws(() => prepare({ country: "IE" }), /item is required/);
  assert.throws(() => prepare({ country: "IE", item: "   " }), /item is required/);
  assert.throws(() => prepare({ country: "IE", item: "x".repeat(81) }), /too long/);
});

test("tool description: says what the figures are (statistics offices, CPI shelf prices, not receipts) and names every country", () => {
  const sources = sourcesFor("groceries");
  assert.ok(sources.length >= 1);
  const d = toolDescription(category);
  assert.match(d, /^Use this when/);
  assert.match(d, /Do not use/);
  assert.match(d, /national statistics office/i);
  assert.match(d, /consumer price index/i);
  assert.match(d, /not receipts/i);
  assert.match(d, /item definition/i);
  assert.match(d, /reference month/i);
  assert.match(d, /change on a year earlier/i);
  for (const s of sources) {
    assert.ok(d.includes(s.placeName), `description should name ${s.placeName}`);
    for (const code of s.countries) assert.ok(d.includes(`country ${code}`), `description should give the country code ${code}`);
  }
});
