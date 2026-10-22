// EIA heating oil workbook W_EPD2F_PRS_NUS_DPGw.xls, sheet "Data 1", as ./../us-eia-fuel/xls.ts returns it, reduced to a few weeks.
// Heating oil values are REAL: the weekly rows of the series page https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=pet&s=w_epd2f_prs_nus_dpg&f=w read on 21 Oct 2026
// (1996-10-21 1.131, 1996-10-28 1.133, 1996-11-04 1.126, 1996-11-11 1.124). The year-earlier weeks (1995) and the propane values are SYNTHETIC test numbers
// (marked below), because only the layout, not those cells, was seen; the layout (rows "Sourcekey", "Date", Excel date serials) is the one every dnav history
// workbook has (identical to the gasoline and diesel fixtures of us-eia-fuel).
// Excel serials: 35002 = 1995-10-30, 35016 = 1995-11-13, 35359 = 1996-10-21, 35366 = 1996-10-28, 35373 = 1996-11-04, 35380 = 1996-11-11.

import type { Sheet } from "../../categories/rent/xlsx";

const CONTENTS = (title: string): Sheet => ({ name: "Contents", rows: [[], [null, "Workbook Contents"], [null, title]] });

export const HEATING_OIL_SHEETS: Sheet[] = [
  CONTENTS("U.S. Residential Heating Oil Price"),
  {
    name: "Data 1",
    rows: [
      ["Back to Contents", "Data 1: Weekly U.S. Residential Heating Oil Price  (Dollars per Gallon)"],
      ["Sourcekey", "W_EPD2F_PRS_NUS_DPG"],
      ["Date", "Weekly U.S. Residential Heating Oil Price  (Dollars per Gallon)"],
      [35002, 1.1], // synthetic
      [35016, 1.12], // synthetic
      [35359, 1.131],
      [35366, 1.133],
      [35373, 1.126],
      [35380, 1.124],
    ],
  },
];

// Synthetic propane values (layout as above).
export const PROPANE_SHEETS: Sheet[] = [
  CONTENTS("U.S. Residential Propane Price"),
  {
    name: "Data 1",
    rows: [
      ["Back to Contents", "Data 1: Weekly U.S. Propane Residential Price  (Dollars per Gallon)"],
      ["Sourcekey", "W_EPLLPA_PRS_NUS_DPG"],
      ["Date", "Weekly U.S. Propane Residential Price  (Dollars per Gallon)"],
      [35002, 1.2],
      [35016, 1.25],
      [35359, 1.3],
      [35366, 1.31],
      [35373, 1.33],
      [35380, 1.35],
    ],
  },
];
