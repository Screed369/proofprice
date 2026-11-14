import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { DMEPOS_CSV } from "./fixture";
import { dmeposPrices, feeFor, findRelease, isDmeposRequest, matchDmepos, parseDmepos, parseState, resetCache, serviceQuery, unzipDmeposCsv } from "./source";

// Page excerpt copied 2026-11-11 from the live CMS page (links to the release sub-pages, in the order the page lists them).
const PAGE = `<a href="/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule/dme26">DME26</a><a href="/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule/dme26-b">DME26-B</a><a href="/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule/dme26-c">DME26-C</a><a href="/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule/dme26-d">DME26-D</a><a href="/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule/dme25-d">DME25-D</a>`;

function zipOf(name: string, content: string): Buffer {
  const raw = Buffer.from(content, "latin1");
  const comp = deflateRawSync(raw);
  const nm = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(0, 42);
  const cdOffset = 30 + nm.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + nm.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([lh, nm, comp, ch, nm, eocd]);
}

// The real file has 3,5xx rows; the loader wants at least 500, so the fixture rows are repeated under made-up unusable codes only in the loader test.
const filler = Array.from({ length: 600 }, (_, i) => DMEPOS_CSV.split("\r\n")[8].replace("A4216", `A${String(5000 + i)}`)).join("\r\n");
const BIG = DMEPOS_CSV + filler + "\r\n";
const fetcher = async (url: string) => (url.endsWith(".zip") ? zipOf("DMEPOS_OCT.csv", BIG) : Buffer.from(PAGE));

describe("us-cms-dmepos", () => {
  beforeEach(() => resetCache());

  it("picks the newest release from the page (dme26-d = October 2026)", () => {
    const r = findRelease(PAGE)!;
    assert.equal(r.name, "dme26-d");
    assert.equal(r.url, "https://www.cms.gov/files/zip/dme26-d.zip");
    assert.equal(r.label, "October 2026");
    assert.equal(r.ref, "2026-Q4");
    assert.equal(findRelease("<p>nothing</p>"), null);
  });

  it("reads the csv out of the zip and the header by name", () => {
    const text = unzipDmeposCsv(zipOf("DMEPOS_OCT.csv", DMEPOS_CSV));
    const p = parseDmepos(text);
    assert.equal(p.released, "October 2026");
    assert.ok(p.states.includes("TX") && p.states.length >= 50);
    assert.equal(p.rows.length, 6);
    const cpap = p.rows.find((r) => r.code === "E0601")!;
    assert.equal(cpap.mod, "RR");
    assert.equal(cpap.category, "CR");
    assert.equal(cpap.fees.AL.nr, 51.94);
    assert.equal(cpap.fees.AL.r, 97.02);
    assert.equal(p.rows.find((r) => r.code === "A4216")!.fees.AL.r, null); // 0.00 = no fee in this column
    assert.throws(() => unzipDmeposCsv(zipOf("other.csv", "x")), /no DMEPOS/);
    assert.throws(() => parseDmepos("a,b\n1,2"), /header/);
  });

  it("routes equipment requests only", () => {
    assert.equal(isDmeposRequest({ country: "US", service: "E0601" }), true);
    assert.equal(isDmeposRequest({ country: "US", service: "wheelchair", basis: "dmepos" }), true);
    assert.equal(isDmeposRequest({ country: "US", service: "99213" }), false);
    assert.equal(isDmeposRequest({ country: "US", service: "knee replacement" }), false);
    assert.equal(isDmeposRequest({ country: "US", service: "G0121" }), false);
  });

  it("understands codes, modifiers, words and states", () => {
    assert.deepEqual(serviceQuery("e0601 rr"), { code: "E0601", mod: "RR", words: [] });
    assert.deepEqual(serviceQuery("Walker"), { code: null, mod: null, words: ["walker"] });
    const p = parseDmepos(DMEPOS_CSV);
    assert.equal(parseState("Texas", p.states), "TX");
    assert.equal(parseState("tx", p.states), "TX");
    assert.equal(parseState(undefined, p.states), null);
    assert.throws(() => parseState("Narnia", p.states), /state must be/);
    assert.equal(matchDmepos(p.rows, serviceQuery("walker")).length, 2);
    assert.equal(matchDmepos(p.rows, serviceQuery("E0143"))[0].mod, "NU"); // purchase before rental
  });

  it("answers a state fee and the median across states, labelled as a posted rate", async () => {
    const a = await dmeposPrices({ service: "E0601", state: "AL" }, fetcher);
    assert.equal(a.status, "ok");
    assert.equal(a.price?.value, 51.94);
    assert.equal(a.price?.unit, "per month (rental)");
    assert.equal(a.price?.sample_size ?? null, null);
    assert.match(a.summary, /October 2026/);
    assert.match(a.summary, /not a price paid/);
    assert.equal((a.extra as any).rural_fee_usd, 97.02);
    const n = await dmeposPrices({ service: "oxygen concentrator" }, fetcher);
    assert.equal(n.status, "ok");
    assert.ok((n.price?.value ?? 0) >= 94.56 && (n.price?.value ?? 0) <= 177.16);
    assert.equal(n.price?.measure, "median");
    const p = parseDmepos(DMEPOS_CSV);
    const f = feeFor(p.rows.find((r) => r.code === "E1390")!, null);
    assert.equal(f.min, 94.56);
    assert.equal(f.max, 177.16);
  });

  it("says plainly when nothing matches or the input is empty", async () => {
    const none = await dmeposPrices({ service: "teleportation chair" }, fetcher);
    assert.equal(none.status, "no_matches");
    await assert.rejects(() => dmeposPrices({ service: "" }, fetcher), /service is required/);
    await assert.rejects(() => dmeposPrices({ service: "E0601", state: "Narnia" }, fetcher), /state must be/);
  });
});
