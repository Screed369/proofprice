// Real EIA values captured on 2026-10-21 through the GitHub-hosted probe (see CLAUDE.md), in the shape readXlsx returns.
//
// ELECTRICITY_SHEETS: https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx (Electric Power Monthly, table 5.6.A, July 2026 and July 2025): the title, sector and
// month heading rows and every division and state row. Values are cents per kilowatthour; "--" = not published. Source line of the file: Form EIA-861M (formerly EIA-826).
//
// GAS_COMMERCIAL_HTML: https://www.eia.gov/dnav/ng/ng_pri_sum_a_EPG0_PCS_DMcf_m.htm (Natural Gas Prices, Commercial Price, monthly, dollars per thousand cubic feet), release date
// 9/30/2026. Cut down to the title, the month heading row, the rows of seven areas exactly as served, and the notes with the release dates.
// Not imported by any runtime code.

import type { Sheet } from "../../categories/rent/xlsx";

export const ELECTRICITY_SHEETS: Sheet[] = [
  {
    name: "Table_5_06_A",
    rows: [
      ["Table 5.6.A. Average Price of Electricity to Ultimate Customers by End-Use Sector,"],
      ["by State, July 2026 and 2025 (Cents per Kilowatthour)"],
      ["", "Residential", null, "Commercial", null, "Industrial", null, "Transportation", null, "All Sectors"],
      ["Census Division\r\nand State", "July 2026", "July 2025", "July 2026", "July 2025", "July 2026", "July 2025", "July 2026", "July 2025", "July 2026", "July 2025"],
      ["and State", "July 2026", "July 2025", "July 2026", "July 2025", "July 2026", "July 2025", "July 2026", "July 2025", "July 2026", "July 2025"],
      ["New England", 28.0, 27.89, 22.6, 22.48, 17.97, 18.1, 11.07, 12.99, 24.5, 24.47],
      ["Connecticut", 24.16, 27.6, 19.87, 22.86, 17.29, 18.59, 13.55, 17.48, 21.91, 25.02],
      ["Maine", 32.41, 27.98, 21.64, 21.08, 13.94, 15.71, "--", "--", 23.85, 22.89],
      ["Massachusetts", 30.49, 30.07, 24.41, 23.26, 20.25, 19.93, 9.2, 9.42, 26.56, 25.85],
      ["New Hampshire", 26.6, 22.79, 20.63, 19.74, 18.17, 16.75, "--", "--", 23.14, 20.77],
      ["Rhode Island", 28.29, 26.18, 23.43, 22.22, 22.86, 21.31, 23.08, 23.06, 25.65, 23.84],
      ["Vermont", 23.75, 22.14, 20.71, 19.39, 13.07, 12.23, "--", "--", 20.17, 18.95],
      ["Middle Atlantic", 25.71, 23.53, 20.14, 19.08, 11.41, 10.35, 15.84, 16.54, 21.04, 19.47],
      ["New Jersey", 25.19, 25.32, 19.17, 18.36, 15.63, 14.92, 12.85, 12.04, 21.89, 21.56],
      ["New York", 29.9, 26.22, 24.18, 23.05, 10.81, 10.06, 17.24, 18.49, 25.18, 23.01],
      ["Pennsylvania", 21.72, 19.51, 13.86, 12.63, 11.04, 9.87, 10.71, 9.87, 16.22, 14.61],
      ["East North Central", 19.57, 17.8, 14.65, 13.29, 10.49, 9.53, 11.59, 7.63, 15.26, 13.95],
      ["Illinois", 19.22, 17.22, 15.19, 13.66, 11.87, 10.64, 11.4, 7.05, 15.89, 14.28],
      ["Indiana", 16.73, 16.18, 13.3, 14.07, 9.16, 9.21, 13.65, 14.89, 12.92, 13.04],
      ["Michigan", 23.05, 20.55, 16.46, 14.96, 9.81, 8.94, 16.96, 13.91, 17.43, 15.7],
      ["Ohio", 19.45, 17.38, 14.06, 11.5, 10.95, 9.05, 11.58, 10.72, 15.09, 13.1],
      ["Wisconsin", 19.06, 18.25, 13.93, 13.37, 10.46, 9.86, 21.01, 17.3, 14.69, 14.02],
      ["West North Central", 15.89, 15.26, 11.96, 11.7, 9.65, 8.95, 14.63, 14.03, 12.76, 12.25],
      ["Iowa", 15.99, 15.31, 13.27, 13.18, 9.99, 9.07, "--", "--", 12.63, 11.89],
      ["Kansas", 15.27, 14.46, 12.04, 11.68, 8.52, 8.07, "--", "--", 12.53, 11.9],
      ["Minnesota", 17.45, 16.92, 13.49, 13.17, 10.34, 9.77, 14.19, 13.56, 14.17, 13.69],
      ["Missouri", 16.09, 15.56, 12.64, 12.21, 9.87, 9.46, 14.85, 14.31, 13.91, 13.47],
      ["Nebraska", 13.78, 12.84, 9.39, 9.57, 10.0, 9.0, "--", "--", 10.83, 10.45],
      ["North Dakota", 13.41, 13.31, 8.22, 7.79, 8.21, 7.62, "--", "--", 9.09, 8.56],
      ["South Dakota", 15.37, 14.52, 12.17, 11.72, 9.83, 9.33, "--", "--", 12.86, 12.29],
      ["South Atlantic", 16.12, 15.28, 12.26, 11.52, 9.25, 9.14, 13.84, 10.48, 13.69, 13.0],
      ["Delaware", 18.48, 16.58, 13.8, 12.54, 11.71, 11.09, "--", "--", 15.64, 14.3],
      ["District of Columbia", 25.21, 23.04, 23.88, 20.7, 32.15, 20.21, 14.69, 9.8, 24.03, 21.0],
      ["Florida", 15.03, 15.11, 11.37, 11.3, 9.17, 8.91, 11.17, 10.5, 13.36, 13.33],
      ["Georgia", 16.27, 15.56, 12.54, 12.49, 10.03, 10.87, 10.41, 11.6, 13.75, 13.59],
      ["Maryland", 21.41, 18.83, 17.51, 15.14, 16.21, 13.66, 15.66, 12.29, 19.35, 16.86],
      ["North Carolina", 15.16, 13.37, 10.73, 9.75, 8.37, 7.77, 10.39, 9.23, 12.49, 11.19],
      ["South Carolina", 15.47, 14.7, 11.61, 10.97, 7.84, 7.88, "--", "--", 12.36, 11.84],
      ["Virginia", 17.55, 15.78, 11.68, 10.21, 10.07, 9.7, 12.22, 8.43, 13.49, 12.2],
      ["West Virginia", 15.78, 15.43, 11.44, 11.19, 8.4, 7.98, "--", "--", 11.66, 11.48],
      ["East South Central", 14.61, 13.99, 13.49, 12.97, 7.74, 7.61, "--", "--", 12.29, 11.91],
      ["Alabama", 16.4, 15.93, 14.83, 14.59, 8.42, 8.12, "--", "--", 13.32, 13.03],
      ["Kentucky", 13.81, 13.13, 11.95, 11.64, 7.51, 7.31, "--", "--", 11.18, 10.83],
      ["Mississippi", 14.54, 13.58, 13.65, 12.73, 7.66, 7.61, "--", "--", 12.22, 11.63],
      ["Tennessee", 13.71, 13.21, 13.43, 12.81, 7.13, 7.24, "--", "--", 12.21, 11.87],
      ["West South Central", 15.21, 14.71, 9.1, 9.35, 7.07, 6.72, 11.54, 7.3, 10.84, 10.5],
      ["Arkansas", 14.33, 13.26, 11.76, 10.61, 7.84, 7.24, 15.31, 13.71, 11.27, 10.4],
      ["Louisiana", 12.72, 13.12, 10.97, 11.59, 6.08, 6.91, 11.5, 11.24, 9.74, 10.37],
      ["Oklahoma", 14.35, 13.52, 10.32, 9.92, 8.16, 6.72, "--", "--", 11.39, 10.41],
      ["Texas", 15.88, 15.36, 8.47, 8.85, 7.07, 6.61, 7.75, 3.77, 10.91, 10.55],
      ["Mountain", 14.92, 14.59, 12.14, 12.13, 8.38, 8.58, 11.35, 11.12, 12.36, 12.2],
      ["Arizona", 15.38, 15.34, 13.12, 13.42, 9.35, 9.27, 17.7, 13.49, 13.74, 13.86],
      ["Colorado", 17.0, 15.99, 13.81, 13.25, 9.54, 9.53, 10.22, 10.03, 14.2, 13.45],
      ["Idaho", 13.73, 12.28, 10.16, 9.59, 9.02, 8.24, "--", "--", 10.87, 9.83],
      ["Montana", 14.99, 14.27, 13.33, 12.83, 7.71, 7.71, "--", "--", 12.33, 11.76],
      ["Nevada", 12.77, 12.39, 9.72, 10.14, 10.04, 9.83, 9.41, 9.56, 11.15, 11.02],
      ["New Mexico", 16.09, 15.8, 11.9, 12.46, 4.16, 5.74, "--", "--", 9.52, 10.38],
      ["Utah", 13.12, 13.45, 10.85, 10.44, 9.1, 9.4, 12.11, 12.64, 11.45, 11.38],
      ["Wyoming", 14.36, 14.64, 10.26, 10.16, 8.62, 8.93, "--", "--", 10.14, 10.25],
      ["Pacific Contiguous", 27.14, 25.99, 23.94, 23.62, 18.01, 17.75, 17.7, 16.61, 23.96, 23.29],
      ["California", 33.61, 32.66, 30.56, 30.08, 25.11, 25.27, 18.42, 17.38, 30.71, 30.12],
      ["Oregon", 15.97, 15.61, 10.6, 10.59, 8.92, 8.59, 14.32, 13.53, 11.78, 11.63],
      ["Washington", 14.71, 13.45, 11.78, 11.24, 7.51, 7.21, 13.43, 12.21, 12.05, 11.25],
      ["Pacific Noncontiguous", 40.76, 34.77, 34.32, 29.38, 35.55, 27.25, "--", "--", 36.71, 30.31],
      ["Alaska", 28.83, 27.3, 23.29, 22.98, 24.81, 19.4, "--", "--", 25.41, 23.42],
      ["Hawaii", 48.0, 39.36, 43.63, 35.06, 39.33, 30.29, "--", "--", 43.28, 34.51],
      ["U.S. Total", 18.31, 17.45, 14.53, 14.05, 9.77, 9.33, 14.97, 14.27, 14.99, 14.36],
    ],
  },
];

export const GAS_COMMERCIAL_HTML = "<html><head>\n\t<title>Average Commercial Price </title>\n</head><body>\n<table>\n<tr>\n<th class=\"Series4\">Area</th>\n<th class=\"Series5\">Feb-26</th>\n    <th class=\"Series5\">Mar-26</th>\n    <th class=\"Series5\">Apr-26</th>\n    <th class=\"Series5\">May-26</th>\n    <th class=\"Series5\">Jun-26</th>\n    <th class=\"Series5\">Jul-26</th>\n    <th class=\"Cross\">View<br>History</th>  \n</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"3\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\"><B>U.S.<B></td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.34</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.26</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.21</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.17</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.71</td>\n\t\t\t<td width=\"76\" class=\"Current2\">13.03</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020us3m.htm\" class=\"Hist\">1973-2026</a></td>\t\t\t\t\n\t\t</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"23\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\">California</td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">17.80</td>\n\t\t\t<td width=\"76\" class=\"DataB\">16.29</td>\n\t\t\t<td width=\"76\" class=\"DataB\">NA</td>\n\t\t\t<td width=\"76\" class=\"DataB\">NA</td>\n\t\t\t<td width=\"76\" class=\"DataB\">14.00</td>\n\t\t\t<td width=\"76\" class=\"Current2\">15.20</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020ca3m.htm\" class=\"Hist\">1989-2026</a></td>\t\t\t\t\n\t\t</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"23\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\">District of Columbia</td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">14.98</td>\n\t\t\t<td width=\"76\" class=\"DataB\">16.26</td>\n\t\t\t<td width=\"76\" class=\"DataB\">17.54</td>\n\t\t\t<td width=\"76\" class=\"DataB\">15.78</td>\n\t\t\t<td width=\"76\" class=\"DataB\">16.96</td>\n\t\t\t<td width=\"76\" class=\"Current2\">18.31</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020dc3m.htm\" class=\"Hist\">1989-2026</a></td>\t\t\t\t\n\t\t</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"23\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\">New York</td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">14.00</td>\n\t\t\t<td width=\"76\" class=\"DataB\">13.12</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.84</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.37</td>\n\t\t\t<td width=\"76\" class=\"DataB\">11.41</td>\n\t\t\t<td width=\"76\" class=\"Current2\">11.21</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020ny3m.htm\" class=\"Hist\">1989-2026</a></td>\t\t\t\t\n\t\t</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"23\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\">Texas</td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.97</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.72</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.40</td>\n\t\t\t<td width=\"76\" class=\"DataB\">13.08</td>\n\t\t\t<td width=\"76\" class=\"DataB\">12.72</td>\n\t\t\t<td width=\"76\" class=\"Current2\">12.60</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020tx3m.htm\" class=\"Hist\">1989-2026</a></td>\t\t\t\t\n\t\t</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"23\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\">Wyoming</td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">7.90</td>\n\t\t\t<td width=\"76\" class=\"DataB\">8.22</td>\n\t\t\t<td width=\"76\" class=\"DataB\">8.58</td>\n\t\t\t<td width=\"76\" class=\"DataB\">8.72</td>\n\t\t\t<td width=\"76\" class=\"DataB\">9.25</td>\n\t\t\t<td width=\"76\" class=\"Current2\">10.09</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020wy3m.htm\" class=\"Hist\">1989-2026</a></td>\t\t\t\t\n\t\t</tr>\n<tr class=\"DataRow\">\n\t\t\t<td width=\"228\" class=\"DataStub\">\n\t\t\t\t<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\" class=\"data2\">\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<td width=\"23\"></td>\n\t\t\t\t\t\t<td class=\"DataStub1\">Hawaii</td>\n\t\t\t\t\t</tr>\n\t\t\t\t</table>\n\t\t\t</td>\n\t\t\t<td width=\"76\" class=\"DataB\">NA</td>\n\t\t\t<td width=\"76\" class=\"DataB\">44.89</td>\n\t\t\t<td width=\"76\" class=\"DataB\">55.98</td>\n\t\t\t<td width=\"76\" class=\"DataB\">NA</td>\n\t\t\t<td width=\"76\" class=\"DataB\">52.96</td>\n\t\t\t<td width=\"76\" class=\"Current2\">50.11</td>\n\t\t\t<td width=\"76\" class=\"DataHist\"><a href=\"./hist/n3020hi3m.htm\" class=\"Hist\">1989-2026</a></td>\t\t\t\t\n\t\t</tr>\n</table>\n<table><tr><td class=\"Footnotes\"><span class=\"FNlabel\">-</span> = No Data Reported;&nbsp; <span class=\"FNlabel\">--</span> = Not Applicable;&nbsp; <span class=\"FNlabel\">NA</span> = Not Available;&nbsp; <span class=\"FNlabel\">W</span> = Withheld to avoid disclosure of individual company data. </td> </tr> <tr> <td height=\"5\"></td> </tr> <tr> <td class=\"Footnotes\"> <span class=\"FNlabel\">Notes:</span> Prices are in nominal dollars. (notes cut down for this fixture) </td> </tr> <tr> <td height=\"5\"></td> </tr> <tr> <td class=\"Footnotes\">Release Date: 9/30/2026</td></tr></table>\n</body></html>\n";
