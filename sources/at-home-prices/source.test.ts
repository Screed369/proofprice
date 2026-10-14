import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { InputError, SourceError, isSourceOutage } from "../../lib/http";
import { SOURCE_PLUGINS, countriesFor, categoryById, paramSchemas } from "../../lib/registry";
import {
  CACHE_MS, FILE_URL, INFO, LICENCE_URL, PAGE_URL, areaLabel, atAnswer, atHomePrices, clearCache, downloadFile, findArea, foldName, loadData, parseFile,
  parseQuery, parseWorkbook, stateOfCode, viennaDistrictOfPostcode,
} from "./source";
import type { AtData, Query } from "./source";
import { listZip, parseOds, readOds, readZipEntry } from "./ods";
import type { OdsSheet } from "./ods";
import * as F from "./fixtures";

// Fixtures: real rows of STATISTIK AUSTRIA's spreadsheet, read through a Vercel preview on 2026-10-14 (see fixtures.ts).

function makeZip(files: { name: string; data: Buffer; method?: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const dirs: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.method ?? 8;
    const body = method === 8 ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    dirs.push(dir, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(dirs);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function cellXml(v: string): string {
  if (v === "") return "<table:table-cell/>";
  if (/^\d+(\.\d+)?$/.test(v)) return `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`;
  return `<table:table-cell office:value-type="string"><text:p>${esc(v)}</text:p></table:table-cell>`;
}
/** A spreadsheet file (zip with content.xml) holding the given sheets. */
function buildOds(sheets: OdsSheet[]): Buffer {
  const body = sheets
    .map((s) => `<table:table table:name="${esc(s.name)}">${s.rows.map((r) => `<table:table-row>${(r.length ? r : [""]).map(cellXml).join("")}</table:table-row>`).join("")}</table:table>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;
  return makeZip([{ name: "mimetype", data: Buffer.from("application/vnd.oasis.opendocument.spreadsheet"), method: 0 }, { name: "content.xml", data: Buffer.from(xml, "utf8") }]);
}

const DATA: AtData = parseWorkbook(F.SHEETS);
const find = (q: string, o?: { includeEmpty?: boolean }) => findArea(DATA.areas, parseQuery(q), o);
const answer = (town: string | null, type: string, postcode: string | null = null) => atAnswer(DATA, { town, postcode, property_type: type as never });
const foundName = (q: string) => {
  const f = find(q);
  assert.equal(f.kind, "found", q);
  return f.kind === "found" ? `${f.area.level}:${f.area.code || f.area.name}` : "";
};

test("at-home-prices: licence, attribution and type are STATISTIK AUSTRIA's", () => {
  assert.equal(INFO.id, "at-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.publisher, /STATISTIK AUSTRIA/);
  assert.match(INFO.licence, /Unter Angabe der Quelle „STATISTIK AUSTRIA“ ist es bei korrekter Wiedergabe gestattet, Inhalte für kommerzielle und nicht-kommerzielle Zwecke zu vervielfältigen/);
  assert.match(INFO.licence, /dass die verwendeten Inhalte bearbeitet wurden/);
  assert.match(INFO.licence, /carries no Creative Commons label/);
  assert.equal(INFO.licence_url, LICENCE_URL);
  assert.equal(LICENCE_URL, "https://www.statistik.at/ueber-uns/aufgaben-und-grundsaetze/rechtsgrundlagen/impressum");
  for (const k of ["STATISTIK AUSTRIA", "bearbeitet", "ProofPrice"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /Kleinräumige Medianwerte stellen keine reine Preisveränderung dar/);
  assert.match(INFO.limits, /fewer than 10 transactions/);
  assert.equal(INFO.homepage, PAGE_URL);
});

test("at-home-prices: registered as the AT source of the home-sales tool, Wien apartment first, no harvest", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "at-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["AT"]);
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "AT", town: "Wien", property_type: "apartment" });
  assert.equal(plugin.harvest, undefined); // no sample counts, so nothing for the price library
  assert.ok(countriesFor("home-sales").includes("AT"));
  assert.match(String(paramSchemas(categoryById("home-sales")!).town.description), /AT: a municipality/);
});

// ---------- the spreadsheet reader ----------

test("at-home-prices: the reader keeps empty cells in place (the real Güssing row) and takes numbers from office:value", () => {
  const xml = F.CONTENT_XML_TABLE_OPEN + F.CONTENT_XML_ROWS.join("") + "</table:table>";
  const [sheet] = parseOds(xml);
  assert.equal(sheet.name, "Wohnungspreise");
  assert.deepEqual(sheet.rows[0], ["Durchschnittliche Wohnungspreise pro pol. Bezirk in den Jahren 2015-2025"]);
  assert.deepEqual(sheet.rows[1], ["104", "Güssing", "", "", "", "", "", "1206", "1273", "1159", "", "", "919"]);
  assert.deepEqual(sheet.rows[2], ["105", "Jennersdorf", "", "", "", "", "", "", "", "1255", "1082"]);
});

test("at-home-prices: the reader decodes entities, spaces and paragraphs", () => {
  // synthetic cell contents for the cases the real fragment does not have
  const xml =
    '<table:table table:name="T"><table:table-row><table:table-cell office:value-type="string"><text:p>A &amp; B &#xFC;</text:p><text:p>x<text:s text:c="2"/>y</text:p></table:table-cell>' +
    '<table:table-cell office:value-type="string" office:string-value="from attribute"><text:p>ignored</text:p></table:table-cell>' +
    '<table:table-cell table:number-columns-repeated="2" office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row>' +
    '<table:table-row table:number-rows-repeated="3"/><table:table-row><table:table-cell office:value-type="percentage" office:value="0.25"/></table:table-row></table:table>';
  const [sheet] = parseOds(xml);
  assert.deepEqual(sheet.rows[0], ["A & B ü\nx  y", "from attribute", "7", "7"]);
  assert.deepEqual(sheet.rows[sheet.rows.length - 1], ["0.25"]);
});

test("at-home-prices: zip and spreadsheet files are read from memory, and anything else is refused", () => {
  const xml = F.CONTENT_XML_TABLE_OPEN + F.CONTENT_XML_ROWS.join("") + "</table:table>";
  const zip = makeZip([{ name: "mimetype", data: Buffer.from("application/vnd.oasis.opendocument.spreadsheet"), method: 0 }, { name: "content.xml", data: Buffer.from(xml, "utf8") }]);
  const entries = listZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ["mimetype", "content.xml"]);
  assert.equal(readZipEntry(zip, entries[0]).toString(), "application/vnd.oasis.opendocument.spreadsheet");
  assert.equal(readZipEntry(zip, entries[1]).toString("utf8"), xml);
  assert.equal(readOds(zip)[0].rows[1][1], "Güssing");
  assert.throws(() => listZip(Buffer.from("<html>nope</html>".repeat(4))), /not a zip file/);
  assert.throws(() => readOds(makeZip([{ name: "other.xml", data: Buffer.from("<a/>") }])), /no content.xml/);
});

// ---------- the workbook ----------

test("at-home-prices: parseWorkbook reads districts, municipalities, Bundesländer and Austria, and skips land and building periods", () => {
  assert.equal(DATA.latestYear, 2025);
  assert.equal(DATA.created, "2026-05-28");
  const count = (level: string) => DATA.areas.filter((a) => a.level === level).length;
  assert.deepEqual({ country: count("country"), state: count("state"), municipality: count("municipality"), district: count("district") }, { country: 1, state: 9, municipality: 14, district: 11 });
  const get = (level: string, code: string) => DATA.areas.find((a) => a.level === level && (a.code === code || a.name === code))!;

  const at = get("country", "Österreich");
  assert.equal(at.house[2025], 2836);
  assert.equal(at.apartment[2025], 4162);
  assert.equal(at.house[2024], 2711);
  assert.equal(get("state", "Wien").apartment[2025], 5212);
  assert.equal(get("state", "Wien").state, "Wien");
  // the land-price block of the Bundesländer sheet (77, 76, ...) and the Grundpreise sheet (decimals) never reach a house or flat price
  assert.ok(!DATA.areas.some((a) => Object.values({ ...a.house, ...a.apartment }).some((v) => !Number.isInteger(v) || v < 300)));

  // blank cells keep their year: Güssing flats have 2020 to 2022 and 2025
  const gussing = get("district", "104");
  assert.deepEqual(gussing.apartment, { 2020: 1206, 2021: 1273, 2022: 1159, 2025: 919 });
  assert.equal(gussing.state, "Burgenland");
  assert.deepEqual(get("district", "105").apartment, { 2022: 1255, 2023: 1082 });
  assert.deepEqual(get("district", "102").apartment, {});
  assert.equal(get("district", "303").house[2017], undefined);
  assert.equal(get("district", "303").house[2019], 2269);
  assert.equal(get("district", "303").apartment[2019], 1227);
  assert.equal(get("municipality", "41116").house[2017], 1231);
  assert.equal(get("municipality", "70513").house[2025], 6040);
  assert.deepEqual(Object.keys(get("municipality", "70513").house), ["2025"]);

  const flori = get("district", "921");
  assert.equal(flori.vienna, 21);
  assert.equal(flori.name, "Wien 21.,Floridsdorf");
  assert.equal(flori.state, "Wien");
  assert.equal(flori.apartment[2025], 5253);
  assert.equal(areaLabel(flori), "Wien 21 (Floridsdorf)");
  assert.equal(areaLabel(get("district", "306")), "Bezirk Baden");
  assert.equal(areaLabel(get("municipality", "30604")), "Baden");
  assert.equal(areaLabel(at), "Austria");
  assert.equal(stateOfCode("306"), "Niederösterreich");
  assert.equal(stateOfCode("90001"), "Wien");
  assert.equal(stateOfCode("101"), "Burgenland");
  assert.equal(stateOfCode("70101"), "Tirol");
  assert.equal(stateOfCode("0"), "");
});

test("at-home-prices: a file without the expected tables is a source problem, not an empty answer", () => {
  assert.throws(() => parseWorkbook([]), SourceError);
  assert.throws(() => parseWorkbook([{ name: "Wohnungspreise", rows: [["nothing here"]] }]), /unexpected layout/);
  assert.throws(() => parseFile(Buffer.from("this is not a spreadsheet at all, just text".repeat(3))), /could not be read/);
  assert.throws(() => parseFile(buildOds([{ name: "Other", rows: [["a", "b"]] }])), /unexpected layout/);
  assert.equal(parseFile(buildOds(F.SHEETS)).areas.length, DATA.areas.length);
});

// ---------- names ----------

test("at-home-prices: names fold umlauts, ß and Sankt", () => {
  assert.equal(foldName("Wörthersee"), "worthersee");
  assert.equal(foldName("Landstraße"), "landstrasse");
  assert.equal(foldName("Sankt Pölten"), "st polten");
  assert.equal(foldName("St. Pölten"), "st polten");
  assert.equal(foldName("Rudolfsheim-Fünfhaus"), "rudolfsheim funfhaus");
});

test("at-home-prices: queries carry levels, Vienna districts and postcodes", () => {
  const q = (s: string) => parseQuery(s);
  assert.deepEqual(q("Wien"), { q: "wien", force: null, vienna: null, postcode: null });
  assert.deepEqual(q("1210 Wien"), { q: "wien", force: null, vienna: null, postcode: "1210" });
  assert.deepEqual(q("Wien 1210"), { q: "wien", force: null, vienna: null, postcode: "1210" });
  assert.equal(q("6020 Innsbruck").q, "innsbruck");
  assert.equal(q("Graz, Österreich").q, "graz");
  assert.equal(q("Wien, Austria").q, "wien");
  for (const s of ["Wien 21", "Wien 21.", "Wien 21., Floridsdorf", "Vienna 21st district", "21st district of Vienna", "21. Bezirk", "Wien Bezirk 21", "Vienna district 21"]) {
    assert.equal(q(s).vienna, 21, s);
  }
  assert.equal(q("Wien 24").vienna, null); // there is no 24th district
  assert.deepEqual(q("Bezirk Baden"), { q: "baden", force: "district", vienna: null, postcode: null });
  assert.equal(q("Baden district").force, "district");
  assert.equal(q("district of Baden").q, "baden");
  assert.deepEqual(q("Land Salzburg"), { q: "salzburg", force: "state", vienna: null, postcode: null });
  assert.equal(q("Salzburg state").force, "state");
  assert.equal(q("Bundesland Tirol").q, "tirol");
  assert.equal(q("Klagenfurt Land").force, null); // a real district name, not a level word
  assert.equal(viennaDistrictOfPostcode("1010"), 1);
  assert.equal(viennaDistrictOfPostcode("1210"), 21);
  assert.equal(viennaDistrictOfPostcode("1230"), 23);
  assert.equal(viennaDistrictOfPostcode("1240"), null);
  assert.equal(viennaDistrictOfPostcode("1005"), null);
  assert.equal(viennaDistrictOfPostcode("6020"), null);
  assert.equal(viennaDistrictOfPostcode(null), null);
});

test("at-home-prices: German, English and ASCII spellings reach the same place; a municipality beats a district and a district beats a Bundesland", () => {
  for (const s of ["Wien", "Vienna", "Wien, Austria"]) assert.equal(foundName(s), "municipality:90001", s);
  for (const s of ["St. Pölten", "Sankt Pölten", "St Polten", "Sankt Polten"]) assert.equal(foundName(s), "municipality:30201", s);
  for (const s of ["Klagenfurt", "Klagenfurt am Wörthersee", "Klagenfurt am Woerthersee"]) assert.equal(foundName(s), "municipality:20101", s);
  assert.equal(foundName("Klagenfurt Land"), "district:204");
  assert.equal(foundName("Klagenfurt Stadt"), "district:201");
  assert.equal(foundName("Innsbruck"), "municipality:70101");
  assert.equal(foundName("Eisenstadt"), "municipality:10101");
  assert.equal(foundName("Baden"), "municipality:30604");
  for (const s of ["Bezirk Baden", "Baden district", "district of Baden", "Baden (Bezirk)"]) assert.equal(foundName(s), "district:306", s);
  assert.equal(foundName("Salzburg"), "municipality:50101");
  for (const s of ["Land Salzburg", "Salzburg state", "Bundesland Salzburg", "state of Salzburg"]) assert.equal(foundName(s), "state:Salzburg", s);
  assert.equal(foundName("Waidhofen an der Ybbs"), "district:303");
  for (const s of ["Güssing", "Gussing", "Guessing"]) assert.equal(foundName(s), "district:104", s);
  for (const s of ["Floridsdorf", "Wien 21", "Wien 21., Floridsdorf", "Vienna 21st district", "21. Bezirk"]) assert.equal(foundName(s), "district:921", s);
  assert.equal(foundName("Donaustadt"), "district:922");
  for (const s of ["Niederösterreich", "Niederoesterreich", "Lower Austria"]) assert.equal(foundName(s), "state:Niederösterreich", s);
  for (const s of ["Kärnten", "Kaernten", "Carinthia"]) assert.equal(foundName(s), "state:Kärnten", s);
  assert.equal(foundName("Tyrol"), "state:Tirol");
  assert.equal(foundName("Styria"), "state:Steiermark");
  assert.equal(foundName("Upper Austria"), "state:Oberösterreich");
  for (const s of ["", "Austria", "Österreich", "Osterreich", "national"]) assert.equal(foundName(s), "country:Österreich", s);

  const baden = find("Baden");
  assert.ok(baden.kind === "found" && baden.also.map((a) => a.level).join() === "district");
  const sbg = find("Salzburg");
  assert.ok(sbg.kind === "found" && sbg.also.map((a) => a.level).join() === "state");
});

test("at-home-prices: findArea never guesses; a near miss is offered and a place without figures is named as such", () => {
  assert.equal(find("Atlantis").kind, "none");
  assert.equal(find("x").kind, "none");
  const near = find("Klagenfur");
  assert.equal(near.kind, "similar");
  if (near.kind === "similar") {
    assert.ok(near.options.length >= 3 && near.options[0].level === "municipality");
    assert.equal(areaLabel(near.options[0]), "Klagenfurt am Wörthersee");
  }
  assert.equal(find("Rust").kind, "none"); // Rust (Stadt) has no figure in any year
  const rust = find("Rust", { includeEmpty: true });
  assert.ok(rust.kind === "found" && rust.area.code === "102");
  assert.equal(find("Wien 24").kind, "none");
});

// ---------- answers ----------

test("at-home-prices: Wien apartment — the first example — is a finished official-statistic answer", () => {
  const a = answer("Wien", "apartment");
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per m²");
  assert.equal(a.price!.measure, "median");
  assert.equal(a.price!.value, 5212);
  assert.equal(a.price!.median, 5212);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null); // the spreadsheet gives no sales count
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal(a.statistic!.reference_period, "2025");
  assert.equal(a.statistic!.measure, "median");
  assert.match(a.statistic!.note ?? "", /purchase contracts from 2021 to 2025, the earlier years revalued to 2025 with a regression model/);
  // The summary itself says per m² (not per home) and that the figure is a model over five years of contracts, not one year's sales.
  assert.match(
    a.summary,
    /^In Wien the median price paid for owner-occupied flats \(Eigentumswohnungen\) was €5,212 per m² of living area \(not per home\) for 2025, a model figure from purchase contracts of 2021 to 2025, the earlier years revalued to 2025\./,
  );
  assert.match(a.summary, /5\.5% higher than in 2024 \(€4,940 per m²\)/);
  // which side is above is named, not left ambiguous
  assert.match(a.summary, /The Austrian median for 2025 was €4,162 per m² \(Wien is 25\.2% above it\)/);
  // the publisher's name no longer reads "purchase contracts from the land register for 2025" (one year's contracts)
  assert.match(a.summary, /Official median published by STATISTIK AUSTRIA \(Bundesanstalt Statistik Österreich\) for 2025\.$/);
  assert.doesNotMatch(a.summary, /land register for 2025/);
  assert.equal(a.source.licence_url, LICENCE_URL);
  const x = a.extra as any;
  assert.deepEqual(x.region, { name: "Wien", published_as: "Wien", level: "municipality", code: "90001", bundesland: "Wien" });
  assert.equal(x.previous_period.value, 4940);
  assert.equal(x.austria_median.median, 4162);
  assert.equal(x.bundesland_median, null); // Vienna is both city and Bundesland: one figure, not two
  assert.deepEqual(x.also_published, []);
  assert.deepEqual(x.other_property_type, { key: "house", description: "houses (Wohnhäuser)", reference_period: "2025", median: 5376 });
  assert.equal(x.series.length, 11);
  assert.deepEqual(x.series[0], { reference_period: "2015", value: 3333 });
  assert.deepEqual(x.dataset, { url: FILE_URL, page: PAGE_URL, created: "2026-05-28" });
  assert.equal(x.data_window, "2021-2025");
});

test("at-home-prices: a municipality is compared with its Bundesland and Austria, and the other levels of the same name are listed", () => {
  const graz = answer("Graz", "house");
  assert.equal(graz.price!.value, 4034);
  const gx = graz.extra as any;
  assert.equal(gx.bundesland_median.median, 2421);
  assert.equal(gx.bundesland_median.area_vs_this_percent, 66.6);
  assert.equal(gx.austria_median.area_vs_this_percent, 42.2);
  assert.match(graz.summary, /The Steiermark median was €2,421 per m²/);

  const sbg = answer("Salzburg", "apartment");
  assert.equal(sbg.price!.value, 5114);
  const sx = sbg.extra as any;
  assert.equal(sx.previous_period.change_percent, 2.3);
  assert.equal(sx.bundesland_median.median, 4968);
  assert.deepEqual(sx.also_published, [{ level: "Bundesland (federal state)", name: "Salzburg", median: 4968 }]);

  const baden = answer("Baden", "house");
  assert.equal(baden.price!.value, 4257);
  assert.deepEqual((baden.extra as any).also_published, [{ level: "district (Bezirk)", name: "Bezirk Baden", median: 3467 }]);
  assert.equal((baden.extra as any).bundesland_median.median, 2653);

  const bezirk = answer("Bezirk Baden", "apartment");
  assert.equal(bezirk.price!.value, 3621);
  assert.match(bezirk.summary, /^In Bezirk Baden the median price paid for owner-occupied flats/);
  assert.equal((bezirk.extra as any).bundesland_median.median, 3089);
  assert.equal((bezirk.extra as any).region.level, "district (Bezirk)");

  const state = answer("Tirol", "house");
  assert.equal(state.price!.value, 4828);
  assert.equal((state.extra as any).previous_period.change_percent, -2.8);
  assert.equal((state.extra as any).austria_median.area_vs_this_percent, 70.2);
  assert.equal((state.extra as any).bundesland_median, null);
  assert.match(state.summary, /lower than in 2024 \(€4,967 per m²\)/);
});

test("at-home-prices: no town is Austria", () => {
  const a = answer(null, "house");
  assert.equal(a.price!.value, 2836);
  assert.match(a.summary, /^In Austria the median price paid for houses \(Wohnhäuser\) was €2,836 per m²/);
  assert.equal((a.extra as any).previous_period.change_percent, 4.6);
  assert.equal((a.extra as any).austria_median, null);
  assert.equal((a.extra as any).bundesland_median, null);
  assert.equal(answer("Österreich", "apartment").price!.value, 4162);
});

test("at-home-prices: a Vienna district is reached by number, name or postcode", () => {
  for (const [town, postcode] of [["Wien 21", null], ["Floridsdorf", null], [null, "1210"], ["Wien", "1210"], ["1210 Wien", null], ["Vienna 21st district", null]] as const) {
    const a = answer(town, "apartment", postcode);
    assert.equal(a.price!.value, 5253, `${town}/${postcode}`);
  }
  const a = answer("Wien 21", "apartment");
  assert.match(a.summary, /^In Wien 21 \(Floridsdorf\) the median price paid for owner-occupied flats/);
  assert.match(a.summary, /17\.4% higher than in 2024/);
  assert.match(a.summary, /The Wien median was €5,212 per m²/);
  assert.equal((a.extra as any).bundesland_median.area_vs_this_percent, 0.8);
  assert.equal((a.extra as any).region.bundesland, "Wien");
  // a postcode only decides Vienna: with another town it is ignored
  assert.equal(answer("Graz", "house", "1210").price!.value, 4034);
  assert.equal(answer("Donaustadt", "house").price!.value, 4929);
});

test("at-home-prices: gaps in the series are reported, not filled: older latest year, missing previous year", () => {
  const old = answer("Bezirk Jennersdorf", "apartment");
  assert.equal(old.price!.value, 1082);
  assert.equal(old.statistic!.reference_period, "2023");
  assert.deepEqual(old.period, { from: "2023-01-01", to: "2023-12-31" });
  assert.match(old.statistic!.note ?? "", /has no 2025 figure for Bezirk Jennersdorf \(too few sales\); the newest it has is for 2023, so this figure is 2 years older than the rest of the file/);
  assert.equal((old.extra as any).previous_period.value, 1255);
  assert.equal((old.extra as any).previous_period.change_percent, -13.8);

  const gussing = answer("Güssing", "apartment");
  assert.equal(gussing.price!.value, 919);
  assert.equal((gussing.extra as any).previous_period, null); // 2024 is blank
  assert.doesNotMatch(gussing.summary, /That is/);
  assert.doesNotMatch(gussing.statistic!.note ?? "", /has no/);

  const kufstein = answer("Kufstein", "house");
  assert.equal(kufstein.price!.value, 6040);
  assert.deepEqual((kufstein.extra as any).series, [{ reference_period: "2025", value: 6040 }]);

  assert.equal(answer("Perg", "house").price!.value, 2797);
  assert.equal((answer("Perg", "house").extra as any).previous_period.change_percent, 2.7);
  // Rum has a row but no figure, Rust has neither flats nor houses
  const rust = answer("Rust", "house");
  assert.equal(rust.status, "no_matches");
  assert.match(rust.summary, /publishes no house or flat price for Bezirk Rust \(Stadt\)/);
});

test("at-home-prices: 'any' gives both medians but no single price; unsupported kinds say so", () => {
  const any = answer("Wien", "any");
  assert.equal(any.status, "no_matches");
  assert.equal(any.price, null);
  assert.match(any.summary, /publishes houses and flats separately, with no figure for both together/);
  assert.match(any.summary, /€5,376/);
  assert.match(any.summary, /€5,212/);
  assert.deepEqual((any.extra as any).by_type.map((t: any) => t.key), ["house", "apartment"]);
  assert.equal(answer(null, "any").status, "no_matches");
  for (const t of ["villa", "detached", "semi-detached", "terraced"]) {
    const a = answer("Wien", t);
    assert.equal(a.status, "no_matches", t);
    assert.match(a.summary, new RegExp(`no official figure for property_type '${t}'`));
  }
  for (const t of ["condo", "flat-maisonette"]) assert.equal(answer("Wien", t).price!.value, 5212, t);
  // a place that has only one of the two kinds
  const noHouse = answer("Traiskirchen", "house");
  assert.equal(noHouse.status, "no_matches");
  assert.match(noHouse.summary, /no published price for houses \(Wohnhäuser\) in Traiskirchen/);
  assert.match(noHouse.summary, /It does publish owner-occupied flats \(Eigentumswohnungen\): €2,585 per m² for 2025/);
});

test("at-home-prices: unknown places are answered honestly, with suggestions", () => {
  const none = answer("Atlantis", "house");
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /no place called 'Atlantis'/);
  assert.match(none.summary, /100 most populous municipalities/);
  const near = answer("Klagenfur", "house");
  assert.match(near.summary, /Did you mean Klagenfurt am Wörthersee \(municipality\)/);
  assert.equal(answer("Wien 24", "house").status, "no_matches");
});

// ---------- fetching ----------

test("at-home-prices: the spreadsheet is fetched once per six hours, and an older copy serves when a refresh fails", async () => {
  clearCache();
  const file = buildOds(F.SHEETS);
  let calls = 0;
  let failing = false;
  const fetcher = async () => {
    calls++;
    if (failing) throw new SourceError("Source timed out");
    return file;
  };
  const t0 = Date.parse("2026-10-14T12:00:00Z");
  const first = await loadData({ fetcher, now: t0 });
  assert.equal(calls, 1);
  assert.equal(first.areas.length, DATA.areas.length);
  await loadData({ fetcher, now: t0 + 3600_000 });
  await loadData({ fetcher, now: t0 + CACHE_MS - 1 });
  assert.equal(calls, 1);
  await loadData({ fetcher, now: t0 + CACHE_MS + 1 });
  assert.equal(calls, 2);
  failing = true;
  const stale = await loadData({ fetcher, now: t0 + 2 * CACHE_MS + 5 });
  assert.equal(calls, 3);
  assert.equal(stale.areas.length, DATA.areas.length);
  clearCache();
  await assert.rejects(() => loadData({ fetcher, now: t0 }), (e: unknown) => e instanceof SourceError && isSourceOutage(e));
  clearCache();
});

test("at-home-prices: downloadFile asks the publisher once, honestly, and reports failures as source problems", async () => {
  const real = globalThis.fetch;
  const seen: { url: string; ua: string }[] = [];
  try {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, ua: String((init?.headers as Record<string, string>)["user-agent"]) });
      return new Response(Buffer.from("abc"), { status: 200 });
    }) as typeof fetch;
    assert.equal((await downloadFile()).toString(), "abc");
    assert.equal(seen[0].url, FILE_URL);
    assert.match(seen[0].ua, /ProofPrice.*hello@proofprice\.com/);
    globalThis.fetch = (async () => new Response("no", { status: 503 })) as typeof fetch;
    await assert.rejects(() => downloadFile(), (e: unknown) => e instanceof SourceError && (e as SourceError).status === 503 && isSourceOutage(e));
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(() => downloadFile(), /Could not reach the official source/);
  } finally {
    globalThis.fetch = real;
  }
});

test("at-home-prices: atHomePrices validates input and answers from the parsed file", async () => {
  clearCache();
  await assert.rejects(() => atHomePrices({ town: "Wien", property_type: "castle" }, { data: DATA }), (e: unknown) => e instanceof InputError && /property_type must be one of/.test((e as Error).message));
  await assert.rejects(() => atHomePrices({ postcode: "4020" }, { data: DATA }), InputError); // only Vienna postcodes can be matched
  const byPostcode = await atHomePrices({ postcode: "1210", property_type: "apartment" }, { data: DATA });
  assert.equal(byPostcode.price!.value, 5253);
  let calls = 0;
  const res = await atHomePrices({ town: " Wien ", property_type: "Apartment ", baseUrl: "https://proofprice.com" }, { fetcher: async () => (calls++, buildOds(F.SHEETS)), now: Date.parse("2026-10-14T12:00:00Z") });
  assert.equal(res.price!.value, 5212);
  assert.ok(res.method_url.startsWith("https://proofprice.com"));
  assert.equal(calls, 1);
  clearCache();
});

test("at-home-prices: the query type is Query-shaped (compile-time check of the exported types)", () => {
  const q: Query = parseQuery("Wien");
  assert.equal(q.q, "wien");
});
