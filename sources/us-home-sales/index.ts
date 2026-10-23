// Manifest: United States home sales, partial coverage (Connecticut, New York City, Cook County IL). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, usHomeSales } from "./source";
import { isDcRequest } from "../us-dc-home-sales/source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["US"],
  countryHelp: "US = United States, partial: Connecticut, New York City and Cook County IL (Chicago area) only; not nationwide",
  placeName: "the United States (Connecticut, New York City and Cook County IL only)",
  status: "live",
  // Washington, DC is answered by us-dc-home-sales (DC Office of the Chief Financial Officer, CC BY 4.0); declared serves() change.
  // A bare "Washington" stays here (the town of Washington, CT). The rule is isDcRequest() in ../us-dc-home-sales/source.ts.
  serves: (p) => !isDcRequest(p),
  paramNotes: {
    town:
      "US: a Connecticut town ('Hartford'), a New York City borough or neighborhood ('Brooklyn', 'Williamsburg'), 'Chicago', 'Cook County' or a Cook County assessment township ('Evanston', 'Oak Park'). " +
      "Add the state if a name exists in two places ('Hartford, CT'). Required unless postcode is a New York City ZIP.",
    postcode: "US: 5-digit ZIP code, New York City only (Connecticut and Cook County have no ZIP in the public file).",
    property_type: "US: any (default), house (one- to three-family houses and townhomes), condo, or coop (New York City only).",
    months: "US: 1 to 36 months back from the latest sale in the file (New York City: up to 12).",
  },
  paramValues: { property_type: ["house", "condo", "coop"] },
  extraParams: {
    state: z.string().optional().describe("US only: 'CT' (Connecticut), 'NY' (New York City), 'IL' (Cook County) or 'DC' (Washington, DC). Usually inferred from the place; set it when a name exists in two of them."),
  },
  examples: [
    { params: { country: "US", town: "Hartford" } },
    { params: { country: "US", town: "Brooklyn" }, smoke: false },
    { params: { country: "US", town: "Chicago" }, smoke: false },
  ],
  method:
    "US (partial): each place is routed to its official sale records, queried live. Connecticut: OPM Real Estate Sales file (annual; non-use-coded sales excluded). New York City: Department of Finance Rolling Calendar Sales (last 12 months; sales under $10,000 excluded). Cook County IL: Assessor Parcel Sales (Assessor's own sale filters). Medians and 10th–90th percentiles over the latest window of the file; never addresses.",
  handle: (p, ctx) =>
    usHomeSales({
      town: str(p.town),
      postcode: str(p.postcode),
      state: str(p.state),
      property_type: str(p.property_type),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
});
