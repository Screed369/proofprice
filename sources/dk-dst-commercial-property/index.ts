// Manifest: Denmark commercial property (official average price per business / industrial property, Statistics Denmark EJEN77). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { denmarkCommercialProperty, dkCommercialHarvest, dkCommercialHistoryKey, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["DK"],
  countryHelp: "DK = Denmark (official average price per business or industrial property from Statistics Denmark, by province and region; an official statistic, per property, not per m2)",
  placeName: "Denmark",
  status: "live",
  paramNotes: {
    town:
      "DK: a province ('Fyn', 'Østjylland', 'Nordsjælland'), a region ('Hovedstaden', 'Syddanmark') or a town/municipality ('København', 'Aarhus', 'Odense'), with or without æ ø å. " +
      "Statistics Denmark publishes by province, so a town is answered with the province it lies in (and the answer says which). Omit for Denmark as a whole.",
    postcode: "DK: not supported (published by province and region); give town instead.",
    property_type: "DK: commercial (default) = business properties plus industrial properties and warehouses, as an average price PER PROPERTY. land is not available (only a count of building sites is published, no price).",
    months: "DK: not used; Statistics Denmark publishes one average per quarter.",
  },
  examples: [
    { params: { country: "DK", property_type: "commercial" } },
    { params: { country: "DK", town: "Østjylland", property_type: "commercial" }, smoke: false },
  ],
  method:
    "Denmark: Statistics Denmark's average purchase price per property for ordinary free-trade sales of business properties and of industrial properties and warehouses, with the number of sales, by quarter for each province, region and all of Denmark. " +
    "We return the sales-weighted mean of the two groups for the latest quarter with at least 5 sales, with the previous quarter and the year before. An official statistic per property, not per square metre.",
  handle: (p, ctx) => denmarkCommercialProperty({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
  harvest: () => dkCommercialHarvest(),
  historyKey: (p) => dkCommercialHistoryKey({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type) }),
  referenceDates: true,
  staleMaxDays: 35,
  nominalCounts: true,
  noHistory: "Denmark: Statistics Denmark publishes one average per quarter and ProofPrice keeps no separate history of it yet. Ask pricepaid_commercial_property (/api/v1/commercial-property) for the newest quarter, which carries the previous quarter and the year earlier.",
});
