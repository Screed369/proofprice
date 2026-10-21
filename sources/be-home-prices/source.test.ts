import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, countriesFor, categoryById, paramSchemas } from "../../lib/registry";
import {
  FILE_URL, INFO, STEADY_N, areaKey, beAnswer, beHarvest, beHomePrices, bestFigure, decodeFile, findPlace, foldName, parseAreaKey, parsePeriodId, parseVastgoed,
  periodEnd, periodLabel, periodStart, periodWords, placeLabel, regionOfRefnis, snapshotFromRows, snapshotOf, titleCase, typeKeyOf, unzipFirstFile,
} from "./source";
import type { Figure, Place, Snapshot } from "./source";
import * as F from "./fixtures";

// Fixtures: lines in the real layout of Statbel's file, numbers read from the live file on 2026-10-14 (see fixtures.ts).
const NOW = new Date("2026-10-14T12:00:00Z");
const places = (keys: string[]): Place[] => keys.map((k) => parseAreaKey(k)!);

function snapshot(extra: string[] = F.SYNTHETIC_LINES): Snapshot {
  const snap = snapshotOf(parseVastgoed(F.fileText(extra)));
  return snapshotFromRows(snap.date, snap.rows);
}

function makeZip(name: string, data: Buffer, method: 0 | 8): Buffer {
  const body = method === 8 ? deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(body.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdStart = local.length + nameBuf.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, nameBuf, body, cd, nameBuf, eocd]);
}

test("be-home-prices: licence, attribution and type are Statbel's", () => {
  assert.equal(INFO.id, "be-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.publisher, /Statbel/);
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.licence, /Statbel’s open data are published under the Creative Commons Attribution 4\.0 license/);
  assert.equal(INFO.licence_url, "https://statbel.fgov.be/en/open-data");
  for (const k of ["Statbel", "Vastgoed", "CC BY 4.0"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /25th percentile/);
  assert.match(INFO.limits, /no figure for houses and apartments together/);
  assert.doesNotMatch(INFO.what_is_recorded, /565/);
});

test("be-home-prices: registered as the BE source of the home-sales tool, Antwerpen apartment first", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "be-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["BE"]);
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "BE", town: "Antwerpen", property_type: "apartment" });
  assert.equal(typeof plugin.harvest, "function");
  assert.ok(countriesFor("home-sales").includes("BE"));
  assert.match(String(paramSchemas(categoryById("home-sales")!).town.description), /BE: a municipality/);
});

test("be-home-prices: parseVastgoed reads the real layout by column name, CRLF, blank cells and all", () => {
  const rows = parseVastgoed(F.fileText(F.SYNTHETIC_LINES));
  const nat = rows.filter((r) => r.refnis === "01000" && r.year === 2026 && r.period === "Q2");
  assert.equal(nat.length, 4);
  const apt = nat.find((r) => r.typeNl === "Appartementen")!;
  assert.deepEqual(
    { n: apt.transactions, p25: apt.p25, p50: apt.p50, p75: apt.p75, level: apt.level, nameFr: apt.nameFr, surface: apt.surface },
    { n: 13718, p25: 191000, p50: 257500, p75: 336000, level: 1, nameFr: "BELGIQUE", surface: "totaal / total" },
  );
  assert.equal(apt.typeFr, "Appartements");
  const thin = rows.find((r) => r.refnis === "44021" && r.period === "Y")!;
  assert.equal(thin.transactions, 3);
  assert.equal(thin.p50, null);
  // the header names are matched, not the positions
  const fields = F.line(2025, "all", "01000", "BELGIE", "BELGIQUE", "Y", [102862, 220000, 315000, 430000], 1).split("|");
  const moveTransactionsFirst = (a: string[]) => [a[8], ...a.slice(0, 8), ...a.slice(9)];
  const again = parseVastgoed(moveTransactionsFirst(F.HEADER.split("|")).join("|") + "\n" + moveTransactionsFirst(fields).join("|"));
  assert.equal(again[0].transactions, 102862);
  assert.equal(again[0].p50, 315000);
  assert.equal(again[0].period, "Y");
  assert.throws(() => parseVastgoed("a|b|c\n1|2|3"), SourceError);
  assert.throws(() => parseVastgoed(F.HEADER.replace("MS_P_50_median", "MEDIAN") + "\n"), /no MS_P_50_median column/);
});

test("be-home-prices: the file is Latin-1 today and decoded as UTF-8 if it changes", () => {
  const latin = Buffer.from("Maisons avec 2 ou 3 fa\xe7ades (type ferm\xe9)", "latin1");
  assert.equal(decodeFile(latin), "Maisons avec 2 ou 3 façades (type fermé)");
  assert.equal(decodeFile(Buffer.from("Maisons avec 2 ou 3 façades (type fermé)", "utf8")), "Maisons avec 2 ou 3 façades (type fermé)");
});

test("be-home-prices: unzipFirstFile reads deflated and stored zips and refuses anything else", () => {
  const text = Buffer.from(F.fileText(), "latin1");
  assert.equal(unzipFirstFile(makeZip("vastgoed_2010_9999.txt", text, 8)).toString("latin1"), text.toString("latin1"));
  assert.equal(unzipFirstFile(makeZip("vastgoed_2010_9999.txt", text, 0)).toString("latin1"), text.toString("latin1"));
  assert.throws(() => unzipFirstFile(Buffer.from("<html>not a zip</html>".repeat(5))), /not a zip file/);
});

test("be-home-prices: the four real Statbel labels map to our types; the all-houses label is not an apartment", () => {
  for (const [id, key] of [["closed", "house-closed"], ["open", "house-open"], ["all", "all"], ["apt", "apartment"]] as const) {
    assert.equal(typeKeyOf(F.TYPES[id][0], F.TYPES[id][1]), key, id);
    assert.equal(typeKeyOf(F.TYPES[id][0]), key, `${id} (Dutch label only)`);
  }
  assert.equal(typeKeyOf("Bouwgronden", "Terrains à bâtir"), null);
  assert.equal(typeKeyOf("Iets anders", ""), null);
});

test("be-home-prices: periods end where they should and read well in words", () => {
  const p = (id: string) => parsePeriodId(id)!;
  assert.equal(periodEnd(p("2026Q2")), "2026-06-30");
  assert.equal(periodStart(p("2026Q2")), "2026-04-01");
  assert.equal(periodEnd(p("2026S1")), "2026-06-30");
  assert.equal(periodStart(p("2026S1")), "2026-01-01");
  assert.equal(periodEnd(p("2025S2")), "2025-12-31");
  assert.equal(periodStart(p("2025S2")), "2025-07-01");
  assert.equal(periodEnd(p("2025Y")), "2025-12-31");
  assert.equal(periodEnd(p("2024Q1")), "2024-03-31");
  assert.equal(periodLabel(p("2026Q2")), "2026-Q2");
  assert.equal(periodLabel(p("2026S1")), "2026-S1");
  assert.equal(periodLabel(p("2025Y")), "2025");
  assert.equal(periodWords(p("2026Q2")), "the second quarter of 2026 (April to June)");
  assert.equal(periodWords(p("2026S1")), "the first half of 2026");
  assert.equal(periodWords(p("2025Y")), "the year 2025");
  assert.equal(parsePeriodId("2026Q5"), null);
  assert.equal(parsePeriodId("garbage"), null);
});

test("be-home-prices: snapshotOf keeps the newest quarter, half-year and year, drops thin and blank cells", () => {
  const snap = snapshotOf(parseVastgoed(F.fileText(F.SYNTHETIC_LINES)));
  assert.deepEqual(snap.periods, ["2025Y", "2026Q2", "2026S1"]);
  assert.equal(snap.date, "2026-06-30");
  assert.deepEqual(snap.unmapped, []);
  assert.deepEqual(Object.keys(snap.types).sort(), ["all", "apartment", "house-closed", "house-open"]);
  const ids = new Set(snap.rows.map((r) => r.item.split("/")[1]));
  assert.deepEqual([...ids].sort(), ["2025Y", "2026Q2", "2026S1"]);
  // 2026 Q1 and 2025 Q4/S1 are older than the newest of their kind: not collected
  assert.ok(!snap.rows.some((r) => /2026Q1|2025Q4|2025S1/.test(r.item)));
  // blank quartiles (3 sales) and 4 sales are below the floor: never published
  assert.ok(!snap.rows.some((r) => r.area.startsWith("44021|") && r.item.endsWith("2025Y")));
  assert.ok(!snap.rows.some((r) => r.area.startsWith("21009|")));
  assert.ok(snap.rows.every((r) => r.n >= 5 && r.low > 0 && r.high >= r.median && r.median >= r.low));
  const ant = snap.rows.find((r) => r.area === "11002|ANTWERPEN|ANVERS|5" && r.item === "apartment/2026Q2")!;
  assert.deepEqual(ant, { area: "11002|ANTWERPEN|ANVERS|5", item: "apartment/2026Q2", n: 1645, median: 255000, low: 200000, high: 341777, min: 200000, max: 341777 });
  assert.equal(areaKey({ refnis: "25121", nameNl: "X", nameFr: "X", level: 5 }), "25121|X||5");
  assert.throws(() => snapshotOf([]), SourceError);
});

test("be-home-prices: harvest downloads once, with an honest user agent, and explains the quartiles", async () => {
  const zip = makeZip("vastgoed_2010_9999.txt", Buffer.from(F.fileText(F.SYNTHETIC_LINES), "latin1"), 8);
  const real = globalThis.fetch;
  const seen: { url: string; ua: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, ua: String((init?.headers as Record<string, string>)["user-agent"]) });
    return new Response(zip, { status: 200 });
  }) as typeof fetch;
  try {
    const res = await beHarvest();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, FILE_URL);
    assert.match(seen[0].ua, /ProofPrice-collector.*hello@proofprice\.com/);
    assert.equal(res.date, "2026-06-30");
    assert.equal(res.currency, "EUR");
    assert.equal(res.unit, "per home");
    assert.equal(res.rows.length, 27); // 12 national + 10 Antwerpen + 3 Flemish region + 2 Gent; the thin and blank cells are left out
    assert.match(res.note ?? "", /2025Y, 2026Q2, 2026S1/);
    assert.match(res.note ?? "", /25th and 75th percentile/);
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    await assert.rejects(() => beHarvest(), /HTTP 503/);
  } finally {
    globalThis.fetch = real;
  }
});

test("be-home-prices: names fold apostrophes and accents; titles are readable", () => {
  assert.equal(foldName("PROVINCE D'ANVERS"), "province d anvers");
  assert.equal(foldName("Liège"), "liege");
  assert.equal(foldName("Knokke-Heist"), "knokke heist");
  assert.equal(titleCase("SINT-JANS-MOLENBEEK"), "Sint-Jans-Molenbeek");
  assert.equal(titleCase("OTTIGNIES-LOUVAIN-LA-NEUVE"), "Ottignies-Louvain-la-Neuve");
  const bx = parseAreaKey("21004|BRUSSEL|BRUXELLES|5")!;
  assert.equal(placeLabel(bx), "Brussel / Bruxelles");
  assert.equal(placeLabel(parseAreaKey("44021|GENT|GAND|5")!), "Gent / Gand");
  assert.equal(placeLabel(parseAreaKey("01000|BELGIE|BELGIQUE|1")!), "Belgium");
  assert.equal(placeLabel(parseAreaKey("25121|OTTIGNIES-LOUVAIN-LA-NEUVE||5")!), "Ottignies-Louvain-la-Neuve");
  assert.equal(parseAreaKey("garbage"), null);
});

test("be-home-prices: Dutch, French and English names reach the same municipality, and a municipality beats its arrondissement and province", () => {
  const p = places(F.REAL_AREA_KEYS);
  const refnis = (q: string) => {
    const f = findPlace(q, p);
    assert.equal(f.kind, "found", q);
    return f.kind === "found" ? f.place.refnis : "";
  };
  for (const q of ["Antwerpen", "Antwerp", "Anvers", "ANTWERPEN, Belgium", "Antwerp (city)"]) assert.equal(refnis(q), "11002", q);
  for (const q of ["Brussel", "Brussels", "Bruxelles", "brussels"]) assert.equal(refnis(q), "21004", q);
  for (const q of ["Gent", "Ghent", "Gand"]) assert.equal(refnis(q), "44021", q);
  for (const q of ["Luik", "Liège", "Liege"]) assert.equal(refnis(q), "62063", q);
  for (const q of ["Elsene", "Ixelles"]) assert.equal(refnis(q), "21009", q);
  for (const q of ["Leuven", "Louvain"]) assert.equal(refnis(q), "24062", q);
  for (const q of ["Bergen", "Mons"]) assert.equal(refnis(q), "53053", q);
  assert.equal(refnis("Ottignies-Louvain-la-Neuve"), "25121");
  // the province and the arrondissement, only when asked for by level
  assert.equal(refnis("province of Antwerp"), "10000");
  assert.equal(refnis("Province d'Anvers"), "10000");
  assert.equal(refnis("provincie Antwerpen"), "10000");
  assert.equal(refnis("Antwerpen province"), "10000");
  assert.equal(refnis("Namur province"), "90000");
  assert.equal(refnis("province de Namur"), "90000");
  assert.equal(refnis("Vlaams-Brabant"), "20001");
  assert.equal(refnis("arrondissement Antwerpen"), "11000");
  // regions and the country
  assert.equal(refnis("Flanders"), "02000");
  assert.equal(refnis("Vlaanderen"), "02000");
  assert.equal(refnis("Wallonia"), "03000");
  assert.equal(refnis("Brussels Capital Region"), "04000");
  for (const q of ["Belgium", "Belgique", "België", "BE", "nationwide"]) assert.equal(refnis(q), "01000", q);
});

test("be-home-prices: findPlace never guesses: an unknown name is none, a near miss is offered", () => {
  const p = places(F.REAL_AREA_KEYS);
  assert.equal(findPlace("Atlantis", p).kind, "none");
  assert.equal(findPlace("", p).kind, "none");
  assert.equal(findPlace("x", p).kind, "none");
  const near = findPlace("Antwerpe", p);
  assert.equal(near.kind, "similar");
  if (near.kind === "similar") assert.ok(near.options.some((o) => o.refnis === "11002"));
  const two = places(["11001|AARTSELAAR||5", "99991|HAMME||5", "99992|HAMME||5"]);
  const dup = findPlace("Hamme", two);
  assert.equal(dup.kind, "ambiguous");
  if (dup.kind === "ambiguous") assert.equal(dup.options.length, 2);
});

test("be-home-prices: regionOfRefnis follows the Statbel codes", () => {
  assert.equal(regionOfRefnis("01000"), 0);
  assert.equal(regionOfRefnis("02000"), 1);
  assert.equal(regionOfRefnis("03000"), 3);
  assert.equal(regionOfRefnis("04000"), 2);
  assert.equal(regionOfRefnis("11002"), 1); // Antwerpen
  assert.equal(regionOfRefnis("44021"), 1); // Gent
  assert.equal(regionOfRefnis("24062"), 1); // Leuven (Flemish Brabant)
  assert.equal(regionOfRefnis("20001"), 1); // province Vlaams-Brabant
  assert.equal(regionOfRefnis("21004"), 2); // Brussel
  assert.equal(regionOfRefnis("25121"), 3); // Ottignies (Walloon Brabant)
  assert.equal(regionOfRefnis("20002"), 3); // province Waals-Brabant
  assert.equal(regionOfRefnis("53053"), 3); // Mons (Hainaut)
  assert.equal(regionOfRefnis("62063"), 3); // Liège
  assert.equal(regionOfRefnis("90000"), 3); // province Namur
});

test("be-home-prices: bestFigure takes the shortest steady period that ends last", () => {
  const f = (id: string, n: number): Figure => ({ period: parsePeriodId(id)!, n, p25: 1, p50: 2, p75: 3 });
  assert.equal(periodLabel(bestFigure([f("2026Q2", 1645), f("2026S1", 3154), f("2025Y", 6653)])!.period), "2026-Q2");
  assert.equal(periodLabel(bestFigure([f("2026Q2", STEADY_N - 1), f("2026S1", STEADY_N + 10), f("2025Y", 500)])!.period), "2026-S1");
  assert.equal(periodLabel(bestFigure([f("2026Q2", 12), f("2026S1", 20), f("2025Y", 500)])!.period), "2026-S1"); // none steady: the one with most sales among the latest
  assert.equal(periodLabel(bestFigure([f("2026S1", 20), f("2025Y", 500)])!.period), "2026-S1"); // newer beats larger-but-older
  assert.equal(periodLabel(bestFigure([f("2025Y", 500)])!.period), "2025");
  assert.equal(bestFigure([]), null);
});

test("be-home-prices: Antwerpen apartment — the first example — is a finished official-statistic answer", () => {
  const a = beAnswer(snapshot([]), { town: "Antwerpen", property_type: "apartment", now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per home");
  assert.equal(a.price!.measure, "median");
  assert.equal(a.price!.value, 255000);
  assert.equal(a.price!.median, 255000);
  // typical_low / typical_high are the 10th and 90th percentile: Statbel publishes quartiles, which go in extra instead
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, 1645);
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.equal(a.statistic!.measure, "median");
  assert.match(a.summary, /Antwerpen \/ Anvers/);
  // per home, and the latest quarter is marked provisional in the summary itself, not only in the note
  assert.match(a.summary, /apartments \(per home, not per m²\) was €255,000 in the second quarter of 2026 \(April to June\) \(provisional\), from 1,645 transactions/);
  assert.match(a.summary, /between €200,000 and €341,777 \(25th to 75th percentile\)/);
  // which side is below is named, not left ambiguous
  assert.match(a.summary, /Belgian median for the same period was €257,500 \(Antwerpen \/ Anvers is 1% below it\)/);
  assert.equal((a.extra as any).library_snapshot_date, "2026-06-30");
  assert.equal((a.extra as any).collected, undefined);
  assert.match(a.summary, /Official median published by Statbel \(Statistics Belgium\) for 2026-Q2\./);
  const x = a.extra as any;
  assert.equal(x.region.code, "11002");
  assert.equal(x.region.level, "municipality");
  assert.equal(x.property_type_published.key, "apartment");
  assert.deepEqual(x.interquartile_range.p25, 200000);
  assert.equal(x.belgium_comparison.median, 257500);
  assert.equal(x.belgium_comparison.difference_percent, -1);
  assert.equal(x.region_comparison, null); // no row for the Flemish region in the real fixture lines
  assert.equal(a.source.licence_url, "https://statbel.fgov.be/en/open-data");
  assert.deepEqual(x.other_periods.map((o: any) => o.reference_period), ["2026-S1", "2025"]);
  assert.equal(x.other_periods[0].median, 255000);
  // a steady, recent quarter: the only caveat is Statbel's own, that the latest quarter is provisional
  assert.equal(a.statistic!.note, "Statbel treats the data for the latest quarter as provisional and revises it in its next publication.");
});

test("be-home-prices: the region is compared too when Statbel has its row (synthetic Flemish numbers)", () => {
  const snap = snapshot();
  const a = beAnswer(snap, { town: "Antwerp", property_type: "apartment", now: NOW });
  assert.equal(a.status, "ok");
  const x = a.extra as any;
  assert.equal(x.region_comparison.place, "Vlaams Gewest / Region Flamande");
  assert.equal(x.region_comparison.median, 240000);
  assert.equal(x.region_comparison.difference_percent, 6.3);
  assert.equal(x.region_comparison.level, "region");
});

test("be-home-prices: houses, detached and villa requests use Statbel's own house types and say so", () => {
  const snap = snapshot();
  const house = beAnswer(snap, { town: "Antwerpen", property_type: "house", now: NOW });
  assert.equal(house.price!.value, 380000);
  assert.equal(house.sample_size, 638);
  assert.match(house.summary, /houses \(all types, not apartments\)/);
  const villa = beAnswer(snap, { town: "Antwerpen", property_type: "villa", now: NOW });
  assert.equal(villa.status, "ok");
  assert.equal(villa.statistic!.reference_period, "2026-S1"); // the quarter has 23 sales, the half-year 55
  assert.equal(villa.price!.value, 660000);
  assert.equal(villa.sample_size, 55);
  assert.match(villa.statistic!.note ?? "", /no separate villa category/);
  const detached = beAnswer(snap, { town: "Antwerpen", property_type: "detached", now: NOW });
  assert.equal(detached.price!.value, 660000);
  assert.doesNotMatch(detached.statistic!.note ?? "", /villa/);
  const terraced = beAnswer(snap, { town: "Antwerpen", property_type: "terraced", now: NOW });
  assert.equal(terraced.price!.value, 377500);
  assert.match(terraced.statistic!.note ?? "", /terraced and semi-detached houses \(2 or 3 facades\) in one figure/);
});

test("be-home-prices: a thin quarter falls back to the steadier half-year and says so", () => {
  const a = beAnswer(snapshot(), { town: "Gent", property_type: "apartment", now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.statistic!.reference_period, "2026-S1");
  assert.equal(a.price!.value, 232000);
  assert.equal(a.sample_size, 40);
  assert.equal(a.confidence, "medium");
  assert.match(a.statistic!.note ?? "", /quarterly figure rests on only 12 transactions, so this is the steadier figure for the first half of 2026/);
  assert.match(a.summary, /Gent \/ Gand/);
});

test("be-home-prices: no town is Belgium; 'any' gives both medians but no single price", () => {
  const snap = snapshot();
  const be = beAnswer(snap, { town: null, property_type: "apartment", now: NOW });
  assert.equal(be.price!.value, 257500);
  assert.equal(be.sample_size, 13718);
  assert.match(be.summary, /In Belgium the median/);
  assert.equal((be.extra as any).belgium_comparison, null);

  const any = beAnswer(snap, { town: "Antwerpen", property_type: "any", now: NOW });
  assert.equal(any.status, "no_matches");
  assert.equal(any.price, null);
  assert.match(any.summary, /no single price for houses and apartments together/);
  assert.match(any.summary, /€380,000/);
  assert.match(any.summary, /€255,000/);
  assert.match(any.summary, /property_type 'house' or 'apartment'/);
  assert.deepEqual((any.extra as any).by_type.map((t: any) => t.key), ["all", "apartment"]);
});

test("be-home-prices: unknown places, ambiguous names and missing types are answered honestly", () => {
  const snap = snapshot();
  const none = beAnswer(snap, { town: "Atlantis", property_type: "house", now: NOW });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no municipality, province or region called 'Atlantis'/);
  const similar = beAnswer(snap, { town: "Antwerpe", property_type: "house", now: NOW });
  assert.match(similar.summary, /Did you mean/);
  // Gent has no house figure in this slice
  const noType = beAnswer(snap, { town: "Gent", property_type: "house", now: NOW });
  assert.equal(noType.status, "no_matches");
  assert.match(noType.summary, /Statbel publishes no price for houses \(all types, not apartments\) in Gent \/ Gand/);
  assert.match(noType.summary, /Statbel does publish apartments for Gent/);
  // Elsene has only a sub-floor row: nothing published at all
  const tiny = beAnswer(snap, { town: "Elsene", property_type: "apartment", now: NOW });
  assert.equal(tiny.status, "no_matches");
  assert.equal(tiny.price, null);
});

test("be-home-prices: an old figure is flagged plainly", () => {
  const old = beAnswer(snapshot(), { town: "Antwerpen", property_type: "apartment", now: new Date("2028-01-01T00:00:00Z") });
  assert.match(old.statistic!.note ?? "", /more than a year old/);
});

test("be-home-prices: only a figure for the newest period Statbel publishes is called provisional", () => {
  // the library already holds a newer period than this place's figure: the figure is not the provisional latest quarter
  const later = { ...snapshot(), date: "2026-09-30" };
  const a = beAnswer(later, { town: "Antwerpen", property_type: "apartment", now: NOW });
  assert.equal(a.status, "ok");
  assert.doesNotMatch(a.summary, /provisional/);
  assert.doesNotMatch(a.statistic!.note ?? "", /provisional/);
});

test("be-home-prices: beHomePrices validates input and reports an empty library as a source problem", async () => {
  const snap = snapshot();
  await assert.rejects(() => beHomePrices({ town: "Antwerpen", property_type: "castle" }, { snapshot: snap }), (e: unknown) => e instanceof InputError && /property_type must be one of/.test((e as Error).message));
  await assert.rejects(() => beHomePrices({ postcode: "2000" }, { snapshot: snap }), InputError);
  await assert.rejects(() => beHomePrices({ town: "Antwerpen" }, { snapshot: null }), (e: unknown) => e instanceof SourceError && !(e instanceof InputError));
  const ok = await beHomePrices({ town: "Antwerpen", property_type: "Apartment ", baseUrl: "https://proofprice.com" }, { snapshot: snap, now: NOW });
  assert.equal(ok.status, "ok");
  assert.ok(ok.method_url.startsWith("https://proofprice.com"));
  const dup = places(["99991|HAMME||5", "99992|HAMME||5"]);
  const amb = snapshotFromRows("2026-06-30", dup.map((d) => ({ area: d.key, item: "apartment/2026Q2", n: 50, median: 200000, low: 150000, high: 250000 })));
  await assert.rejects(() => beHomePrices({ town: "Hamme", property_type: "apartment" }, { snapshot: amb }), /names several places/);
});

test("Belgium keeps no history: it is not among the home-sales history countries, and a history request says why", async () => {
  const { categoryById, historySources, runHistory } = await import("../../lib/registry");
  const { buildOpenApi } = await import("../../lib/openapi");
  const cat = categoryById("home-sales")!;
  assert.ok(!historySources(cat).some((s) => s.countries.includes("BE")));
  const spec: any = buildOpenApi("https://proofprice.com");
  const hist = spec.paths["/api/v1/home-sales/history"];
  if (hist) assert.doesNotMatch(hist.get.summary, /\bBE\b/);
  assert.throws(() => runHistory(cat, { country: "BE", town: "Gent" }), /Statbel publishes one median/);
});
