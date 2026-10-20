// Tests for the Malaysia PriceCatcher source. Header and layout are copied from the live files (probed 2026-10-17 and 2026-10-20: lookup_item.csv,
// lookup_premise.csv, pricecatcher_2026-10.csv); the first rows of each are real, the remaining shop rows are generated in the same format so a state has 5+ shops.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INFO, Newest, buildRows, defsFor, itemKey, matchItems, parseItems, parsePremises, parsePrices, pricecatcherAnswerFromRows, resolveState, splitLine, monthUrl,
} from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const ITEM_CSV = `item_code,item,unit,item_group,item_category
-1,,,,
1,AYAM BERSIH - STANDARD,1kg,BARANGAN SEGAR,AYAM
3,AYAM HIDUP,1kg,BARANGAN SEGAR,AYAM
118,TELUR AYAM GRED A (BERAT 65.0 GM HINGGA 69.9 GM SEBIJI),10 biji,BARANGAN SEGAR,TELUR
125,TELUR ITIK,10 biji,BARANGAN SEGAR,TELUR
904,BERAS SUPER CAP RAMBUTAN 5% (IMPORT),10 kg,BARANGAN BERBUNGKUS,BERAS
917,"TEPUNG GANDUM NGP (BERBUNGKUS, CAP SAUH)",1kg,BARANGAN BERBUNGKUS,TEPUNG
`;

const PREMISE_CSV = `premise_code,premise,address,premise_type,state,district
-1,Unknown Premise,Unknown Address,,,
2,PASAR BESAR IPOH,"JALAN LAKSAMANA,TAMAN JUBILEE,30300 IPOH, PERAK",Pasar Basah ,Perak,Kinta
3,JUSCO AYER KEROH,"LOT 4991,MUKIM BUKIT BARU,75450 LEBUH AYER KEROH, MELAKA",Pasar Raya / Supermarket,Melaka,Melaka Tengah
136,THE STORE ( PUDU PLAZA ),"UG & 1st FLOOR, PUDU PLAZA,JALAN DAVIS,",Pasar Raya / Supermarket,W.P. Kuala Lumpur,Cheras
183,GIANT SUPERMARKET KELANA JAYA,"JALAN SS 6/3,PUSAT BANDAR KELANA JAYA,47301 PETALING JAYA, SELANGOR",Pasar Raya / Supermarket,Selangor,Petaling Jaya
`;

// premises 1000-1011 are generated: 1000-1007 in Selangor, 1008-1011 in Perak
function premises(): string {
  let t = PREMISE_CSV;
  for (let i = 0; i < 8; i++) t += `${1000 + i},SHOP ${i},"ADDR",Kedai Runcit,Selangor,Gombak\n`;
  for (let i = 8; i < 12; i++) t += `${1000 + i},SHOP ${i},"ADDR",Kedai Runcit,Perak,Kinta\n`;
  return t;
}

function prices(): string {
  // real first rows of pricecatcher_2026-10.csv, then generated rows in the same layout
  let t = "date,premise_code,item_code,price\n2026-10-10,2,1,11.0\n2026-10-10,2,47,9.0\n2026-10-10,2,1110,14.7\n";
  for (let i = 0; i < 12; i++) {
    const p = 1000 + i;
    t += `2026-10-16,${p},1,${(10 + (i % 4) * 0.5).toFixed(1)}\n`; // chicken 10.0..11.5
    t += `2026-10-16,${p},118,${(13 + i * 0.1).toFixed(1)}\n`; // eggs
    t += `2026-10-09,${p},118,99.0\n`; // older price for the same shop and item: ignored (newest wins)
  }
  t += "2026-10-16,3,1,60.0\n"; // typo-like outlier price (6x the median) at the Melaka shop: dropped
  t += "2026-10-16,2,904,-1\n2026-10-16,-1,1,10.0\n2026-10-16,1000,-1,10.0\n"; // junk rows ignored
  t += "2026-09-01,1000,3,8.0\n"; // too old for the 7-day window
  return t;
}

function built() {
  const items = parseItems(ITEM_CSV), prem = parsePremises(premises());
  const n = new Newest();
  parsePrices(prices(), n);
  return { items, prem, n, b: buildRows(n.entries(), items, prem, n.newestDate) };
}

test("lookup files: placeholder rows are skipped, quoted names with commas survive, addresses are not kept", () => {
  const items = parseItems(ITEM_CSV);
  assert.equal(items.size, 6);
  assert.equal(items.get(917)!.name, "TEPUNG GANDUM NGP (BERBUNGKUS, CAP SAUH)");
  assert.equal(itemKey("TEPUNG GANDUM NGP (BERBUNGKUS, CAP SAUH)", "1kg"), "TEPUNG GANDUM NGP (BERBUNGKUS/ CAP SAUH)|1kg".replace("/ ", "/"));
  const prem = parsePremises(PREMISE_CSV);
  assert.equal(prem.get(136), "W.P. Kuala Lumpur");
  assert.ok(!prem.has(-1));
  assert.deepEqual(splitLine('2,PASAR,"A, B",x'), ["2", "PASAR", "A, B", "x"]);
});

test("a changed header is refused with a plain message", () => {
  assert.throws(() => parsePrices("day,shop,thing,cost\n", new Newest()), /new layout/);
  assert.throws(() => parseItems("a,b\n"), /new layout/);
});

test("parsePrices keeps each shop's newest price and ignores junk rows", () => {
  const { n } = built();
  assert.equal(n.newestDate, "2026-10-16");
  const e = n.entries().find((x) => x.premise === 1001 && x.item === 118)!;
  assert.equal(e.date, "2026-10-16");
  assert.equal(e.price, 13.1);
  assert.ok(!n.entries().some((x) => x.premise <= 0 || x.item <= 0));
});

test("buildRows: median across shops by state and nationally, 5-shop rule, outlier dropped, old prices left out", () => {
  const { b } = built();
  assert.equal(b.date, "2026-10-16");
  assert.deepEqual(b.states, ["Perak", "Selangor"]);
  const all = b.rows.find((r) => r.area === "ALL" && r.item === "AYAM BERSIH - STANDARD|1kg")!;
  assert.equal(all.n, 13, "12 generated shops + the real Ipoh market (2026-10-10, inside the 7-day window); the 60.0 outlier is dropped");
  assert.ok(all.median >= 10 && all.median <= 11.5);
  assert.ok(!b.rows.some((r) => r.item.startsWith("AYAM HIDUP")), "a price from September is outside the 7-day window");
  assert.ok(b.rows.every((r) => r.n >= 5));
  assert.equal(b.dropped.outliers, 1);
  assert.equal(b.rows.find((r) => r.area === "Perak" && r.item.startsWith("AYAM BERSIH"))!.n, 5, "4 generated + the Ipoh market");
  assert.equal(b.rows.find((r) => r.area === "Melaka"), undefined, "one outlier-only shop is far below 5");
});

test("matchItems answers English and Malay questions, generic names first", () => {
  const defs = defsFor(built().b.rows, "ALL");
  assert.equal(matchItems(defs, "chicken")[0].name, "AYAM BERSIH - STANDARD");
  assert.equal(matchItems(defs, "price of eggs")[0].name.startsWith("TELUR AYAM"), true);
  assert.equal(matchItems(defs, "telur")[0].name.startsWith("TELUR AYAM"), true);
  assert.deepEqual(matchItems(defs, "diamonds"), []);
  const mk = (name: string, n: number) => ({ key: name + "|1kg", name, unit: "1kg", n, row: { area: "ALL", item: name + "|1kg", n, median: 1, low: 1, high: 1, min: 1, max: 1 } });
  assert.equal(matchItems([mk("TEMBIKAI SUSU", 251), mk("SUSU SEGAR KURMA FARM FRESH", 100)], "milk")[0].name, "SUSU SEGAR KURMA FARM FRESH", "milk-melon is a watermelon");
  assert.equal(matchItems([mk("TEMBIKAI SUSU", 251)], "milk").length, 0);
});

test("resolveState: Kuala Lumpur and Penang style names", () => {
  const rows = [
    { area: "W.P. Kuala Lumpur", item: "x|1", n: 5, median: 1, low: 1, high: 1, min: 1, max: 1 },
    { area: "Pulau Pinang", item: "x|1", n: 5, median: 1, low: 1, high: 1, min: 1, max: 1 },
    { area: "Selangor", item: "x|1", n: 5, median: 1, low: 1, high: 1, min: 1, max: 1 },
  ];
  assert.equal(resolveState(rows, "Kuala Lumpur"), "W.P. Kuala Lumpur");
  assert.equal(resolveState(rows, "KL"), "W.P. Kuala Lumpur");
  assert.equal(resolveState(rows, "penang"), "Pulau Pinang");
  assert.equal(resolveState(rows, "selangor"), "Selangor");
  assert.equal(resolveState(rows, "Atlantis"), null);
});

test("answer: national and state figures are posted prices in MYR with shops as the sample", () => {
  const day = { date: "2026-10-16", rows: built().b.rows };
  const a = pricecatcherAnswerFromRows(day, { item: "chicken", today: "2026-10-17" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "MYR");
  assert.equal(a.price!.unit, "per 1kg");
  assert.equal(a.sample_size, 13);
  assert.match(a.summary, /not receipts/);
  const s = pricecatcherAnswerFromRows(day, { item: "eggs", region: "Selangor", today: "2026-10-17" });
  assert.equal(s.status, "ok");
  assert.equal(s.sample_size, 8);
  assert.equal(s.period.to, "2026-10-16");
});

test("answer: a state with under 5 shops says so instead of answering for another place; unknown state lists the valid ones", () => {
  const day = { date: "2026-10-16", rows: built().b.rows };
  const p = pricecatcherAnswerFromRows(day, { item: "eggs", region: "Perak", today: "2026-10-17" });
  assert.notEqual(p.status, "ok");
  assert.equal(p.price, null);
  assert.throws(() => pricecatcherAnswerFromRows(day, { item: "chicken", region: "Atlantis" }), /no figures in our copy/);
  assert.throws(() => pricecatcherAnswerFromRows(day, {}), /item is required/);
});

test("answer: an old library copy is flagged", () => {
  const day = { date: "2026-10-01", rows: built().b.rows };
  const a = pricecatcherAnswerFromRows(day, { item: "chicken", today: "2026-10-20" });
  assert.equal((a.extra as any).stale, true);
});

test("manifest: groceries category, Malaysia, posted price, licence and attribution", () => {
  assert.deepEqual(manifest.countries, ["MY"]);
  assert.equal(manifest.category, "groceries");
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("MY"));
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.attribution, /CC BY 4.0/);
  assert.equal(monthUrl("2026-10"), "https://storage.data.gov.my/pricecatcher/pricecatcher_2026-10.csv");
  assert.ok(manifest.harvest && manifest.historyKey);
});

test("buildRows keeps the best-covered few items of each staple category, plus other well-covered items", () => {
  const csv = "item_code,item,unit,item_group,item_category\n" +
    [1, 2, 3, 4, 5].map((i) => `${i},AYAM TEST ${i},1kg,BARANGAN SEGAR,AYAM`).join("\n") + "\n" +
    Array.from({ length: 45 }, (_, k) => 6 + k).map((i) => `${i},GAJET ${i},1 biji,LAIN,LAIN-LAIN`).join("\n") + "\n";
  const items = parseItems(csv);
  const prem = new Map<number, string>();
  const n = new Newest();
  for (let s = 0; s < 6; s++) {
    prem.set(100 + s, "Johor");
    // item 1 is priced in 6 shops, item 2 in 6, item 3 in 6, item 4 and 5 in 5 shops each (fewer shops than 1-3 only by tie order)
    for (const it of Array.from({ length: 51 }, (_, k) => 1 + k)) if (s < (it === 4 || it === 5 ? 5 : 6)) n.add(100 + s, it, "2026-10-16", 10 + it);
  }
  const b = buildRows(n.entries(), items, prem, n.newestDate);
  const names = new Set(b.rows.map((r) => r.item.split("|")[0]));
  assert.deepEqual([...names].filter((x) => x.startsWith("AYAM")).sort(), ["AYAM TEST 1", "AYAM TEST 2", "AYAM TEST 3"], "AYAM keeps 3; the 4th and 5th lose to 40 better-covered other items");
  assert.equal([...names].filter((x) => x.startsWith("GAJET")).length, 40, "40 other items");
});
