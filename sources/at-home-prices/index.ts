// Manifest: Austria home prices (STATISTIK AUSTRIA, official median price per m² by district, municipality and Bundesland). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, atHarvest, atHistoryKey, atHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["AT"],
  countryHelp: "AT = Austria (official STATISTIK AUSTRIA median price per m² of houses and flats, annual)",
  placeName: "Austria",
  status: "live",
  paramNotes: {
    town:
      "AT: a municipality among the 100 largest ('Wien' / 'Vienna', 'Graz', 'Linz', 'Salzburg', 'Innsbruck'), a district ('Wien 2' for Leopoldstadt, 'Bezirk Baden', 'Kitzbühel'), or a Bundesland ('Tirol', 'Niederösterreich' / 'Lower Austria'). Omit for Austria. Official annual medians per m², not a list of sales.",
    postcode: "AT: only Vienna postcodes (1010 to 1230) are matched, to the Vienna district; elsewhere give the town or district as town.",
    property_type:
      "AT: house or apartment (flats). The figure is the price per m² of living area. With no type given the headline is the flat figure and both medians are in extra.by_type. There is no figure for both together. Villa, detached, semi-detached and terraced get the all-houses figure, labelled as such (extra.widened_from).",
    months: "AT: ignored; STATISTIK AUSTRIA publishes one figure per calendar year (the latest is returned).",
  },
  paramValues: { property_type: ["house", "apartment"] },
  examples: [
    { params: { country: "AT", town: "Wien", property_type: "apartment" } },
    { params: { country: "AT", town: "Graz", property_type: "house" }, smoke: false },
    { params: { country: "AT", postcode: "1020", property_type: "apartment" }, smoke: false },
  ],
  method:
    "Austria: the official median price per m² of living area for houses and for owner-occupied flats that STATISTIK AUSTRIA publishes once a year per district, large municipality, Bundesland and for Austria, from land-register purchase contracts (five years of contracts, the earlier ones revalued to the reference year by a regression model). We pass on the published figure for the latest year, with the change on the year before and the Bundesland and Austrian medians; it is a per m² price, not a price per home.",
  handle: (p, ctx) =>
    atHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
  // Stale-if-error copy: the collector keeps the newest year's published medians (no record count), so a statistik.at outage is answered from them.
  harvest: () => atHarvest(),
  historyKey: (p) => atHistoryKey({ town: str(p.town) ?? str(p.area), postcode: str(p.postcode), property_type: str(p.property_type) }),
  nominalCounts: true,
  referenceDates: true,
  noHistory: "Austria: STATISTIK AUSTRIA publishes one median per place, type and year, so daily snapshots would only repeat it; ProofPrice keeps no history of it. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure.",
});
