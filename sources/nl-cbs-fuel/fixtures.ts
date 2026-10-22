// Real rows from CBS StatLine table 80416NED, copied from the Verifier's probe of 2026-10-21 (GET https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet
// with $filter Perioden gt '20261005'; JSON body {"value":[...]}) and the table's first row. Nothing is invented. The same national figures for
// 12 Oct 2026 appear in the EU Weekly Oil Bulletin for NL (2461.96 / 2481.86 / 960.92 euro per 1000 litres), which is an independent cross-check.
export const REAL_REPLY = {
  value: [
    { ID: 7586, Perioden: "20261009", BenzineEuro95_1: 2.455, Diesel_2: 2.482, Lpg_3: 0.952 },
    { ID: 7589, Perioden: "20261012", BenzineEuro95_1: 2.462, Diesel_2: 2.482, Lpg_3: 0.961 },
  ],
};
export const FIRST_ROW = { ID: 0, Perioden: "20060101", BenzineEuro95_1: 1.325, Diesel_2: 1.003, Lpg_3: 0.543 };
