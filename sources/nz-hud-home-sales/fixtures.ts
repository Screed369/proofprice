// Fixtures for the HUD "Property and sales statistics" workbook (https://www.hud.govt.nz/stats-and-insights/property-and-sales-statistics/about-the-dashboard).
// Checked live on 2026-10-29 from GitHub's servers: Property-and-Sales-data-download-July-2026.xlsx, 27,663,803 bytes, sheet "Sales" with 170,459 rows.
//
// REAL: the header, the national / Auckland / Wellington City / Christchurch City / Queenstown-Lakes monthly rows for 2025-12 to 2026-07, and the
// July 2026 rows (monthly, 3-month and 12-month) that the collector wrote to the library on that day (national, Wellington City, Auckland City and
// region, Wellington region, Queenstown-Lakes, Christchurch City, Howick), and the first Far North rows of 1980 (counts without prices).
// SYNTHETIC: rows marked SYNTHETIC (Kawerau, Chatham Islands, a 4-sale cell) carry invented numbers; they exist only to test the logic.

import type { Cell } from "./xlsx";
import type { LibraryRow } from "../../lib/library/store";

export const CHECKED = "2026-10-29";
export const HEADER: Cell[] = ["stat_type", "area_type", "area", "period", "residential_sales", "lower_quartile_sale_price", "median_sale_price", "upper_quartile_sale_price"];

/** Excel serial (days since 1899-12-30) of the first of the month, as the workbook stores its dates. */
export const SERIAL: Record<string, number> = {
  "1980-01": 29221, "1980-02": 29252, "1980-04": 29312, "2025-12": 45992, "2026-01": 46023, "2026-02": 46054, "2026-03": 46082,
  "2026-04": 46113, "2026-05": 46143, "2026-06": 46174, "2026-07": 46204,
};
const row = (stat: string, level: string, area: string, p: string, f: (number | null)[]): Cell[] => [stat, level, area, SERIAL[p], ...f];

const MONTHLY: [string, string, string, string, number[]][] = [
  ["Monthly", "National", "New Zealand", "2025-12", [6430, 595000, 766000, 1005000]],
  ["Monthly", "National", "New Zealand", "2026-01", [4436, 566000, 737000, 951000]],
  ["Monthly", "National", "New Zealand", "2026-02", [7037, 587000, 756000, 985000]],
  ["Monthly", "National", "New Zealand", "2026-03", [7984, 589000, 762000, 1015000]],
  ["Monthly", "National", "New Zealand", "2026-04", [6463, 589000, 759000, 989000]],
  ["Monthly", "National", "New Zealand", "2026-05", [6548, 585000, 761000, 990000]],
  ["Monthly", "National", "New Zealand", "2026-06", [5932, 572000, 747000, 967500]],
  ["Monthly", "National", "New Zealand", "2026-07", [5654, 569000, 738000, 950000]],
  ["3-Month rolling", "National", "New Zealand", "2026-07", [18134, 577000, 750000, 970000]],
  ["12-Month rolling", "National", "New Zealand", "2026-07", [80128, 583700, 755000, 980000]],
  ["Monthly", "Region", "Auckland", "2026-07", [1662, 738695, 921000, 1247000]],
  ["Monthly", "Region", "Wellington", "2026-07", [509, 572000, 724000, 890000]],
  ["Monthly", "Territorial Authority", "Wellington City", "2026-07", [162, 639000, 810000, 1007000]],
  ["3-Month rolling", "Territorial Authority", "Wellington City", "2026-07", [529, 670000, 825000, 1044000]],
  ["12-Month rolling", "Territorial Authority", "Wellington City", "2026-07", [2432, 700500, 847000, 1070000]],
  ["Monthly", "Territorial Authority", "Christchurch City", "2026-07", [592, 559000, 669000, 851000]],
  ["Monthly", "Territorial Authority", "Queenstown-Lakes District", "2026-07", [54, 1175000, 1450000, 2170000]],
  // SYNTHETIC: a small district whose July sales (4) are too few to publish, and one with sales but no prices (HUD leaves them blank)
  ["Monthly", "Territorial Authority", "Kawerau District", "2026-07", [4, 300000, 350000, 400000]],
  ["Monthly", "Territorial Authority", "Chatham Islands", "2026-07", [6, null as unknown as number, null as unknown as number, null as unknown as number]],
];

/** The sheet as readSheet returns it: header first, then rows; blank cells are null. */
export const SALES_ROWS: Cell[][] = [
  HEADER,
  // REAL: the earliest rows of the sheet, sales counts without prices
  ["Monthly", "Territorial Authority", "Far North District", 29221, 2],
  ["Monthly", "Territorial Authority", "Far North District", 29252, 1],
  ["Monthly", "Territorial Authority", "Far North District", 29312, 1],
  ...MONTHLY.map(([stat, level, area, p, f]) => row(stat, level, area, p, f)),
  // regions that make the national July count (5654) add up: Auckland 1662 + Wellington 509 + the rest (SYNTHETIC remainder)
  row("Monthly", "Region", "Rest of New Zealand", "2026-07", [5654 - 1662 - 509, 400000, 500000, 600000]),
];

/** Library rows as the collector wrote them for 2026-07-31 (REAL values, see above). */
const LIB: [string, string, number, number, number, number][] = [
  ["national", "12m/2026-07", 80128, 755000, 583700, 980000],
  ["national", "1m/2026-07", 5654, 738000, 569000, 950000],
  ["national", "3m/2026-07", 18134, 750000, 577000, 970000],
  ["ta|Wellington City", "12m/2026-07", 2432, 847000, 700500, 1070000],
  ["ta|Wellington City", "1m/2026-07", 162, 810000, 639000, 1007000],
  ["ta|Wellington City", "3m/2026-07", 529, 825000, 670000, 1044000],
  ["ta|Auckland City", "12m/2026-07", 23057, 948000, 757000, 1296000],
  ["ta|Auckland City", "1m/2026-07", 1662, 921000, 738695, 1247000],
  ["ta|Auckland City", "3m/2026-07", 5426, 939000, 753000, 1281000],
  ["region|Auckland", "12m/2026-07", 23057, 948000, 757000, 1296000],
  ["region|Auckland", "1m/2026-07", 1662, 921000, 738695, 1247000],
  ["region|Auckland", "3m/2026-07", 5426, 939000, 753000, 1281000],
  ["region|Wellington", "12m/2026-07", 7314, 753000, 597000, 922000],
  ["region|Wellington", "1m/2026-07", 509, 724000, 572000, 890000],
  ["region|Wellington", "3m/2026-07", 1608, 745000, 587000, 915000],
  ["ta|Queenstown-Lakes District", "12m/2026-07", 1131, 1390000, 1055000, 1835000],
  ["ta|Queenstown-Lakes District", "1m/2026-07", 54, 1450000, 1175000, 2170000],
  ["ta|Queenstown-Lakes District", "3m/2026-07", 207, 1450000, 1100000, 1985000],
  ["ta|Christchurch City", "12m/2026-07", 9001, 694500, 576000, 875000],
  ["ta|Christchurch City", "1m/2026-07", 592, 669000, 559000, 851000],
  ["ta|Christchurch City", "3m/2026-07", 1882, 693000, 571000, 874000],
  ["board|Howick", "12m/2026-07", 2285, 1160000, 902000, 1414000],
  ["board|Howick", "1m/2026-07", 129, 1032000, 833000, 1330000],
  ["board|Howick", "3m/2026-07", 492, 1130000, 869000, 1367000],
  // SYNTHETIC: a district with a 12-month figure only (its monthly and 3-month prices are blank in the file), and a Tasman region next to a Tasman district
  ["ta|Kawerau District", "12m/2026-07", 61, 410000, 340000, 480000],
  ["ta|Taupō District", "12m/2026-07", 740, 640000, 520000, 800000],
  ["ta|Taupō District", "3m/2026-07", 190, 650000, 530000, 810000],
  ["ta|Tasman District", "12m/2026-07", 500, 800000, 600000, 1000000],
  ["region|Tasman", "12m/2026-07", 520, 790000, 590000, 990000],
];
export const LIBRARY_ROWS: LibraryRow[] = LIB.map(([area, item, n, median, low, high]) => ({ date: "2026-07-31", area, item, n, median, low, high, min: low, max: high }));

export const ABOUT_HTML =
  '<html><body><a href="/stats-and-insights/other">other</a> <a class="btn" href="/assets/Property-and-Sales-data-download-July-2026.xlsx?m=e141007c9ceaea6c61ca3f7d76ad900682f583d8">Download the data</a></body></html>';
