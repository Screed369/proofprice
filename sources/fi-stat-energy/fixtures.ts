// Table 13rb "Price of electricity by type of consumer" (Statistics Finland, pxdata.stat.fi). The METADATA (variables, codes, labels) is real: probe fi13rb1 of 2026-10-23.
// The data reply is a POST and cannot be probed; this fixture follows the PxWeb json-stat2 layout used by the same API for table 13mu (see sources/fi-home-prices)
// with dimension ids and category codes from the real metadata. The NUMBERS are SYNTHETIC (invented, c/kWh) and test parsing and arithmetic only.
// Dimension order: timeperiod_m, energia_48_20220905 (A energy, B distribution, C taxes, SSS total), energia_49_20220905 (A..E households), contentscode.
const months = ["2025M05", "2025M06", "2026M05", "2026M06"];
const parts = ["A", "B", "C", "SSS"];
const types = ["A", "B", "C", "D", "E"];
// per (month, part, type) in c/kWh; the total is energy + distribution + taxes
const base: Record<string, number[]> = {
  A: [8, 7, 6, 5, 5], // energy
  B: [9, 6, 5, 4, 3], // distribution
  C: [4, 3, 2.5, 2, 2], // taxes
};
const factor = [1.0, 1.1, 1.2, 1.5]; // per month
const value: Array<number | null> = [];
months.forEach((_, mi) => {
  parts.forEach((p) => {
    types.forEach((_t, ti) => {
      if (p === "SSS") {
        const sum = (["A", "B", "C"] as const).reduce((a, k) => a + Math.round(base[k][ti] * factor[mi] * 100) / 100, 0);
        value.push(Math.round(sum * 100) / 100);
      } else value.push(Math.round(base[p][ti] * factor[mi] * 100) / 100);
    });
  });
});
// Band E (> 15,000 kWh) has no tax part in the newest month in this synthetic cube: a missing cell, to test that it is left out.
const tIdx = 3 * 20 + 2 * 5 + 4; // month 3, part C, type E
value[tIdx] = null;
const sIdx = 3 * 20 + 3 * 5 + 4; // total for E in the newest month is also missing
value[sIdx] = null;

const cat = (codes: string[], labels: string[]) => ({ index: Object.fromEntries(codes.map((c, i) => [c, i])), label: Object.fromEntries(codes.map((c, i) => [c, labels[i]])) });
export const SYNTHETIC_JSON = {
  version: "2.0",
  class: "dataset",
  label: "Price of electricity by type of consumer by Month, Price component, Type of consumer and Information",
  source: "Statistics Finland",
  updated: "2026-09-23T06:00:00Z",
  id: ["timeperiod_m", "energia_48_20220905", "energia_49_20220905", "contentscode"],
  size: [4, 4, 5, 1],
  dimension: {
    timeperiod_m: { label: "Month", category: cat(months, months) },
    energia_48_20220905: { label: "Price component", category: cat(parts, ["Electric energy (excluding tax)", "Distribution price (excluding tax)", "Taxes (electricity tax and VAT)", "Total price"]) },
    energia_49_20220905: { label: "Type of consumer", category: cat(types, ["Household customer, annual consumption < 1 000 kW", "Household customer, annual consumption 1 000 kWh - 2 499 kWh", "Household customer, annual consumption 2 500 kWh - 4 999 kWh", "Household customer, annual consumption 5 000 kWh - 15 000 kWh", "Household customer, annual consumption > 15 000 kWh"]) },
    contentscode: { label: "Information", category: cat(["hinta_snt_kwh"], ["Price (c/kWh)"]) },
  },
  value,
};
