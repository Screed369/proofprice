// Fixtures: region.fixture.csv is the real file sceyp25_mean_and_median_fee_by_child_age_and_region.csv (2024 and 2025, 72 rows, as
// downloaded on 2026-10-14). The provider-type and local-authority files are built here with the REAL column headers and row shapes
// documented from the same release; their rows are generated only to reach the size checks, except the ones named in the tests
// (Camden, Manchester and the England rows), whose numbers are copied from the release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeZip } from "../../tests/helpers/make-zip";
import { writeDaily } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";
import { feeFilesFromZip, feeRows, gbAnswer, gbChildcare, gbHarvest, harvestOptions, INFO, matchPlace, pickReleaseId, placesOf } from "./source";
import { unzipAll } from "../../categories/rent/xlsx";

const REGION = readFileSync(path.join(__dirname, "region.fixture.csv"), "utf8");
const PROVIDER_HEAD = "time_period,time_identifier,geographic_level,country_code,country_name,provider_type,child_age,mean_hourly_fee,median_hourly_fee,unweighted_base";
const LA_HEAD = "time_period,time_identifier,geographic_level,country_code,country_name,region_code,region_name,old_la_code,new_la_code,la_name,child_age,mean_hourly_fee,median_hourly_fee,unweighted_base,lower_ci,upper_ci";
const PROVIDERS = ["All providers", "Private group-based providers", "Voluntary group-based providers", "Nursery class childcare settings", "Maintained nursery schools", "Childminders"];
const AGES = ["Under 2 years old", "2 years old", "3 and 4 years old"];

const provider = () => {
  const lines = [PROVIDER_HEAD];
  PROVIDERS.forEach((p, i) => AGES.forEach((a, j) => lines.push(`2025,Calendar year,National,E92000001,England,${p},${a},${(6 + i * 0.1 + j * 0.1).toFixed(2)},${6 + i * 0.1 + j * 0.1 > 6.5 ? 6.5 : 6},"2,708"`)));
  lines.push(`2025,Calendar year,National,E92000001,England,Childminders,Under 2 years old,6.36,6,"2,708"`); // the real row quoted in the release notes
  lines.push(`2025,Calendar year,National,E92000001,England,Voluntary group-based providers,2 years old,6.5,6,[u] 18`);
  return lines.join("\n");
};
const la = () => {
  const lines = [LA_HEAD];
  lines.push("2025,Calendar year,Local authority,E92000001,England,E12000002,North West,352,E08000003,Manchester,2 years old,7.45985,7,47,6.5,8.4");
  for (let i = 0; i < 120; i++) {
    const code = `E0600${String(1000 + i)}`;
    for (const a of AGES) lines.push(`2025,Calendar year,Local authority,E92000001,England,E12000002,North West,${i},${code},Area ${i},${a},6.5,6,${20 + i},6,7`);
  }
  lines.push("2025,Calendar year,Local authority,E92000001,England,E12000007,London,202,E09000007,Camden,2 years old,9.5,9,x,8,11");
  lines.push("2025,Calendar year,Local authority,E92000001,England,E12000007,London,202,E09000007,Camden,3 and 4 years old,9.1,8.5,[u] 12,8,10");
  return lines.join("\n");
};
const files = () => ({ region: REGION, provider: provider(), la: la() });
const zip = () => makeZip({ "data/sceyp25_mean_and_median_fee_by_child_age_and_region.csv": REGION, "data/sceyp25_mean_and_median_fee_by_provider_type.csv": provider(), "data/sceyp25_mean_and_median_fee_by_LA.csv": la(), "data/sceyp25_other.csv": "a,b\n1,2" });

test("zip: the three tables are found whatever the year prefix; a missing one is reported", () => {
  const f = feeFilesFromZip(unzipAll(zip()));
  assert.equal(f.region, REGION);
  assert.throws(() => feeFilesFromZip(new Map([["x.csv", Buffer.from("a")]])), (e: any) => e instanceof SourceError && /release layout may have changed/.test(e.message));
});

test("rows: newest year only, medians as published, low-reliability bases flagged, bases under 10 and 'x' dropped", () => {
  const { year, rows } = feeRows(files());
  assert.equal(year, 2025);
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  assert.deepEqual(get("E12000007 London", "under2:all"), { area: "E12000007 London", item: "under2:all", n: 782, median: 8.5, low: 8.5, high: 8.5, min: 8.95, max: 0 });
  assert.equal(get("E12000007 London", "age3-4:all")!.median, 8);
  assert.equal(get("E12000007 London", "school:all")!.n, 422);
  assert.equal(get("E12000009 South West", "age2:all")!.n, 718); // "1,390" style numbers with commas also parse (South East)
  assert.equal(get("E12000008 South East", "age2:all")!.n, 1390);
  assert.equal(get("E92000001 England", "under2:childminder")!.median, 6);
  assert.equal(get("E08000003 Manchester", "age2:all")!.median, 7);
  assert.equal(get("E09000007 Camden", "age2:all"), undefined); // base "x"
  assert.equal(get("E09000007 Camden", "age3-4:all")!.max, 1); // "[u] 12" is flagged
  assert.ok(rows.some((r) => r.area === "E92000001 England" && r.item === "age2:voluntary" && r.n === 18 && r.max === 1)); // "[u] 18"
  assert.ok(rows.every((r) => r.n >= 10));
  assert.ok(rows.every((r) => r.area !== "E12000007 London" || r.item.endsWith(":all")));
});

test("rows: too small or mismatched files are refused", () => {
  assert.throws(() => feeRows({ ...files(), la: la().split("\n").slice(0, 6).join("\n") }), (e: any) => e instanceof SourceError && /Too few fee rows/.test(e.message));
  const other = provider().replace(/^2025,/gm, "2024,");
  assert.throws(() => feeRows({ ...files(), provider: other.replace("2024,time_identifier", "time_period,time_identifier") }), (e: any) => e instanceof SourceError);
});

test("release page: the zip link gives the release id", () => {
  assert.equal(pickReleaseId('<a href="https://content.explore-education-statistics.service.gov.uk/api/releases/aaf7e46e-0776-43a2-9763-adc29bc04f44/files">zip</a>'), "aaf7e46e-0776-43a2-9763-adc29bc04f44");
  assert.equal(pickReleaseId("<html></html>"), null);
});

test("harvest: reads the release id from the page, downloads the zip and builds the day", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const bytes = zip();
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    if (String(url).includes("find-statistics")) return new Response('<a href="/api/releases/11111111-2222-3333-4444-555555555555/files">zip</a>', { status: 200 });
    return new Response(new Uint8Array(bytes), { status: 200 });
  }) as typeof fetch;
  harvestOptions.retryDelayMs = 0;
  try {
    const day = await gbHarvest();
    assert.equal(day.date, "2025-12-31");
    assert.equal(day.currency, "GBP");
    assert.equal(day.unit, "per hour");
    assert.ok(calls[1].endsWith("/api/releases/11111111-2222-3333-4444-555555555555/files"));
    assert.ok(day.rows.length > 300);
  } finally {
    globalThis.fetch = original;
  }
});

test("harvest: falls back to the known release when the page fails, and gives up clearly when the download fails", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response("nope", { status: 500 });
  }) as typeof fetch;
  harvestOptions.retryDelayMs = 0;
  try {
    await assert.rejects(gbHarvest(), (e: any) => e instanceof SourceError && /Could not download .*aaf7e46e-0776-43a2-9763-adc29bc04f44.*HTTP 500/.test(e.message));
  } finally {
    globalThis.fetch = original;
  }
});

// ---------- answers ----------

const lib = () => ({ date: "2025-12-31", rows: feeRows(files()).rows });
const NOW = new Date("2026-10-14T12:00:00Z");

test("London preschool: the published median, sample size and a clear note", () => {
  const a = gbAnswer(lib(), { area: "London" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 8);
  assert.equal(a.price?.measure, "median");
  assert.equal(a.price?.currency, "GBP");
  assert.equal(a.price?.unit, "per hour");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, 1057);
  assert.equal(a.statistic?.reference_period, "2025");
  assert.match(a.summary, /median hourly fee that providers in London charge parents for 3 and 4 year olds was £8\.00 an hour in 2025 \(mean £8\.60\)/);
  assert.match(a.statistic?.note ?? "", /Government-funded hours and Tax-Free Childcare are not deducted/);
  assert.match(a.statistic?.note ?? "", /No age_group was given/);
  assert.equal((a.extra as any).by_age_group["children under 2"], 8.5);
  assert.match(a.source.licence, /Open Government Licence/);
});

test("ages, local authorities, England and provider types", () => {
  const l = lib();
  assert.equal(gbAnswer(l, { area: "London", age_group: "infant" }, NOW).price?.value, 8.5);
  assert.equal(gbAnswer(l, { area: "Manchester", age_group: "toddler" }, NOW).price?.value, 7);
  const camden = gbAnswer(l, { area: "Camden", age_group: "preschool" }, NOW);
  assert.equal(camden.price?.value, 8.5);
  assert.match(camden.statistic?.note ?? "", /low reliability/);
  const eng = gbAnswer(l, { age_group: "infant", care_type: "home-based" }, NOW);
  assert.equal(eng.price?.value, 6);
  assert.match(eng.summary, /childminders in England/);
  assert.ok((gbAnswer(l, { area: "England", age_group: "infant" }, NOW).extra as any).by_provider_type);
  assert.match(gbAnswer(l, { area: "Camden", age_group: "school-age" }, NOW).extra && String((gbAnswer(l, { area: "Camden", age_group: "school-age" }, NOW).extra as any).reason), /school-age fees are published by region only/);
});

test("places and bad requests", () => {
  const places = placesOf(lib().rows);
  assert.equal(matchPlace(places, "north west").kind, "region");
  assert.equal(matchPlace(places, "Manchester").code, "E08000003");
  assert.equal(matchPlace(places, "UK").kind, "country");
  assert.throws(() => matchPlace(places, "Paris"), (e: any) => e instanceof InputError && /No fee figure/.test(e.message));
  assert.throws(() => matchPlace(places, "Area"), (e: any) => e instanceof InputError && /more exact place/.test(e.message));
  assert.throws(() => gbAnswer(lib(), { area: "London", care_type: "centre" }, NOW), (e: any) => e instanceof InputError && /care_type must be left out/.test(e.message));
  assert.throws(() => gbAnswer(lib(), { area: "London", age_group: "teen" }, NOW), (e: any) => e instanceof InputError);
});

test("library round trip", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gb-childcare-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    await assert.rejects(gbChildcare({ area: "London" }, NOW), (e: any) => e instanceof SourceError && /Not yet available/.test(e.message));
    writeDaily(INFO.id, { date: "2025-12-31", currency: "GBP", unit: "per hour", rows: lib().rows });
    assert.equal((await gbChildcare({ area: "London", age_group: "school-age" }, NOW)).price?.value, 8);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
