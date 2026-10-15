// Real format, checked live on 2026-10-15 (DESNZ "Solar PV cost data", DNC basis, edition of 28 May 2026, financial year 2025/26).
// The ROWS below are real rows (numbers copied from the workbook); only the older years are left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { priceAnswerSchema } from "../../lib/schemas";
import { xlsxAttachments, monthlySlugs } from "../../lib/gov-uk";
import type { Cell, Sheet } from "../../categories/rent/xlsx";
import { INFO, bandFor, dncWorkbookUrl, fyFromEnd, fyPeriod, parseSolar, solarAnswer, solarRows, solarSelect } from "./source";

const ANNUAL_HEAD: Cell[] = [
  "Financial year", "Number of installations included in analysis", "Number of installations not included in analysis", "Overall coverage [note 2]",
  "0-4 kW - \nNumber of installations included in analysis", "0-4 kW:\nMedian (£/kW)", "0-4 kW:\nMean (£/kW)", "0-4 kW:\nLower CI (£/kW)", "0-4 kW:\nUpper CI (£/kW)",
  "4-10 kW - \nNumber of installations included in analysis", "4-10 kW:\nMedian (£/kW)", "4-10 kW:\nMean (£/kW)", "4-10 kW:\nLower CI (£/kW)", "4-10 kW:\nUpper CI (£/kW)",
  "10-50 kW - \nNumber of installations included in analysis", "10-50 kW:\nMedian (£/kW)", "10-50 kW:\nMean (£/kW)", "10-50 kW:\nLower CI (£/kW)", "10-50 kW:\nUpper CI (£/kW)",
];
const ANNUAL: Cell[][] = [
  ["Annual small scale solar PV installation costs - Declared Net Capacity (DNC)"],
  ["The data in this table are based on Declared Net Capacity - see Cover Sheet for more details"],
  ANNUAL_HEAD,
  ["2024/25", 208049, 6154, 0.97127024364738124, 150432, 1884.24, 2109.87, 2105.09, 2114.64, 50384, 1779.83, 1845.95, 1840.22, 1851.67, 7233, 1257.47, 1365.51, 1352.51, 1378.5],
  ["2025/26", 265682, 7248, 0.97344374015315283, 187554, 1780.25, 2008.32, 2004.02, 2012.63, 68490, 1696.97, 1770.43, 1765.58, 1775.27, 9638, 1262.17, 1344.33, 1333.71, 1354.96],
];
const TYPED_HEAD = (n: string): Cell[] => [
  "Financial year", "Installation Type", n, "Number of installations not included in analysis", "Overall coverage [note 2]", "All installations included in analysis:\nMean (£/kW)",
  "0-4 kW - \nNumber of installations included in analysis", "0-4 kW:\nMean (£/kW)", "4-10 kW - \nNumber of installations included in analysis", "4-10 kW:\nMean (£/kW)",
  "10-50 kW - \nNumber of installations included in analysis", "10-50 kW:\nMean (£/kW)",
];
const DOMESTIC: Cell[][] = [
  ["Annual small scale solar PV installation costs: domestic and non-domestic - Declared Net Capacity (DNC)"],
  TYPED_HEAD("Number of installations included in analysis"),
  ["2024/25", "Domestic", 155159, 3853, 0.97576912434281693, 2063.3000000000002, 105042, 2172.59, 47265, 1857.1, 2852, 1455.32],
  ["2024/25", "Non-domestic", 52890, 2301, 0.95830841985106263, 1893.27, 45390, 1964.72, 3119, 1676.87, 4381, 1307.04],
  ["2025/26", "Domestic", 176894, 3986, 0.97796329057938969, 1962.09, 107137, 2095.5100000000002, 64487, 1785.16, 5270, 1414.71],
  ["2025/26", "Non-domestic", 88788, 3262, 0.9645627376425856, 1844.85, 80417, 1892.17, 4003, 1533.02, 4368, 1259.42],
];
const NEWBUILD: Cell[][] = [
  ["Annual small scale solar PV installation costs: new build and retrofit - Declared Net Capacity (DNC)"],
  TYPED_HEAD("Number of installations included in analysis [note 4]"),
  ["2025/26", "Retrofit (Domestic)", 150600, 3208, 0.97914282742120051, 2022.3, 84047, 2228.4699999999998, 61652, 1790.04, 4901, 1408.35],
  ["2025/26", "New build (Domestic)", 24992, 738, 0.97131752817722505, 1599.23, 22604, 1599.19, 2134, 1612.35, 254, 1492.89],
  ["2025/26", "Retrofit (Total)", 168070, 3828, 0.97773097999976732, 2002.62, 95705, 2202.96, 63850, 1788.05, 8515, 1359.76],
];
const SHEETS: Sheet[] = [
  { name: "Cover sheet", rows: [["Average costs of small-scale solar PV - Declared Net Capacity (DNC)- May 2026"]] },
  { name: "Annual table (DNC)", rows: ANNUAL },
  { name: "Domestic costs (DNC)", rows: DOMESTIC },
  { name: "New build costs (DNC)", rows: NEWBUILD },
];

test("parseSolar reads the latest financial year of the three tables, with the published installation counts", () => {
  const f = parseSolar(SHEETS);
  assert.equal(f.fy, "2025/26");
  assert.deepEqual(f.items["median/all/0-4"], { value: 1780.25, n: 187554 });
  assert.deepEqual(f.items["median/all/10-50"], { value: 1262.17, n: 9638 });
  assert.deepEqual(f.items["mean/domestic/4-10"], { value: 1785.16, n: 64487 });
  assert.deepEqual(f.items["mean/domestic/all"], { value: 1962.09, n: 176894 });
  assert.deepEqual(f.items["mean/non-domestic/0-4"], { value: 1892.17, n: 80417 });
  assert.deepEqual(f.items["mean/newbuild-domestic/0-4"], { value: 1599.19, n: 22604 });
  assert.deepEqual(f.items["mean/retrofit-domestic/10-50"], { value: 1408.35, n: 4901 });
  assert.equal(f.items["mean/domestic/0-4"].value, 2095.51); // 2025/26, not 2024/25
});

test("parseSolar fails loudly when the layout changes", () => {
  assert.throws(() => parseSolar([{ name: "Annual table (DNC)", rows: [["nothing"]] }]), SourceError);
  const broken = SHEETS.map((s) => (s.name.startsWith("Annual") ? { ...s, rows: s.rows.map((r) => r.map((c) => (typeof c === "string" ? c.replace("Median", "Typical") : c))) } : s));
  assert.throws(() => parseSolar(broken), /needs updating/);
});

test("financial years map to dates and back", () => {
  assert.deepEqual(fyPeriod("2025/26"), { from: "2025-04-01", to: "2026-03-31" });
  assert.equal(fyFromEnd("2026-03-31"), "2025/26");
  assert.throws(() => fyPeriod("2025"), SourceError);
});

test("size and dwelling type choose the figure; bad input is an InputError", () => {
  assert.deepEqual(bandFor(undefined), { band: "0-4", assumed: true });
  assert.equal(bandFor(4).band, "0-4");
  assert.equal(bandFor(4.1).band, "4-10");
  assert.equal(bandFor(12).band, "10-50");
  assert.throws(() => bandFor(0), InputError);
  assert.throws(() => bandFor(80), InputError);
  assert.equal(solarSelect({}).key, "median/all/0-4");
  assert.equal(solarSelect({ dwelling_type: "Domestic", size_kw: 6 }).key, "mean/domestic/4-10");
  assert.equal(solarSelect({ dwelling_type: "new build" }).key, "mean/newbuild-domestic/0-4");
  assert.throws(() => solarSelect({ dwelling_type: "castle" }), InputError);
});

test("the answer is an honest official statistic with the published count", () => {
  const a = solarAnswer(parseSolar(SHEETS), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1780.25);
  assert.equal(a.price!.measure, "median");
  assert.equal(a.price!.unit, "per kW installed");
  assert.equal(a.sample_size, 187554);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.reliability, "official_with_count");
  assert.deepEqual(a.period, { from: "2025-04-01", to: "2026-03-31" });
  assert.equal(a.data_as_of, "2026-03-31");
  assert.match(a.summary, /Declared installed cost/);
  assert.doesNotMatch(a.summary, /\bpaid\b/i);
  assert.ok((a.extra as any).size_assumed);
  assert.ok(priceAnswerSchema.safeParse(a).success);
  assert.equal(a.source.licence.startsWith("Open Government Licence v3.0"), true);
  const d = solarAnswer(parseSolar(SHEETS), { dwelling_type: "domestic", size_kw: 6, area: "Leeds" });
  assert.equal(d.price!.measure, "average");
  assert.equal(d.price!.value, 1785.16);
  assert.ok((d.extra as any).area_note);
});

test("library rows keep the true counts and describe the financial year's last day", () => {
  const rows = solarRows(parseSolar(SHEETS));
  const r = rows.find((x) => x.item === "median/all/0-4")!;
  assert.equal(r.n, 187554);
  assert.equal(r.area, "GB");
  assert.ok(rows.every((x) => x.n >= 5 && x.median === x.low && x.median === x.high));
});

test("the DNC workbook is found by its attachment title (GOV.UK content API shape, checked 2026-10-15)", () => {
  const page = {
    details: {
      attachments: [
        { title: "Solar PV cost data: DNC basis (Excel)", url: "https://assets.publishing.service.gov.uk/media/6a1709cc65bc5f798327f404/Solar_Costs_2025-26__DNC_.xlsx", filename: "Solar_Costs_2025-26__DNC_.xlsx" },
        { title: "Solar PV cost data: DNC basis (ODS)", url: "https://assets.publishing.service.gov.uk/media/6a1709d9050971fbebf3bb3a/Solar_Costs_2025-26__DNC_.ods" },
        { title: "Solar PV cost data: TIC basis (Excel)", url: "https://assets.publishing.service.gov.uk/media/6a1709e4050971fbebf3bb3b/Solar_Costs_2025-26__TIC_.xlsx" },
      ],
    },
  };
  assert.match(dncWorkbookUrl(page), /Solar_Costs_2025-26__DNC_\.xlsx$/);
  assert.equal(xlsxAttachments(page).length, 2);
  assert.throws(() => dncWorkbookUrl({ details: { attachments: [] } }), SourceError);
  assert.deepEqual(monthlySlugs("x", new Date("2026-01-10T00:00:00Z"), 2), ["x-december-2025", "x-november-2025"]);
  assert.equal(INFO.id, "gb-desnz-solar-cost");
});
