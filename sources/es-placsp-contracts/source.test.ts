import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, EntrySplitter, esContracts, esContractsHarvest, feedUrl, INFO, itemsOf, nextLink, parseEntry, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Shape copied from the live feed licitacionesPerfilesContratanteCompleto3.atom, checked 2026-10-24 (personal and buyer details left out).
const entry = (id: number, status: string, award: string) => `<entry>
        <id>https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/${id}</id>
        <summary type="text">Id licitación: 184/2026; Órgano de Contratación: Alcaldía; Importe: 39000 EUR; Estado: ${status}</summary>
        <title>Suministro de un tractor</title>
        <updated>2026-10-23T19:23:02.714+02:00</updated>
        <cac-place-ext:ContractFolderStatus>
            <cbc:ContractFolderID>184/2026</cbc:ContractFolderID>
            <cbc-place-ext:ContractFolderStatusCode languageID="es" listURI="https://contrataciondelestado.es/codice/cl/2.04/SyndicationContractFolderStatusCode-2.04.gc">${status}</cbc-place-ext:ContractFolderStatusCode>
            <cac:ProcurementProject>
                <cbc:Name>Suministro de un tractor</cbc:Name>
                <cac:BudgetAmount>
                    <cbc:EstimatedOverallContractAmount currencyID="EUR">39000</cbc:EstimatedOverallContractAmount>
                    <cbc:TaxExclusiveAmount currencyID="EUR">39000</cbc:TaxExclusiveAmount>
                </cac:BudgetAmount>
                <cac:RequiredCommodityClassification>
                    <cbc:ItemClassificationCode listURI="http://contrataciondelestado.es/codice/cl/2.04/CPV2008-2.04.gc">45233251</cbc:ItemClassificationCode>
                </cac:RequiredCommodityClassification>
                <cac:RequiredCommodityClassification>
                    <cbc:ItemClassificationCode listURI="http://contrataciondelestado.es/codice/cl/2.04/CPV2008-2.04.gc">43250000</cbc:ItemClassificationCode>
                </cac:RequiredCommodityClassification>
            </cac:ProcurementProject>
            ${award}
        </cac-place-ext:ContractFolderStatus>
    </entry>`;
const result = (code: string, date: string, amount: number) => `<cac:TenderResult>
                <cbc:ResultCode listURI="http://contrataciondelestado.es/codice/cl/2.09/TenderResultCode-2.09.gc">${code}</cbc:ResultCode>
                <cbc:AwardDate>${date}</cbc:AwardDate>
                <cbc:ReceivedTenderQuantity>1</cbc:ReceivedTenderQuantity>
                <cac:AwardedTenderedProject>
                    <cac:LegalMonetaryTotal>
                        <cbc:TaxExclusiveAmount currencyID="EUR">${amount}</cbc:TaxExclusiveAmount>
                        <cbc:PayableAmount currencyID="EUR">${amount * 1.21}</cbc:PayableAmount>
                    </cac:LegalMonetaryTotal>
                </cac:AwardedTenderedProject>
            </cac:TenderResult>`;
const head = (next: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Licitaciones</title>
    <link href="https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom" rel="self"/>
    <link href="https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom" rel="first"/>
    ${next ? `<link href="${next}" rel="next"/>` : ""}
    <updated>2026-10-23T20:22:31.267+02:00</updated>
`;

test("parseEntry reads an award without names, and ignores tenders not awarded yet", () => {
  const e = parseEntry(entry(1, "ADJ", result("8", "2026-10-23", 38998)), "2026-10-01", "2026-10-24");
  assert.ok(e);
  assert.equal(e!.updated, "2026-10-23");
  assert.deepEqual(e!.awards, [{ key: "https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/1#1", date: "2026-10-23", value: 38998, cpv: "45233251" }]);
  assert.equal(parseEntry(entry(2, "PUB", ""), "2026-10-01", "2026-10-24")!.awards.length, 0);
  assert.equal(parseEntry("<entry></entry>", "2026-10-01", "2026-10-24"), null);
});

test("parseEntry drops cancelled results, placeholders, entry errors and awards outside the window", () => {
  const xml = entry(3, "RES", result("1", "2026-10-23", 5000) + result("9", "2026-10-23", 100) + result("9", "2026-10-23", 5e9) + result("9", "2026-08-01", 7000) + result("9", "2026-10-22", 7000));
  const e = parseEntry(xml, "2026-10-10", "2026-10-24")!;
  assert.deepEqual(e.awards.map((a) => [a.date, a.value]), [["2026-10-22", 7000]]);
});

test("nextLink and feedUrl follow the chain on the proven host", () => {
  const h = head("https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_20261023_202231.atom");
  assert.equal(
    feedUrl(nextLink(h)),
    "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_20261023_202231.atom",
  );
  assert.equal(nextLink(head("")), "");
  assert.equal(feedUrl("not a url"), "");
});

test("EntrySplitter finds entries across any cut of the text and keeps the head", () => {
  const text = head("https://contrataciondelestado.es/x.atom") + entry(1, "ADJ", result("8", "2026-10-23", 6000)) + "\n" + entry(2, "PUB", "") + "\n</feed>";
  for (const size of [1, 7, 64, 100000]) {
    const got: string[] = [];
    const s = new EntrySplitter((x) => got.push(x));
    for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
    assert.equal(got.length, 2, `piece size ${size}`);
    assert.ok(got[0].startsWith("<entry>") && got[0].endsWith("</entry>"));
    assert.equal(nextLink(s.head), "https://contrataciondelestado.es/x.atom");
  }
});

test("itemsOf and aggregateAll keep only items with 5 distinct awards", () => {
  assert.ok(itemsOf("45233251").includes("road-resurfacing"));
  assert.ok(itemsOf("45233251").includes("cpv-45") && itemsOf("45233251").includes("cpv-4523"));
  const mk = (n: number, cpv = "45233251") => Array.from({ length: n }, (_, i) => ({ key: `k${cpv}${i}`, date: "2026-10-20", value: 10000 + i * 1000, cpv }));
  const rows = aggregateAll([...mk(5), ...mk(4, "30213100"), ...mk(5)], "2026-10-10", "2026-10-24");
  assert.ok(rows.find((r) => r.item === "cpv-45" && r.n === 5));
  assert.ok(!rows.find((r) => r.item === "laptops"));
});

const fileOf = (next: string, ids: number[], updated: string) =>
  head(next) + ids.map((i) => entry(i, "ADJ", result("8", "2026-10-23", 10000 + i * 1000)).replace("2026-10-23T19:23:02.714+02:00", updated)).join("\n") + "\n</feed>";

test("harvest walks the chain back to the window start and aggregates", async () => {
  const first = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
  const page2 = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/p2.atom";
  const files: Record<string, string> = {
    [first]: fileOf("https://contrataciondelestado.es/sindicacion/sindicacion_643/p2.atom", [1, 2, 3], "2026-10-23T10:00:00+02:00"),
    [page2]: fileOf("", [4, 5, 6, 7], "2026-10-09T10:00:00+02:00"),
  };
  const asked: string[] = [];
  const r = await esContractsHarvest(new Date("2026-10-24T03:17:00Z"), {
    days: 14,
    open: async (u) => {
      asked.push(u);
      return [files[u]];
    },
  });
  assert.deepEqual(asked, [first, page2]);
  assert.equal(r.date, "2026-10-24");
  const cpv45 = r.rows.find((x) => x.item === "cpv-45");
  assert.equal(cpv45?.n, 7);
  assert.equal(cpv45?.median, 14000);
});

test("harvest refuses to store a partial window and reports a read failure", async () => {
  const first = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
  const f = fileOf("https://contrataciondelestado.es/sindicacion/sindicacion_643/p2.atom", [1, 2, 3, 4, 5], "2026-10-23T10:00:00+02:00");
  await assert.rejects(
    esContractsHarvest(new Date("2026-10-24T03:17:00Z"), { days: 14, maxFiles: 1, open: async () => [f] }),
    /not storing a partial window/,
  );
  await assert.rejects(esContractsHarvest(new Date("2026-10-24T03:17:00Z"), { open: async () => { throw new Error("boom"); } }), SourceError);
  assert.ok(first);
});

test("windowStart", () => assert.equal(windowStart("2026-10-24", 14), "2026-10-10"));

test("answer: median and range from the library, period and labels, and clear errors", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "esplacsp-"));
  try {
    await assert.rejects(esContracts({ what: "laptops" }), /not been collected yet/);
    const h = { date: "2026-10-24", currency: "EUR", unit: "per contract, total awarded price without VAT", rows: [{ area: "ALL", item: "cpv-45", n: 130, median: 54000, low: 9000, high: 420000, min: 600, max: 9e6 }] };
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "EUR", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const a = await esContracts({ what: "works", cpv: "45" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.median, 54000);
    assert.equal(a.price?.currency, "EUR");
    assert.equal(a.sample_size, 130);
    assert.deepEqual(a.period, { from: "2026-10-23", to: "2026-10-24" });
    assert.match(a.summary, /not unit prices/);
    assert.equal((await esContracts({ what: "laptops" })).status, "no_matches");
    await assert.rejects(esContracts({ what: "unicorns" }), InputError);
    await assert.rejects(esContracts({ what: "x", cpv: "123" }), InputError);
    await assert.rejects(esContracts({ what: "laptops", buyer_area: "Madrid" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("answer: a thin newest day falls back to the newest earlier day with 5+ awards, and says so", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "esplacsp-"));
  try {
    const unit = "per contract, total awarded price without VAT";
    writeDaily(INFO.id, { date: "2026-10-24", currency: "EUR", unit, rows: [{ area: "ALL", item: "cpv-45", n: 12, median: 172232, low: 40045, high: 3890362, min: 6341, max: 8301079 }] });
    writeDaily(INFO.id, { date: "2026-10-29", currency: "EUR", unit, rows: [{ area: "ALL", item: "cpv-03", n: 12, median: 48988, low: 25664, high: 89146, min: 25020, max: 150064 }] });
    writeMeta(INFO.id, { source: INFO.id, currency: "EUR", unit, first_date: "2026-10-24", last_date: "2026-10-29", days: 2, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const a = await esContracts({ what: "works", cpv: "45" });
    assert.equal(a.status, "ok");
    assert.equal(a.price?.median, 172232);
    assert.deepEqual(a.period, { from: "2026-10-23", to: "2026-10-24" });
    assert.match(a.method ?? "", /fewer than 5 awards/);
    assert.equal((a.extra as any).fell_back_to_earlier_day, "2026-10-24");
    // older than a week: still no matches
    assert.equal((await esContracts({ what: "laptops" })).status, "no_matches");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("INFO: reuse with source cited, contract prices, no buyers or winners", () => {
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.attribution, /Origen de los datos: Ministerio de Hacienda/);
  assert.match(INFO.limits, /never read or kept/);
});

test("gap G20261030-1: /api/v1/contracts?country=ES with no 'what' is refused as a bad request that names working examples", async () => {
  const contracts = (await import("../../categories/contracts/index")).default;
  assert.throws(
    () => contracts.prepare!({ country: "ES" } as any),
    (e: any) => e instanceof InputError && /what is required/.test(e.message) && /country=ES&what=office%20cleaning/.test(e.message) && /cpv=45/.test(e.message),
  );
  // with a purchase it still prepares
  const ok = contracts.prepare!({ country: "ES", what: "office cleaning" } as any) as any;
  assert.equal(ok.what, "office cleaning");
});
