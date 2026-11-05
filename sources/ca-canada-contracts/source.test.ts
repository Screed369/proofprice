import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HEADER, ROWS } from "./fixtures";
import { aggregate, caContractsHarvest, caFederalContracts, contractFromRow, CsvReader, headerIndex, INFO, isFederalArea, kindOf, matchItem, monthsBefore, streamContracts } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

function parse(text: string, chunk = text.length): string[][] {
  const rows: string[][] = [];
  const r = new CsvReader((x) => rows.push(x));
  for (let i = 0; i < text.length; i += chunk) r.push(text.slice(i, i + chunk));
  r.end();
  return rows;
}
const real = parse([HEADER, ...ROWS].join("\n"), 13);

test("real file (read 2026-11-05): 5 rows of 43 columns, BOM ignored, quoted commas kept in one cell", () => {
  assert.equal(real.length, 6);
  assert.ok(real.every((r) => r.length === real[0].length));
  const idx = headerIndex(real[0]);
  assert.equal(real[5][idx.desc], "Rental of machinery, office furniture and fixtures and other equipment");
});

test("real rows become contracts: value as amended, date, kind of purchase and type; names are never read", () => {
  const idx = headerIndex(real[0]);
  const c = real.slice(1).map((r) => contractFromRow(r, idx));
  assert.ok(c.every(Boolean));
  assert.deepEqual(c[0], { ref: "C-2019-2020-Q4-1", date: "2020-02-26", value: 38900.25, kind: "communications professional services not elsewhere specified", type: "services" });
  assert.equal(c[2]!.kind, "translation services");
  assert.equal(c[4]!.date, "2026-09-29");
  assert.ok(!JSON.stringify(c).match(/Simzer|Breckenhill|Perrier|Dingwall|Livecast/));
});

test("rows without a usable value or date are dropped", () => {
  const idx = headerIndex(real[0]);
  const base = [...real[3]];
  const set = (i: number, v: string) => { const r = [...base]; r[i] = v; return r; };
  assert.equal(contractFromRow(set(idx.value, ""), idx), null);
  assert.equal(contractFromRow(set(idx.value, "-500"), idx), null);
  assert.equal(contractFromRow(set(idx.value, "999"), idx), null);
  assert.equal(contractFromRow(set(idx.date, ""), idx), null);
  assert.equal(contractFromRow(set(idx.desc, ""), idx), null);
  assert.throws(() => headerIndex(["a", "b"]), SourceError);
});

test("monthsBefore and kindOf", () => {
  assert.equal(monthsBefore("2026-09-29", 24), "2024-09-29");
  assert.equal(monthsBefore("2026-02-28", 12), "2025-02-28");
  assert.equal(monthsBefore("2024-02-29", 12), "2023-02-28");
  assert.equal(kindOf("License/Maintenance fees for application software (including COTS)"), "license maintenance fees for application software including cots");
});

test("isFederalArea accepts the federal words only", () => {
  for (const a of ["federal", "Federal government", "Government of Canada", "proactive disclosure"]) assert.ok(isFederalArea(a), a);
  for (const a of ["", undefined, "Quebec", "Alberta", "Ontario"]) assert.ok(!isFederalArea(a), String(a));
});

function many(kind: string, desc: string, n: number, base: number, type = "S", refStart = 0) {
  const idx = headerIndex(real[0]);
  return Array.from({ length: n }, (_, i) => {
    const r = [...real[3]];
    r[idx.ref] = `T-${kind}-${refStart + i}`;
    r[idx.desc] = desc;
    r[idx.value] = String(base + i * 1000);
    r[idx.type] = type;
    r[idx.date] = "2026-03-15";
    return contractFromRow(r, idx)!;
  });
}

test("aggregate: 5-contract rule, one row per reference, goods/services/all groups", () => {
  const cs = [...many("tr", "Translation services", 7, 20000), ...many("few", "Rare thing", 4, 50000, "G"), ...many("g", "Office supplies", 5, 10000, "G")];
  const dup = [...cs, ...cs]; // a second copy of the same references must not count twice
  const rows = aggregate(dup, "2024-01-01", "2026-09-29");
  const get = (i: string) => rows.find((r) => r.item === i);
  assert.equal(get("d:translation services")!.n, 7);
  assert.equal(get("d:translation services")!.median, 23000);
  assert.equal(get("d:rare thing"), undefined);
  assert.equal(get("all")!.n, 16);
  assert.equal(get("type:services")!.n, 7);
  assert.equal(get("type:goods")!.n, 9);
  assert.ok(rows.every((r) => r.n >= 5 && r.area === "ALL"));
  assert.equal(aggregate(cs, "2026-06-01", "2026-09-29").length, 0, "window excludes March contracts");
});

test("matchItem: exact, all-words, types, nothing", () => {
  const rows = [{ item: "all", n: 99 }, { item: "type:services", n: 50 }, { item: "d:translation services", n: 30 }, { item: "d:other professional services not elsewhere specified", n: 40 }, { item: "d:legal services", n: 12 }];
  assert.equal(matchItem("translation services", rows)!.item, "d:translation services");
  assert.equal(matchItem("Translation Service", rows)!.item, "d:translation services");
  assert.equal(matchItem("professional", rows)!.item, "d:other professional services not elsewhere specified");
  assert.equal(matchItem("services", rows)!.item, "type:services");
  assert.equal(matchItem("all", rows)!.item, "all");
  const s = matchItem("service", rows.filter((r) => r.item !== "type:services"))!;
  assert.equal(s.item, "d:other professional services not elsewhere specified");
  assert.deepEqual(s.related, ["translation services", "legal services"]);
  assert.equal(matchItem("laptops", rows), null);
});

function bodyOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 97) c.enqueue(bytes.slice(i, i + 97)); c.close(); } });
}

test("harvest: streams a file, window ends at the newest contract, answer comes from the library", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "lib-ca-"));
  const idx = headerIndex(real[0]);
  const cs = [...many("tr", "Translation services", 8, 20000), ...many("sw", "Software licences, maintenance", 6, 40000, "G")];
  const lines = cs.map((c, i) => { const r = [...real[3]]; r[idx.ref] = c.ref; r[idx.desc] = i < 8 ? "Translation services" : "Software licences, maintenance"; r[idx.value] = String(c.value); r[idx.type] = c.type === "goods" ? "G" : "S"; r[idx.date] = c.date; return r.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(","); });
  const text = [HEADER, ...lines].join("\r\n");
  const stats = await streamContracts(bodyOf(text), () => {});
  assert.equal(stats.rows, 14);
  const h = await caContractsHarvest(new Date("2026-11-05T03:17:00Z"), async () => bodyOf(text));
  assert.equal(h.date, "2026-03-15");
  assert.equal(h.currency, "CAD");
  assert.ok(h.rows.find((r) => r.item === "d:software licences maintenance"));
  await assert.rejects(caContractsHarvest(new Date(), async () => bodyOf(HEADER)), SourceError);
  writeDaily(INFO.id, { date: h.date, currency: h.currency, unit: h.unit, rows: h.rows });
  writeMeta(INFO.id, { last_harvest_at: new Date().toISOString(), last_ok: new Date().toISOString(), last_error: null } as any);
  const a: any = await caFederalContracts({ what: "translation services", buyer_area: "federal" });
  assert.equal(a.status, "ok");
  assert.equal(a.price.median, 23500);
  assert.equal(a.sample_size, 8);
  assert.equal(a.period.to, "2026-03-15");
  assert.match(a.source.licence, /Open Government Licence/);
  const all: any = await caFederalContracts({ what: "all" });
  assert.equal(all.sample_size, 14);
  await assert.rejects(caFederalContracts({ what: "laptops" }), InputError);
  await assert.rejects(caFederalContracts({ what: "x", cpv: "30" }), InputError);
});
