// Manifest: New Zealand rents (MBIE Tenancy Services rental bond data). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, nzRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (rental bond data from MBIE Tenancy Services; weekly rent in NZD)",
  placeName: "New Zealand",
  status: "live",
  paramNotes: {
    town: "NZ: required. A territorial authority or city ('Wellington', 'Auckland', 'Christchurch', 'Hamilton', 'Dunedin', 'Queenstown-Lakes'), a region ('Canterbury', 'Wellington Region') or 'New Zealand' for the whole country. A name that is both a city and a region (Wellington) gives the city.",
    postcode: "NZ: not used; rents are published by territorial authority and region.",
    property_type: "NZ: not applied. The published place files do not split by dwelling type; the answer covers all new private tenancies and says so.",
    house_type: "NZ: not applied (see property_type).",
    bedrooms: "NZ: not applied. MBIE publishes bedroom splits only by unnamed Statistics NZ area codes, not by place name; the answer says so.",
    months: "NZ: ignored; the figure is for the latest month MBIE has published (about two months behind).",
  },
  examples: [
    { params: { country: "NZ", town: "Wellington", bedrooms: "2" } },
    { params: { country: "NZ", town: "Auckland" }, smoke: false },
    { params: { country: "NZ", town: "New Zealand" }, smoke: false },
  ],
  method:
    "New Zealand rents: the median weekly rent and published lower and upper quartile of new private-sector tenancies whose rental bond was lodged in the latest month, by territorial authority or region, from MBIE Tenancy Services' monthly rental bond data. The range is the quartiles; the count is bonds lodged.",
  handle: (p, ctx) =>
    nzRents({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), house_type: str(p.house_type), bedrooms: num(p.bedrooms), baseUrl: ctx.baseUrl }),
});
