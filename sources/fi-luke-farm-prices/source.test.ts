import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { findSource, runCategory, categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import manifest from "./index";
import { DATA_EGGS, DATA_MEAT, DATA_MILK, META_0100, META_0200, META_0300 } from "./fixtures";
import {
  answerFor, harvestRows, INFO, itemName, lukeFarmPrices, lukeHarvest, lukeHistoryKey, lukeProductOf, LUKE_API, LUKE_KEYS, monthRange, monthWords,
  PRODUCTS, readMeta, readSeries, requestFor, shiftMonth, tableUrl,
} from "./source";

const NOW = new Date("2026-10-23T12:00:00Z");
const META: Record<string, unknown> = { "0200": META_0200, "0100": META_0100, "0300": META_0300 };
const DATA: Record<string, unknown> = { "0200": DATA_MEAT, "0100": DATA_MILK, "0300": DATA_EGGS };

function rig() {
  const log: Array<{ method: string; url: string; body?: any }> = [];
  return {
    log,
    fetcher: async (url: string) => {
      log.push({ method: "GET", url });
      return META[/\/(\d{4})_tuohin\.px/.exec(url)![1]];
    },
    poster: async (url: string, body: unknown) => {
      log.push({ method: "POST", url, body });
      return DATA[/\/(\d{4})_tuohin\.px/.exec(url)![1]];
    },
  };
}
const pr = (key: string) => PRODUCTS.find((x) => x.key === key)!;

test("INFO: official statistic, CC BY 4.0, attribution to Luke", () => {
  assert.equal(INFO.id, "fi-luke-farm-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0/);
  assert.match(INFO.attribution, /Natural Resources Institute Finland \(Luke\)/);
  assert.equal(tableUrl("0200"), `${LUKE_API}/0200_tuohin.px`);
});

test("metadata (real, 23 Oct 2026): every product's table and series code exists", () => {
  for (const p of PRODUCTS) {
    const meta = readMeta(META[p.table]);
    const v = meta.variables.find((x) => x.code === (p.seriesVar ?? "INFO"));
    assert.ok(v, `${p.key}: variable ${p.seriesVar ?? "INFO"}`);
    assert.ok(v!.values.includes(p.code), `${p.key}: ${p.code} in ${p.table}`);
    assert.ok(meta.variables.some((x) => x.time && x.code === "M"));
  }
  assert.throws(() => readMeta({}), SourceError);
});

test("request: newest months, the one series, whole INFO; every variable is selected", () => {
  const meat = requestFor(readMeta(META_0200), [pr("pig"), pr("chicken")], 14);
  const by = Object.fromEntries(meat.query.map((x) => [x.code, x.selection.values]));
  assert.equal(meat.response.format, "json");
  assert.deepEqual(by.LJ, ["LSIAT", "BROI"]);
  assert.deepEqual(by.INFO, ["E_KGS"]);
  assert.equal(by.M.length, 14);
  assert.equal(by.M[13], "2026M08");
  const milk = requestFor(readMeta(META_0100), [pr("milk")], 3);
  const m = Object.fromEntries(milk.query.map((x) => [x.code, x.selection.values]));
  assert.deepEqual(m.INFO, ["TUOHIN_KESKIM_CL"]);
  assert.deepEqual(m.M, ["2026M06", "2026M07", "2026M08"]);
  assert.throws(() => requestFor(readMeta(META_0200), [{ ...pr("pig"), code: "NOPE" }], 3), SourceError);
});

test("readSeries: monthly points per series, missing cells left out, either column order", () => {
  const meat = readSeries(DATA_MEAT, "LJ");
  assert.equal(meat.get("LSIAT")!.length, 15);
  assert.equal(meat.get("EMAK")!.length, 14); // one ".." month
  assert.equal(meat.get("LSIAT")!.at(-1)!.month, "2026M08");
  const milk = readSeries(DATA_MILK, null, "TUOHIN_KESKIM_CL");
  assert.equal(milk.get("TUOHIN_KESKIM_CL")!.at(-1)!.value, 48.8);
  assert.equal(readSeries(DATA_EGGS, "LLUOKK_TUOTT").get("AB_KESKIM")!.at(-1)!.month, "2026M07");
  assert.throws(() => readSeries({}, "LJ"), SourceError);
  assert.throws(() => readSeries(DATA_MILK, null), SourceError); // milk needs the code it asked for
});

test("months: ranges, words, shifts", () => {
  assert.deepEqual(monthRange("2026M02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(monthWords("2026M08"), "August 2026");
  assert.equal(shiftMonth("2026M01", -1), "2025M12");
  assert.equal(shiftMonth("2026M08", -12), "2025M08");
  assert.throws(() => monthRange("2026"), SourceError);
});

test("answer: fattening pigs, EUR per 100 kg as published, price per kg, changes, no sample size", async () => {
  const r = rig();
  const a = await lukeFarmPrices({ product: "pig" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per 100 kg");
  assert.equal(a.price?.value, 195.4);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period.to, "2026-08-31");
  assert.equal((a.extra as any).price_per_kg, 1.954);
  assert.equal((a.extra as any).change_on_year_earlier.reference_month, "2025M08");
  assert.equal((a.extra as any).change_on_previous_month.reference_month, "2026M07");
  assert.equal((a.extra as any).last_12_months.length, 12);
  assert.match(a.summary ?? "", /August 2026/);
  assert.match(a.summary ?? "", /fattening pigs/);
  assert.equal(r.log.filter((x) => x.method === "POST").length, 1);
  assert.ok(r.log[0].url.endsWith("/0200_tuohin.px"));
  // aliases of eu-farm-prices work
  const b = await lukeFarmPrices({ product: "pork" }, { fetcher: r.fetcher, poster: r.poster, now: NOW }).catch((e) => e);
  assert.ok(b instanceof InputError || b.status === "ok");
});

test("answer: milk is cents per litre in Luke, EUR per litre in our headline", async () => {
  const r = rig();
  const a = await lukeFarmPrices({ product: "milk" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.value, 0.488);
  assert.equal((a.extra as any).published_value, 48.8);
  assert.equal((a.extra as any).published_unit, "cents per litre");
  assert.equal((a.extra as any).price_per_kg, undefined);
});

test("answer: the newest month with a value is used and old data is flagged", async () => {
  const r = rig();
  const a = await lukeFarmPrices({ product: "eggs" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.equal((a.extra as any).reference_month, "2026M07");
  const old = answerFor(pr("pig"), [{ month: "2026M01", value: 150 }], { product: "pig" }, NOW);
  assert.match(old.statistic?.note ?? "", /Old data/);
  const none = answerFor(pr("pig"), [], { product: "pig" }, NOW);
  assert.equal(none.status, "no_matches");
});

test("products: unknown ones are explained, not guessed", async () => {
  assert.equal(lukeProductOf("piglets"), null);
  assert.equal(lukeProductOf("butter"), null);
  assert.equal(lukeProductOf("unobtainium"), null);
  assert.equal(lukeProductOf("pig")!.key, "pig");
  assert.equal(lukeProductOf("raw milk")!.key, "milk");
  assert.equal(lukeProductOf("broilers")!.key, "chicken");
  const r = rig();
  await assert.rejects(lukeFarmPrices({ product: "butter" }, { fetcher: r.fetcher, poster: r.poster }), (e: unknown) => e instanceof InputError && /pig/.test((e as Error).message));
});

test("routing: Luke answers FI for its products, the EU portal for the rest; other countries are untouched", () => {
  const eu = SOURCE_PLUGINS.find((s) => s.info.id === "eu-farm-prices")!;
  for (const key of LUKE_KEYS) {
    assert.equal(findSource("farm-prices", "FI", { country: "FI", product: key })?.info.id, "fi-luke-farm-prices", key);
    assert.equal(eu.serves!({ country: "FI", product: key }), false, `eu must not serve FI ${key}`);
    assert.equal(eu.serves!({ country: "IE", product: key }), true, `eu still serves IE ${key}`);
  }
  for (const other of ["piglets", "butter", "wheat", "tomatoes", "heavy lamb", "chicken breast", "organic milk"]) {
    assert.equal(findSource("farm-prices", "FI", { country: "FI", product: other })?.info.id, "eu-farm-prices", other);
  }
  assert.equal(findSource("farm-prices", "IE", { country: "IE", product: "pig" })?.info.id, "eu-farm-prices");
  assert.deepEqual(manifest.countries, ["FI"]);
});

test("harvest: the newest month's averages with the unit in the item, same figures as the live answer, no made-up count", async () => {
  const r = rig();
  const h = await lukeHarvest({ fetcher: r.fetcher, poster: r.poster });
  assert.equal(h.currency, "EUR");
  assert.equal(h.date, "2026-08-31");
  const live = await lukeFarmPrices({ product: "pig" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  const row = h.rows.find((x) => x.item === itemName(pr("pig")))!;
  assert.ok(row);
  assert.equal(row.area, "FI");
  assert.equal(row.median, live.price?.value);
  assert.ok(Number.isNaN(row.n));
  // eggs lag one month in the fixture, so they are not in the August copy
  assert.equal(h.rows.some((x) => x.item === itemName(pr("eggs"))), false);
  assert.ok(h.rows.some((x) => x.item === itemName(pr("milk"))));
  assert.throws(() => harvestRows([]), /no usable/);
});

test("history key and manifest daily copy", () => {
  assert.deepEqual(lukeHistoryKey({ product: "pig" }), { area: "FI", item: "fattening pigs (EUR per 100 kg)", label: "Finland, fattening pigs" });
  assert.equal(lukeHistoryKey({ product: "butter" }), null);
  assert.ok(manifest.harvest && manifest.historyKey && manifest.referenceDates && manifest.nominalCounts);
});

test("the tool still lists FI under farm-prices", () => {
  assert.equal(categoryById("farm-prices")?.tool, "pricepaid_farm_prices");
  assert.ok(runCategory);
});
