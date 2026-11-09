// Manifest: Spain average appraised value of homes (Ministry of Transport / Housing, Estadística de Valor Tasado), in the home-sales tool, labelled as appraisals. Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, esAppraisedHomes, esHarvest, esHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["ES"],
  countryHelp: "ES = Spain (official average APPRAISED value per m² of free housing from mortgage valuations, quarterly, by region, province and municipality over 25,000 inhabitants; appraisals, not recorded sale prices)",
  placeName: "Spain",
  status: "live",
  // Spain without a town is answered by eu-home-price-index (the national house price index); any place name, or town="Spain", comes here.
  serves: (p) => !!str(p.town) || !!str(p.postcode) || str(p.level) === "municipality",
  paramNotes: {
    town:
      "ES: a province or region ('Madrid', 'Barcelona', 'Málaga', 'Valencia', 'Baleares', 'Cataluña'...), or a municipality over 25,000 inhabitants ('Marbella', 'Getafe', 'Alcalá de Henares, Madrid'). Use town='Spain' for the national average (omitting town gives the house price index instead). Official average APPRAISED value per m², not a price paid.",
    postcode: "ES: not supported (the ministry publishes by region, province and municipality); give the place as town.",
    property_type: "ES: the tables cover free housing as a whole; only 'any' has an answer.",
    months: "ES: ignored; the ministry publishes one average per quarter (the latest is returned, with the previous quarter and the year earlier).",
  },
  extraParams: {
    level: z.enum(["municipality"]).optional().describe("ES only: set to 'municipality' to look town up among municipalities over 25,000 inhabitants (for example the city of Madrid or Barcelona rather than the province)."),
  },
  examples: [
    { params: { country: "ES", town: "Madrid" } },
    { params: { country: "ES", town: "Marbella" }, smoke: false },
    { params: { country: "ES", town: "Spain" }, smoke: false },
  ],
  method:
    "Spain: the average appraised value per m² of free housing that the Ministry of Transport / Housing publishes each quarter (Estadística de Valor Tasado de Vivienda, from mortgage appraisals) for Spain, regions, provinces and municipalities over 25,000 inhabitants. Appraisals, not recorded sales; we pass on the published figure and calculate the changes.",
  handle: (p, ctx) =>
    esAppraisedHomes({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      level: str(p.level),
      baseUrl: ctx.baseUrl,
    }),
  harvest: () => esHarvest(),
  historyKey: (p) => esHistoryKey({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), level: str(p.level) }),
  referenceDates: true,
  staleMaxDays: 100, // the ministry publishes quarterly; its newest figure cannot change between releases
  nominalCounts: true,
  noHistory: "Spain: the ministry publishes one appraised average per place and quarter and ProofPrice keeps no separate history of it yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure, which carries the previous quarter and the year earlier.",
});
