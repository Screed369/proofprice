// Manifest: Latvia house sales (VZD house sale statistics from the Real Estate Market Database). Logic lives in ./source.ts.
// Answers home-sales requests for LV that ask for a house (property_type=house); apartments stay with lv-vzd-home-sales.
// This folder sorts before lv-vzd-home-sales on purpose: the first source whose serves() says yes is used.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, isHouseType, lvHouseSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["LV"],
  countryHelp: "LV = Latvia (houses: VZD median price per house per town or parish, calendar year, by floor-area band; apartments are answered without property_type)",
  placeName: "Latvia (houses)",
  status: "live",
  paramNotes: {
    town: "LV houses (property_type=house): a town (Riga, Jurmala, Adazi, Saulkrasti ...), a rural parish such as 'Carnikavas pagasts', or a municipality such as 'Adazu novads' (answers for its towns).",
    property_type: "LV: 'house' gives the VZD house statistics (price per house in EUR); leave out for apartments.",
  },
  paramValues: { property_type: ["house"] },
  extraParams: {
    floor_area: z.number().min(10).max(2000).optional().describe("LV houses only: floor area of the house in m2, for example 140. VZD publishes bands (up to 40, 40-60, 60-110, 110-180, 180-250, over 250 m2); the band is picked for you. Without it the band with the most deals is returned and the other bands are listed."),
  },
  examples: [
    { params: { country: "LV", town: "Riga", property_type: "house" } },
    { params: { country: "LV", town: "Jurmala", property_type: "house", floor_area: "150" }, smoke: false },
  ],
  serves: (p) => !!str(p.town) && isHouseType(str(p.property_type)) && str(p.property_type)!.toLowerCase() !== "any",
  method:
    "Latvia houses: the median price per house in EUR (not per m2) of the deals VZD, the State Land Service, registered in its Real Estate Market Database, per town, parish or Riga, by house floor-area band, for the latest full calendar year, with VZD's deal count.",
  handle: (p, ctx) => lvHouseSales({ town: str(p.town), property_type: str(p.property_type), floor_area: num(p.floor_area), baseUrl: ctx.baseUrl }),
});
