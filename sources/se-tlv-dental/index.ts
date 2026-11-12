// Manifest: Sweden dental care reference prices (TLV). Logic lives in ./source.ts.
// Free tier only (no licence stated on the TLV page). Reference prices, not paid prices.
import { defineSource, str } from "../../lib/plugin";
import { INFO, seDentalPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "medical",
  countries: ["SE"],
  countryHelp: "SE = Sweden (dental care: TLV reference prices for the state dental support, SEK; posted reference prices, not paid prices)",
  placeName: "Sweden (dental care reference prices)",
  status: "live",
  paramNotes: {
    service:
      "SE: a dental treatment in plain words ('crown', 'root canal', 'implant', 'filling', 'check-up', 'scaling', 'denture'; Swedish words work too: 'krona', 'rotfyllning') or a TLV treatment number ('800' = permanent crown, '501' = root canal, one canal). " +
    "Sweden has dental care only here: for doctor or hospital prices Sweden has no data.",
    state: "SE: not used, leave out.",
    setting: "SE: not used, leave out.",
  },
  examples: [
    { params: { country: "SE", service: "crown" } },
    { params: { country: "SE", service: "root canal" }, smoke: false },
    { params: { country: "SE", service: "800" }, smoke: false },
  ],
  method:
    "Sweden (dental care): the reference price per numbered treatment that TLV publishes in its tariff file (general and specialist dental care). We read the TLV page, use the file in force today and pass on the price. " +
    "Reference prices are what the Swedish state dental support is calculated on; dental clinics set their own prices, so this is not what patients paid.",
  handle: (p, ctx) => seDentalPrices({ service: str(p.service), state: str(p.state), setting: str(p.setting), baseUrl: ctx.baseUrl }),
});
