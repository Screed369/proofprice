// Fixtures: fixtures/fruit-2026-10.zip and veg-2026-10.zip hold the REAL daily files RF/RH 281026, 291026 and 301026 downloaded on 2026-11-09 from
// https://mercadocentral.gob.ar/sites/default/files/precios_mayoristas/ (FRUTAS_OCTUBRE_26.zip, HORTALIZA_OCTUBRE_26_0.zip); fixtures/page-links.txt holds the real ZIP links of
// https://mercadocentral.gob.ar/informaci%C3%B3n/precios-mayoristas (read the same day).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { unzipAll } from "../../categories/rent/xlsx";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { answerFromDays, arHarvest, arHistoryKey, arWholesale, dayFromName, harvestFromRows, loadDays, parseDay, parsePageLinks, PAGE_URL, readBiff2, resolveProduct } from "./source";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const FRUIT_ZIP = fx("fruit-2026-10.zip");
const VEG_ZIP = fx("veg-2026-10.zip");
const LINKS = readFileSync(new URL("./fixtures/page-links.txt", import.meta.url), "utf8").trim().split("\n");
const PAGE = LINKS.map((l) => `<span class="file"><a href="${l}" type="application/zip">x</a></span>`).join("\n");

const get = async (url: string): Promise<Buffer> => {
  if (url === PAGE_URL) return Buffer.from(PAGE);
  if (/FRUTAS_OCTUBRE_26\.zip$/.test(url)) return FRUIT_ZIP;
  if (/HORTALIZA_OCTUBRE_26_0\.zip$/.test(url)) return VEG_ZIP;

  throw new SourceError(`unexpected ${url}`);
};

// November files are not in the fixture: make the newest month empty so the reader falls back to October.
const getOct = async (url: string): Promise<Buffer> => {
  if (/NOVIEMBRE/.test(url)) return emptyZip();
  return get(url);
};
function emptyZip(): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  return eocd;
}

const day = (zip: Buffer, name: string) => unzipAll(zip).get(name)!;

test("ar-cmcba: the Excel 2.0 file is read: header, text with the N-tilde and numbers", () => {
  const rows = readBiff2(day(FRUIT_ZIP, "RF301026.XLS"));
  assert.deepEqual(rows[0].slice(0, 8), ["ESP", "VAR", "PROC", "ENV", "KG", "CAL", "TAM", "GRADO"]);
  assert.ok(rows[0].includes("MOPK"));
  assert.ok(rows.length > 100);
  assert.ok(rows.some((r) => r[0] === "ANANA" && r[1] === "PINA")); // "PI¥A" in the file: 0xA5 is N-tilde in code page 437
  const pine = rows.find((r) => r[0] === "ANANA" && r[1] === "PINA" && typeof r[4] === "number")!;
  assert.equal(typeof pine[4], "number");
  assert.equal(typeof pine[12], "number");
});

test("ar-cmcba: a changed format is a SourceError, never misread", () => {
  assert.throws(() => readBiff2(Buffer.from("<html>moved</html>")), SourceError);
  const ole = Buffer.alloc(600);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole);
  assert.throws(() => readBiff2(ole), /OLE2/);
  assert.throws(() => parseDay(Buffer.from([9, 0, 4, 0, 2, 0, 0x10, 0, 10, 0, 0, 0]), "fruit", "2026-10-30"), /different header/);
});

test("ar-cmcba: file names give kind and date", () => {
  assert.deepEqual(dayFromName("RF281026.XLS"), { kind: "fruit", date: "2026-10-28" });
  assert.deepEqual(dayFromName("RH011126.xls"), { kind: "veg", date: "2026-11-01" });
  assert.equal(dayFromName("HORTALIZA_NOVIEMBRE-26.rar"), null);
  assert.equal(dayFromName("Links/readme.txt"), null);
  assert.equal(dayFromName("RF321326.XLS"), null);
});

test("ar-cmcba: real page links are placed by kind and month despite irregular names", () => {
  const z = parsePageLinks(PAGE);
  assert.equal(z.length, 22);
  const has = (kind: string, ym: string) => z.some((x) => x.kind === kind && x.ym === ym);
  for (const ym of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) {
    assert.ok(has("fruit", ym), `fruit ${ym}`);
    assert.ok(has("veg", ym), `veg ${ym}`);
  }
  assert.match(z.find((x) => x.kind === "fruit" && x.ym === "2026-09")!.url, /SEPTIEMBRE/); // HORTALIZA_SEPTIENBRE (typo) is placed too
  assert.match(z.find((x) => x.kind === "veg" && x.ym === "2026-09")!.url, /SEPTIENBRE/);
});

test("ar-cmcba: parsing a real vegetable day drops species averages and gives ARS per kg", () => {
  const rows = parseDay(day(VEG_ZIP, "RH301026.XLS"), "veg", "2026-10-30");
  assert.ok(rows.length > 150);
  assert.ok(rows.every((r) => !/prom/i.test(r.variety) && r.price > 0 && r.kg > 0));
  const tomato = rows.filter((r) => r.species === "TOMATE");
  assert.ok(tomato.length >= 10);
  for (const t of tomato) assert.ok(t.price > 100 && t.price < 20000, `tomato ${t.price}`);
});

test("ar-cmcba: products resolve from English and Spanish names, unknown ones do not", () => {
  assert.equal(resolveProduct("Tomatoes")?.key, "tomato");
  assert.equal(resolveProduct("manzana")?.key, "apple");
  assert.equal(resolveProduct("Papa")?.kind, "veg");
  assert.equal(resolveProduct("PIÑA")?.key, undefined);
  assert.equal(resolveProduct("pina"), null);
  assert.equal(resolveProduct("pineapple")?.names[0], "ANANA");
  assert.equal(resolveProduct("jalisco"), null);
});

test("ar-cmcba: real tomato days give an ARS per kg range with sample size, period, posted price type and licence", async () => {
  const a = await arWholesale({ product: "tomato" }, getOct);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "ARS");
  assert.equal(a.price!.unit, "per kg");
  assert.ok(a.sample_size! >= 30, `n ${a.sample_size}`);
  assert.ok(a.price!.min <= a.price!.median && a.price!.median <= a.price!.max);
  assert.ok(a.price!.median > 300 && a.price!.median < 6000, `median ${a.price!.median}`);
  assert.equal(a.period.from, "2026-10-28");
  assert.equal(a.period.to, "2026-10-30");
  assert.equal(a.price_type, "posted_price");
  assert.match(a.source.licence, /Attribution/);
  assert.match(a.source.attribution, /CMCBA/);
  assert.deepEqual((a.extra as any).trading_days, ["2026-10-28", "2026-10-29", "2026-10-30"]);
});

test("ar-cmcba: real fruit answers too, and an unknown product is an InputError before any download", async () => {
  const a = await arWholesale({ product: "banana" }, getOct);
  assert.equal(a.status, "ok");
  assert.ok(a.price!.median > 200 && a.price!.median < 8000, `median ${a.price!.median}`);
  let calls = 0;
  await assert.rejects(arWholesale({ product: "unicorn" }, async (u) => { calls++; return get(u); }), InputError);
  assert.equal(calls, 0);
  await assert.rejects(arWholesale({}, get), InputError);
});

test("ar-cmcba: a market filter is ignored with a note, a thin product gets no range", async () => {
  const a = await arWholesale({ product: "potato", market: "Cordoba" }, getOct);
  assert.equal(a.status, "ok");
  assert.match(String((a.extra as any).market_ignored), /one market/);
  const thin = answerFromDays([{ date: "2026-10-30", rows: parseDay(day(VEG_ZIP, "RH301026.XLS"), "veg", "2026-10-30").filter((r) => r.species === "KALE").slice(0, 2) }], { product: "kale" });
  assert.notEqual(thin.status, "ok");
});

test("ar-cmcba: loadDays reads the newest month first and falls back to the month before", async () => {
  const days = await loadDays("veg", getOct, 3, 2);
  assert.deepEqual(days.map((d) => d.date), ["2026-10-30", "2026-10-29", "2026-10-28"]);
  await assert.rejects(loadDays("veg", async (u) => (u === PAGE_URL ? Buffer.from("<html></html>") : get(u))), SourceError);
});

test("ar-cmcba: the daily collector stores one national row per product with at least 5 records, ARS per kg", async () => {
  const h = await arHarvest(getOct);
  assert.equal(h.date, "2026-10-30");
  assert.equal(h.currency, "ARS");
  assert.equal(h.unit, "per kg");
  const items = h.rows.map((r) => r.item);
  assert.ok(items.includes("tomato") && items.includes("apple"));
  assert.ok(h.rows.every((r) => r.area === "ALL" && r.n >= 5 && r.low <= r.median && r.median <= r.high));
  assert.throws(() => harvestFromRows([], "2026-10-30"), SourceError);
});

test("ar-cmcba: history key only for AR and known products", () => {
  assert.deepEqual(arHistoryKey({ country: "ar", product: "papa" }), { area: "ALL", item: "potato", label: "Argentina wholesale potato" });
  assert.equal(arHistoryKey({ country: "CL", product: "tomato" }), null);
  assert.equal(arHistoryKey({ country: "AR", product: "unicorn" }), null);
});

test("ar-cmcba: registered under wholesale-markets with a working example", () => {
  const p = SOURCE_PLUGINS.find((x) => x.info.id === "ar-cmcba-wholesale")!;
  assert.ok(p);
  assert.equal(p.category, "wholesale-markets");
  assert.ok(p.examples.length >= 1 && p.examples[0].params.country === "AR");
  assert.equal(categoryById("wholesale-markets")!.tool, "pricepaid_wholesale_market_prices");
});
