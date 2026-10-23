import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { CSV_URL, INFO, clearCache, downloadCsv, findRegion, huAnswer, huHomePrices, loadData, parseCsv } from "./source";

// Fixture: rows of KSH STADAT lak0025.csv (table 18.1.2.9, thousand HUF per m2), read from GitHub Actions on 2026-10-23.
// The probe garbled the ISO-8859-2 accents; they are restored here. Rows trimmed to the ones the tests use.
const HEAD = "18.1.2.9. Egy lakás átlagos négyzetmétere régió és településtípus szerint [ezer forint];;;;;;;;;;;;;;;;;;;;\r\nRégió;Településtípus;2007;2008;2009;2010;2011;2012;2013;2014;2015;2016;2017;2018;2019;2020;2021;2022;2023;2024;2025\r\n";
const FIXTURE =
  HEAD +
  "Használt lakások;;;;;;;;;;;;;;;;;;;;\r\n" +
  "Budapest;főváros;266;265;259;252;245;236;226;240;290;361;419;508;623;640;692;844;887;977;1 194\r\n" +
  "Pest;együtt;189;184;178;180;174;169;158;161;174;192;214;245;299;331;407;488;495;576;673\r\n" +
  "Dél-Alföld;megyeszékhely;159;163;160;154;151;145;140;145;160;181;208;245;306;319;368;463;500;572;707\r\n" +
  "Ország;együtt;178;161;154;160;154;150;145;154;175;191;212;241;276;282;339;411;440;531;625\r\n" +
  "Ország;megyeszékhely;165;169;161;156;154;149;143;147;164;182;206;244;297;316;369;465;502;566;689\r\n" +
  "Ország;főváros;266;265;259;252;245;236;226;240;290;361;419;508;623;640;692;844;887;977;1 194\r\n" +
  "Új lakások;;;;;;;;;;;;;;;;;;;;\r\n" +
  "Budapest;főváros;348;362;366;351;343;345;352;356;398;460;512;603;687;795;924;1 129;1 267;1 454;1 610\r\n" +
  "Dél-Alföld;községek;..;..;..;..;..;..;..;..;..;..;..;..;..;..;..;..;..;..;869\r\n" +
  "Dél-Alföld;városok;..;197;198;..;..;..;..;..;..;209;226;261;300;293;353;464;548;598;..\r\n" +
  "Dél-Alföld;megyeszékhely;239;244;234;222;215;213;239;224;248;278;322;383;425;486;560;704;748;866;1 090\r\n" +
  "Ország;együtt;225;241;232;220;225;220;191;233;238;268;332;337;368;425;510;581;668;829;955\r\n";

const data = parseCsv(FIXTURE);

test("parses both sections, thousand-separator spaces and '..' gaps", () => {
  assert.equal(data.latestYear, 2025);
  const bp = data.existing.find((r) => r.region === "Budapest")!;
  assert.equal(bp.values[2025], 1194);
  assert.equal(bp.values[2007], 266);
  const gap = data.new.find((r) => r.region === "Dél-Alföld" && r.type === "városok")!;
  assert.equal(gap.values[2025], undefined);
  assert.equal(gap.values[2024], 598);
  assert.ok(data.new.some((r) => r.region === "Ország"));
});

test("a changed file shape is a source error, not a wrong answer", () => {
  assert.throws(() => parseCsv("<html>maintenance</html>"), SourceError);
});

test("Budapest used dwellings: 1,194,000 HUF per m2 for 2025, average, official statistic, no sample size", () => {
  const a = huAnswer(data, { town: "Budapest", property_type: null, settlement: null });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1194000);
  assert.equal(a.price?.currency, "HUF");
  assert.equal(a.price?.unit, "per m²");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /Budapest/);
  const ex = a.extra as any;
  assert.equal(ex.previous_period.value, 977000);
  assert.equal(ex.previous_period.change_percent, 22.2);
});

test("new dwellings in a region's county seats", () => {
  const a = huAnswer(data, { town: "Szeged", property_type: "new", settlement: "county_seat" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1090000);
  assert.match(a.summary, /Southern Great Plain/);
  assert.match(a.summary, /newly built/);
});

test("a blank latest cell falls back to the newest year and says so", () => {
  const a = huAnswer(data, { town: "Southern Great Plain", property_type: "new", settlement: "towns" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 598000);
  assert.match(a.statistic?.note ?? "", /2025/);
});

test("a cell that is blank in every year gives no_matches with words, not a made-up number", () => {
  const empty = parseCsv(FIXTURE.replace("Új lakások;;;;;;;;;;;;;;;;;;;;\r\n", "Új lakások;;;;;;;;;;;;;;;;;;;;\r\nPest;községek;" + Array(19).fill("..").join(";") + "\r\n"));
  const a = huAnswer(empty, { town: "Pest", property_type: "new", settlement: "villages" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price?.value ?? null, null);
});

test("Hungary as a whole and name matching", () => {
  assert.equal(huAnswer(data, { town: "Hungary", property_type: null, settlement: null }).price?.value, 625000);
  assert.equal(findRegion("Debrecen")?.published, "Észak-Alföld");
  assert.equal(findRegion("Pécs")?.published, "Dél-Dunántúl");
  assert.equal(findRegion("észak-alföld")?.published, "Észak-Alföld");
  assert.equal(findRegion("Atlantis"), null);
});

test("an unknown place says what is available instead of answering for Hungary", () => {
  const a = huAnswer(data, { town: "Atlantis", property_type: null, settlement: null });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Budapest/);
});

test("bad parameter values are input errors", () => {
  assert.throws(() => huAnswer(data, { town: "Budapest", property_type: "castle", settlement: null }), InputError);
  assert.throws(() => huAnswer(data, { town: "Pest", property_type: null, settlement: "suburbs" }), InputError);
});

test("licence and attribution carry CC BY 4.0 and the KSH credit", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.attribution, /HCSO \/ ksh\.hu/);
});

test("fetch: decodes ISO-8859-2, caches, and reports outages", async () => {
  clearCache();
  let calls = 0;
  const fetcher = async () => (calls++, FIXTURE);
  const a = await huHomePrices({ town: "Budapest", property_type: null, settlement: null }, { fetcher, now: 1_000 });
  assert.equal(a.price?.value, 1194000);
  await huHomePrices({ town: "Budapest", property_type: null, settlement: null }, { fetcher, now: 2_000 });
  assert.equal(calls, 1);
  clearCache();
  await assert.rejects(loadData({ fetcher: async () => { throw new SourceError("Source timed out", CSV_URL); }, now: 3 }), SourceError);
  clearCache();
});

test("downloadCsv decodes ISO-8859-2 bytes", async () => {
  const orig = globalThis.fetch;
  // "Régió;Településtípus" in ISO-8859-2: é=E9, ő would be F5
  const bytes = Uint8Array.from([0x52, 0xe9, 0x67, 0x69, 0xf3, 0x3b, 0xf5]);
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as any;
  try {
    assert.equal(await downloadCsv(), "Régió;ő");
    globalThis.fetch = (async () => new Response("no", { status: 503 })) as any;
    await assert.rejects(downloadCsv(), SourceError);
  } finally {
    globalThis.fetch = orig;
  }
});

test("manifest: serves a Hungarian request only when a town is named, so the Eurostat index keeps the national question", () => {
  const s = SOURCE_PLUGINS.find((x) => x.info.id === "hu-ksh-home-prices")!;
  assert.ok(s);
  assert.equal(s.serves!({ country: "HU", town: "Budapest" }), true);
  assert.equal(s.serves!({ country: "HU" }), false);
  const idx = SOURCE_PLUGINS.find((x) => x.info.id === "eu-home-price-index")!;
  assert.equal(idx.serves!({ country: "HU" }), true);
  assert.equal(idx.serves!({ country: "HU", town: "Budapest" }), false);
});
