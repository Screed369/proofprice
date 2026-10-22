// The outside check (crossCheck): verdict rules, our library roll-up, the runner on real library days with the publishers' figures
// from the probe fixtures, the result files, and that nothing of it reaches the public answer, tools, OpenAPI or coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { countShareFor, FAIL_AFTER_RUNS, judge, libraryRollup, nextMeta, runSourceCheck, spanMonths, SourceRunDeps } from "../lib/crosscheck";
import { SOURCE_PLUGINS, coverage } from "../lib/registry";
import { buildOpenApi, buildLlmsTxt } from "../lib/openapi";
import { appendCrossCheck, CrossCheckRow, libraryDates, readCrossCheck, readRowsOnDates } from "../lib/library/store";
import { wobHeadlines } from "../sources/_crosscheck/feeds";
import { WOB_ROWS } from "../sources/_crosscheck/fixtures";
import type { PriceAnswer } from "../lib/answer";
import type { CrossCheckContext, SourcePlugin } from "../lib/plugin";

const src = (id: string) => SOURCE_PLUGINS.find((s) => s.info.id === id)!;
const base = { band: [0.2, 1.7] as [number, number], tolerancePct: 1, previousGaps: [] as number[], jumpPoints: 1.5 };

test("judge: AGREES near zero, EXPLAINED inside the declared bias, SUSPECT outside it", () => {
  assert.equal(judge({ ...base, gap: 0.7 }).verdict, "AGREES"); // Spain petrol, pilot
  assert.equal(judge({ ...base, gap: 1.7 }).verdict, "EXPLAINED"); // Spain diesel, pilot
  assert.equal(judge({ ...base, gap: -0.8 }).verdict, "AGREES");
  const s = judge({ ...base, gap: 3.1 });
  assert.equal(s.verdict, "SUSPECT");
  assert.match(s.reason, /outside the expected \+0.2% to \+1.7%/);
  // a unit slip (per 1000 litres against per litre) is caught whatever the band
  assert.equal(judge({ ...base, gap: 99900 }).verdict, "SUSPECT");
});

test("judge: the alarm is a JUMP in the gap, not the gap itself", () => {
  assert.equal(judge({ ...base, gap: 1.4, previousGaps: [1.0, 1.2, 1.4, 1.1] }).verdict, "EXPLAINED");
  const j = judge({ ...base, gap: 2.6, previousGaps: [0.2, 0.3, 0.2, 0.25] });
  assert.equal(j.verdict, "SUSPECT"); // still inside band + tolerance, but it moved 2.4 points
  assert.match(j.reason, /jumped from its usual 0.23% to 2.6%/);
});

test("judge: volumes off (the Bristol boundary) and a half-empty feed (France, 20 Oct) are SUSPECT even when prices agree", () => {
  const v = judge({ ...base, band: [0, 0], tolerancePct: 8, gap: 0.4, volume: { ratio: 700 / 364, expectedRatio: [1, 1], tolerancePct: 30 } });
  assert.equal(v.verdict, "SUSPECT");
  assert.match(v.reason, /our count is 1.92x theirs/);
  const c = judge({ ...base, gap: 0.5, countShare: { share: 0.39, min: 0.8 } });
  assert.equal(c.verdict, "SUSPECT");
  assert.match(c.reason, /half empty/);
});

test("library roll-up and inside count on the real library: France's 20 Oct 2026 dip is seen", () => {
  const dates = libraryDates("fr-fuel");
  const rows = readRowsOnDates("fr-fuel", dates.filter((d) => d >= "2026-10-01" && d <= "2026-10-21"));
  const d19 = libraryRollup(rows, "diesel", "2026-10-19")!;
  assert.ok(Math.abs(d19.value - 2.3698) < 0.0005, `roll-up ${d19.value}`);
  const upTo21 = dates.filter((d) => d <= "2026-10-21");
  assert.ok(countShareFor(rows, "diesel", "2026-10-20", upTo21)! < 0.5); // 20 Oct held far fewer stations
  assert.ok(countShareFor(rows, "diesel", "2026-10-19", upTo21)! > 0.8);
  // a national-only source gives its single published row
  const nl = readRowsOnDates("nl-cbs-fuel", ["2026-10-19"]);
  assert.deepEqual(libraryRollup(nl, "diesel", "2026-10-19"), { value: 2.456, period: "2026-10-19", n: null });
});

const ctx = { now: new Date("2026-10-23T05:00:00Z"), get: async () => null } as unknown as CrossCheckContext;
const noApi = async (): Promise<PriceAnswer> => {
  throw new Error("not used");
};
const realLibrary = (id: string) => {
  const dates = libraryDates(id).filter((d) => d <= "2026-10-21");
  return { dates, rows: readRowsOnDates(id, dates.slice(-40)) };
};
const withFetch = (s: SourcePlugin, fetch: () => Promise<any>): SourcePlugin => ({ ...s, crossCheck: { ...s.crossCheck!, fetch } });

test("runner, fuel: Spain and France on 19 Oct 2026 against the Oil Bulletin (probe fixture) match the pilot", async () => {
  const deps: SourceRunDeps = { ctx, askApi: noApi, library: realLibrary, previous: [], today: "2026-10-23" };
  const es = await runSourceCheck(withFetch(src("es-fuel"), async () => wobHeadlines(WOB_ROWS, ["ES"], ["diesel", "petrol95"])), deps);
  assert.equal(es.fetchError, null);
  const byArea = Object.fromEntries(es.rows.map((r) => [r.their_key, r]));
  assert.equal(byArea["ES/diesel"].verdict, "EXPLAINED"); // about +1.4%: inside the declared +0.2 to +1.7
  assert.equal(byArea["ES/petrol95"].verdict, "AGREES");
  assert.equal(byArea["ES/diesel"].their_period, "2026-10-19");
  assert.equal(byArea["ES/diesel"].our_period, "2026-10-19");
  const fr = await runSourceCheck(withFetch(src("fr-fuel"), async () => wobHeadlines(WOB_ROWS, ["FR"], ["diesel", "petrol95"])), deps);
  assert.deepEqual(fr.rows.map((r) => r.verdict).sort(), ["AGREES", "EXPLAINED"]);
  const nl = await runSourceCheck(withFetch(src("nl-cbs-fuel"), async () => wobHeadlines(WOB_ROWS, ["NL"], ["diesel", "petrol95"])), deps);
  assert.deepEqual(nl.rows.map((r) => [r.verdict, r.gap_pct]), [["AGREES", -0.01], ["AGREES", 0.01]]);
});

const answer = (value: number, n: number | null, from: string, to: string, extra: Record<string, unknown> = {}): PriceAnswer =>
  ({ status: "ok", price: { value }, sample_size: n, period: { from, to }, as_of: to, extra } as unknown as PriceAnswer);

test("runner, homes: Ireland like for like AGREES; a wider area (Bristol's postal town) is caught by the count", async () => {
  const ie = await runSourceCheck(
    withFetch(src("ie-ppr"), async () => [
      { key: "40", value: 493000, period: "2026-08" },
      { key: "51", value: 428000, period: "2026-08" },
      { key: "22", value: 200000, period: "2026-08" },
    ]),
    {
      ctx, library: realLibrary, previous: [], today: "2026-10-23",
      askApi: async (_s, q) => {
        assert.equal(q.property_type, "second-hand");
        return answer({ Dublin: 491000, Kildare: 430000, Longford: 200000 }[q.town]!, 2000, "2025-10-16", "2026-10-16");
      },
    },
  );
  assert.deepEqual(ie.rows.map((r) => r.verdict), ["AGREES", "AGREES", "AGREES"]);
  const gb = await runSourceCheck(
    withFetch(src("gb-hmlr-ppd"), async () => [
      { key: "E08000035", value: 246385, period: "2026-08", n: 800 },
      { key: "E06000023", value: 353596, period: "2026-08", n: 364 },
    ]),
    {
      ctx, library: realLibrary, previous: [], today: "2026-10-23",
      // Leeds by district (2,149 sales, 22 Oct 2026); "Bristol" as if asked by postal town (about 700 a month, pilot)
      askApi: async (_s, q) => (q.district === "Leeds" ? answer(249000, 2149, "2026-04-22", "2026-08-26") : answer(365000, 4200, "2026-03-01", "2026-08-28")),
    },
  );
  const [leeds, bristol] = gb.rows;
  assert.equal(leeds.verdict, "AGREES");
  assert.equal(bristol.verdict, "SUSPECT");
  assert.equal(bristol.our_n, Math.round(4200 / spanMonths("2026-03-01", "2026-08-28")));
  assert.match(bristol.reason, /our count is .*x theirs.*Known differences: .*postal town/);
  assert.equal(leeds.our_n, 515);
});

test("runner, EIA: a parsing check compares only the same month, and reads business cents from the answer", async () => {
  const theirs = async () => [
    { key: "TX", value: 8.47, period: "2026-07" },
    { key: "CA", value: 25.0, period: "2026-07" },
    { key: "NY", value: 20.0, period: "2026-07" },
  ];
  const r = await runSourceCheck(withFetch(src("us-eia-energy-business"), theirs), {
    ctx, library: realLibrary, previous: [], today: "2026-10-23",
    askApi: async (_s, q) =>
      q.state === "NY"
        ? ({ ...answer(0.2, null, "2026-06-01", "2026-06-30", { cents_per_kwh: 20 }), statistic: { reference_period: "2026-06" } } as PriceAnswer)
        : ({ ...answer(0.0847, null, "2026-07-01", "2026-07-31", { cents_per_kwh: q.state === "TX" ? 8.47 : 24.0 }), statistic: { reference_period: "2026-07" } } as PriceAnswer),
  });
  assert.deepEqual(r.rows.map((x) => [x.their_key, x.verdict]), [["TX", "AGREES"], ["CA", "SUSPECT"]]); // CA: a shifted column
  assert.match(r.notes.join(" "), /NY business: periods differ \(ours 2026-06, theirs 2026-07\)/);
});

test("runner: a publisher link that fails is a 'link moved' error, not a data alarm; the run fails only on the 3rd time in a row", async () => {
  const r = await runSourceCheck(withFetch(src("es-fuel"), async () => { throw new Error("HTTP 404 for https://energy.ec.europa.eu/x"); }), {
    ctx, askApi: noApi, library: realLibrary, previous: [], today: "2026-10-23",
  });
  assert.equal(r.rows.length, 0);
  assert.match(r.fetchError!, /^link moved or unreachable: HTTP 404/);
  let meta: any;
  const fails: boolean[] = [];
  for (let i = 0; i < FAIL_AFTER_RUNS + 1; i++) {
    const n = nextMeta(meta, "es-fuel", `2026-10-2${i}T05:00:00Z`, r, 0);
    meta = n.meta;
    fails.push(n.failRun);
  }
  assert.deepEqual(fails, [false, false, true, false]);
  assert.equal(meta.consecutive_failures, 4);
  assert.equal(nextMeta(meta, "es-fuel", "2026-10-30T05:00:00Z", { rows: [], fetchError: null, notes: [] }, 0).meta.consecutive_failures, 0);
});

test("result files: one row per area and release, re-runs never duplicate, labels with commas survive", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pp-xc-"));
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const row: CrossCheckRow = {
      checked_at: "2026-10-23", area: "Spain, diesel", their_key: "ES/diesel", their_period: "2026-10-19", their_value: 1.88922,
      our_period: "2026-10-19", our_value: 1.9161, gap_pct: 1.42, our_n: 11214, their_n: null, verdict: "EXPLAINED", reason: 'gap 1.42% is inside the declared bias "+0.2% to +1.7%"',
    };
    assert.equal(appendCrossCheck("es-fuel", [row]), 1);
    assert.equal(appendCrossCheck("es-fuel", [row]), 0);
    assert.equal(appendCrossCheck("es-fuel", [{ ...row, their_period: "2026-10-26" }]), 1);
    assert.deepEqual(readCrossCheck("es-fuel")[0], row);
    assert.match(readFileSync(path.join(dir, "_crosscheck", "es-fuel.csv"), "utf8"), /^checked_at,area,their_key/);
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("off the public API: no crossCheck field reaches coverage, OpenAPI or llms.txt", () => {
  const text = JSON.stringify(coverage()) + JSON.stringify(buildOpenApi("https://proofprice.com")) + buildLlmsTxt("https://proofprice.com");
  for (const word of ["crossCheck", "headlineUrl", "knownDifferences", "expectedBiasPct", "_crosscheck"]) {
    assert.ok(!text.includes(word), `public output mentions ${word}`);
  }
});
