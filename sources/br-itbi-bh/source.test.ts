import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseItbi, brNumber, monthFiles, readMonths, dailyRows, lastCompleteMonth, resolveArea, bhKey, bhHistoryKey, bhHomeSales, servesBh,
  monthsBack, ymToDate, type Rec,
} from "./source";
import { parsePackageShow } from "../../lib/adapters";

// Fixture: header and a hand-picked sample of rows of the September 2026 monthly file (pda_itbi_relatorio_202609.csv), read live from
// ckan.pbh.gov.br on 7 Nov 2026. Streets are in the file; the parser never reads them.
const csv = readFileSync(path.join(__dirname, "fixtures", "itbi-202609-head.csv"), "utf8");
// Fixture: the dataset's CKAN package_show (dados.pbh.gov.br, 7 Nov 2026), resources trimmed to five CSV files.
const pkg = parsePackageShow(JSON.parse(readFileSync(path.join(__dirname, "fixtures", "package_show-trimmed.json"), "utf8")));
const SEP = 2026 * 12 + 8;

test("BR-BH: live sample parses: flats and houses only, residential only, comma decimals, no streets in the output", () => {
  const recs = parseItbi(csv);
  assert.equal(recs.length, 6); // 4 flats + 2 houses; shop room, garage and land dropped
  assert.deepEqual([recs[0].area, recs[0].kind, recs[0].value, recs[0].ym], ["lourdes", "apartment", 430000, SEP]);
  assert.ok(Math.abs((recs[0].m2 as number) - 430000 / 79.6) < 0.01);
  assert.equal(recs.find((r) => r.area === "nova-suissa")?.value, 286274.3); // "286274,3"
  assert.equal(recs.filter((r) => r.kind === "house").length, 2);
  assert.ok(!JSON.stringify(recs).match(/AVE |RUA |30170/));
});

test("BR-BH: money parsing, tiny and huge values, odd months and changed columns", () => {
  assert.equal(brNumber("1265,78"), 1265.78);
  assert.equal(brNumber("430000"), 430000);
  assert.equal(brNumber("195985.06"), 195985.06);
  assert.equal(brNumber("1.250.000,50"), 1250000.5);
  assert.ok(Number.isNaN(brNumber("")));
  const head = "Endereco Completo;Bairro;Area Construida Adquirida;Tipo Construtivo Preponderante;Descrição Tipo Ocupacao (Unidade);Valor Declarado;Data Quitacao\r\n";
  const row = (v: string, d = "01/09/2026", t = "AP") => `X;Buritis;60;${t};RESIDENCIAL;${v};${d}\r\n`;
  assert.equal(parseItbi(head + row("500000") + row("205") + row("21000000") + row("500000", "31/13/2026") + row("500000", "") + row("500000", "01/09/2026", "BA")).length, 1);
  assert.throws(() => parseItbi("Foo;Bar\r\n1;2\r\n"), /unexpected format/);
  assert.deepEqual(parseItbi(""), []);
});

test("BR-BH: monthly files are found by file name; the back-file and non-CSV are skipped; a re-upload of a month wins", () => {
  const files = monthFiles(pkg.resources);
  assert.equal(files.length, 4); // the 80 MB back-file is skipped; 2024-06 and 2026-07..09 remain
  assert.ok(files[0].ym > files[1].ym);
  const f = monthFiles([
    { format: "CSV", url: "https://ckan.pbh.gov.br/x/pda_itbi_relatorio_200801_a_202405.csv", modified: "2024-07-15" },
    { format: "PDF", url: "https://ckan.pbh.gov.br/x/pda_itbi_relatorio_202609.pdf", modified: "2026-11-03" },
    { format: "CSV", url: "https://ckan.pbh.gov.br/x/pda_itbi_relatorio_202407_corrigido.csv", modified: "2024-09-04" },
    { format: "CSV", url: "https://ckan.pbh.gov.br/x/pda_itbi_relatorio_202606.csv", modified: "2026-09-08" },
    { format: "CSV", url: "https://ckan.pbh.gov.br/y/pda_itbi_relatorio_202606.csv", modified: "2026-09-10" },
  ]);
  assert.deepEqual(f.map((x) => x.ym), [2026 * 12 + 5, 2024 * 12 + 6]);
  assert.match(f[0].url, /\/y\//);
});

test("BR-BH: readMonths reads the newest 25 files and a failing file fails the whole run", async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ym: SEP - i, url: `u${i}`, modified: "" }));
  const seen: string[] = [];
  const recs = await readMonths(many, async (u) => { seen.push(u); return csv; });
  assert.equal(seen.length, 25);
  assert.equal(recs.length, 25 * 6);
  await assert.rejects(readMonths(many, async (u) => { if (u === "u3") throw new Error("boom"); return csv; }), /boom/);
});

const mk = (area: string, ym: number, n: number, value: number, kind: "apartment" | "house" = "apartment"): Rec[] =>
  Array.from({ length: n }, (_, i) => ({ ym, area, kind, value: value + i * 1000, m2: (value + i * 1000) / 60 }));

test("BR-BH: daily rows: windows end at the newest complete month, under 5 never published, whole city is ALL", () => {
  const recs = [...mk("buritis", SEP, 6, 500000), ...mk("lourdes", SEP, 4, 900000), ...mk("centro", SEP - 15, 5, 200000), ...mk("buritis", SEP - 1, 8, 480000)];
  const { date, rows } = dailyRows(recs);
  assert.equal(date, "2026-09-30");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("buritis", "any:3m")?.n, 14);
  assert.equal(get("buritis", "apartment:12m")?.n, 14);
  assert.equal(get("lourdes", "any:12m"), undefined); // 4 transfers
  assert.equal(get("centro", "any:12m"), undefined); // 15 months old
  assert.equal(get("centro", "any:24m")?.n, 5);
  assert.equal(get("ALL", "any:12m")?.n, 18);
  assert.ok(get("buritis", "apartment-m2:12m"));
  assert.equal(get("buritis", "house:12m"), undefined);
});

test("BR-BH: a half-filled newest month is dropped; a missing month is not guessed", () => {
  const full = [...mk("a", SEP - 1, 100, 400000), ...mk("a", SEP, 30, 400000)];
  assert.equal(lastCompleteMonth(full), SEP - 1);
  assert.equal(dailyRows(full).date, "2026-08-31");
  assert.equal(lastCompleteMonth([...mk("a", SEP - 1, 100, 400000), ...mk("a", SEP, 80, 400000)]), SEP);
  assert.throws(() => dailyRows([]), /no usable/);
  assert.equal(ymToDate(2026 * 12 + 1), "2026-02-28");
  assert.equal(monthsBack("2026-09-30", 12), "2025-10-01");
});

test("BR-BH: serves() sends Belo Horizonte places here and leaves Rio, Fortaleza and the rest of Brazil alone", () => {
  assert.equal(servesBh("Belo Horizonte", undefined), true);
  assert.equal(servesBh("Savassi, Belo Horizonte", undefined), true);
  assert.equal(servesBh("Buritis", undefined), true);
  assert.equal(servesBh("BH", undefined), true);
  assert.equal(servesBh(undefined, "30170-004"), true);
  assert.equal(servesBh(undefined, "31330290"), true);
  assert.equal(servesBh("Copacabana", undefined), false); // Rio (BH also has a bairro of that name)
  assert.equal(servesBh("Aldeota", undefined), false);
  assert.equal(servesBh("Centro", undefined), false);
  assert.equal(servesBh("São Paulo", undefined), false);
  assert.equal(servesBh(undefined, "22070-011"), false);
  assert.equal(servesBh(undefined, undefined), false);
});

test("BR-BH: place names: accents, whole city, unknown, rounding of months", () => {
  const known = ["buritis", "santo-agostinho", "nova-suissa", "alipio-de-melo"];
  assert.deepEqual(resolveArea("Belo Horizonte", known), { area: "ALL", label: "Belo Horizonte" });
  assert.equal(resolveArea(undefined, known)?.area, "ALL");
  assert.equal(resolveArea("Nova Suissa, Belo Horizonte", known)?.area, "nova-suissa");
  assert.equal(resolveArea("Alípio de Melo", known)?.area, "alipio-de-melo");
  assert.equal(resolveArea("Narnia", known), null);
  assert.equal(bhKey({ town: "Buritis", months: 5, property_type: "house" }, known)?.item, "house:6m");
  assert.equal(bhKey({ town: "Buritis", property_type: "castle" }, known), null);
});

test("BR-BH: answer from the library: labelled declared value, per m2, widened window, thin area, unknown place", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bh-lib-"));
  mkdirSync(path.join(dir, "br-itbi-bh", "daily"), { recursive: true });
  writeFileSync(path.join(dir, "br-itbi-bh", "meta.json"), JSON.stringify({ last_date: "2026-09-30" }));
  writeFileSync(path.join(dir, "br-itbi-bh", "daily", "2026-09.csv"), [
    "date,area,item,n,median,low,high,min,max",
    "2026-09-30,buritis,apartment:12m,400,600000,350000,1100000,100000,3000000",
    "2026-09-30,buritis,apartment-m2:12m,390,7500,5000,11000,2500,25000",
    "2026-09-30,lourdes,any:24m,7,1500000,900000,2500000,800000,3000000",
    "2026-09-30,ALL,any:12m,20000,480000,220000,1200000,40000,9000000",
  ].join("\n") + "\n");
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const a = await bhHomeSales({ town: "Buritis", property_type: "apartment" });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 400);
    assert.deepEqual(a.period, { from: "2025-10-01", to: "2026-09-30" });
    assert.match(a.summary, /declared transaction value/);
    assert.match(a.summary, /may differ from the price actually paid/);
    assert.equal((a.extra as any).per_m2.median, 7500);
    assert.equal(a.price_type, "posted_price");
    const w = await bhHomeSales({ town: "Lourdes" });
    assert.equal((w.extra as any).window_widened, true);
    assert.equal(w.sample_size, 7);
    const c = await bhHomeSales({ town: "Belo Horizonte" });
    assert.equal(c.sample_size, 20000);
    await assert.rejects(bhHomeSales({ town: "Narnia" }), /Unknown neighbourhood/);
    await assert.rejects(bhHomeSales({ town: "Lourdes", property_type: "castle" }), /property_type must be/);
    assert.deepEqual(bhHistoryKey({ town: "Buritis", property_type: "apartment" }), { area: "buritis", item: "apartment:12m", label: "Buritis, Belo Horizonte, Brazil" });
    const thin = await bhHomeSales({ town: "Buritis", property_type: "house" });
    assert.notEqual(thin.status, "ok");
    assert.equal(thin.price, null);
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
  }
});
