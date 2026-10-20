// Manifest: Singapore government contract prices (GeBIZ awarded tenders). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, sgContracts } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["SG"],
  countryHelp: "SG = Singapore (GeBIZ tenders)",
  placeName: "Singapore (GeBIZ)",
  status: "live",
  paramNotes: {
    what: "SG: a word or phrase searched in the tender description ('cleaning', 'laptops', 'security services'); common purchases use a tuned keyword.",
    cpv: "SG: not used (Singapore tenders carry no CPV codes).",
    buyer_area: "SG: part of an agency name ('National Library Board', 'Health Sciences Authority').",
    months: "SG: 1 to 60 months by award date; the dataset covers FY2021 onwards and is updated about yearly.",
  },
  examples: [
    { params: { country: "SG", what: "cleaning", months: 60 } },
    { params: { country: "SG", what: "cleaning", buyer_area: "Library", months: 60 }, smoke: false },
  ],
  method:
    "Singapore GeBIZ awarded tenders from data.gov.sg, found by free-text search on the tender description (and agency name); each awarded tender is one contract. Median and 10th–90th percentile in SGD. Totals per tender, not unit prices; suppliers are never named.",
  handle: (p, ctx) =>
    sgContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), months: num(p.months) ?? 24, baseUrl: ctx.baseUrl }),
});
