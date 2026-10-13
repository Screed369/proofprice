// Manifest: France home sales (DVF, DGFiP via Etalab geo-dvf). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { SourceError } from "../../lib/http";
import { INFO, frHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["FR"],
  countryHelp: "FR = France (DVF)",
  placeName: "France",
  status: "live",
  paramNotes: {
    town: "FR: town, e.g. 'Bordeaux', or use postcode.",
    postcode: "FR: 5-digit postcode, e.g. '69003'; use instead of town for a precise area.",
    property_type: "FR: house or apartment.",
  },
  paramValues: { property_type: ["house", "apartment"] },
  examples: [{ params: { country: "FR", postcode: "69003", property_type: "apartment" } }],
  method:
    "France (DVF): only plain sales of exactly one house or apartment are counted; sales that bundle several homes or commercial premises are left out. DVF arrives with a delay of several months, so the period shown is the latest available.",
  handle: (p, ctx) => {
    if (!str(p.town) && !str(p.postcode)) throw new SourceError("A French town or postcode is required.");
    return frHomeSales({
      postcode: str(p.postcode),
      town: str(p.town),
      property_type: str(p.property_type),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    });
  },
});
