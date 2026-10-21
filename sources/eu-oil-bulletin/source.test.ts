// Real formats, checked live on 2026-10-14 (bulletin dated Monday 12 October 2026):
//  - the bulletin page (energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en) links "Price developments 2005 onwards (xlsx)"
//    as /document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx
//  - that workbook's sheet "Prices with taxes" has: row 0 column codes ("IE_price_with_tax_diesel", "PL_exchange_rate", "EU_price_with_tax_euro95"...),
//    row 1 product names, row 2 units ("1000 l"), then one row per week, newest first, column A = the Monday as an Excel date serial (46307 = 2026-10-12).
//    Prices are euro per 1000 litres, converted into euro by the Commission; "<CC>_exchange_rate" is euro per unit of national currency.
// HISTORY_ROWS (./fixtures.ts) are real rows from that sheet. Only the number of countries and weeks is reduced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { readXlsx } from "../../categories/rent/xlsx";
import { writeDaily } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";
import { HISTORY_ROWS } from "./fixtures";
import def from "./index";
import {
  COUNTRIES, HISTORY_URL, INFO, NATIONAL_CURRENCY, STAND_IN, findHistoryUrl, harvestOptions, parseHistory, pickPrevious, pickYearEarlier, previousWeek,
  wobAnswer, wobFuelNow, wobHarvest, wobHistoryKey, wobMonthly, wobResult, wobRows, yearEarlierWeek,
} from "./source";

/** The fixture keeps 10 of the 23 countries, so the "far too few countries" guard is lowered for it. */
const weeks = () => parseHistory(HISTORY_ROWS, 60, 5);
const NOW = new Date("2026-10-15T12:00:00Z");

/** The collector's day, written to a fresh library directory (what `npm run harvest` does), then read back like a request. */
function libraryWithFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wob-lib-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const h = wobResult(weeks());
  writeDaily(INFO.id, h);
  return dir;
}

test("parseHistory: newest week first, euro per litre, only the countries this source answers or stands in for", () => {
  const w = weeks();
  assert.equal(w.length, 6);
  assert.deepEqual(w.map((x) => x.date), ["2026-10-12", "2026-10-05", "2026-09-28", "2025-10-20", "2025-10-13", "2025-10-06"]);
  const ie = w[0].prices.IE;
  assert.deepEqual(ie, { petrol95: 1.9827, diesel: 2.1637, heating_oil: 1.48725 }); // no LPG price for Ireland
  assert.equal(w[0].prices.PL.diesel, 1.79469);
  assert.equal(w[0].prices.PL.lpg, 0.77337);
  assert.equal(w[0].prices.DE.lpg, 1.133);
  assert.equal(w[0].prices.EU.petrol95, 2.00976); // the EU27 weighted average
  // France is answered by its own source; the bulletin's figure is kept so it can stand in when that source is down
  assert.ok(w[0].prices.FR.diesel! > 1 && w[0].prices.FR.diesel! < 3, "France's diesel in euro per litre");
  assert.ok(w[0].prices.FR.petrol95! > 1 && w[0].prices.FR.petrol95! < 3);
    assert.ok(!("EUR" in w[0].prices), "the euro-area column is not kept");
  assert.equal(w[0].fx.PL, 0.2280501710);
  assert.equal(w[0].fx.BG, 1);
  assert.equal(w[4].fx.BG, 0.5112997239); // a year earlier Bulgaria still had the lev
  assert.equal(w[4].prices.IE.diesel, 1.666);
});

test("parseHistory: a changed layout is refused with a plain message", () => {
  assert.throws(() => parseHistory([["a"], ["b"]]), /no '<country>_price_with_tax_euro95' columns/);
  const noUnits = HISTORY_ROWS.filter((r, i) => i !== 2);
  assert.throws(() => parseHistory(noUnits, 60, 5), /no unit row/);
  const wrongUnit = HISTORY_ROWS.map((r, i) => (i === 2 ? r.map((c) => (c === "1000 l" ? "t" : c)) : r));
  assert.throws(() => parseHistory(wrongUnit, 60, 5), /not '1000 l'/);
  // a newest week with almost no countries is not a real bulletin
  const thin = HISTORY_ROWS.map((r, i) => (i === 3 ? r.map((c, j) => (j > 40 && typeof c === "number" ? null : c)) : r));
  assert.throws(() => parseHistory(thin, 60, 5), /Euro-super 95 prices for only/);
  assert.throws(() => parseHistory(HISTORY_ROWS), /Euro-super 95 prices for only 10 countries/); // the real threshold (15) refuses a thin file
});

test("previous week and the same week a year earlier", () => {
  const w = weeks();
  assert.equal(previousWeek(w)?.date, "2026-10-05");
  assert.equal(yearEarlierWeek(w)?.date, "2025-10-13"); // 364 days before 2026-10-12, not the 6th or 20th
  assert.equal(previousWeek([w[0]]), null);
  assert.equal(yearEarlierWeek(w.slice(0, 3)), null);
  // a skipped week: fall back to the closest earlier one within two weeks
  assert.equal(previousWeek([w[0], w[2]])?.date, "2026-09-28");
  assert.equal(previousWeek([w[0], w[3]]), null);
  const list = [{ date: "2025-10-06", value: 1 }, { date: "2025-10-13", value: 2 }, { date: "2025-10-20", value: 3 }];
  assert.equal(pickYearEarlier(list, "2026-10-12")?.value, 2);
  assert.equal(pickYearEarlier(list.slice(0, 1), "2026-10-12"), null); // 6 days off is not "a year earlier"
  assert.equal(pickPrevious([{ date: "2026-10-05", value: 1 }, { date: "2026-09-28", value: 2 }], "2026-10-12")?.value, 1);
});

test("library rows: published figures, dated earlier prices, exchange rates only for countries with their own currency", () => {
  const rows = wobRows(weeks());
  assert.ok(rows.every((r) => Number.isNaN(r.n) && r.median === r.low && r.low === r.high && r.high === r.min && r.min === r.max), "published values, no record count");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item)?.median;
  assert.equal(get("IE", "diesel"), 2.1637);
  assert.equal(get("IE", "diesel@2026-10-05"), 2.1637);
  assert.equal(get("IE", "diesel@2025-10-13"), 1.666);
  assert.equal(get("IE", "petrol95@2025-10-13"), 1.7189);
  assert.equal(get("IE", "lpg"), undefined);
  assert.equal(get("EU", "diesel"), 2.13588);
  assert.equal(get("PL", "fx"), 0.2280501710);
  assert.equal(get("PL", "fx@2025-10-13"), 0.2346591576);
  assert.equal(get("BG", "fx"), undefined);
  assert.equal(get("DE", "fx"), undefined);
  assert.ok(!rows.some((r) => ["EUR"].includes(r.area)));
  assert.ok(rows.some((r) => r.area === "FR" && r.item === "diesel"), "stand-in rows are kept for France");
  assert.ok(!rows.some((r) => r.area === "FR" && r.item === "fx"), "France is in the euro");
  assert.ok(rows.some((r) => r.area === "MT" && r.item === "heating_oil" && r.median === 1));
  assert.ok(!rows.some((r) => r.item.includes("@") && !/@\d{4}-\d{2}-\d{2}$/.test(r.item)));
  assert.deepEqual(Object.keys(NATIONAL_CURRENCY).sort(), ["CZ", "DK", "HU", "PL", "RO", "SE"]);
});

test("the history link is found on the bulletin page markup", () => {
  const html = `<div class="ecl-file__info"><div class="ecl-file__title">Price developments 2005 onwards (xlsx)</div></div><a class="ecl-file__download" href="/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx" download>Download</a>
<a href="/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202026-09-21.xlsx">Download</a>`;
  assert.equal(findHistoryUrl(html), HISTORY_URL);
  assert.equal(findHistoryUrl("<a href=\"/x.pdf\">x</a>"), null);
});

const workbook = () =>
  makeXlsx({
    "Prices with taxes": HISTORY_ROWS,
    "Prices wo taxes": [["Consumer prices of petroleum products net of duties and taxes", "CTR", "EU_price_wo_tax_euro95"], [null, null, "Euro-super 95  (I)"], ["Date", null, "1000 l"], [46307, "EU_", 1112.6427395865062]],
  });

function fakeSite(opts: { page?: boolean; file?: boolean } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  const xlsx = workbook();
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u === "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en") {
      return opts.page === false
        ? new Response("busy", { status: 503 })
        : new Response(`<a href="/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx">Download</a>`, { status: 200 });
    }
    if (u === HISTORY_URL && opts.file !== false) return new Response(xlsx, { status: 200 });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest end to end (fake Commission site): reads the history workbook and returns the newest week", async () => {
  harvestOptions.retryDelayMs = 0;
  const site = fakeSite();
  try {
    const h = await wobHarvest(5);
    assert.deepEqual(site.calls, ["https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en", HISTORY_URL]);
    assert.equal(h.date, "2026-10-12");
    assert.equal(h.currency, "EUR");
    assert.equal(h.unit, "per litre");
    assert.ok(h.rows.some((r) => r.area === "IE" && r.item === "diesel" && r.median === 2.1637));
    assert.match(h.note ?? "", /previous week 2026-10-05, year earlier 2025-10-13/);
  } finally {
    site.restore();
  }
  // the page lookup is only a convenience: if the page is down the stable document address is used
  const noPage = fakeSite({ page: false });
  try {
    assert.equal((await wobHarvest(5)).date, "2026-10-12");
    assert.equal(noPage.calls.at(-1), HISTORY_URL);
  } finally {
    noPage.restore();
  }
  // a missing file is a clear error, never an empty library day
  const noFile = fakeSite({ file: false });
  try {
    await assert.rejects(wobHarvest(5), (e: any) => e instanceof SourceError && /Could not download/.test(e.message));
  } finally {
    noFile.restore();
  }
});

test("the real sheet layout survives an actual .xlsx round trip", () => {
  const sheet = readXlsx(workbook()).find((s) => s.name === "Prices with taxes")!;
  assert.equal(parseHistory(sheet.rows, 60, 5)[0].prices.IE.diesel, 2.1637);
});

test("answer from the library: the published national average, with the change on the week and the year", async () => {
  libraryWithFixture();
  try {
    const a = await wobFuelNow({ country: "IE", fuel: "diesel" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.confidence, "high");
    assert.equal(a.price?.currency, "EUR");
    assert.equal(a.price?.unit, "per litre");
    assert.equal(a.price?.measure, "average");
    assert.equal(a.price?.value, 2.1637);
    assert.equal(a.price?.median, null);
    assert.equal(a.price?.typical_low, null);
    assert.equal(a.sample_size, null);
    assert.deepEqual(a.period, { from: "2026-10-12", to: "2026-10-12" });
    assert.equal(a.statistic?.reference_period, "2026-10-12");
    assert.match(a.summary, /^In Ireland the average pump price of diesel \(automotive gas oil\) was €2\.1637 per litre \(all duties and taxes included\)/);
    assert.match(a.summary, /prices in force on 12 October 2026, unchanged on the previous week \(5 October 2026\) and 29\.9% higher than a year earlier \(13 October 2025\)\./);
    assert.match(a.summary, /Official average published by European Commission, Directorate-General for Energy for 2026-10-12\./);
    assert.match(a.source.licence, /Creative Commons Attribution 4\.0 International \(CC BY 4\.0\)/);
    assert.equal(a.source.licence_url, "https://commission.europa.eu/legal-notice_en");
    assert.ok(!a.statistic?.note, "nothing to warn about for a fresh national answer");
    const x = a.extra as any;
    assert.equal(x.country_name, "Ireland");
    assert.equal(x.bulletin_date, "2026-10-12");
    assert.equal(x.price_eur_per_1000_litres, 2163.7);
    assert.equal(x.change_on_previous_week.change_percent, 0);
    assert.equal(x.change_on_year_earlier.price_eur_per_litre, 1.666);
    assert.equal(x.change_on_year_earlier.change_percent, 29.9);
    assert.equal(x.eu27_weighted_average_eur_per_litre, 2.13588);
    assert.equal(x.heating_gas_oil_eur_per_litre, 1.48725);
    assert.deepEqual(x.published_prices_eur_per_litre, { petrol95: 1.9827, diesel: 2.1637, heating_gas_oil: 1.48725 });
    assert.equal(x.national_currency, undefined);
    assert.match(x.bulletin_note, /most frequently charged, based on a weighted average/);

    const de = await wobFuelNow({ country: "de", fuel: "petrol95" }, NOW);
    assert.equal(de.price?.value, 2.214);
    assert.match(de.summary, /In Germany the average pump price of unleaded petrol \(Euro-super 95\) was €2\.2140 per litre/);

    const lpg = await wobFuelNow({ country: "DE", fuel: "lpg" }, NOW);
    assert.equal(lpg.price?.value, 1.133);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("a country with its own currency also gets the price and the change in that currency", async () => {
  libraryWithFixture();
  try {
    const a = await wobFuelNow({ country: "PL", fuel: "diesel" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.price?.value, 1.79469);
    const n = (a.extra as any).national_currency;
    assert.equal(n.currency, "PLN");
    assert.equal(n.exchange_rate_eur_per_unit, 0.228050171);
    assert.equal(n.price_per_litre, Math.round((1.79469 / 0.228050171) * 1000) / 1000); // about 7.87 zloty
    assert.ok(n.price_per_litre > 7.8 && n.price_per_litre < 7.95);
    assert.equal(n.previous_week.date, "2026-10-05");
    assert.equal(n.year_earlier.date, "2025-10-13");
    // the zloty weakened against the euro over the year (0.2347 -> 0.2281 euro per zloty), so the rise in zloty is larger than the rise in euro
    assert.equal(n.year_earlier.price_per_litre, Math.round((1.3936 / 0.2346591576) * 1000) / 1000);
    assert.ok(n.year_earlier.change_percent > (a.extra as any).change_on_year_earlier.change_percent);
    assert.match(a.summary, /\(all duties and taxes included; about 7\.87 PLN per litre\) in the Weekly Oil Bulletin/);
    assert.match(a.statistic?.note ?? "", /outside the euro/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("a place or postcode is answered nationally, and says so", async () => {
  libraryWithFixture();
  try {
    const a = await wobFuelNow({ country: "IE", fuel: "diesel", town: "Cork", postcode: "T12 X2Y3" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.price?.value, 2.1637);
    assert.match(a.summary, /^Ireland is covered by national averages only \(you asked about postcode T12 X2Y3, Cork\)\./);
    assert.match(a.statistic?.note ?? "", /national average for Ireland, not a price for that place/);
    assert.equal((a.extra as any).answered_as, "national average");
    assert.equal((a.query as any).town, "Cork");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("old data is flagged plainly", async () => {
  libraryWithFixture();
  try {
    const fresh = await wobFuelNow({ country: "IE", fuel: "diesel" }, new Date("2026-10-29T00:00:00Z")); // 17 days
    assert.ok(!(fresh.extra as any).stale_warning);
    const old = await wobFuelNow({ country: "IE", fuel: "diesel" }, new Date("2026-11-20T00:00:00Z"));
    assert.match(old.summary, /This is old data: 39 days have passed since that bulletin\./);
    assert.match(old.statistic?.note ?? "", /newest bulletin we hold is for 12 October 2026, 39 days ago/);
    assert.equal((old.extra as any).data_age_days, 39);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("a fuel the country does not report is no_matches, not a made-up number", async () => {
  libraryWithFixture();
  try {
    const a = await wobFuelNow({ country: "IE", fuel: "lpg" }, NOW);
    assert.equal(a.status, "no_matches");
    assert.equal(a.price, null);
    assert.match(a.summary, /carries no LPG motor fuel \(autogas\) price for Ireland/);
    assert.match(a.summary, /It does carry: unleaded petrol \(Euro-super 95\), diesel \(automotive gas oil\), heating gas oil\./);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("input errors are InputErrors with a way forward", async () => {
  libraryWithFixture();
  try {
    for (const fuel of ["petrol98", "e10", "e85", "methane"]) {
      await assert.rejects(wobFuelNow({ country: "IE", fuel }, NOW), (e: any) => e instanceof InputError && /petrol95 \(Euro-super 95\), diesel or lpg/.test(e.message));
    }
    for (const country of ["US", "GB", "XX"]) {
      await assert.rejects(wobFuelNow({ country, fuel: "diesel" }, NOW), (e: any) => e instanceof InputError && /answers for IE, AT, DE/.test(e.message));
    }
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("standing in for a national source: France's national figure, and a place is answered nationally without claiming coverage", async () => {
  libraryWithFixture();
  try {
    const a = await wobFuelNow({ country: "FR", fuel: "diesel", postcode: "75015" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "eu-oil-bulletin");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.sample_size, null);
    assert.match(a.summary, /^This is the national average for France, not a figure for postcode 75015\. In France the average pump price of diesel/);
    assert.ok(!/covered by national averages only/.test(a.summary));
    assert.equal((a.extra as any).answered_as, "national average");
    assert.deepEqual(STAND_IN, { ES: "Spain", FR: "France", IT: "Italy" });
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "wob-empty-"));
  try {
    await assert.rejects(wobFuelNow({ country: "IE", fuel: "diesel" }), (e: any) => e instanceof SourceError && /Not yet available/.test(e.message));
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("pure answer: a country missing from the library rows is no_matches", () => {
  const a = wobAnswer({ date: "2026-10-12", rows: [] }, { country: "IE", fuel: "diesel" }, NOW);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("history key: country and fuel, national", () => {
  assert.deepEqual(wobHistoryKey({ country: "IE", fuel: "diesel" }), { area: "IE", item: "diesel", label: "Ireland (national average)" });
  assert.equal(wobHistoryKey({ country: "PL", fuel: "lpg" })?.item, "lpg");
  assert.equal(wobHistoryKey({ country: "IE", fuel: "e10" }), null);
  assert.equal(wobHistoryKey({ country: "ES", fuel: "diesel" }), null);
});

test("manifest and INFO: the countries, the examples, the licence quoted from the Commission", () => {
  assert.deepEqual([...def.countries].sort(), "IE AT DE NL BE PT PL DK SE FI LU GR CZ SK SI HR HU RO BG EE LV LT CY MT".split(" ").sort());
  assert.deepEqual(def.countries, Object.keys(COUNTRIES));
  for (const c of ["ES", "FR", "IT"]) assert.ok(!def.countries.includes(c), `${c} has its own source`);
  assert.deepEqual(def.fallbackFor, { sources: ["it-fuel", "fr-fuel", "es-fuel"], countries: ["IT", "FR", "ES"], label: "the European Commission Weekly Oil Bulletin" });
  assert.match(INFO.limits, /this bulletin's national figure for that country is given instead and the answer says so/);
  assert.equal(def.category, "fuel");
  assert.deepEqual(def.examples[0].params, { country: "IE", fuel: "diesel" });
  assert.deepEqual(def.examples.map((e) => e.params.country), ["IE", "DE", "PL"]);
  assert.ok(def.harvest && def.historyKey);
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /reuse is allowed, provided appropriate credit is given and changes are indicated/);
  assert.match(INFO.licence, /Reproduction is authorised provided the source is acknowledged/);
  assert.equal(INFO.homepage, "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en");
  assert.match(INFO.limits, /national average/);
});

test("wobMonthly: monthly average of the weekly figures, min/max as the range, thin months left out", () => {
  const ws = parseHistory(HISTORY_ROWS, Infinity, 5);
  const months = [...new Set(ws.map((w) => w.date.slice(0, 7)))].sort();
  const periods = wobMonthly(ws, months[0], months[months.length - 1]);
  assert.ok(periods.length >= 1);
  for (const p of periods) {
    assert.match(p.period, /^\d{4}-\d{2}$/);
    const inMonth = ws.filter((w) => w.date.startsWith(p.period));
    assert.ok(inMonth.length >= 3);
    for (const r of p.rows) {
      assert.ok(Number.isNaN(r.n) && r.min <= r.low && r.low <= r.median && r.median <= r.high && r.high <= r.max);
      assert.ok(["petrol95", "diesel", "lpg"].includes(r.item));
      const vals = inMonth.map((w) => w.prices[r.area]?.[r.item as "diesel"]).filter((v): v is number => v !== undefined);
      assert.equal(r.low, Math.min(...vals));
      assert.equal(r.high, Math.max(...vals));
    }
  }
  // a month with only two weeks gives no figure
  const two = ws.filter((w) => w.date.slice(0, 7) === months[0]).slice(0, 2);
  assert.deepEqual(wobMonthly(two, months[0], months[0]), []);
  // the range is respected
  assert.deepEqual(wobMonthly(ws, "1990-01", "1990-12"), []);
});

test("Austria (G20261021-AT-FUEL): the national weekly average, labelled as an official statistic with no sample size", async () => {
  // The fixture is the real sheet with the Austrian columns appended in the same layout as every other country
  // (AT_price_with_tax_euro95 / diesel / heating_oil / LPG, euro per 1000 l). The figures are illustrative round numbers, not a bulletin quote.
  const rows = HISTORY_ROWS.map((r) => r.slice());
  const at = ["AT_price_with_tax_euro95", "AT_price_with_tax_diesel", "AT_price_with_tax_heating_oil", "AT_price_with_tax_fuel_oil_1", "AT_price_with_tax_fuel_oil_2", "AT_price_with_tax_LPG"];
  rows[0].push("CTR", ...at);
  rows[1].push(null, ...at.map(() => "x"));
  rows[2].push(null, "1000 l", "1000 l", "1000 l", "t", "t", "1000 l");
  rows.slice(3).forEach((r, i) => r.push("AT_", 1700 - i, 1800 - i, 1300, null, null, null));
  const w = parseHistory(rows, 60, 5);
  assert.equal(w[0].prices.AT.diesel, 1.8);
  assert.equal(w[0].prices.AT.petrol95, 1.7);
  const dir = mkdtempSync(path.join(tmpdir(), "wob-at-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    writeDaily(INFO.id, wobResult(w));
    const a = await wobFuelNow({ country: "AT", fuel: "diesel" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "eu-oil-bulletin");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.sample_size, null);
    assert.match(a.summary, /Austria/);
    assert.deepEqual(wobHistoryKey({ country: "AT", fuel: "diesel" }), { area: "AT", item: "diesel", label: "Austria (national average)" });
    assert.ok(def.countries.includes("AT"));
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
