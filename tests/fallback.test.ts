// Fallback sources (SourcePlugin.fallbackFor): the order runCategory follows when a national source is down, checked with fake
// sources, plus the real case: the EU Weekly Oil Bulletin standing in for the Italian and French station-level sources.
// No test here needs the network: the library is a temp folder, handles are replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const libDir = mkdtempSync(path.join(tmpdir(), "pp-fallback-"));
process.env.PROOFPRICE_LIBRARY_DIR = libDir;

import { buildStatisticAnswer } from "../lib/answer";
import type { PriceAnswer } from "../lib/answer";
import { InputError, SourceError } from "../lib/http";
import { writeDaily, writeMeta } from "../lib/library/store";
import type { SourcePlugin } from "../lib/plugin";
import { SOURCE_PLUGINS, categoryById, fallbackSources, runCategory } from "../lib/registry";
import { priceAnswerSchema } from "../lib/schemas";
import { fallbackSentence } from "../lib/stale";
import { HISTORY_ROWS } from "../sources/eu-oil-bulletin/fixtures";
import { parseHistory, wobResult } from "../sources/eu-oil-bulletin/source";

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const fuelCat = categoryById("fuel")!;
const itSrc = SOURCE_PLUGINS.find((s) => s.info.id === "it-fuel")!;
const frSrc = SOURCE_PLUGINS.find((s) => s.info.id === "fr-fuel")!;
const wobSrc = SOURCE_PLUGINS.find((s) => s.info.id === "eu-oil-bulletin")!;
const MI = { country: "IT", area: "MI", fuel: "diesel" }; // the library holds a recent copy of it-fuel for MI
const RM = { country: "IT", area: "RM", fuel: "diesel" }; // ... and none for RM

function seed(source: string, rows: { area: string; item: string; median: number; n?: number }[], date: string) {
  writeDaily(source, {
    date,
    currency: "EUR",
    unit: "per litre",
    rows: rows.map((r) => ({ area: r.area, item: r.item, n: r.n ?? 60, median: r.median, low: r.median - 0.05, high: r.median + 0.1, min: r.median - 0.2, max: r.median + 0.3 })),
  });
  writeMeta(source, {
    source, currency: "EUR", unit: "per litre", first_date: date, last_date: date, days: 1,
    last_harvest_at: null, last_rows: rows.length, last_ok_at: null, last_error: null,
  });
}
seed("it-fuel", [{ area: "MI", item: "diesel", median: 1.8 }], day(-1));

/** Replace a real source's handle for the length of `body`. */
async function withHandle<T>(src: SourcePlugin, fn: () => Promise<PriceAnswer>, body: () => Promise<T>): Promise<T> {
  const original = src.handle;
  src.handle = (async () => fn()) as any;
  try {
    return await body();
  } finally {
    src.handle = original;
  }
}

/** A fake fallback source: the bulletin's manifest with its own id, handle and (optionally) library hooks. */
function fake(id: string, handle: () => Promise<PriceAnswer>, opts: { countries?: string[]; library?: boolean } = {}): SourcePlugin & { calls: number } {
  const s: any = {
    ...wobSrc,
    info: { ...wobSrc.info, id, name: `Fake ${id}` },
    fallbackFor: { sources: ["it-fuel"], countries: opts.countries ?? ["IT"], label: `the fake ${id}` },
    calls: 0,
    harvest: opts.library ? async () => { throw new Error("not in tests"); } : undefined,
    historyKey: opts.library ? (p: any) => ({ area: String(p.country), item: String(p.fuel), label: `${p.country} (national average)` }) : undefined,
  };
  s.handle = async () => {
    s.calls++;
    return handle();
  };
  return s;
}

function national(src: SourcePlugin, value: number | null): PriceAnswer {
  return buildStatisticAnswer({
    source: src.info, query: { country: "IT", fuel: "diesel" }, measure: "average", currency: "EUR", unit: "per litre", method: "m",
    value, period: { from: "2026-10-12", to: "2026-10-12" }, reference_period: "2026-10-12",
    describe: (v) => `In Italy the average pump price of diesel was €${v} per litre.`,
  });
}

const down = () => Promise.reject(new SourceError("MIMIT timed out"));
const live = (src: SourcePlugin) => () => Promise.resolve({ ...national(src, 1.7), summary: "live primary" } as PriceAnswer);

test("fallbackSources: only sources that declare this primary and this country, same category", () => {
  const a = fake("fake-a", down);
  const b = fake("fake-b", down, { countries: ["FR"] });
  assert.deepEqual(fallbackSources(itSrc, "IT", [itSrc, a, b]).map((s) => s.info.id), ["fake-a"]);
  assert.deepEqual(fallbackSources(itSrc, "FR", [itSrc, a, b]), []); // fake-b declares FR, but it-fuel does not answer France
  assert.deepEqual(fallbackSources(itSrc, "IT").map((s) => s.info.id), ["eu-oil-bulletin"]);
  assert.deepEqual(fallbackSources(frSrc, "FR").map((s) => s.info.id), ["eu-oil-bulletin"]);
});

test("fallbackSources: Statistics Netherlands (nl-cbs-fuel) falls back to the bulletin's national NL figure", async (t) => {
  t.mock.method(console, "warn", () => {});
  const nl = SOURCE_PLUGINS.find((s) => s.info.id === "nl-cbs-fuel")!;
  assert.deepEqual(fallbackSources(nl, "NL").map((s) => s.info.id), ["eu-oil-bulletin"]);
  // the bulletin still does not answer NL on its own (serves() leaves NL to CBS)
  assert.equal(wobSrc.serves!({ country: "NL" }), false);
  const fb = fake("fake-nl", () => Promise.resolve({ ...national(fake("x", down), 2.0), summary: "bulletin NL" } as PriceAnswer), { countries: ["NL"] });
  (fb as any).fallbackFor = { sources: ["nl-cbs-fuel"], countries: ["NL"], label: "the fake bulletin" };
  const a = await withHandle(nl, down, () => runCategory(fuelCat, { country: "NL", fuel: "diesel" }, {}, { sources: [nl, fb] }));
  assert.equal(a.extra!.fallback_for, "nl-cbs-fuel");
  assert.match(a.notice, /could not be reached/);
});

test("order 1: a live primary answer is returned and the fallback is never asked", async () => {
  const fb = fake("fake-fb", () => Promise.resolve(national(fake("x", down), 1.6)));
  const a = await withHandle(itSrc, live(itSrc), () => runCategory(fuelCat, RM, {}, { sources: [itSrc, fb] }));
  assert.equal(a.summary, "live primary");
  assert.equal(fb.calls, 0);
});

test("order 2: primary down with a recent copy: the copy answers, the fallback is never asked", async (t) => {
  t.mock.method(console, "warn", () => {});
  const fb = fake("fake-fb", () => Promise.resolve(national(fake("x", down), 1.6)));
  const a = await withHandle(itSrc, down, () => runCategory(fuelCat, MI, {}, { sources: [itSrc, fb] }));
  assert.equal(a.extra!.stale, true);
  assert.equal(a.source.id, "it-fuel");
  assert.equal(a.extra!.fallback_for, undefined);
  assert.equal(fb.calls, 0);
});

test("order 3: primary down, no copy: the fallback's own live answer, saying plainly that it stands in", async (t) => {
  t.mock.method(console, "warn", () => {});
  let fb: SourcePlugin & { calls: number };
  fb = fake("fake-fb", () => Promise.resolve(national(fb, 1.6)));
  const a = await withHandle(itSrc, down, () => runCategory(fuelCat, RM, { baseUrl: "https://example.test" }, { sources: [itSrc, fb] }));
  assert.equal(fb.calls, 1);
  assert.equal(a.status, "ok");
  // it IS the fallback source's answer: its source, licence, attribution, price type and evidence
  assert.equal(a.source.id, "fake-fb");
  assert.equal(a.source.attribution, wobSrc.info.attribution);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.evidence?.type, "official_statistic");
  assert.equal(a.price!.value, 1.6);
  // ... marked as standing in
  assert.equal(a.extra!.fallback_for, "it-fuel");
  assert.equal(a.extra!.primary_error, "MIMIT timed out");
  const sentence = fallbackSentence(itSrc.info.publisher, "the fake fake-fb");
  assert.equal(sentence, `The national source (${itSrc.info.publisher}) could not be reached; this is the fake fake-fb's national figure instead.`);
  assert.ok(a.notice.startsWith(sentence));
  assert.ok(a.summary.startsWith(sentence));
  assert.ok(priceAnswerSchema.safeParse(a).success);
});

test("order 4: fallback down too: the fallback's own recent copy, still marked as standing in", async (t) => {
  t.mock.method(console, "warn", () => {});
  seed("fake-lib", [{ area: "IT", item: "diesel", median: 1.65, n: 5 }], day(-2));
  const fb = fake("fake-lib", () => Promise.reject(new SourceError("Source returned HTTP 503", "", 503)), { library: true });
  const a = await withHandle(itSrc, down, () => runCategory(fuelCat, RM, {}, { sources: [itSrc, fb] }));
  assert.equal(a.source.id, "fake-lib");
  assert.equal(a.extra!.stale, true);
  assert.equal(a.extra!.snapshot_date, day(-2));
  assert.equal(a.extra!.fallback_for, "it-fuel");
  assert.equal(a.extra!.primary_error, "MIMIT timed out");
  assert.match(a.notice, /^The national source \(.*\) could not be reached; this is the fake fake-lib's national figure instead\. The official source did not respond; this is our copy from/);
});

test("order 5: nothing can stand in: the primary's error (a 502), never the fallback's", async (t) => {
  t.mock.method(console, "warn", () => {});
  const noCopy = fake("fake-nocopy", () => Promise.reject(new SourceError("Source timed out")), { library: true });
  await assert.rejects(withHandle(itSrc, down, () => runCategory(fuelCat, RM, {}, { sources: [itSrc, noCopy] })), /MIMIT timed out/);
  assert.equal(noCopy.calls, 1);
  // the fallback has no figure for this fuel (status not ok): not used
  let empty: SourcePlugin & { calls: number };
  empty = fake("fake-empty", () => Promise.resolve(national(empty, null)));
  await assert.rejects(withHandle(itSrc, down, () => runCategory(fuelCat, RM, {}, { sources: [itSrc, empty] })), /MIMIT timed out/);
  // the fallback refuses the request (bad input for it): not used, and its message is not shown
  const refuses = fake("fake-refuses", () => Promise.reject(new InputError("fuel must be petrol95, diesel or lpg")));
  await assert.rejects(withHandle(itSrc, down, () => runCategory(fuelCat, RM, {}, { sources: [itSrc, refuses] })), /MIMIT timed out/);
  // a fallback that hangs is cut off by the deadline, then the primary's error
  const hangs = fake("fake-hangs", () => new Promise<PriceAnswer>(() => {}));
  await assert.rejects(withHandle(itSrc, down, () => runCategory(fuelCat, RM, {}, { sources: [itSrc, hangs], deadlineMs: 20 })), /MIMIT timed out/);
});

test("a fallback is only for outages: bad input and 4xx from the primary are reported as they are", async (t) => {
  t.mock.method(console, "warn", () => {});
  const fb = fake("fake-fb", () => Promise.resolve(national(fake("x", down), 1.6)));
  await assert.rejects(withHandle(itSrc, () => Promise.reject(new InputError("Give an Italian town")), () => runCategory(fuelCat, RM, {}, { sources: [itSrc, fb] })), /Give an Italian town/);
  await assert.rejects(withHandle(itSrc, () => Promise.reject(new SourceError("MIMIT returned HTTP 404", "", 404)), () => runCategory(fuelCat, RM, {}, { sources: [itSrc, fb] })), /HTTP 404/);
  assert.equal(fb.calls, 0);
});

test("several fallbacks: the first that answers ok wins, in registry order", async (t) => {
  t.mock.method(console, "warn", () => {});
  const first = fake("fake-first", () => Promise.reject(new SourceError("Source timed out")));
  let second: SourcePlugin & { calls: number };
  second = fake("fake-second", () => Promise.resolve(national(second, 1.62)));
  const a = await withHandle(itSrc, down, () => runCategory(fuelCat, RM, {}, { sources: [itSrc, first, second] }));
  assert.equal(first.calls, 1);
  assert.equal(a.source.id, "fake-second");
  assert.equal(a.extra!.fallback_for, "it-fuel");
});

// ---------- the real case: the EU Weekly Oil Bulletin for Italy and France ----------

function seedBulletin() {
  const h = wobResult(parseHistory(HISTORY_ROWS, 60, 5)); // real rows (France among them)
  // the fixture keeps no Italian column: add Italy's national diesel figure as the collector would store it
  h.rows.push({ area: "IT", item: "diesel", n: 5, median: 1.7123, low: 1.7123, high: 1.7123, min: 1.7123, max: 1.7123 });
  writeDaily("eu-oil-bulletin", h);
  return h.date;
}

test("Italy: MIMIT down and no copy for the province: the bulletin's national figure, honest about the place asked", async (t) => {
  t.mock.method(console, "warn", () => {});
  const date = seedBulletin();
  const a = await withHandle(itSrc, down, () => runCategory(fuelCat, RM, { baseUrl: "https://example.test" }));
  assert.equal(a.status, "ok");
  assert.equal(a.source.id, "eu-oil-bulletin");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 1.7123);
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, date);
  assert.equal(a.extra!.fallback_for, "it-fuel");
  assert.equal(a.extra!.primary_error, "MIMIT timed out");
  assert.equal(a.extra!.answered_as, "national average");
  assert.ok(a.notice.startsWith(
    "The national source (Ministero delle Imprese e del Made in Italy (MIMIT), Osservaprezzi carburanti) could not be reached; " +
      "this is the European Commission Weekly Oil Bulletin's national figure instead.",
  ));
  assert.match(a.summary, /This is the national average for Italy, not a figure for RM\./);
  assert.ok(priceAnswerSchema.safeParse(a).success);
  // the province copy still comes first where it exists
  const mi = await withHandle(itSrc, down, () => runCategory(fuelCat, MI));
  assert.equal(mi.source.id, "it-fuel");
  assert.equal(mi.extra!.stale, true);
});

test("France over REST: the national source down, the bulletin answers with a 200 and says so; a fuel it does not publish stays a 502", async (t) => {
  t.mock.method(console, "warn", () => {});
  seedBulletin();
  const { GET } = await import("../app/api/v1/[category]/route");
  const ask = (url: string) => GET(new Request(url), { params: Promise.resolve({ category: "fuel" }) });
  const res = await withHandle(frSrc, () => Promise.reject(new SourceError("Source returned HTTP 503", "", 503)), () => ask("https://example.test/api/v1/fuel?country=FR&postcode=75015&fuel=diesel"));
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.source.id, "eu-oil-bulletin");
  assert.equal(body.extra.fallback_for, "fr-fuel");
  assert.match(body.notice, /^The national source \(Ministère de l'Économie via data\.economie\.gouv\.fr\) could not be reached/);
  assert.match(body.summary, /national average for France, not a figure for postcode 75015/);
  const e10 = await withHandle(frSrc, () => Promise.reject(new SourceError("Source returned HTTP 503", "", 503)), () => ask("https://example.test/api/v1/fuel?country=FR&postcode=75015&fuel=e10"));
  assert.equal(e10.status, 502);
});
