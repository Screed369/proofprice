// Manifest: mobile and fixed broadband prices for the EU (Eurostat isoc_pbo). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, OFFER_ALIASES, euBroadband } from "./source";

export default defineSource({
  info: INFO,
  category: "broadband",
  countries: Object.keys(COUNTRIES),
  countryHelp: "EU member states as ISO codes (GR for Greece): " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", "),
  placeName: "the EU",
  status: "live",
  paramNotes: {
    offer:
      "EU, Eurostat: the cheapest posted offer of the largest operators, PPP euro per month. Names: " +
      Object.entries(OFFER_ALIASES).map(([k, v]) => `${k} (${v})`).join(", ") +
      ". Any Eurostat offer code also works, e.g. FI_MBPS30-100_PTV (fixed 30-100 Mbps with phone and TV). Default fixed_100_200.",
  },
  examples: [
    { params: { country: "IE", offer: "fixed_100_200" } },
    { params: { country: "DE", offer: "mobile_10gb" }, smoke: false },
  ],
  method:
    "EU mobile and broadband: the official price Eurostat publishes once a year for the cheapest posted offer of the largest operators, for a standard offer, in PPP euro per month. We pass on the published figure and its year; it is a posted price, not what customers paid.",
  handle: (p, ctx) => euBroadband({ country: String(p.country), offer: str(p.offer), baseUrl: ctx.baseUrl }),
});
