// Manifest: Uruguay regulated maximum pump prices (ANCAP, national open-data catalogue). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, uyFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["UY"],
  countryHelp: "UY = Uruguay (ANCAP: monthly maximum pump price set by decree, national, IVA included; not a station price)",
  placeName: "Uruguay",
  status: "live",
  paramNotes: {
    fuel: "Uruguay: petrol95 (Super 95) or diesel (gasoil 10-S), as the regulated maximum price per litre in Uruguayan pesos with IVA; premium 97 and gasoil 50-S are in the extra fields. Other fuels are not published.",
    postcode: "Uruguay: not used; ANCAP publishes one national price, so the national figure is returned and says so.",
    area: "Uruguay: not used (national maximum price only).",
    town: "Uruguay: not used (national maximum price only).",
    service: "Uruguay: not used.",
  },
  examples: [{ params: { country: "UY", fuel: "diesel" } }, { params: { country: "UY", fuel: "petrol95" }, smoke: false }],
  method:
    "Uruguay (fuel): ANCAP publishes in the national open-data catalogue the maximum consumer price per litre of Super 95 petrol and gasoil 10-S diesel, approved by decree and in force each month, in Uruguayan pesos with IVA included. " +
    "We pass on the newest month that has a quotation, with the change on the previous quoted month and a year earlier; it is a regulated maximum with no count of sales, not a station price.",
  handle: (p, ctx) => uyFuelNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
});
