// Contract-ready fuel clause pages: weekly series from library rows, the content hash, the page data and the sitemap entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSitemap, libraryForSitemap } from "../lib/open-book";
import { rowsToCsv, CROSSCHECK_HEADER } from "../lib/library/store";
import { NO_COUNT } from "../lib/stats";
import { canonicalText, clausePaths, clauseSeries, loadClausePage, resetClauseCache, sha256, weeklyFromRows } from "../lib/site/fuel-clause";
import { SITE_URL } from "../lib/site/constants";

const r = (date: string, area: string, item: string, median: number) => ({ date, area, item, n: NO_COUNT, median, low: median, high: median, min: median, max: median });

function fixtureLibrary(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "clause-lib-"));
  const wob = path.join(dir, "eu-oil-bulletin");
  mkdirSync(path.join(wob, "daily"), { recursive: true });
  mkdirSync(path.join(wob, "history"), { recursive: true });
  writeFileSync(
    path.join(wob, "daily", "2026-10.csv"),
    rowsToCsv([
      r("2026-10-12", "IE", "diesel", 2.1637),
      r("2026-10-12", "IE", "diesel@2026-10-05", 2.1637),
      r("2026-10-12", "IE", "diesel@2025-10-13", 1.666),
      r("2026-10-12", "FR", "diesel", 2.3282),
      r("2026-10-19", "IE", "diesel", 2.1367),
      r("2026-10-19", "IE", "diesel@2026-10-12", 2.1538), // a restatement of the 12th: 2.1538 vs 2.1637
      r("2026-10-19", "IE", "diesel@2025-10-20", 1.6705),
    ]),
  );
  writeFileSync(path.join(wob, "meta.json"), JSON.stringify({ source: "eu-oil-bulletin", currency: "EUR", unit: "per litre" }));
  writeFileSync(
    path.join(wob, "history", "2026.csv"),
    "date,area,item,n,median,low,high,min,max\n2026-08,IE,diesel,,1.89664,1.8456,1.9306,1.8456,1.9306\n2026-09,IE,diesel,,2.02893,1.9538,2.1229,1.9538,2.1229\n",
  );
  const xc = path.join(dir, "_crosscheck");
  mkdirSync(xc, { recursive: true });
  writeFileSync(
    path.join(xc, "fr-fuel.csv"),
    CROSSCHECK_HEADER + "\n2026-10-21,\"France, diesel\",FR/diesel,2026-10-19,2.3282,2026-10-19,2.3401,0.51,,,AGREES,within the declared band\n",
  );
  return dir;
}

test("weeklyFromRows: own rows and dated earlier rows make one series, newest first; a restated week is counted", () => {
  const rows = [
    r("2026-10-12", "IE", "diesel", 2.1637),
    r("2026-10-12", "IE", "diesel@2026-10-05", 2.1637),
    r("2026-10-19", "IE", "diesel", 2.1367),
    r("2026-10-19", "IE", "diesel@2026-10-12", 2.1538),
    r("2026-10-19", "DE", "diesel", 9),
    r("2026-10-19", "IE", "petrol95", 1.9),
  ];
  const { weeks, revised } = weeklyFromRows(rows, "IE", "diesel");
  assert.deepEqual(weeks, [{ date: "2026-10-19", value: 2.1367 }, { date: "2026-10-12", value: 2.1637 }, { date: "2026-10-05", value: 2.1637 }]);
  assert.equal(revised, 1);
  assert.deepEqual(weeklyFromRows([], "IE", "diesel").weeks, []);
});

test("canonicalText and the hash: stable, ordered oldest first, and any changed figure changes the hash", () => {
  const s = { sourceId: "eu-oil-bulletin", area: "IE", item: "diesel", currency: "EUR", unit: "per litre" };
  const weeks = [{ date: "2026-10-19", value: 2.1367 }, { date: "2026-10-12", value: 2.1637 }];
  const text = canonicalText(s, weeks, []);
  assert.equal(text, "proofprice fuel clause | source=eu-oil-bulletin | area=IE | item=diesel | currency=EUR | unit=per litre\nweek\t2026-10-12\t2.16370\nweek\t2026-10-19\t2.13670\n");
  assert.equal(sha256(text), createHash("sha256").update(text).digest("hex"));
  assert.notEqual(sha256(text), sha256(canonicalText(s, [{ date: "2026-10-19", value: 2.1368 }, weeks[1]], [])));
  assert.equal(sha256(text), sha256(canonicalText(s, [...weeks].reverse(), [])), "input order does not matter");
});

test("loadClausePage: weeks, monthly averages, licence info, outside check, hash that matches the shown text", () => {
  process.env.PROOFPRICE_LIBRARY_DIR = fixtureLibrary();
  resetClauseCache();
  const ie = loadClausePage("ie")!;
  assert.equal(ie.series.name, "Ireland");
  assert.deepEqual(ie.weeks.map((w) => w.date), ["2026-10-19", "2026-10-12", "2026-10-05", "2025-10-20", "2025-10-13"]);
  assert.equal(ie.weeks[1].value, 2.1637, "the value recorded on the week's own bulletin day wins");
  assert.equal(ie.revisedWeeks, 1);
  assert.equal(ie.from, "2025-10-13");
  assert.equal(ie.to, "2026-10-19");
  assert.deepEqual(ie.months.map((m) => m.month), ["2026-09", "2026-08"]);
  assert.match(ie.info.licence, /CC BY 4.0/);
  assert.equal(ie.currency, "EUR");
  assert.equal(ie.outside, null, "no outside check is held for Ireland: no line");
  assert.equal(ie.hash, createHash("sha256").update(ie.canonical).digest("hex"));
  assert.match(ie.canonical, /month\t2026-08\t1.89664\t1.84560\t1.93060/);
  const fr = loadClausePage("fr")!;
  assert.deepEqual(fr.outside && [fr.outside.verdict, fr.outside.gapPct, fr.outside.theirPeriod], ["AGREES", 0.51, "2026-10-19"]);
  assert.equal(loadClausePage("de"), null, "no figures held: no page");
  assert.equal(loadClausePage("zz"), null);
  assert.deepEqual(clausePaths().slice(0, 3), ["/fuel-clause", "/fuel-clause/fr", "/fuel-clause/ie"]);
});

test("every series points at a real source and an official, non-asking price type", () => {
  const ids = new Set(clauseSeries().map((s) => s.sourceId));
  assert.deepEqual([...ids].sort(), ["eu-oil-bulletin", "gb-desnz-fuel"]);
  for (const s of clauseSeries()) assert.match(s.slug, /^[a-z]{2}$/);
  assert.equal(new Set(clauseSeries().map((s) => s.slug)).size, clauseSeries().length);
});

test("the sitemap lists the clause pages like the other pages, and only when there are figures", () => {
  process.env.PROOFPRICE_LIBRARY_DIR = fixtureLibrary();
  resetClauseCache();
  const urls = buildSitemap(SITE_URL, new Date("2026-10-22T00:00:00Z"), libraryForSitemap()).map((e) => e.url);
  assert.ok(urls.includes(`${SITE_URL}/fuel-clause`));
  assert.ok(urls.includes(`${SITE_URL}/fuel-clause/ie`));
  assert.ok(!urls.includes(`${SITE_URL}/fuel-clause/de`));
  const none = buildSitemap(SITE_URL, new Date("2026-10-22T00:00:00Z"), { answerPages: [], indexPaths: [], newestDay: null });
  assert.ok(!none.some((e) => e.url.includes("fuel-clause")));
});

test("page source: information-not-advice notice, hash, and every /api/ link is nofollow", () => {
  for (const f of ["app/fuel-clause/page.tsx", "app/fuel-clause/[country]/page.tsx"]) {
    const src = readFileSync(path.join(process.cwd(), f), "utf8");
    assert.match(src, /information, not (legal|financial)|information, not legal/i, f);
    for (const m of src.matchAll(/<a [^>]*href=\{?["`]?(\/api\/[^>]*)>/g)) assert.match(m[0], /rel="nofollow"/, `${f}: ${m[0]}`);
    assert.ok(!/\/api\//.test(src.replace(/<a [^>]*href=\{?["`]?\/api\/[^>]*rel="nofollow"[^>]*>/g, "").replace(/const rest = `[^`]*`;/, "")), `${f}: an /api/ mention outside a nofollow link`);
  }
});
