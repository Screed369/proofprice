// Tests for the ANEEL Brazil electricity tariff source.
// The first three records are copied from the live API (checked 2026-10-15 via the GitHub probe). The others reuse the same
// field layout; their values are made up only to exercise old-tariff and filter logic (marked SYNTHETIC).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { INFO, aneelDailyRows, aneelHarvest, aneelHistoryKey, brElectricity, brElectricityAnswer, ckanFilters, currentTariffs, findDistributor, parseBrNumber, parseTariffs } from "./source";

const base = {
  DatGeracaoConjuntoDados: "2026-10-15", DscBaseTarifaria: "Tarifa de Aplicação", DscSubGrupo: "B1", DscModalidadeTarifaria: "Convencional",
  DscClasse: "Residencial", DscSubClasse: "Residencial", DscDetalhe: "Não se aplica", NomPostoTarifario: "Não se aplica", DscUnidadeTerciaria: "MWh", SigAgenteAcessante: "Não se aplica",
};
const live = (id: number, ag: string, cnpj: string, reh: string, tusd: string, te: string) => ({
  _id: id, ...base, DscREH: reh, SigAgente: ag, NumCNPJDistribuidora: cnpj, DatInicioVigencia: "2026-09-30", DatFimVigencia: "2027-09-29", VlrTUSD: tusd, VlrTE: te,
});
const RECORDS = [
  live(328540, "CEGERO", "86444163000189", "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.761, DE 30 DE SETEMBRO DE 2026", "345,30", "240,75"),
  live(328350, "CEDRI", "50105865000190", "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.760, DE 30 DE SETEMBRO DE 2026", "644,57", "354,14"),
  live(328730, "CEJAMA", "85665990000130", "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.762, DE 30 DE SETEMBRO DE 2026", "558,70", "211,45"),
  // SYNTHETIC
  live(1, "CEMIG-D", "17155730000164", "SYNTHETIC", "453,00", "295,27"),
  live(2, "LIGHT", "60444437000146", "SYNTHETIC", "480,10", "310,00"),
  live(3, "ENEL SP", "61695227000193", "SYNTHETIC", "400,00", "330,00"),
  { ...live(4, "CEMIG-D", "17155730000164", "SYNTHETIC old", "400,00", "250,00"), DatInicioVigencia: "2025-05-28", DatFimVigencia: "2026-05-27" },
  { ...live(5, "CEMIG-D", "17155730000164", "SYNTHETIC wrong", ",00", "28,99"), DscDetalhe: "SCEE" },
  { ...live(6, "BAD", "0", "SYNTHETIC", "abc", "1,00") },
];
const TODAY = new Date("2026-10-15T12:00:00Z");

test("licence and type", () => {
  assert.match(INFO.licence, /ODbL|Open Database/);
  assert.equal(INFO.price_type, "posted_price");
});

test("Brazilian numbers", () => {
  assert.equal(parseBrNumber("418,31"), 418.31);
  assert.equal(parseBrNumber(",00"), 0);
  assert.equal(parseBrNumber("1.234,50"), 1234.5);
  assert.ok(Number.isNaN(parseBrNumber("abc")));
});

test("parse drops SCEE lines and unreadable numbers", () => {
  const t = parseTariffs(RECORDS);
  assert.equal(t.length, 7);
  assert.ok(!t.some((x) => x.distributor === "BAD"));
});

test("current tariff = newest valid today", () => {
  const cur = currentTariffs(parseTariffs(RECORDS), TODAY);
  assert.equal(cur.length, 6);
  assert.equal(cur.find((c) => c.distributor === "CEMIG-D")!.total, 748.27);
});

test("distributor answer, with fuzzy name", () => {
  const a = brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", distributor: "cemig", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "BRL");
  assert.equal(a.price!.value, 0.7483);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.sample_size, null);
});

test("real CEGERO line is 0.586 BRL/kWh and plausible", () => {
  const a = brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", distributor: "CEGERO", today: TODAY });
  assert.equal(a.price!.value, 0.5861);
  assert.ok(a.price!.value > 0.3 && a.price!.value < 1.5);
});

test("national median with spread", () => {
  const a = brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 6);
  assert.equal((a.extra as any).lowest, "CEGERO");
  assert.equal((a.extra as any).highest, "CEDRI");
  assert.ok(a.price!.typical_low! <= a.price!.value && a.price!.value <= a.price!.typical_high!);
});

test("errors: gas and unknown distributor", () => {
  assert.throws(() => brElectricityAnswer(parseTariffs(RECORDS), { energy: "gas", today: TODAY }), InputError);
  assert.throws(() => brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", distributor: "NOPE", today: TODAY }), InputError);
  assert.equal(findDistributor(currentTariffs(parseTariffs(RECORDS), TODAY), "CE"), null); // ambiguous prefix
});

test("expired tariffs give no_matches", () => {
  const a = brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", today: new Date("2030-01-01") });
  assert.equal(a.status, "no_matches");
});

test("fetch uses the right filters", async () => {
  let url = "";
  const a = await brElectricity({ energy: "electricity", distributor: "LIGHT" }, {
    fetcher: async (u) => { url = u; return { success: true, result: { records: RECORDS, fields: [], total: 9 } }; },
  });
  const sp = new URL(url).searchParams;
  assert.equal(sp.get("resource_id"), "fcf2906c-7c32-4b9b-a637-054e7a5234f4");
  assert.deepEqual(JSON.parse(sp.get("filters")!), ckanFilters());
  assert.ok(a.status === "ok" || a.status === "no_matches");
});

const OK = { success: true, result: { records: RECORDS, fields: [], total: 9 } };

test("one retry: a 502 then a good answer succeeds", async () => {
  let calls = 0;
  const a = await brElectricity({ energy: "electricity", today: TODAY }, {
    fetcher: async () => { if (++calls === 1) throw new SourceError("Source returned HTTP 502", "", 502); return OK; },
  });
  assert.equal(calls, 2);
  assert.ok(a.status === "ok" || a.status === "no_matches");
});

test("two 502s in a row still fail as an outage (so stale-if-error can answer)", async () => {
  let calls = 0;
  await assert.rejects(
    brElectricity({ energy: "electricity" }, { fetcher: async () => { calls++; throw new SourceError("Source returned HTTP 502", "", 502); } }),
    (e: any) => e instanceof SourceError && e.status === 502,
  );
  assert.equal(calls, 2);
});

test("a format error or bad input is not retried", async () => {
  let calls = 0;
  await assert.rejects(brElectricity({ energy: "electricity" }, { fetcher: async () => { calls++; return { success: false }; } }));
  assert.equal(calls, 1);
  await assert.rejects(brElectricity({ energy: "gas" }, { fetcher: async () => { calls++; return OK; } }), InputError);
  assert.equal(calls, 1);
});

test("library rows: national median plus one posted tariff per distributor", () => {
  const rows = aneelDailyRows(parseTariffs(RECORDS), TODAY);
  const all = rows.find((r) => r.area === "ALL")!;
  assert.equal(all.item, "electricity");
  assert.equal(all.n, 6);
  assert.ok(all.low <= all.median && all.median <= all.high && all.min <= all.low && all.high <= all.max);
  const cemig = rows.find((r) => r.area === "CEMIGD")!;
  assert.equal(cemig.median, 0.7483);
  assert.equal(cemig.n, 5);
  assert.equal(rows.length, 7);
  assert.deepEqual(aneelDailyRows([], TODAY), []);
});

test("harvest uses the API with the longer timeout and reports BRL per kWh", async () => {
  const r = await aneelHarvest({ fetcher: async () => ({ success: true, result: { records: RECORDS.map((x) => ({ ...x, DatInicioVigencia: "2020-01-01", DatFimVigencia: "2099-12-31" })), fields: [], total: 9 } }) });
  assert.equal(r.currency, "BRL");
  assert.match(r.unit, /kWh/);
  assert.ok(r.rows.some((x) => x.area === "ALL"));
});

test("historyKey: national by default, a distributor when named, nothing for gas", () => {
  assert.deepEqual(aneelHistoryKey({ country: "BR", energy: "electricity" }), { area: "ALL", item: "electricity", label: "Brazil (median of distributors)" });
  assert.equal(aneelHistoryKey({ country: "BR", energy: "electricity", distributor: "CEMIG-D" })!.area, "CEMIGD");
  assert.equal(aneelHistoryKey({ country: "BR", energy: "electricity", distributor: "ENEL SP" })!.area, "ENELSP");
  assert.equal(aneelHistoryKey({ country: "BR", energy: "gas" }), null);
});

test("the national figure says ProofPrice calculated the median; a distributor's data date is not in the future", () => {
  const a = brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", today: TODAY });
  assert.doesNotMatch(a.summary, /Official (median|average) published/);
  assert.match(a.summary, /Median calculated by ProofPrice across the tariffs ANEEL/);
  assert.match(a.evidence!.label, /calculated by ProofPrice/);
  const d = brElectricityAnswer(parseTariffs(RECORDS), { energy: "electricity", distributor: "cemig", today: TODAY });
  assert.ok(d.data_as_of! <= new Date().toISOString().slice(0, 10));
});
