// Real format, checked live on 2026-10-15 (DESNZ Boiler Upgrade Scheme statistics, "August 2026", published 24 September 2026; table Q1.1A
// runs to 2026 Q2). The ROWS below are real rows (numbers copied from the workbook); only the quarters before 2025 Q3 are left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { priceAnswerSchema } from "../../lib/schemas";
import type { Cell, Sheet } from "../../categories/rent/xlsx";
import { INFO, busAnswer, busRows, busTech, busWorkbookUrl, notPublished, parseBus, quarterFromEnd, quarterPeriod } from "./source";

const Q = ["2025 Q3:\nJul to Sep", "2025 Q4:\nOct to Dec", "2026 Q1:\nJan to Mar", "2026 Q2:\nApr to Jun"];
const HEAD: Cell[] = ["Technology type", "Measure", ...Q];
const ROWS: Cell[][] = [
  ["Table Q1.1A - Median, lower quartile and upper quartile reported cost (£) and capacity (kW) of redemptions paid by technology type and quarter, England and Wales, May 2022 to June 2026"],
  ["The symbol [c1] is used to indicate cases where there are between 1 and 4 data points inclusive."],
  HEAD,
  ["Air-to-Water Heat Pump", "Median capacity of installation (kW)", 8, 8.4, 8.1, 8],
  ["Air-to-Water Heat Pump", "Median cost of installation (£)", 13000, 13440, 13100, 12908],
  ["Air-to-Water Heat Pump", "Lower quartile cost of installation (£)", 10863, 11459, 11350, 11128],
  ["Air-to-Water Heat Pump", "Upper quartile cost of installation (£)", 15580, 16029, 15761, 15627],
  ["Air-to-Air Heat Pump", "Median cost of installation (£)", "[x]", "[x]", "[x]", "[x]"],
  ["Ground Source Heat Pump", "Median capacity of installation (kW)", 12, 13, 13, 10.5],
  ["Ground Source Heat Pump", "Median cost of installation (£)", 27490, 26841, 27352, 27232],
  ["Ground Source Heat Pump", "Lower quartile cost of installation (£)", 17938, 20510, 20000, 18136],
  ["Ground Source Heat Pump", "Upper quartile cost of installation (£)", 40775, 37626, 39737, 42110],
  ["Shared Ground Loop Ground Source Heat Pump", "Median cost of installation (£)", "[c1]", "[c1]", "[c1]", "[c1]"],
  ["Biomass boiler", "Median cost of installation (£)", 18775, 15534, 16136, 13765],
];
const SHEETS: Sheet[] = [{ name: "Cover Sheet", rows: [["Boiler Upgrade Scheme (BUS) monthly statistics"]] }, { name: "Q1.1A", rows: ROWS }];

test("parseBus reads the latest quarter and drops suppressed cells", () => {
  const q = parseBus(SHEETS);
  assert.equal(q.quarter, "2026 Q2");
  assert.equal(q.items["air_to_water/median"], 12908);
  assert.equal(q.items["air_to_water/lq"], 11128);
  assert.equal(q.items["air_to_water/uq"], 15627);
  assert.equal(q.items["air_to_water/kw"], 8);
  assert.equal(q.items["ground_source/median"], 27232);
  assert.equal(q.items["biomass_boiler/median"], 13765);
  assert.ok(!Object.keys(q.items).some((k) => k.startsWith("air_to_air") || k.includes("shared")));
});

test("parseBus fails loudly on a changed layout", () => {
  assert.throws(() => parseBus([{ name: "Other", rows: [] }]), SourceError);
  assert.throws(() => parseBus([{ name: "Q1.1A", rows: [["nothing"]] }]), /needs updating/);
  assert.throws(() => parseBus([{ name: "Q1.1A", rows: [HEAD, ["Biomass boiler", "Median cost of installation (£)", "[c1]", "[c1]", "[c1]", "[c1]"]] }]), /needs updating/);
});

test("quarters map to dates and back", () => {
  assert.deepEqual(quarterPeriod("2026 Q2"), { from: "2026-04-01", to: "2026-06-30" });
  assert.deepEqual(quarterPeriod("2025 Q1"), { from: "2025-01-01", to: "2025-03-31" });
  assert.equal(quarterFromEnd("2026-06-30"), "2026 Q2");
  assert.throws(() => quarterPeriod("June 2026"), SourceError);
});

test("an air-to-water answer is an official median with no sample size, quartiles in extra", () => {
  const a = busAnswer(parseBus(SHEETS), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 12908);
  assert.equal(a.price!.unit, "per installation");
  assert.equal(a.price!.typical_low, null); // quartiles are not 10th/90th percentiles
  assert.equal(a.price!.typical_high, null);
  assert.equal((a.extra as any).lower_quartile, 11128);
  assert.equal((a.extra as any).upper_quartile, 15627);
  assert.equal(a.sample_size, null);
  assert.equal(a.confidence, "high"); // unchanged field
  assert.equal(a.reliability, "official_median_no_count"); // the honest one
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.match(a.summary, /Reported installed cost/);
  assert.doesNotMatch(a.summary, /\bpaid\b/i);
  assert.match(String((a.extra as any).grant_note), /7,500/);
  assert.ok(priceAnswerSchema.safeParse(a).success);
  const g = busAnswer(parseBus(SHEETS), { technology: "ground source", dwelling_type: "flat", area: "Leeds" });
  assert.equal(g.price!.value, 27232);
  assert.ok((g.extra as any).dwelling_type_note && (g.extra as any).area_note);
});

test("a suppressed or unknown technology is no_matches or an InputError, never a guess", () => {
  const q: ReturnType<typeof parseBus> = { quarter: "2026 Q2", items: { "air_to_water/median": 12908 } };
  const a = busAnswer(q, { technology: "biomass boiler" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.reliability, "insufficient_data");
  assert.match(a.summary, /suppressed/);
  assert.throws(() => busTech("steam"), InputError);
  assert.equal(busTech(undefined), "air_to_water");
});

test("library rows use the placeholder count (the source sets nominalCounts) and one national area", () => {
  const rows = busRows(parseBus(SHEETS));
  assert.ok(rows.every((r) => r.n === 5 && r.area === "EW" && r.median === r.low));
  assert.ok(rows.some((r) => r.item === "air_to_water/median" && r.median === 12908));
});

test("other measures get an honest no_matches answer", () => {
  const a = notPublished("wall_insulation");
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /No open official cost statistic/);
  assert.equal((a.extra as any).reason, "not_published");
  assert.ok(priceAnswerSchema.safeParse(a).success);
});

test("the workbook is the Excel attachment of the release page (GOV.UK content API shape, checked 2026-10-15)", () => {
  const page = {
    details: {
      attachments: [
        { title: "Boiler Upgrade Scheme Statistics: August 2026 (Excel)", url: "https://assets.publishing.service.gov.uk/media/6ab10b644c0f475de0a66aa4/Boiler_Upgrade_Scheme_BUS_Statistics_August_2026.xlsx", filename: "Boiler_Upgrade_Scheme_BUS_Statistics_August_2026.xlsx" },
        { title: "Boiler Upgrade Scheme Statistics: August 2026 (ODS)", url: "https://assets.publishing.service.gov.uk/media/6ab10b7644ec1aa417346d30/Boiler_Upgrade_Scheme_BUS_Statistics_August_2026.ods" },
      ],
    },
  };
  assert.match(busWorkbookUrl(page), /BUS_Statistics_August_2026\.xlsx$/);
  assert.throws(() => busWorkbookUrl({ details: { attachments: [] } }), SourceError);
  assert.equal(INFO.id, "gb-bus-stats");
  assert.match(INFO.licence, /Open Government Licence v3\.0/);
});
