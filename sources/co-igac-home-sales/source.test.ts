// Fixtures copied from LIVE responses fetched through the Probe workflow on 2026-10-29 (datos.gov.co, dataset 7y2j-43cv):
//   .../7y2j-43cv.json?$limit=3&$where=tiene_valor=1  -> rows with year_radica "2016"/"2021", divipola "5002", municipio "ABEJORRAL", valor "5000000.0"/"230000000" (text)
//   .../7y2j-43cv.json?$select=municipio,departamento,max(year_radica),count(*)&$where=...municipio like '%BOGOT%' OR '%MEDELL%' OR '%CALI%'&$group=municipio,departamento
//      -> BOGOTÁ D.C. / BOGOTÁ D.C. (295534, max 2023), CALIFORNIA, CALIMA, MEDELLÍN / ANTIOQUIA (126520), SAN CALIXTO, SANTIAGO DE CALI / VALLE DEL CAUCA (93166)
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { baseWhere, chooseYears, coHomeSales, likePattern, normName, parseValues, parseYearCounts, pickCandidate, splitPlace, titleCase, MIN_VALUE } from "./source";
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

test("query: sales that declare a value of at least COP 10 million, value column only", () => {
  assert.equal(baseWhere("any"), `tiene_valor = 1 AND nombre_natujur like 'COMPRAVENTA%' AND valor >= ${MIN_VALUE}`);
  assert.match(baseWhere("urban"), /tipo_predio_zona = 'URBANO'/);
  assert.match(baseWhere("rural"), /tipo_predio_zona = 'RURAL'/);
});

test("parsers read the live text numbers and drop small or unusable values", () => {
  assert.deepEqual(parseValues([{ valor: "230000000" }, { valor: "5000000.0" }, { valor: "x" }, {}, { valor: "12000000.0" }]), [230000000, 12000000]);
  const yc = parseYearCounts([{ divipola: "5001", municipio: "MEDELLÍN", departamento: "ANTIOQUIA", year_radica: "2023", count: "21000" }, { divipola: "5001", municipio: "MEDELLÍN", year_radica: "abc", count: "3" }]);
  assert.equal(yc.length, 1);
  assert.equal(yc[0].year, 2023);
});

test("chooseYears: newest year, widened for small places, capped at three years", () => {
  const c = (year: number, count: number) => ({ divipola: "1", municipio: "M", departamento: "D", year, count });
  assert.deepEqual(chooseYears([c(2022, 40), c(2023, 50)], 12), { years: [2023], total: 50 });
  assert.deepEqual(chooseYears([c(2021, 3), c(2022, 1), c(2023, 2)], 12), { years: [2021, 2022, 2023], total: 6 });
  assert.deepEqual(chooseYears([c(2020, 9), c(2021, 9), c(2022, 9), c(2023, 9)], 36)?.years, [2021, 2022, 2023]);
  assert.equal(chooseYears([], 12), null);
});

/** A fake Socrata server: the aggregate query returns year counts, the value query returns declared values. */
function fake(valuesFor: number[]) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    if (url.includes("count%28%2A%29") || url.includes("count(*)")) {
      return [
        { divipola: "5001", municipio: "MEDELLÍN", departamento: "ANTIOQUIA", year_radica: "2022", count: "20000" },
        { divipola: "5001", municipio: "MEDELLÍN", departamento: "ANTIOQUIA", year_radica: "2023", count: String(valuesFor.length) },
      ];
    }
    const offset = Number(/%24offset=(\d+)/.exec(url)?.[1] ?? /\$offset=(\d+)/.exec(url)?.[1] ?? 0);
    const limit = Number(/%24limit=(\d+)/.exec(url)?.[1] ?? /\$limit=(\d+)/.exec(url)?.[1] ?? 1000);
    return valuesFor.slice(offset, offset + limit).map((v) => ({ valor: String(v) }));
  };
  return { fetcher, urls };
}

test("coHomeSales: median and range of declared values for the newest year, with the dataset-ends notice", async () => {
  const values = [90, 120, 150, 180, 200, 230, 260, 300, 350, 500].map((m) => m * 1_000_000);
  const { fetcher, urls } = fake(values);
  const a = await coHomeSales({ town: "Medellin" }, { fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "COP");
  assert.equal(a.price?.median, 215_000_000);
  assert.equal(a.sample_size, 10);
  assert.equal(a.period.from, "2023-01-01");
  assert.equal(a.period.to, "2023-12-31");
  assert.equal((a.extra as any).area, "Medellín, Antioquia");
  assert.match(JSON.stringify(a.extra), /ends in 2023/);
  // only the value column is read in the second query; no matricula, cadastral number or deed text
  const second = decodeURIComponent(urls[urls.length - 1]);
  assert.match(second, /select=valor/);
  assert.doesNotMatch(urls.join(" "), /matricula|numero_catastral|documento/);
});

test("coHomeSales: fewer than five sales in three years gives insufficient_data, no figure", async () => {
  const fetcher = async (url: string) =>
    url.includes("count") && url.includes("year_radica") && url.includes("group")
      ? [
          { divipola: "5002", municipio: "ABEJORRAL", departamento: "ANTIOQUIA", year_radica: "2022", count: "1" },
          { divipola: "5002", municipio: "ABEJORRAL", departamento: "ANTIOQUIA", year_radica: "2023", count: "2" },
        ]
      : [{ valor: "50000000" }, { valor: "60000000" }, { valor: "70000000" }];
  const a = await coHomeSales({ town: "Abejorral" }, { fetcher });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("coHomeSales: bad input is refused", async () => {
  const { fetcher } = fake([1]);
  await assert.rejects(() => coHomeSales({ town: "Medellin", postcode: "050001" }, { fetcher }), InputError);
  await assert.rejects(() => coHomeSales({ town: "" }, { fetcher }), InputError);
  await assert.rejects(() => coHomeSales({ town: "Medellin", property_type: "castle" }, { fetcher }), InputError);
});

test("manifest: Colombia is served by this source in home-sales, with urban and rural allowed", () => {
  assert.equal(source.info.id, "co-igac-home-sales");
  assert.equal(findSource("home-sales", "CO", { town: "Medellin" })?.info.id, "co-igac-home-sales");
  assert.deepEqual(source.paramValues, { property_type: ["urban", "rural"] });
});
