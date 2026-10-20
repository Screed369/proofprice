import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchedule, nameKey, nzDailyRows, nzAnswerFromRow, nzKey, nzHistoryKey, candidateDates, editionUrl, NzPack } from "./source";
import { FIXTURE_XML } from "./fixture";

// Real start of Schedule_2026-08-10.xml, probed 20 Oct 2026 (see fixture.ts).
test("nz-pharmac parses the live layout", () => {
  const s = parseSchedule(FIXTURE_XML);
  assert.equal(s.published, "2026-08-10");
  assert.equal(s.edition, "August 2026");
  assert.equal(s.packs.length, 36);
  assert.deepEqual(s.packs[0], { id: "P494275", chemical: "Alginic acid", brand: "Gaviscon Infant", quantity: 30, price: 8.06 });
  assert.deepEqual(s.packs[1], { id: "P2196786", chemical: "Sodium alginate", brand: "Acidex", quantity: 500, price: 7.5 });
});
test("nz-pharmac reads only Section B and tolerates entities", () => {
  const xml = `<Schedule><Section ID="B"><ATC1 ID="A"><Name>X</Name><Chemical ID="c"><Name>Foo &amp; Bar</Name><Formulation ID="f"><Name>F</Name><Brand ID="b"><Name>Brand</Name>
    <Pack ID="P1"><Quantity>10</Quantity><Price>2.50</Price></Pack><Pack ID="P2"><Quantity>0</Quantity><Price>0</Price></Pack></Brand></Formulation></Chemical></ATC1></Section>
    <Section ID="H"><Chemical ID="d"><Name>Hosp</Name><Formulation ID="g"><Name>F</Name><Brand ID="h"><Name>HB</Name><Pack ID="P3"><Quantity>1</Quantity><Price>9</Price></Pack></Brand></Formulation></Chemical></Section></Schedule>`;
  const s = parseSchedule(xml);
  assert.deepEqual(s.packs, [{ id: "P1", chemical: "Foo & Bar", brand: "Brand", quantity: 10, price: 2.5 }]);
});
test("nz-pharmac keys and URLs", () => {
  assert.equal(nameKey("Sodium alginate"), "alginate");
  assert.equal(nameKey("Paracetamol with codeine"), "paracetamol");
  assert.equal(nameKey("10 mg"), null);
  assert.equal(nzKey("Panadol Extra").item, "name:panadol");
  assert.throws(() => nzKey(""));
  assert.equal(nzHistoryKey({})?.item, undefined);
  assert.equal(nzHistoryKey({ medicine: "paracetamol" })?.item, "name:paracetamol");
  assert.equal(editionUrl("2026-10-01"), "https://schedule.pharmac.govt.nz/pub/schedule/archive/2026/2026-10-01/Schedule_2026-10-01.xml");
  const d = candidateDates("2026-10-20", 62);
  assert.equal(d[0], "2026-10-20");
  assert.equal(d.length, 63);
  assert.equal(d[62], "2026-08-19");
});
test("nz-pharmac daily rows need 5 packs per name and count a pack once per key", () => {
  const s = parseSchedule(FIXTURE_XML);
  const rows = nzDailyRows(s.packs);
  assert.ok(rows.every((r) => r.area === "ALL" && r.n >= 5));
  assert.equal(rows.find((r) => r.item === "name:acidex"), undefined); // one pack only: hidden
  const dup: NzPack[] = Array.from({ length: 5 }, (_, i) => ({ id: "P" + i, chemical: "Foo", brand: "Foo", quantity: 10, price: 2 + i }));
  const r = nzDailyRows(dup);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 5); // chemical and brand share the key: counted once
  assert.equal(nzDailyRows(dup.slice(0, 4)).length, 0);
});
test("nz-pharmac answer is a posted list price, never 'paid'", () => {
  const row = { date: "2026-10-20", area: "ALL", item: "name:paracetamol", n: 30, median: 4.5, low: 2.1, high: 12, min: 1.5, max: 20 };
  const a = nzAnswerFromRow(row, { key: "paracetamol", today: "2026-10-20" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.median, 4.5);
  assert.equal(a.price?.currency, "NZD");
  assert.match(a.summary, /list price \(per pack\)/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /sold for/);
  assert.equal(a.extra, undefined);
  assert.equal((nzAnswerFromRow(row, { key: "paracetamol", today: "2026-11-05" }).extra as any).stale, true);
  assert.equal(nzAnswerFromRow({ ...row, n: 4 }, { key: "paracetamol", today: "2026-10-20" }).status, "insufficient_data");
});
