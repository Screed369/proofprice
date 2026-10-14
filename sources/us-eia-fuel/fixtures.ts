// Real EIA data captured on 2026-10-14 (release date 10/14/2026, newest week 10/12/2026): the header rows and a few weekly rows of the sheets
// "Data 3" (regular), "Data 6" (midgrade), "Data 9" (premium) of https://www.eia.gov/petroleum/gasdiesel/xls/pswrgvwall.xls and "Data 1" (weekly diesel,
// all types) of https://www.eia.gov/petroleum/gasdiesel/xls/psw18vwall.xls, as read by ./xls.ts. Only the weeks the tests need are kept:
// 45943 = 2025-10-13 (a year before the newest week), 46293 = 2026-09-28, 46300 = 2026-10-05, 46307 = 2026-10-12.
// The values are US dollars per gallon, exactly as EIA publishes them. The dnav page https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm shows the same
// national figures for 10/12/26: regular 4.331, midgrade 4.957, premium 5.366, diesel 6.179.

import type { Sheet } from "../../categories/rent/xlsx";

export const GAS_AREA_CODES = [
  "NUS", "R10", "R1X", "R1Y", "R1Z", "R20", "R30", "R40", "R50", "SCA", "SCO", "SFL", "SMA", "SMN", "SNY", "SOH", "STX", "SWA",
  "YBOS", "YORD", "YCLE", "YDEN", "Y44HO", "Y05LA", "YMIA", "Y35NY", "Y05SF", "Y48SE",
];
export const DIESEL_AREA_CODES = ["NUS", "R10", "R1X", "R1Y", "R1Z", "R20", "R30", "R40", "R50", "SCA", "R5XCA"];

function dataSheet(name: string, title: string, seriesPrefix: string, codes: string[], description: string, weeks: number[][]): Sheet {
  return {
    name,
    rows: [
      ["Back to Contents", `${name}: ${title}`],
      ["Sourcekey", ...codes.map((c) => `${seriesPrefix}_PTE_${c}_DPG`)],
      ["Date", description],
      ...weeks,
    ],
  };
}

const REGULAR = dataSheet("Data 3", "Regular All Areas All Formulations", "EMM_EPMR", GAS_AREA_CODES, "Weekly U.S. Regular All Formulations Retail Gasoline Prices  (Dollars per Gallon)", [
  [45943, 3.061, 2.952, 2.98, 3.104, 2.849, 2.812, 2.623, 3.049, 4.213, 4.457, 2.785, 2.872, 2.943, 2.875, 3.055, 2.718, 2.585, 4.357, 2.979, 3.243, 2.797, 2.726, 2.55, 4.45, 2.894, 2.98, 4.488, 4.553],
  [45950, 3.019, 2.902, 2.949, 3.064, 2.787, 2.805, 2.556, 2.997, 4.166, 4.426, 2.756, 2.829, 2.912, 2.855, 3.015, 3.007, 2.511, 4.305, 2.937, 3.181, 2.96, 2.678, 2.498, 4.404, 2.875, 2.933, 4.473, 4.487],
  [46293, 4.465, 4.29, 4.369, 4.411, 4.195, 4.291, 3.924, 4.486, 5.724, 6.189, 4.094, 4.282, 4.316, 4.315, 4.405, 4.263, 3.841, 5.453, 4.341, 4.759, 4.326, 4.033, 3.847, 6.165, 4.301, 4.378, 6.267, 5.677],
  [46300, 4.354, 4.147, 4.343, 4.363, 3.959, 4.109, 3.911, 4.417, 5.727, 6.227, 4.02, 3.97, 4.302, 4.2, 4.38, 3.829, 3.874, 5.424, 4.333, 4.633, 3.859, 3.979, 3.836, 6.209, 4.075, 4.34, 6.306, 5.656],
  [46307, 4.331, 4.118, 4.291, 4.347, 3.929, 4.145, 3.851, 4.439, 5.639, 6.104, 4.175, 3.982, 4.258, 4.184, 4.353, 3.87, 3.779, 5.377, 4.305, 4.695, 3.851, 4.153, 3.762, 6.082, 4.071, 4.314, 6.154, 5.606],
]);

const MIDGRADE = dataSheet("Data 6", "Midgrade All Areas All Formulations", "EMM_EPMM", GAS_AREA_CODES, "Weekly U.S. Midgrade All Formulations Retail Gasoline Prices  (Dollars per Gallon)", [
  [45943, 3.665, 3.455, 3.582, 3.623, 3.325, 3.292, 3.143, 3.362, 4.642, 4.781, 3.164, 3.322, 3.538, 3.204, 3.53, 3.308, 3.097, 4.733, 3.543, 3.881, 3.353, 3.183, 3.18, 4.814, 3.326, 3.557, 4.756, 4.989],
  [46300, 4.99, 4.66, 4.958, 4.901, 4.447, 4.562, 4.423, 4.749, 6.179, 6.51, 4.417, 4.449, 4.916, 4.564, 4.888, 4.411, 4.381, 5.749, 4.911, 5.253, 4.55, 4.467, 4.433, 6.549, 4.551, 4.919, 6.547, 6.123],
  [46307, 4.957, 4.627, 4.934, 4.888, 4.4, 4.605, 4.359, 4.778, 6.098, 6.401, 4.576, 4.442, 4.903, 4.534, 4.855, 4.474, 4.292, 5.721, 4.896, 5.294, 4.593, 4.631, 4.381, 6.432, 4.518, 4.886, 6.396, 6.109],
]);

const PREMIUM = dataSheet("Data 9", "Premium All Areas All Formulations", "EMM_EPMP", GAS_AREA_CODES, "Weekly U.S. Premium All Formulations Retail Gasoline Prices  (Dollars per Gallon)", [
  [45943, 4.026, 3.809, 3.941, 3.92, 3.693, 3.802, 3.472, 3.678, 4.818, 4.926, 3.498, 3.657, 3.889, 3.683, 3.913, 3.868, 3.413, 4.911, 3.887, 4.356, 3.953, 3.485, 3.497, 4.843, 3.648, 3.866, 5.012, 5.085],
  [46300, 5.4, 5.049, 5.34, 5.246, 4.821, 5.23, 4.772, 5.097, 6.376, 6.677, 4.768, 4.784, 5.328, 5.184, 5.313, 5.009, 4.723, 5.959, 5.329, 5.92, 5.192, 4.789, 4.792, 6.635, 4.852, 5.245, 6.785, 6.166],
  [46307, 5.366, 5.017, 5.301, 5.226, 4.78, 5.259, 4.711, 5.106, 6.291, 6.566, 4.904, 4.778, 5.311, 5.147, 5.276, 5.056, 4.638, 5.937, 5.313, 5.98, 5.214, 4.936, 4.729, 6.527, 4.819, 5.21, 6.651, 6.157],
]);

/** A sheet of the gasoline workbook that must be passed over: conventional-areas regular (title only is enough to show it is skipped). */
const CONVENTIONAL: Sheet = { name: "Data 1", rows: [["Back to Contents", "Data 1: Regular Conventional"], ["Sourcekey", "EMM_EPMRU_PTE_NUS_DPG"], ["Date", "x"], [46307, 4.15]] };

const DIESEL = dataSheet("Data 1", "W Diesel Prices - All Types", "EMD_EPD2D", DIESEL_AREA_CODES, "Weekly U.S. No 2 Diesel Retail Prices  (Dollars per Gallon)", [
  [45943, 3.665, 3.721, 3.949, 3.877, 3.639, 3.606, 3.299, 3.658, 4.464, 4.94, 4.052],
  [46293, 6.382, 6.137, 6.51, 6.531, 5.953, 6.526, 5.955, 6.407, 7.357, 8.181, 6.643],
  [46300, 6.199, 5.951, 6.476, 6.485, 5.699, 6.286, 5.819, 6.267, 7.229, 8.082, 6.49],
  [46307, 6.179, 5.908, 6.441, 6.471, 5.645, 6.259, 5.809, 6.302, 7.24, 8.091, 6.503],
]);

const CONTENTS_GAS: Sheet = { name: "Contents", rows: [[], [null, "Workbook Contents"], [null, "U.S. All Grades, Areas and Formulations"], [], [null, "Click worksheet name or tab at bottom for data"]] };
const CONTENTS_DIESEL: Sheet = { name: "Contents", rows: [[], [null, "Workbook Contents"], [null, "U.S. On-Highway Diesel Fuel Prices"]] };

/** pswrgvwall.xls as the xls reader returns it (reduced to the weeks above). */
export const GASOLINE_SHEETS: Sheet[] = [CONTENTS_GAS, CONVENTIONAL, REGULAR, MIDGRADE, PREMIUM];
/** psw18vwall.xls as the xls reader returns it (reduced to the weeks above). */
export const DIESEL_SHEETS: Sheet[] = [CONTENTS_DIESEL, DIESEL];
