import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseItbi, kindOf, splitLine, dailyRows, unzipFirstFile, zipUrls, resolveArea, poaKey, poaHistoryKey, poaHomeSales, monthsBack, type Guide } from "./source";

// Fixture: the first rows of the live itbi-2026.csv, probed from GitHub Actions on 24 Oct 2026 (probe poaitbi1).
const head = readFileSync(path.join(__dirname, "fixtures", "itbi-2026-head.csv"), "utf8");

test("BR-POA: split a semicolon line with quoted fields", () => {
  const f = splitLine('2026-01-06 00:00:00;;180000.0;100.0;"APARTAMENTO";"Rua GEN PORTINHO";332;"606";;"CENTRO HISTORIC"');
  assert.equal(f[2], "180000.0");
  assert.equal(f[4], "APARTAMENTO");
  assert.equal(f[9], "CENTRO HISTORIC");
});

test("BR-POA: kinds: apartments and houses only", () => {
  assert.equal(kindOf("APARTAMENTO"), "apartment");
  assert.equal(kindOf("RESIDENCIA ISOLADA"), "house");
  assert.equal(kindOf("RESIDENCIA PADRONIZADA EM COND HORIZONTAL FECHADO"), "house");
  assert.equal(kindOf("ESPACO DE ESTACIONAMENTO RESIDENCIAL"), null);
  assert.equal(kindOf("DEPÓSITO / ARMAZÉM / PRÉDIO INDUSTRIAL"), null);
  assert.equal(kindOf("SALA DE COBERTURA"), null);
  assert.equal(kindOf(""), null);
});

test("BR-POA: parse the live head: blank base, parking, depot, no-kind, and R$48M house dropped; addresses never kept", () => {
  const g = parseItbi(head);
  assert.deepEqual(g.map((x) => [x.date, x.area, x.kind, x.base]), [
    ["2026-01-06", "centro-historic", "apartment", 180000],
    ["2026-01-13", "praia-de-belas", "apartment", 190000],
    ["2026-01-05", "chapeu-do-sol", "apartment", 255000],
    ["2026-01-07", "petropolis", "apartment", 490000],
    ["2026-01-09", "bom-fim", "house", 1000000],
  ]);
  assert.equal(g[0].m2, 180000 / 45.2);
  assert.ok(!JSON.stringify(g).match(/Rua|Avenida|GEN PORTINHO/i));
});

test("BR-POA: cancelled and partial transfers are dropped; a changed header fails loudly", () => {
  const h = 'data_estimativa;base_de_calculo;perc_transmitido;"finalidade_construcao";"bairro";area_constr_privativa;"situacao"\n';
  const g = parseItbi(h + '2026-01-06 00:00:00;300000.0;100.0;"APARTAMENTO";"CENTRO";50.0;"Cancelado"\n2026-01-06 00:00:00;300000.0;50.0;"APARTAMENTO";"CENTRO";50.0;"Pago"\n2026-01-06 00:00:00;300000.0;100.0;"APARTAMENTO";"CENTRO";50.0;"Pago"\n');
  assert.equal(g.length, 1);
  assert.throws(() => parseItbi("a;b;c\n1;2;3"), /unexpected format/);
});

const mk = (area: string, n: number, base: number, date = "2026-09-01", kind: "apartment" | "house" = "apartment"): Guide[] =>
  Array.from({ length: n }, (_, i) => ({ date, area, kind, base: base + i * 1000, m2: (base + i * 1000) / 50 }));

test("BR-POA: daily rows: windows end at the newest guide, under 5 guides never published, ALL row for the city", () => {
  const guides = [...mk("moinhos-de-vento", 6, 600000), ...mk("bom-fim", 4, 400000), ...mk("centro-historic", 5, 200000, "2025-01-10")];
  const { date, rows } = dailyRows(guides, "2026-10-24");
  assert.equal(date, "2026-09-01");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("moinhos-de-vento", "any:12m")?.n, 6);
  assert.equal(get("moinhos-de-vento", "apartment:3m")?.median, 602500);
  assert.equal(get("bom-fim", "any:12m"), undefined); // 4 guides
  assert.equal(get("ALL", "any:12m")?.n, 10);
  assert.equal(get("centro-historic", "any:12m"), undefined); // older than 12 months
  assert.equal(get("centro-historic", "any:24m")?.n, 5);
  assert.ok(get("moinhos-de-vento", "any-m2:12m"));
});

test("BR-POA: place names: truncated bairro names, city and unknown", () => {
  const known = ["centro-historic", "moinhos-vento", "petropolis", "jar-leopoldina"]; // as the live file prints them (checked in the 24 Oct harvest)
  assert.deepEqual(resolveArea("Porto Alegre", known), { area: "ALL", label: "Porto Alegre" });
  assert.equal(resolveArea(undefined, known)?.area, "ALL");
  assert.equal(resolveArea("Petrópolis, Porto Alegre", known)?.area, "petropolis");
  assert.equal(resolveArea("Centro Histórico", known)?.area, "centro-historic");
  assert.equal(resolveArea("Moinhos de Vento", known)?.area, "moinhos-vento");
  assert.equal(resolveArea("Narnia", known), null);
  assert.equal(poaKey({ town: "Petropolis", months: 5, property_type: "house" }, known)?.item, "house:6m");
  assert.equal(poaKey({ town: "Petropolis", property_type: "castle" }, known), null);
});

test("BR-POA: zip reading and the yearly file list from the CKAN record", () => {
  const csv = Buffer.from(head, "utf8");
  const name = Buffer.from("itbi-2026.csv");
  const data = deflateRawSync(csv);
  const lfh = Buffer.alloc(30); lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(8, 8); lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(csv.length, 22); lfh.writeUInt16LE(name.length, 26);
  const cdh = Buffer.alloc(46); cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(8, 10); cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(csv.length, 24); cdh.writeUInt16LE(name.length, 28); cdh.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(30 + name.length + data.length, 16);
  const zip = Buffer.concat([lfh, name, data, cdh, name, eocd]);
  assert.equal(unzipFirstFile(zip).toString("utf8"), head);
  const urls = zipUrls({ result: { resources: [
    { name: "Dicionário", url: "https://dadosabertos.poa.br/x/download/dicionario.pdf" },
    { name: "ITBI 2025", url: "https://dadosabertos.poa.br/dataset/dd8ee5be/resource/e46f56f3/download/itbi-2025.zip" },
    { name: "ITBI 2026", url: "https://dadosabertos.poa.br/dataset/dd8ee5be/resource/b4cf6e78/download/itbi-2026.zip" },
  ] } });
  assert.deepEqual(urls.map((u) => u.year), [2026, 2025]);
});

test("BR-POA: answer from the library: labelled as ITBI tax base, per m2, widened window, thin area, unknown place", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "poa-lib-"));
  mkdirSync(path.join(dir, "br-poa-itbi", "daily"), { recursive: true });
  writeFileSync(path.join(dir, "br-poa-itbi", "meta.json"), JSON.stringify({ last_date: "2026-09-30" }));
  writeFileSync(path.join(dir, "br-poa-itbi", "daily", "2026-09.csv"), [
    "date,area,item,n,median,low,high,min,max",
    "2026-09-30,moinhos-de-vento,apartment:12m,40,720000,380000,1500000,300000,3000000",
    "2026-09-30,moinhos-de-vento,apartment-m2:12m,38,11500,7000,16000,5000,25000",
    "2026-09-30,bom-fim,any:24m,7,450000,250000,800000,200000,900000",
    "2026-09-30,ALL,any:12m,5200,420000,200000,1100000,40000,9000000",
  ].join("\n") + "\n");
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const a = await poaHomeSales({ town: "Moinhos de Vento", property_type: "apartment" });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 40);
    assert.match(a.summary, /ITBI tax base/);
    assert.match(a.summary, /may differ from the price actually paid/);
    assert.equal((a.extra as any).per_m2.median, 11500);
    const w = await poaHomeSales({ town: "Bom Fim" });
    assert.equal((w.extra as any).window_widened, true);
    assert.equal(w.sample_size, 7);
    const c = await poaHomeSales({});
    assert.equal(c.sample_size, 5200);
    await assert.rejects(poaHomeSales({ town: "Narnia" }), /Unknown neighbourhood/);
    await assert.rejects(poaHomeSales({ town: "Bom Fim", property_type: "castle" }), /property_type must be/);
    const h = poaHistoryKey({ town: "Moinhos de Vento", property_type: "apartment" });
    assert.deepEqual(h, { area: "moinhos-de-vento", item: "apartment:12m", label: "Moinhos De Vento, Porto Alegre, Brazil" });
    const thin = await poaHomeSales({ town: "Moinhos de Vento", property_type: "house" });
    assert.notEqual(thin.status, "ok");
    assert.equal(thin.price, null);
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
  }
});

test("BR-POA: monthsBack", () => {
  assert.equal(monthsBack("2026-09-30", 12), "2025-09-30");
});
