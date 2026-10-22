// Manifest: Scotland and Northern Ireland home prices (UK House Price Index, official monthly average by council area and property type). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { findPlace, INFO, PROPERTY_TYPES, ukHpi } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["GB"],
  countryHelp: "GB = England & Wales (HM Land Registry sales); Scotland and Northern Ireland (official UK House Price Index average)",
  placeName: "Great Britain and Northern Ireland",
  status: "live",
  // England & Wales stay with gb-hmlr-ppd (the first source for GB); only a Scottish or Northern Irish place comes here.
  serves: (p) => findPlace(str(p.town)) !== null,
  paramNotes: {
    town:
      "GB Scotland / Northern Ireland: 'Scotland', 'Northern Ireland' or a council area ('Edinburgh', 'Glasgow', 'Aberdeen', 'Fife', 'Highland', 'Belfast', 'Derry', 'Lisburn and Castlereagh'). " +
      "Answered with the official monthly UK House Price Index average, not a list of sales.",
    property_type: "GB Scotland / Northern Ireland: any, detached, semi-detached, terraced or flat-maisonette.",
    months: "GB Scotland / Northern Ireland: ignored; the newest published month is returned.",
  },
  paramValues: { property_type: [...PROPERTY_TYPES] },
  examples: [
    { params: { country: "GB", town: "Edinburgh", property_type: "flat-maisonette" } },
    { params: { country: "GB", town: "Northern Ireland" }, smoke: false },
  ],
  method:
    "Scotland and Northern Ireland: the official monthly average home price from the UK House Price Index (HM Land Registry, Registers of Scotland, Land & Property Services NI), by nation, council area and property type, with the change on the year before.",
  handle: (p, ctx) => ukHpi({ town: str(p.town), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
});
