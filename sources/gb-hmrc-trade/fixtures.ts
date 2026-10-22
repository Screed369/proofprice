// Real lines of the HMRC OTS API, copied on 2026-10-22 from a probe of
//   https://api.uktradeinfo.com/OTS?$filter=MonthId eq 202506 and FlowTypeId eq 1&$skip=100000&$top=400
// (CN 76151080, household articles of aluminium; the first 12 of 400 lines; only the number of lines is reduced).
export const OTS_LINES = {
  "@odata.context": "https://api.uktradeinfo.com/$metadata#OTS",
  value: [
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 4, PortId: 382, Value: 41502.0, NetMass: 1768.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 4, PortId: 428, Value: 1370.0, NetMass: 2.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 4, PortId: 445, Value: 3646.0, NetMass: 111.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 5, PortId: 0, Value: 549.0, NetMass: 33.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 5, PortId: 3, Value: 9244.0, NetMass: 389.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 5, PortId: 7, Value: 111175.0, NetMass: 8320.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 5, PortId: 381, Value: 1472.0, NetMass: 17.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 5, PortId: 382, Value: 6936.0, NetMass: 431.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 7, PortId: 0, Value: 19063.0, NetMass: 2132.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 7, PortId: 382, Value: 939.0, NetMass: 10.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 8, PortId: 381, Value: 2338.0, NetMass: 176.0, SuppUnit: 0.0 },
    { MonthId: 202506, FlowTypeId: 1, SuppressionIndex: 0, CommodityId: 76151080, CommoditySitcId: 69743, CountryId: 10, PortId: 382, Value: 1199.0, NetMass: 345.0, SuppUnit: 0.0 },
  ],
};

// ASSUMED shape, not yet seen live: HMRC's documentation names CountryId and CountryName for the Country table. The preview deployment
// reads the real table; if it carries a two-letter code field, parseCountries uses it, and this fixture should then be replaced by a copy.
export const COUNTRIES = {
  value: [
    { CountryId: 4, CountryName: "Germany" },
    { CountryId: 5, CountryName: "China" },
    { CountryId: 7, CountryName: "Netherlands" },
    { CountryId: 8, CountryName: "Irish Republic" },
    { CountryId: 10, CountryName: "United States" },
  ],
};
