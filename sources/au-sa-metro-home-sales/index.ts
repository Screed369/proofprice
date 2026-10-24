// Manifest: Adelaide (South Australia) house sales, median price by suburb and quarter (SA Government, CC BY 4.0). Logic lives in ./source.ts.
// Folder name sorts AFTER au-home-sales on purpose: the registry takes the first source whose serves() says yes and otherwise the FIRST source,
// so the ABS state source (no serves) stays the default and only an Adelaide suburb comes here.
import { defineSource, str } from "../../lib/plugin";
import { INFO, saHomeSales, servesSuburb } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["AU"],
  countryHelp: "AU = Australia; metropolitan Adelaide (South Australia) suburbs have their own suburb-level source (houses, quarterly), other places get the ABS state figure",
  placeName: "Adelaide, South Australia",
  status: "live",
  paramNotes: {
    town: "AU (Adelaide suburbs): a metropolitan Adelaide suburb such as Norwood, Glenelg, Marion or Prospect. Houses only, by suburb (no postcode figures).",
    postcode: "AU (Adelaide suburbs): not used here; name the suburb in town.",
    property_type: "AU (Adelaide suburbs): houses only.",
    months: "AU (Adelaide suburbs): not used; one median per quarter (the newest is returned).",
  },
  examples: [{ params: { country: "AU", town: "Norwood" } }, { params: { country: "AU", town: "Glenelg, SA" }, smoke: false }],
  method:
    "Adelaide: the South Australian Government's quarterly median house sale price for each metropolitan suburb, with the number of sales as sample size (suburbs with fewer than 5 sales withheld). The published median is passed on unchanged; no range is published.",
  serves: (p) => servesSuburb(str(p.town), str(p.postcode)),
  handle: (p, ctx) => saHomeSales({ town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
});
