import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePacks, currentPacks, keysOf, dailyRows, canon, plain, parsePrice, latestFile, fileUrl, candidateKeys, hrAnswerFromRow, hrHistoryKey, Pack } from "./source";
import type { Cell } from "../../categories/rent/xlsx";

// Real title rows, header and first rows of Zbirni-popis-objavljenih-cijena-lijekova-7356-svi.xlsx (Sheet1), probed 21 Oct 2026 from GitHub Actions.
const HEAD: Cell[] = ["Naziv lijeka i pakiranje", "Djelatna tvar ", "ATK", "Broj odobrenja pakiranja ", "Nositelj odobrenja", "Lokalni predstavnik", "Nositelj potvrde za paralelni promet", "Cijena (EUR )", "Dan objave cijene", "Dan početka važenja cijene", "Dan prestanka važenja cijene", "Tip cijene* / Vrsta postupka"];
const ROWS: Cell[][] = [
  ["ZBIRNI POPIS OBJAVLJENIH CIJENA LIJEKOVA za 2026. godinu"],
  ["Datum prve objave: 07.01.2026"],
  ["Datum zadnje dopune: 21.10.2026"],
  HEAD,
  ["Aban 10 mg filmom obložene tablete, 10 tableta u blisteru, u kutiji", "rivaroksaban", "B01AF01", "HR-H-790495386-01", "Alpha-Medical d.o.o.", null, null, 10.53, 46164, 46214, null, "NDC / Godišnji izračun cijene lijeka"],
  ["Aban 10 mg filmom obložene tablete, 30 tableta u blisteru, u kutiji", "rivaroksaban", "B01AF01", "HR-H-790495386-02", "Alpha-Medical d.o.o.", null, null, 30.1, 46164, 46214, null, "NDC / Godišnji izračun cijene lijeka"],
  ["Abirateron Devatis 500 mg filmom obložene tablete, 60 tableta u blisteru, u kutiji", "abirateronacetat", "L02BX03", "HR-H-315356088-02", "Devatis GmbH", "KONSKOL d.o.o.", null, "1.720,80", 46070, 46070, 46213, "NDC / Obavijest o korištenju najviše dozvoljene cijene lijeka"],
  ["Abirateron Devatis 500 mg filmom obložene tablete, 60 tableta u blisteru, u kutiji", "abirateronacetat", "L02BX03", "HR-H-315356088-02", "Devatis GmbH", "KONSKOL d.o.o.", null, "1.709,60", 46164, 46214, null, "NDC / Obavijest o korištenju najviše dozvoljene cijene lijeka"],
  ["Abilify Maintena 960 mg suspenzija za injekciju", "ARIPIPRAZOL", "N05AX12", "EU/1/13/882/010", "Otsuka", null, null, 634.24, 46164, 46214, null, "NDC"],
  ["Bez cijene 1 tableta", "x", "", "HR-0", "", null, null, null, 46164, 46214, null, ""],
];

test("hr-halmed parses the real layout, skipping title rows and rows without a price", () => {
  const p = parsePacks(ROWS);
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], { name: "Aban 10 mg filmom obložene tablete, 10 tableta u blisteru, u kutiji", substance: "rivaroksaban", approval: "HR-H-790495386-01", parallel: "", price: 10.53, start: "2026-07-11", end: null });
  assert.equal(p[2].price, 1720.8); // Croatian text format
  assert.equal(p[2].end, "2026-07-10");
});
test("hr-halmed fails loudly when the header is gone", () => {
  assert.throws(() => parsePacks([["a", "b"], [1, 2]]), /format changed/);
});
test("hr-halmed keeps only the price in force today for each pack", () => {
  const p = parsePacks(ROWS);
  const cur = currentPacks(p, "2026-10-24");
  const dev = cur.filter((x) => x.approval === "HR-H-315356088-02");
  assert.equal(dev.length, 1);
  assert.equal(dev[0].price, 1709.6); // the old 1,720.80 ended 2026-07-10
  assert.equal(currentPacks(p, "2026-07-01").find((x) => x.approval === "HR-H-315356088-02")?.price, 1720.8);
  assert.equal(currentPacks(p, "2026-07-01").some((x) => x.approval === "HR-H-790495386-01"), false); // starts 2026-07-11: not in force yet
});
test("hr-halmed parses prices", () => {
  assert.equal(parsePrice("1.720,80"), 1720.8);
  assert.equal(parsePrice("35.6"), 35.6);
  assert.equal(parsePrice(10.53), 10.53);
  assert.ok(Number.isNaN(parsePrice(null)));
});
test("hr-halmed English and Croatian spellings meet", () => {
  for (const [a, b] of [["amoxicillin", "amoksicilin"], ["omeprazole", "omeprazol"], ["levothyroxine", "levotiroksin"], ["diclofenac", "diklofenak"], ["insulin", "inzulin"], ["warfarin", "varfarin"], ["azithromycin", "azitromicin"], ["rivaroxaban", "rivaroksaban"]]) assert.equal(canon(a), canon(b), `${a} vs ${b}`);
  assert.equal(plain("Čađavica ŠŽĆ"), "cadavica szc");
});
test("hr-halmed keys: single substance gets its first word and brand, combinations only the full text", () => {
  const mk = (name: string, substance: string): Pack => ({ name, substance, approval: "x", parallel: "", price: 1, start: null, end: null });
  assert.deepEqual(keysOf(mk("Aban 10 mg tablete", "rivaroksaban")).sort(), [canon("aban"), canon("rivaroksaban")].sort());
  const combo = keysOf(mk("Exforge 5 mg/80 mg", "amlodipin, valsartan"));
  assert.ok(combo.includes("amlodipin valsartan".split(" ").map(canon).join(" ")));
  assert.ok(!combo.includes(canon("amlodipin")));
});
test("hr-halmed publishes only names with 5+ packs", () => {
  const mk = (i: number): Pack => ({ name: `Paracetamol Test ${i} 500 mg tablete`, substance: "paracetamol", approval: `A${i}`, parallel: "", price: 2 + i, start: null, end: null });
  const five = Array.from({ length: 5 }, (_, i) => mk(i));
  const rows = dailyRows(five);
  assert.ok(rows.find((r) => r.item === "name:paracetamol" && r.n === 5));
  assert.equal(dailyRows(five.slice(0, 4)).length, 0);
});
test("hr-halmed finds the newest file on the listing page", () => {
  const html = `<a href="/fdsak3jnFsk1Kfa/ostale_stranice/Zbirni-popis-objavljenih-cijena-lijekova_2023.xlsx">a</a><a href="/fdsak3jnFsk1Kfa/ostale_stranice/Zbirni-popis-objavljenih-cijena-lijekova-7356-svi.xlsx">b</a><a href="/fdsak3jnFsk1Kfa/ostale_stranice/Zbirni-popis-objavljenih-cijena-lijekova-6100-svi.xlsx">c</a><a href="/fdsak3jnFsk1Kfa/ostale_stranice/Godisnji-izracun-cijene-lijeka-za-2023.xlsx">d</a>`;
  assert.equal(latestFile(html), "/fdsak3jnFsk1Kfa/ostale_stranice/Zbirni-popis-objavljenih-cijena-lijekova-7356-svi.xlsx");
  assert.equal(latestFile(`<a href="/x/Zbirni-popis-objavljenih-cijena-lijekova_2023.xlsx">`), "/x/Zbirni-popis-objavljenih-cijena-lijekova_2023.xlsx");
  assert.equal(latestFile("<p>none</p>"), null);
  assert.equal(fileUrl("/a/b.xlsx"), "https://ftp.halmed.hr/a/b.xlsx");
});
test("hr-halmed candidate keys, aliases and the empty question", () => {
  assert.deepEqual(candidateKeys("Omeprazole 20 mg"), [canon("omeprazole"), [canon("omeprazole"), canon("20"), canon("mg")].join(" ")]);
  assert.equal(candidateKeys("aspirin")[0], canon("acetilsalicilna"));
  assert.throws(() => candidateKeys(""), /medicine is required/);
  assert.deepEqual(hrHistoryKey({ medicine: "Paracetamol" }), { area: "ALL", item: "name:paracetamol", label: "paracetamol, Croatia (per pack)" });
  assert.equal(hrHistoryKey({}), null);
});
test("hr-halmed answer says posted wholesale ceiling, never paid", () => {
  const a = hrAnswerFromRow({ date: "2026-10-24", area: "ALL", item: "name:paracetamol", n: 18, median: 3.4, low: 2.1, high: 6.8, min: 1.5, max: 9, }, { key: "paracetamol", today: "2026-10-24" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.sample_size, 18);
  assert.match(a.summary, /wholesale/);
  assert.match(a.summary, /not market transactions/);
  assert.match(a.source.attribution, /HALMED/);
  assert.match(hrAnswerFromRow({ date: "2026-10-01", area: "ALL", item: "x", n: 6, median: 1, low: 1, high: 2, min: 1, max: 2 }, { key: "x", today: "2026-10-24" }).summary, /days old/);
});
