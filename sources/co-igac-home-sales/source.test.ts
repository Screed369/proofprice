// Fixtures copied from LIVE responses fetched through the Probe workflow on 2026-10-29 (datos.gov.co, dataset 7y2j-43cv):
//   .../7y2j-43cv.json?$limit=3&$where=tiene_valor=1  -> rows with year_radica "2016"/"2021", divipola "5002", municipio "ABEJORRAL", valor "5000000.0"/"230000000" (text)
//   .../7y2j-43cv.json?$select=municipio,departamento,max(year_radica),count(*)&$where=...municipio like '%BOGOT%' OR '%MEDELL%' OR '%CALI%'&$group=municipio,departamento
//      -> BOGOTÁ D.C. / BOGOTÁ D.C. (295534, max 2023), CALIFORNIA, CALIMA, MEDELLÍN / ANTIOQUIA (126520), SAN CALIXTO, SANTIAGO DE CALI / VALLE DEL CAUCA (93166)
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { Bins, coHarvest, coHomeSales, INFO, itemsFor, likePattern, normName, parseSales, pickCandidate, splitPlace, titleCase } from "./source";
import source from "./index";
import { findSource } from "../../lib/registry";

const NAMES = [
  { divipola: "11001", municipio: "BOGOTÁ D.C.", departamento: "BOGOTÁ D.C." },
  { divipola: "68132", municipio: "CALIFORNIA", departamento: "SANTANDER" },
  { divipola: "76109", municipio: "CALIMA", departamento: "VALLE DEL CAUCA" },
  { divipola: "5001", municipio: "MEDELLÍN", departamento: "ANTIOQUIA" },
  { divipola: "54125", municipio: "SAN CALIXTO", departamento: "NORTE DE SANTANDER" },
  { divipola: "76001", municipio: "SANTIAGO DE CALI", departamento: "VALLE DEL CAUCA" },
];

test("names: accents are ignored and the LIKE pattern matches the accented registry spelling", () => {
  assert.equal(normName("Bogotá, D.C."), "BOGOTA D C");
  assert.equal(normName("Medellín"), "MEDELLIN");
  assert.equal(likePattern("Medellin"), "%M_D_LL__%");
  const re = (p: string) => new RegExp("^" + p.replace(/%/g, ".*").replace(/_/g, ".") + "$");
  assert.ok(re(likePattern("medellin")).test("MEDELLÍN"));
  assert.ok(re(likePattern("Bogotá")).test("BOGOTÁ D.C."));
  assert.ok(!re(likePattern("cali")).test("MEDELLÍN"));
});

test("pickCandidate: Cali means Santiago de Cali (not California or Calima); Bogotá and Medellín resolve", () => {
  assert.equal(pickCandidate(NAMES, "Cali").divipola, "76001");
  assert.equal(pickCandidate(NAMES, "Bogotá").divipola, "11001");
  assert.equal(pickCandidate(NAMES, "Bogota, D.C.").divipola, "11001");
  assert.equal(pickCandidate(NAMES.filter((c) => c.divipola !== "76001"), "Medellin").divipola, "5001");
  assert.throws(() => pickCandidate([NAMES[1], NAMES[2]], "Cali"), InputError);
  assert.throws(() => pickCandidate(NAMES, "Atlantis"), InputError);
  assert.deepEqual(splitPlace("Santa Rosa, Cauca"), { town: "Santa Rosa", dept: "Cauca" });
  assert.deepEqual(splitPlace("Bogotá, D.C."), { town: "Bogotá, D.C.", dept: "" });
  assert.equal(titleCase("SANTIAGO DE CALI"), "Santiago de Cali");
});

const DAY = "2023-12-31";
const M = (n: number) => n * 1_000_000;
const row = (area: string, item: string, n: number, median: number) => ({ area, item, n, median, low: median / 2, high: median * 2, min: median / 4, max: median * 4 });

function withLibrary(fn: () => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "co-lib-"));
    const prev = process.env.PROOFPRICE_LIBRARY_DIR;
    process.env.PROOFPRICE_LIBRARY_DIR = dir;
    try {
      writeDaily(INFO.id, {
        date: DAY, currency: "COP", unit: "per sale",
        rows: [
          row("ALL", "any:2023", 600, M(120)), row("ALL", "any:3y", 1800, M(110)),
          row("5001|MEDELLÍN|ANTIOQUIA", "any:2023", 400, M(215)), row("5001|MEDELLÍN|ANTIOQUIA", "any:3y", 1100, M(200)), row("5001|MEDELLÍN|ANTIOQUIA", "urban:2023", 380, M(220)),
          row("76001|SANTIAGO DE CALI|VALLE DEL CAUCA", "any:2023", 300, M(180)),
          row("68132|CALIFORNIA|SANTANDER", "any:2022", 6, M(60)),
          row("5002|ABEJORRAL|ANTIOQUIA", "any:2021", 5, M(70)),
        ],
      });
      writeMeta(INFO.id, { source: INFO.id, currency: "COP", unit: "per sale", first_date: DAY, last_date: DAY, days: 1, last_harvest_at: "2026-11-02T04:00:00Z", last_rows: 8, last_ok_at: "2026-11-02T04:00:00Z", last_error: null });
      await fn();
    } finally {
      if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("parseSales: live text rows become sales; small, huge and unusable values and odd years are dropped", () => {
  const out = parseSales([
    { divipola: "5001", municipio: "MEDELLÍN", departamento: "ANTIOQUIA", year_radica: "2023", tipo_predio_zona: "URBANO", valor: "530000000" },
    { divipola: "5002", municipio: "ABEJORRAL", departamento: "ANTIOQUIA", year_radica: "2016", tipo_predio_zona: "RURAL", valor: "12000000.0" },
    { divipola: "5002", municipio: "ABEJORRAL", departamento: "ANTIOQUIA", year_radica: "2016", valor: "5000000" },
    { divipola: "5002", municipio: "ABEJORRAL", departamento: "ANTIOQUIA", year_radica: "2016", valor: "99000000000000" },
    { divipola: "5002", municipio: "ABEJORRAL", departamento: "ANTIOQUIA", year_radica: "abc", valor: "50000000" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].zone, "urban");
  assert.equal(out[1].zone, "rural");
  assert.equal(out[1].value, 12_000_000);
});

test("itemsFor / Bins: a sale feeds its year and, inside the window, the 3-year item; groups under 5 sales never become rows", () => {
  const sale = (year: number, zone: "urban" | "rural" | null = "urban") => ({ divipola: "5001", municipio: "MEDELLÍN", departamento: "ANTIOQUIA", year, zone, value: M(100 + year % 10) });
  assert.deepEqual(itemsFor(sale(2023), 2021), ["any:2023", "any:3y", "urban:2023", "urban:3y"]);
  assert.deepEqual(itemsFor(sale(2019, null), 2021), ["any:2019"]);
  const bins = new Bins();
  for (let i = 0; i < 6; i++) bins.add(sale(2023), itemsFor(sale(2023), 2021));
  for (let i = 0; i < 4; i++) bins.add({ ...sale(2022), municipio: "ABEJORRAL" }, ["any:2022"]);
  const rows = bins.flush((it) => it.endsWith(":2023"));
  assert.ok(rows.find((r) => r.area === "ALL" && r.item === "any:2023" && r.n === 6));
  assert.ok(rows.find((r) => r.area.startsWith("5001|") && r.item === "urban:2023" && r.n === 6));
  assert.equal(rows.some((r) => r.item === "any:3y"), false);
  const rest = bins.flush(() => true);
  assert.ok(rest.find((r) => r.item === "any:3y" && r.n === 6));
  assert.equal(rest.some((r) => r.area.includes("ABEJORRAL")), false); // 4 sales: never published
  assert.equal(rest.some((r) => r.area === "ALL" && r.item === "any:2022"), false); // 4 sales nationally in this test
});

test("coHarvest: pages every year, keeps only value, place and zone, and publishes aggregates with the 5-sale rule", async () => {
  const urls: string[] = [];
  const mk = (y: string, i: number, divipola: string, mun: string) => ({ divipola, municipio: mun, departamento: "ANTIOQUIA", year_radica: y, tipo_predio_zona: i % 2 ? "URBANO" : "RURAL", valor: String(M(50 + i)) });
  const data: Record<string, any[]> = {
    "2023": Array.from({ length: 7 }, (_, i) => mk("2023", i, "5001", "MEDELLÍN")),
    "2022": [...Array.from({ length: 5 }, (_, i) => mk("2022", i, "5001", "MEDELLÍN")), mk("2022", 9, "5002", "ABEJORRAL")],
  };
  const fetcher = async (url: string) => {
    urls.push(url);
    const u = decodeURIComponent(url);
    if (u.includes("count(*)")) return [{ year_radica: "2023", count: "7" }, { year_radica: "2022", count: "6" }];
    const y = /year_radica = '(\d{4})'/.exec(u)![1];
    const off = Number(/\$offset=(\d+)/.exec(u)?.[1] ?? 0);
    const lim = Number(/\$limit=(\d+)/.exec(u)![1]);
    return data[y].slice(off, off + lim);
  };
  const r = await coHarvest({ fetcher, pageSize: 4, skipIfUnchanged: false });
  assert.equal(r.date, "2023-12-31");
  assert.equal(r.currency, "COP");
  const med23 = r.rows.find((x) => x.area === "5001|MEDELLÍN|ANTIOQUIA" && x.item === "any:2023");
  assert.equal(med23?.n, 7);
  assert.ok(r.rows.find((x) => x.area === "5001|MEDELLÍN|ANTIOQUIA" && x.item === "any:3y" && x.n === 12));
  assert.ok(r.rows.find((x) => x.area === "ALL" && x.item === "any:2022" && x.n === 6));
  assert.equal(r.rows.some((x) => x.area.includes("ABEJORRAL")), false);
  const q = urls.map(decodeURIComponent).join(" ");
  assert.match(q, /select=divipola,municipio,departamento,year_radica,tipo_predio_zona,valor/);
  assert.doesNotMatch(q, /matricula|numero_catastral|documento|\bpk,/);
});

test("coHarvest: an unchanged registry keeps the stored pass and reads no rows", withLibrary(async () => {
  let calls = 0;
  const r = await coHarvest({ fetcher: async () => { calls++; return []; }, metaFetch: async () => Date.parse("2025-04-04T00:00:00Z") / 1000 });
  assert.equal(calls, 0);
  assert.equal(r.date, DAY);
  assert.ok(r.rows.length >= 8);
  assert.equal("date" in (r.rows[0] as object), false);
}));

test("coHomeSales: municipality answer from the library, newest year, with the dataset-ends notice", withLibrary(async () => {
  const a = await coHomeSales({ town: "Medellin" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "COP");
  assert.equal(a.price?.median, M(215));
  assert.equal(a.sample_size, 400);
  assert.equal(a.period.from, "2023-01-01");
  assert.equal(a.period.to, "2023-12-31");
  assert.equal((a.extra as any).area, "Medellín, Antioquia");
  assert.match(JSON.stringify(a.extra), /ends in 2023/);
}));

test("coHomeSales: 24 months uses the 3-year item; urban uses the urban item; Cali means Santiago de Cali", withLibrary(async () => {
  const w = await coHomeSales({ town: "Medellin", months: 24 });
  assert.equal(w.price?.median, M(200));
  assert.equal(w.period.from, "2021-01-01");
  const u = await coHomeSales({ town: "Medellín", property_type: "urban" });
  assert.equal(u.price?.median, M(220));
  const c = await coHomeSales({ town: "Cali" });
  assert.equal((c.extra as any).area, "Santiago de Cali, Valle del Cauca");
  assert.equal(c.price?.median, M(180));
}));

test("coHomeSales: no town answers for the whole country; an older year is used when the newest has too few sales", withLibrary(async () => {
  const n = await coHomeSales({});
  assert.equal(n.status, "ok");
  assert.equal(n.price?.median, M(120));
  assert.match(String((n.extra as any).area), /Colombia/);
  const old = await coHomeSales({ town: "California" });
  assert.equal(old.period.from, "2022-01-01");
  assert.match(JSON.stringify(old.extra), /Not enough sales/);
}));

test("coHomeSales: fewer than five sales in any year gives no figure; unknown town is refused", withLibrary(async () => {
  const a = await coHomeSales({ town: "Abejorral", property_type: "rural" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  await assert.rejects(() => coHomeSales({ town: "Atlantis" }), InputError);
}));

test("coHomeSales: bad input is refused", withLibrary(async () => {
  await assert.rejects(() => coHomeSales({ town: "Medellin", postcode: "050001" }), InputError);
  await assert.rejects(() => coHomeSales({ town: "Medellin", property_type: "castle" }), InputError);
}));

test("manifest: Colombia is served by this source in home-sales, with urban and rural allowed", () => {
  assert.equal(source.info.id, "co-igac-home-sales");
  assert.equal(findSource("home-sales", "CO", { town: "Medellin" })?.info.id, "co-igac-home-sales");
  assert.deepEqual(source.paramValues, { property_type: ["urban", "rural"] });
});
