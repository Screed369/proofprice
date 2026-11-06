import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRows, yearlyDailyRows, kindOf, dailyRows, resolveArea, rioKey, rioHistoryKey, rioHomeSales, servesRio, monthsBack, ymToDate, type Group } from "./source";
import { parseArcgisQuery } from "../../lib/adapters";

// Fixture: the first residential rows of Aug 2026 from the live layer (Fazenda/ITBI MapServer/8), probed 1 Nov 2026.
const live = parseArcgisQuery(JSON.parse(readFileSync(path.join(__dirname, "fixtures", "layer8-head.json"), "utf8")));

test("BR-RIO: live head rows parse; streets are never in the output", () => {
  const g = parseRows(live.rows);
  assert.equal(g.length, 6);
  assert.deepEqual([g[0].area, g[0].kind, g[0].weight, Math.round(g[0].value)], ["santo-cristo", "apartment", 13, 484516]);
  assert.equal(g[0].ym, 2026 * 12 + 7);
  assert.ok(!JSON.stringify(g).match(/RUA|logradouro/i));
  assert.ok(g[0].m2 !== null && Math.abs(g[0].m2 - 484516.435384 / 49.692307) < 1);
});

test("BR-RIO: kinds, promises of sale, partial transfers, non-residential, tiny and huge values are dropped; changed fields fail loudly", () => {
  assert.equal(kindOf("APARTAMENTO"), "apartment");
  assert.equal(kindOf("CASA"), "house");
  assert.equal(kindOf("VAGA DE GARAGEM"), null);
  assert.equal(kindOf("SALA"), null);
  const base = { bairro: "Tijuca  ", total_transações: 3, uso: "RESIDENCIAL", principais_tipologias: "APARTAMENTO", média_percentual_transferido: 100, média_área_construída: 60, média_valor_transação: 500000, principal_transação_mercado: "COMPRA E VENDA", ano_transação: 2026, mês_transação: 8 };
  const rows = [
    base,
    { ...base, principal_transação_mercado: "PROMESSA" },
    { ...base, média_percentual_transferido: 50 },
    { ...base, uso: "NAO RESIDENCIAL" },
    { ...base, média_valor_transação: 5.11 },
    { ...base, média_valor_transação: 21_124_613 },
    { ...base, principais_tipologias: "SALA" },
  ];
  assert.equal(parseRows(rows).length, 1);
  assert.throws(() => parseRows([{ foo: 1 }]), /unexpected format/);
});

const mk = (area: string, ym: number, groups: number, value: number, weight = 1, kind: "apartment" | "house" = "apartment"): Group[] =>
  Array.from({ length: groups }, (_, i) => ({ ym, area, kind, value: value + i * 1000, m2: (value + i * 1000) / 50, weight }));
const SEP = 2026 * 12 + 8;

test("BR-RIO: daily rows weight each street-month by its transfers, windows end at the newest month, under 5 never published", () => {
  const groups = [...mk("copacabana", SEP, 3, 800000, 2), ...mk("tijuca", SEP, 4, 500000, 1), ...mk("centro", SEP - 15, 5, 200000)];
  const { date, rows } = dailyRows(groups, SEP + 5);
  assert.equal(date, "2026-09-30");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("copacabana", "any:12m")?.n, 6); // 3 groups x 2 transfers
  assert.equal(get("tijuca", "any:12m"), undefined); // 4 transfers
  assert.equal(get("ALL", "any:12m")?.n, 10);
  assert.equal(get("centro", "any:12m"), undefined); // 15 months old
  assert.equal(get("centro", "any:24m")?.n, 5);
  assert.ok(get("copacabana", "apartment-m2:12m"));
  assert.equal(get("copacabana", "house:12m"), undefined);
});

test("BR-RIO: a month in the future is ignored; months helpers", () => {
  const { date } = dailyRows([...mk("a", SEP, 5, 300000), ...mk("a", SEP + 9, 5, 300000)], SEP + 1);
  assert.equal(date, "2026-09-30");
  assert.equal(ymToDate(2026 * 12 + 1), "2026-02-28");
  assert.equal(monthsBack("2026-09-30", 12), "2025-10-01");
  assert.equal(monthsBack("2026-09-30", 3), "2026-07-01");
});

test("BR-RIO: serves() sends Rio places here and leaves Porto Alegre and the rest of Brazil to the default", () => {
  assert.equal(servesRio("Copacabana", undefined), true);
  assert.equal(servesRio("Barra da Tijuca", undefined), true);
  assert.equal(servesRio("Ipanema, Rio de Janeiro", undefined), true);
  assert.equal(servesRio("Rio de Janeiro", undefined), true);
  assert.equal(servesRio(undefined, "22070-011"), true);
  assert.equal(servesRio("Moinhos de Vento", undefined), false);
  assert.equal(servesRio("Porto Alegre", undefined), false);
  assert.equal(servesRio("São Paulo", undefined), false);
  assert.equal(servesRio(undefined, undefined), false);
});

test("BR-RIO: place names: accents, trailing spaces, whole city, unknown", () => {
  const known = ["copacabana", "barra-da-tijuca", "freguesia-jacarepagua", "jacarepagua"];
  assert.deepEqual(resolveArea("Rio de Janeiro", known), { area: "ALL", label: "Rio de Janeiro" });
  assert.equal(resolveArea(undefined, known)?.area, "ALL");
  assert.equal(resolveArea("Jacarepaguá, Rio de Janeiro", known)?.area, "jacarepagua");
  assert.equal(resolveArea("Barra da Tijuca", known)?.area, "barra-da-tijuca");
  assert.equal(resolveArea("Narnia", known), null);
  assert.equal(rioKey({ town: "Copacabana", months: 5, property_type: "house" }, known)?.item, "house:6m");
  assert.equal(rioKey({ town: "Copacabana", property_type: "castle" }, known), null);
});

test("BR-RIO: answer from the library: labelled as declared value, per m2, widened window, thin area, unknown place", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rio-lib-"));
  mkdirSync(path.join(dir, "br-itbi-rio", "daily"), { recursive: true });
  writeFileSync(path.join(dir, "br-itbi-rio", "meta.json"), JSON.stringify({ last_date: "2026-08-31" }));
  writeFileSync(path.join(dir, "br-itbi-rio", "daily", "2026-08.csv"), [
    "date,area,item,n,median,low,high,min,max",
    "2026-08-31,copacabana,apartment:12m,400,900000,500000,1800000,200000,4000000",
    "2026-08-31,copacabana,apartment-m2:12m,380,15000,9000,24000,5000,40000",
    "2026-08-31,urca,any:24m,7,1500000,900000,2500000,800000,3000000",
    "2026-08-31,ALL,any:12m,9000,600000,250000,1500000,40000,9000000",
  ].join("\n") + "\n");
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const a = await rioHomeSales({ town: "Copacabana", property_type: "apartment" });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 400);
    assert.match(a.summary, /declared transaction value/);
    assert.match(a.summary, /may differ from the price actually paid/);
    assert.equal((a.extra as any).per_m2.median, 15000);
    const w = await rioHomeSales({ town: "Urca" });
    assert.equal((w.extra as any).window_widened, true);
    assert.equal(w.sample_size, 7);
    const c = await rioHomeSales({ town: "Rio de Janeiro" });
    assert.equal(c.sample_size, 9000);
    await assert.rejects(rioHomeSales({ town: "Narnia" }), /Unknown neighbourhood/);
    await assert.rejects(rioHomeSales({ town: "Urca", property_type: "castle" }), /property_type must be/);
    assert.deepEqual(rioHistoryKey({ town: "Copacabana", property_type: "apartment" }), { area: "copacabana", item: "apartment:12m", label: "Copacabana, Rio de Janeiro, Brazil" });
    const thin = await rioHomeSales({ town: "Copacabana", property_type: "house" });
    assert.notEqual(thin.status, "ok");
    assert.equal(thin.price, null);
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
  }
});

// Fixture: first rows of the city's yearly layer (Fazenda/ITBI MapServer/4), read 6 Nov 2026 while the monthly layer 8 was empty (count 0).
const liveYear = parseArcgisQuery(JSON.parse(readFileSync(path.join(__dirname, "fixtures", "layer4-head.json"), "utf8")));

test("BR-RIO yearly fallback: layer 4 rows parse without a month; the 95% rule replaces 99.5%", () => {
  const g = parseRows(liveYear.rows, true);
  assert.ok(g.length >= 5);
  assert.equal(g[0].ym, 2026 * 12 + 11);
  assert.equal(g[0].area, "barra-olimpica");
  assert.equal(g[0].weight, 60); // 142 transfers capped
  assert.equal(parseRows(liveYear.rows, false).length < g.length, true); // the monthly rule would drop the 98.5% rows
  assert.ok(!JSON.stringify(g).match(/logradouro/i));
});

test("BR-RIO yearly fallback: 12m = newest year to date, 24m = that year and the one before, under 5 never published", () => {
  const Y = 2026;
  const groups = [...mk("copacabana", Y * 12 + 11, 3, 800000, 2), ...mk("copacabana", (Y - 1) * 12 + 11, 3, 700000, 2), ...mk("tijuca", (Y - 2) * 12 + 11, 9, 500000)];
  const r = yearlyDailyRows(groups, Y, "2026-11-06");
  assert.equal(r.date, "2026-11-06");
  assert.equal(r.year, 2026);
  const get = (a: string, i: string) => r.rows.find((x) => x.area === a && x.item === i);
  assert.equal(get("copacabana", "any:12m")?.n, 6);
  assert.equal(get("copacabana", "any:24m")?.n, 12);
  assert.equal(get("tijuca", "any:24m"), undefined); // two years back is out
  assert.equal(get("ALL", "any:3m"), undefined); // no month windows in yearly mode
});

test("BR-RIO yearly fallback: the answer says calendar year, not months", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rio-lib-y-"));
  mkdirSync(path.join(dir, "br-itbi-rio", "daily"), { recursive: true });
  writeFileSync(path.join(dir, "br-itbi-rio", "meta.json"), JSON.stringify({ last_date: "2026-11-06", note: "yearly:2026 The city's monthly layer is empty" }));
  writeFileSync(path.join(dir, "br-itbi-rio", "daily", "2026-11.csv"), [
    "date,area,item,n,median,low,high,min,max",
    "2026-11-06,copacabana,apartment:12m,400,900000,500000,1800000,200000,4000000",
    "2026-11-06,urca,any:24m,7,1500000,900000,2500000,800000,3000000",
  ].join("\n") + "\n");
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const a = await rioHomeSales({ town: "Copacabana", property_type: "apartment", months: 3 });
    assert.equal(a.status, "ok");
    assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-11-06" });
    assert.match(a.summary, /calendar-year figures: 2026 to date/);
    assert.match(a.method, /calendar-year layer/);
    assert.equal((a.extra as any).granularity, "calendar year");
    const u = await rioHomeSales({ town: "Urca" });
    assert.deepEqual(a.price?.median, 900000);
    assert.deepEqual(u.period, { from: "2025-01-01", to: "2026-11-06" });
    assert.equal((u.extra as any).window_widened, true);
    assert.match(u.summary, /2025 and 2026/);
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
  }
});
