import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, contractOf, INFO, itemsOf, listPage, uaContracts, uaContractsHarvest, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Shape copied from the live Prozorro API 2.5, checked 2026-10-21 and 2026-10-23 (list: id/dateModified/status; detail: data{...}).
const detail = (n: number, over: Record<string, unknown> = {}) => ({
  data: {
    id: `id${n}`,
    contractID: `UA-2026-10-14-0157${n}-a-a1`,
    status: "active",
    dateSigned: "2026-10-14T00:00:00+03:00",
    value: { amount: 100000 + n * 1000, currency: "UAH", valueAddedTaxIncluded: true, amountNet: 80000 },
    items: [{ description: "Ноутбуки", quantity: 1.0, classification: { scheme: "ДК021", id: "30213100-6" }, unit: { name: "штуки", code: "H87" } }],
    suppliers: [{ name: "ТОВ Приклад", identifier: { id: "12345678" } }],
    procuringEntity: { name: "Міськрада", identifier: { id: "87654321" } },
    ...over,
  },
});
const LIST1 = {
  data: [1, 2, 3, 4].map((n) => ({ id: `id${n}`, dateModified: "2026-10-21T22:42:17.582082+03:00", status: "active" })),
  next_page: { offset: "1792611726.626.1.42f1", uri: "https://public-api.prozorro.gov.ua/api/2.5/contracts?limit=100&descending=1&offset=1792611726.626.1.42f1" },
};
const LIST2 = { data: [5, 6, 7].map((n) => ({ id: `id${n}`, dateModified: "x", status: "active" })), next_page: { offset: "end" } };
const LIST3 = { data: [], next_page: { offset: "end2" } };

function api(calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    if (url.includes("offset=end2")) return LIST3;
    if (url.includes("offset=end")) return LIST3;
    if (url.includes("offset=")) return LIST2;
    if (url.includes("opt_fields")) return LIST1;
    const id = url.split("/contracts/")[1];
    const n = Number(id.replace("id", ""));
    if (n === 7) throw new SourceError("HTTP 500");
    if (n === 6) return detail(n, { status: "pending" });
    return detail(n);
  };
}

test("listPage: ids and the next offset; an empty page stops", () => {
  assert.deepEqual(listPage(LIST1).ids, ["id1", "id2", "id3", "id4"]);
  assert.equal(listPage(LIST1).next, "1792611726.626.1.42f1");
  assert.deepEqual(listPage(LIST3), { ids: [], next: null });
  assert.deepEqual(listPage(null), { ids: [], next: null });
});

test("contractOf: keeps signed UAH contracts; drops pending, placeholders, entry errors, other currency, mixed baskets, out of window", () => {
  const f = "2026-07-25";
  const t = "2026-10-23";
  assert.deepEqual(contractOf(detail(5).data, f, t), { id: "id5", date: "2026-10-14", value: 105000, cpv: "30213100" });
  assert.equal(contractOf(detail(5, { status: "pending" }).data, f, t), null);
  assert.equal(contractOf(detail(5, { value: { amount: 1, currency: "UAH", valueAddedTaxIncluded: true } }).data, f, t), null);
  assert.equal(contractOf(detail(5, { value: { amount: 5e10, currency: "UAH", valueAddedTaxIncluded: true } }).data, f, t), null);
  assert.equal(contractOf(detail(5, { value: { amount: 5e5, currency: "EUR", valueAddedTaxIncluded: true } }).data, f, t), null);
  // a supplier that is not a VAT payer (seen live 2026-10-23): amount == amountNet, still a real contract value
  assert.equal(contractOf(detail(5, { value: { amount: 88400, currency: "UAH", valueAddedTaxIncluded: false, amountNet: 88400 } }).data, f, t)?.value, 88400);
  assert.equal(contractOf(detail(5, { dateSigned: "2025-01-01T00:00:00+02:00" }).data, f, t), null);
  assert.equal(contractOf(detail(5, { dateSigned: undefined }).data, f, t), null);
  assert.equal(contractOf(detail(5, { items: [] }).data, f, t), null);
  const mixed = [{ classification: { id: "30213100-6" } }, { classification: { id: "55524000-9" } }];
  assert.equal(contractOf(detail(5, { items: mixed }).data, f, t), null);
  assert.equal(contractOf(detail(5, { status: "terminated" }).data, f, t)?.cpv, "30213100");
  assert.equal(contractOf(null, f, t), null);
});

test("itemsOf and aggregateAll: 5 distinct contracts needed, counted once", () => {
  assert.deepEqual(itemsOf("30213100"), ["laptops", "cpv-30", "cpv-3021"]);
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, date: "2026-10-01", value: 100000 + i, cpv: "30213100" }));
  const five = mk(5);
  const rows = aggregateAll([...five, five[0]], "2026-07-25", "2026-10-23");
  const l = rows.find((r) => r.item === "laptops");
  assert.deepEqual(l && [l.area, l.n, l.median], ["ALL", 5, 100002]);
  assert.deepEqual(aggregateAll(mk(4), "2026-07-25", "2026-10-23"), []);
});

test("harvest then answer: pages the list, reads details, skips failures, keeps aggregates only", async () => {
  const calls: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), "uaproz-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    // 7 ids: id6 pending (dropped), id7 fails; 5 usable -> exactly the minimum
    const h = await uaContractsHarvest(new Date("2026-10-23T03:17:00Z"), { get: api(calls) });
    assert.equal(h.currency, "UAH");
    assert.match(calls[0], /limit=100&descending=1&opt_fields=status$/);
    assert.match(h.note ?? "", /7 most recently updated contracts; 6 read, 1 failed, 5 usable/);
    const laptops = h.rows.find((r) => r.item === "laptops")!;
    assert.deepEqual([laptops.n, laptops.median], [5, 103000]);
    assert.doesNotMatch(JSON.stringify(h), /12345678|87654321|Приклад|Міськрада/);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "UAH", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });

    const a = await uaContracts({ what: "laptops" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "UAH");
    assert.equal(a.price?.median, 103000);
    assert.equal(a.sample_size, 5);
    assert.deepEqual(a.period, { from: "2026-07-25", to: "2026-10-23" });
    assert.match(a.summary, /not unit prices/);
    assert.equal((await uaContracts({ what: "x", cpv: "30213100-6" })).extra?.cpv_group, "3021");
    assert.equal((await uaContracts({ what: "ambulances" })).status, "no_matches");
    await assert.rejects(uaContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(uaContracts({ what: "laptops", cpv: "302" }), InputError);
    await assert.rejects(uaContracts({ what: "laptops", buyer_area: "Kyiv" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest errors: empty list, every detail failing, nothing usable", async () => {
  const now = new Date("2026-10-23T03:17:00Z");
  await assert.rejects(uaContractsHarvest(now, { get: async () => LIST3 }), /list is empty/);
  const failing = async (url: string) => {
    if (url.includes("/contracts/id")) throw new SourceError("HTTP 500");
    return LIST1;
  };
  await assert.rejects(uaContractsHarvest(now, { get: failing }), /Could not read any Prozorro contract/);
  const none = async (url: string) => (url.includes("/contracts/id") ? detail(1, { status: "pending" }) : LIST1);
  await assert.rejects(uaContractsHarvest(now, { get: none }), /nothing usable/);
});

test("no library yet gives a readable error; window is 90 days", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "uaproz-empty-"));
  try {
    await assert.rejects(uaContracts({ what: "laptops" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-23"), "2026-07-25");
});

test("INFO: CC BY 4.0, contract prices, no suppliers", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /suppliers and buyers are never read/);
  assert.match(INFO.attribution, /data\.gov\.ua/);
});
