// Manifest: government contract prices for buyers in EU and EEA states (TED contract award notices). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { COUNTRIES, euTedContracts, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "EU and EEA states, by the country of the public buyer, as ISO codes: " +
    Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". Award notices above the EU procurement thresholds from TED.",
  placeName: "EU and EEA states (TED)",
  status: "live",
  paramNotes: {
    what:
      "EU and EEA: common purchases are matched to CPV product codes (laptops, desktop computers, school meals, road resurfacing, office cleaning, electricity, natural gas, ambulances, waste collection and about 30 more, in English and the main EU languages); " +
      "anything else is a free-text search of the award notices, best in the buyer country's language.",
    cpv: "EU and EEA: an 8-digit CPV code (30213100) or a shorter prefix (3021) for a whole group; a lot counts when its own main product code is in that group.",
    buyer_area: "EU and EEA: the buyer's city, as written on the notice (e.g. 'Lyon', 'München').",
    months: "EU and EEA: up to 60; only the newest 1,000 matching notices are read, so a very common purchase covers a shorter period than asked (the answer says so).",
  },
  examples: [
    { params: { country: "FR", what: "laptops" } },
    { params: { country: "DE", what: "school meals" }, smoke: false },
    { params: { country: "ES", what: "road resurfacing" }, smoke: false },
    { params: { country: "IE", what: "office cleaning" }, smoke: false },
  ],
  method:
    "Contract award notices (form type 'result') published on TED by public buyers in the chosen country, found by CPV product code or free text. Each lot with a chosen winner and a stated value counts as one contract; " +
    "the answer is the median and 10th–90th percentile of those values, in the notice currency. Totals per contract (lot), not unit prices. Framework agreements (whose stated value is usually a ceiling) are kept out of the headline when at least 5 single contracts match, and their figure is given separately; suppliers are never named.",
  handle: (p, ctx) => {
    return euTedContracts({
      country: String(p.country),
      what: String(p.what),
      cpv: str(p.cpv),
      buyer_area: str(p.buyer_area),
      months: num(p.months) ?? 24,
      baseUrl: ctx.baseUrl,
    });
  },
});
