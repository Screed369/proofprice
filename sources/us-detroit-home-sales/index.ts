// Manifest: Detroit, Michigan home sales from the City Assessor's sales table. Shares "home-sales" country US with the other US sources.
// This folder name sorts BEFORE us-home-sales on purpose (first source whose serves() says yes wins; us-home-sales says yes to what is not DC).
import { defineSource, num, str } from "../../lib/plugin";
import { detroitHarvest, detroitHistoryKey, detroitHomeSales, INFO, isDetroitRequest } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["US"],
  countryHelp: "US = United States, partial: Connecticut, New York City, Cook County IL, Washington DC, Maricopa County AZ, Allegheny County PA and Detroit MI only; not nationwide",
  placeName: "Detroit, Michigan",
  status: "live",
  serves: (p) => isDetroitRequest(p),
  paramNotes: {
    town: "US (Detroit, MI): write 'Detroit, MI'. Whole city; neighbourhoods are not available.",
    postcode: "US (Detroit, MI): optional ZIP code 48201 to 48288 with at least 5 sales in the window.",
    property_type: "US (Detroit, MI): not available (houses and condos are mixed); leave out.",
    months: "US (Detroit, MI): 1 to 36 months back from the latest sale in the table.",
  },
  examples: [{ params: { country: "US", town: "Detroit, MI" } }, { params: { country: "US", town: "Detroit, MI", postcode: "48207" }, smoke: false }],
  method:
    "US (Detroit, MI): median and 10th–90th percentile of arm's-length sales of improved residential property of $10,000 or more, read live from the City of Detroit Assessor's property sales table; never addresses.",
  handle: (p, ctx) => detroitHomeSales({ town: str(p.town), postcode: str(p.postcode), state: str(p.state), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: () => detroitHarvest(),
  historyKey: (p) => detroitHistoryKey({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months) }),
  noHistory: "Detroit: ProofPrice keeps only the newest 12-month window as a backup copy in case the City's server is down. Ask pricepaid_home_sales (/api/v1/home-sales) with months=1 to 36 for other windows.",
});
