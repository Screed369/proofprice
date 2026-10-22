// Fixtures fixtures/week-202642.json and week-202641.json: the real datastore_search answers (national rows, Verkaufsgebiet Deutschland) for
// weeks 42 and 41 of 2026, captured 2026-10-22 through the GitHub-hosted probe (304 and 317 records).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, deWholesale, deWholesaleFromWeeks, matchQuotes, newestWeeks, parseQuotes, parseWert, previousWeekCode, weekCodeOf, weekMonday, weekUrl } from "./source";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const w42 = { week: "202642", quotes: parseQuotes(load("week-202642")) };
const w41 = { week: "202641", quotes: parseQuotes(load("week-202641")) };

test("parses the real answer: national quotations in EUR per kg", () => {
  assert.equal(w42.quotes.length, 304);
  assert.ok(w42.quotes.every((q) => q.eurPerKg > 0 && q.eurPerKg < 100 && q.week === "202642"));
});

test("a changed layout is an error", () => {
  assert.throws(() => parseQuotes({ success: true, result: {} }), /unexpected format/);
  assert.throws(() => parseQuotes({ success: true, result: { records: [{ Verkaufsgebiet: "Deutschland", Einheit: "EUR/t", Wert: "5", Produktgruppe: "X" }] } }), /no usable national/);
});

test("German thousands dots and decimal commas", () => {
  assert.equal(parseWert("1.200"), 1200);
  assert.equal(parseWert("244"), 244);
  assert.equal(parseWert("95,5"), 95.5);
  assert.equal(parseWert("1.092"), 1092);
  assert.equal(parseWert("/"), null);
  assert.equal(parseWert(""), null);
});

test("week codes have no zero padding and map to the Monday", () => {
  assert.equal(weekMonday("202642"), "2026-10-12");
  assert.equal(weekMonday("20265"), "2026-01-26");
  assert.equal(weekCodeOf(new Date("2026-10-22T12:00:00Z")), "202643");
  assert.equal(weekCodeOf(new Date("2026-01-30T12:00:00Z")), "20265");
  assert.equal(previousWeekCode("202642"), "202641");
  assert.equal(previousWeekCode("20261"), "202552");
  assert.equal(weekMonday("202699"), null);
});

test("apples: median of the national quotations, with min, max and the previous week", () => {
  const a = deWholesaleFromWeeks(w42, w41, { product: "apples" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per kg");
  const apples = w42.quotes.filter((q) => q.group === "Äpfel").map((q) => q.eurPerKg).sort((x, y) => x - y);
  assert.equal(apples.length, 64);
  const med = (apples[31] + apples[32]) / 2;
  assert.ok(Math.abs(a.price!.value! - med) < 0.001);
  assert.equal(a.price!.min, apples[0]);
  assert.equal(a.price!.max, apples[63]);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2026-10-12");
  assert.equal(a.period.to, "2026-10-18");
  assert.equal(a.extra?.quotations, 64);
  assert.ok(typeof a.extra?.previous_week_median_eur_per_kg === "number");
  assert.ok(a.price!.value! > 0.5 && a.price!.value! < 4, "apples wholesale EUR/kg is plausible");
  assert.match(a.summary, /calendar week 42 of 2026/);
});

test("English, German and variety names find the same data", () => {
  assert.equal(matchQuotes(w42.quotes, "carrots").length, 4);
  assert.equal(matchQuotes(w42.quotes, "Möhren").length, 4);
  assert.equal(matchQuotes(w42.quotes, "moehren").length, 4);
  assert.ok(matchQuotes(w42.quotes, "tomatoes").length >= 20);
  assert.ok(matchQuotes(w42.quotes, "elstar").length >= 1);
  assert.ok(matchQuotes(w42.quotes, "kiwi").length >= 12, "Kiwis and Kiwi Gold together");
});

test("unknown product gives no_matches that lists what the report covers", () => {
  const a = deWholesaleFromWeeks(w42, w41, { product: "durian" });
  assert.equal(a.status, "no_matches");
  assert.match(String(a.extra?.note), /Äpfel/);
});

test("missing product is an input error", async () => {
  await assert.rejects(() => deWholesale({ product: " " }, async () => []), /product is required/);
});

test("the newest week is found by looking back from today; a week with no rows is skipped", async () => {
  const asked: string[] = [];
  const get = async (week: string) => {
    asked.push(week);
    return week === "202642" ? w42.quotes : week === "202641" ? w41.quotes : [];
  };
  const { latest, previous } = await newestWeeks(new Date("2026-10-22T10:00:00Z"), get);
  assert.deepEqual(asked, ["202643", "202642", "202641"]);
  assert.equal(latest.week, "202642");
  assert.equal(previous?.week, "202641");
  const a = await deWholesale({ product: "pears" }, get, new Date("2026-10-22T10:00:00Z"));
  assert.equal(a.status, "ok");
});

test("a feed that stopped is an error, not an old price", async () => {
  await assert.rejects(() => newestWeeks(new Date("2026-10-22T10:00:00Z"), async () => []), /last eight weeks/);
});

test("the request filters one week and the national area", () => {
  const u = decodeURIComponent(weekUrl("202642"));
  assert.match(u, /^https:\/\/open-data\.ble\.de\/api\/3\/action\/datastore_search\?resource_id=d92b81a6-/);
  assert.match(u, /"Woche \(KW\)":"202642"/);
  assert.match(u, /"Verkaufsgebiet":"Deutschland"/);
});

test("licence and attribution are filled in", () => {
  assert.match(INFO.licence, /Zero/);
  assert.match(INFO.licence_url, /dl-de\/zero-2-0/);
  assert.match(INFO.attribution, /BLE/);
  assert.equal(INFO.price_type, "posted_price");
});
