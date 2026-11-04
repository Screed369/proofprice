// Manifest: Poland commercial premises (shops, services, offices) from the Real Estate Price Register (RCN, GUGiK). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { PLACES } from "../pl-rcn-home-sales/source";
import { INFO, plCommercial } from "./source";

const cities = PLACES.map((p) => p.label).join(", ");

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["PL"],
  countryHelp: "PL = Poland (national Real Estate Price Register: notarised sales of shops, service premises and offices in the 19 biggest cities)",
  placeName: "Poland (shops and offices in the big cities)",
  status: "live",
  paramNotes: {
    town: `PL: a city, required (${cities}); Polish or English spelling. Small cities hold few commercial sales; with fewer than 5 no figure is given.`,
    postcode: "PL: not supported; give the city as town.",
    property_type: "PL: commercial only (shops, services, offices). land is refused: the register prices bundles of plots, not single plots.",
    months: "PL: 1 to 24 months, default 12 (commercial sales are few). The register lags by months, so the answer period ends at the newest sale held.",
  },
  examples: [
    { params: { country: "PL", town: "Warszawa", property_type: "commercial" } },
    { params: { country: "PL", town: "Krakow", property_type: "commercial", months: "24" }, smoke: false },
  ],
  pages: [
    { params: { country: "PL", town: "Warszawa", property_type: "commercial" }, label: "Warsaw", question: "What do shops and offices sell for in Warsaw, Poland?" },
  ],
  // Shares commercial-property with no other Polish source: serve any request that names a town.
  serves: (p) => !!str(p.town),
  method:
    "Poland: notarised free-market sales of retail/service and office premises from the national Real Estate Price Register (GUGiK), read live from the official Geoportal WFS service in 90-day slices; median and 10th-90th percentile of the price per m², implausible records dropped, and only the aggregate kept.",
  handle: (p, ctx) =>
    plCommercial({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
