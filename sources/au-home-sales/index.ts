// Manifest: Australia home sales (official mean price of residential dwellings by state and territory, Australian Bureau of Statistics). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, routeAustralia } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["AU"],
  countryHelp:
    "AU = Australia (the Australian Bureau of Statistics' official mean price of residential dwellings, by state and territory; an official statistic of the whole dwelling stock, not individual sales and not a suburb price)",
  placeName: "Australia",
  status: "live",
  paramNotes: {
    town:
      "AU: a state or territory ('Victoria', 'NSW', 'Queensland', 'Tasmania', 'ACT'), or a city or town that lies in one ('Melbourne', 'Parramatta', 'Perth'). " +
      "The ABS publishes by state and territory only, so a city is answered with its state (and the answer says so). Omit for Australia as a whole.",
    postcode: "AU: a 4-digit postcode ('2150'), answered with the state or territory it lies in (the ABS has no postcode figures).",
    property_type: "AU: not split by the ABS; the figure covers all residential dwellings (houses and attached dwellings together). Any value is accepted and noted.",
    months: "AU: not used; the ABS publishes one mean price per quarter.",
  },
  examples: [
    { params: { country: "AU", town: "Victoria" } },
    { params: { country: "AU", town: "Parramatta" }, smoke: false },
    { params: { country: "AU", postcode: "4000" }, smoke: false },
    { params: { country: "AU" }, smoke: false },
  ],
  method:
    "Australia: the Australian Bureau of Statistics' mean price of residential dwellings (the ABS estimate of the total value of the dwelling stock divided by the number of dwellings) for each state and territory and for Australia, by quarter. " +
    "We pass on the published figure in AUD with the previous quarter and the year before; the newest quarter is preliminary. It is an official statistic of the whole housing stock, not a list of sales and not a suburb price.",
  handle: (p, ctx) =>
    routeAustralia({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
});
