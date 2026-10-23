// Real reply from Statistics Netherlands (CBS) StatLine table 85666NED "Eindverbruikersprijzen aardgas en elektriciteit", copied from the GitHub probe nlen-1 of 2026-10-23
// (GET https://opendata.cbs.nl/ODataApi/odata/85666NED/TypedDataSet?$format=json&$filter=Perioden eq '2026HJ01'; only the household columns are kept here, the other
// columns of every row (non-household classes _4.._8 and _14.._20) were in the reply and are ignored by the parser). Codes: Prijscomponenten A047656 total, A047657 supply,
// A047658 network; Belastingen A047659 incl. VAT and taxes, A047660 excl. VAT incl. taxes, A047661 excl. VAT and taxes. The 2025HJ02 rows are SYNTHETIC (invented numbers in
// the proven layout) and only test the previous-period arithmetic.
const row = (id: number, pc: string, b: string, per: string, v: number[]) =>
  ({ ID: id, Prijscomponenten: pc, Belastingen: b, Perioden: per,
     MinderDan569M3_1: v[0], k_569Tot5687M3_2: v[1], k_5687M3EnMeer_3: v[2],
     MinderDan1MWh_9: v[3], k_1Tot25MWh_10: v[4], k_25Tot5MWh_11: v[5], k_5Tot15MWh_12: v[6], k_15MWhEnMeer_13: v[7],
     MinderDan20MWh_14: 0.498, k_20Tot500MWh_15: 0.326 });

export const REAL_BODY = {
  "odata.metadata": "https://opendata.cbs.nl/ODataApi/OData/85666NED/$metadata#Cbs.OData.WebAPI.TypedDataSet",
  value: [
    row(51, "A047656", "A047659", "2026HJ01", [1.993, 1.585, 1.344, 0.08, 0.225, 0.244, 0.253, 0.273]),
    row(103, "A047656", "A047660", "2026HJ01", [1.647, 1.31, 1.111, 0.066, 0.186, 0.202, 0.209, 0.226]),
    row(155, "A047656", "A047661", "2026HJ01", [1.047, 0.709, 0.51, 0.806, 0.407, 0.268, 0.192, 0.161]),
    row(207, "A047657", "A047659", "2026HJ01", [1.525, 1.387, 1.294, -0.584, -0.051, 0.104, 0.187, 0.229]),
    row(259, "A047657", "A047660", "2026HJ01", [1.261, 1.147, 1.07, -0.483, -0.042, 0.086, 0.155, 0.189]),
    row(311, "A047657", "A047661", "2026HJ01", [0.66, 0.546, 0.469, 0.257, 0.178, 0.152, 0.137, 0.124]),
    row(363, "A047658", "A047659", "2026HJ01", [0.468, 0.197, 0.05, 0.664, 0.276, 0.14, 0.066, 0.044]),
    row(415, "A047658", "A047660", "2026HJ01", [0.387, 0.163, 0.041, 0.548, 0.228, 0.116, 0.055, 0.037]),
    row(467, "A047658", "A047661", "2026HJ01", [0.387, 0.163, 0.041, 0.548, 0.228, 0.116, 0.055, 0.037]),
  ],
};

// SYNTHETIC: previous half-year (totals only) and an annual row that must be ignored.
export const WITH_PREVIOUS = {
  value: [
    ...REAL_BODY.value,
    row(50, "A047656", "A047659", "2025HJ02", [1.9, 1.5, 1.3, 0.07, 0.2, 0.22, 0.24, 0.26]),
    row(102, "A047656", "A047660", "2025HJ02", [1.6, 1.25, 1.05, 0.06, 0.17, 0.18, 0.2, 0.22]),
    row(154, "A047656", "A047661", "2025HJ02", [1.0, 0.65, 0.45, 0.75, 0.37, 0.24, 0.18, 0.15]),
    row(60, "A047656", "A047659", "2025JJ00", [9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9]),
  ],
};
