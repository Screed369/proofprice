// Tests for Australia childcare fees. The fixture mirrors the September quarter 2025 report as read 2026-10-31 (education.gov.au/node/19924).
import test from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { INFO, auAnswer, auChildcare, auHarvestRows, auHistoryKey, candidateUrls, clearCache, loadReport, parseReport, stateOf } from "./source";
import manifest from "./index";

const HTML = `<html><head><title>Child Care Subsidy data report – September quarter 2025</title></head><body>
<h1>Child Care Subsidy data report – September quarter 2025</h1>
<h2>Fees</h2><p>The average hourly fee was $13.65, up 4.7% from September quarter 2024.</p>
<table><tr><th>Care type</th><th>Average hourly fee</th></tr>
<tr><td>Centre Based Day Care</td><td>$14.30</td></tr><tr><td>Family Day Care</td><td>$13.70</td></tr>
<tr><td>Outside School Hours Care</td><td>$9.60</td></tr><tr><td>Total</td><td>$13.60</td></tr></table>
<table><tr><th>State or territory</th><th>Average hourly fee</th></tr>
<tr><td>New South Wales</td><td>$14.55</td></tr><tr><td>Victoria</td><td>$14.45</td></tr><tr><td>Queensland</td><td>$13.95</td></tr>
<tr><td>South Australia</td><td>$13.95</td></tr><tr><td>Western Australia</td><td>$14.65</td></tr><tr><td>Tasmania</td><td>$13.15</td></tr>
<tr><td>Northern Territory</td><td>$12.90</td></tr><tr><td>Australian Capital Territory</td><td>$16.05</td></tr><tr><td>Australia</td><td>$14.35</td></tr></table>
</body></html>`;
const MD = HTML.replace(/<[^>]+>/g, "").length ? "Child Care Subsidy data report – September quarter 2025\n| Care type | Average hourly fee |\n| Centre Based Day Care | $14.30 |\n| Total | $13.60 |\n" + ["New South Wales|14.55","Victoria|14.45","Queensland|13.95","South Australia|13.95","Western Australia|14.65","Tasmania|13.15","Northern Territory|12.90","Australian Capital Territory|16.05","Australia|14.35"].map((l) => "| " + l.replace("|", " | $") + " |").join("\n") : "";

const report = parseReport(HTML, "https://example/x");

test("parses care types, states, quarter and headline from HTML", () => {
  assert.equal(report.quarter, "September quarter 2025");
  assert.deepEqual([report.from, report.to], ["2025-07-01", "2025-09-30"]);
  assert.equal(report.care.centre, 14.3);
  assert.equal(report.care["home-based"], 13.7);
  assert.equal(report.care["school-age"], 9.6);
  assert.equal(report.states["Australian Capital Territory"], 16.05);
  assert.equal(report.headline, 13.65);
});

test("parses the same tables from markdown-style text", () => {
  const r = parseReport(MD);
  assert.equal(r.states["New South Wales"], 14.55);
  assert.equal(r.care.centre, 14.3);
});

test("a changed layout is a source error, not a wrong number", () => {
  assert.throws(() => parseReport("<h1>Child Care Subsidy data report – June quarter 2026</h1><p>nothing</p>"), SourceError);
  assert.throws(() => parseReport("<p>no quarter</p>"), SourceError);
});

test("state aliases and unknown areas", () => {
  assert.equal(stateOf("nsw"), "New South Wales");
  assert.equal(stateOf(undefined), null);
  assert.throws(() => stateOf("Sydney"), InputError);
});

test("answers by state, by care type, and nationally", () => {
  const a = auAnswer(report, { area: "NSW" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 14.55);
  assert.equal(a.price?.currency, "AUD");
  assert.equal(a.price?.unit, "per hour");
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(auAnswer(report, { care_type: "centre" }).price?.value, 14.3);
  assert.equal(auAnswer(report, { age_group: "school-age" }).price?.value, 9.6);
  assert.equal(auAnswer(report, {}).price?.value, 13.6);
  assert.throws(() => auAnswer(report, { area: "NSW", care_type: "centre" }), InputError);
  assert.throws(() => auAnswer(report, { care_type: "nanny" }), InputError);
  assert.match(auAnswer(report, { area: "VIC", age_group: "infant" }).extra ? "ok" : "", /ok/);
});

test("candidate urls start at the last completed quarter", () => {
  const c = candidateUrls(new Date("2026-10-31T00:00:00Z"), 3);
  assert.match(c[0].url, /september-quarter-2026$/);
  assert.match(c[1].url, /june-quarter-2026$/);
  assert.match(c[2].url, /march-quarter-2026$/);
  assert.match(candidateUrls(new Date("2026-02-01T00:00:00Z"), 1)[0].url, /december-quarter-2025$/);
});

test("loadReport walks back past quarters that are not published yet and caches", async () => {
  clearCache();
  const seen: string[] = [];
  const fetchPage = async (u: string) => {
    seen.push(u);
    return /september-quarter-2025$/.test(u) ? HTML : null;
  };
  const r = await loadReport(fetchPage, new Date("2026-10-31T00:00:00Z"));
  assert.equal(r.quarter, "September quarter 2025");
  assert.equal(seen.length, 5);
  await loadReport(fetchPage, new Date("2026-10-31T01:00:00Z"));
  assert.equal(seen.length, 5);
  clearCache();
  await assert.rejects(loadReport(async () => null, new Date("2026-10-31T00:00:00Z")), SourceError);
  clearCache();
});

test("auChildcare end to end with a fake page", async () => {
  clearCache();
  const a = await auChildcare({ area: "Tasmania" }, async () => HTML);
  assert.equal(a.price?.value, 13.15);
  clearCache();
});

test("harvest rows and history keys", () => {
  const h = auHarvestRows(report);
  assert.equal(h.date, "2025-09-30");
  assert.equal(h.rows.length, 12);
  assert.deepEqual(auHistoryKey({ area: "ACT" }), { area: "Australian Capital Territory", item: "all", label: "Australian Capital Territory, all care types" });
  assert.equal(auHistoryKey({ care_type: "home-based" })?.item, "home-based");
  assert.equal(auHistoryKey({ area: "NSW", care_type: "centre" }), null);
  assert.equal(auHistoryKey({ area: "Sydney" }), null);
});

test("manifest basics", () => {
  assert.equal(manifest.info.id, INFO.id);
  assert.deepEqual(manifest.countries, ["AU"]);
  assert.equal(manifest.category, "childcare");
});
