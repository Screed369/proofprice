// Manifest: England care home weekly unit costs (DHSC Adult Social Care Finance Report). Logic lives in ./source.ts.
// An official statistic on the existing medical tool (no new category). Licence: Open Government Licence v3.0.
import { defineSource, str } from "../../lib/plugin";
import { INFO, gbCareHomeCosts } from "./source";

export default defineSource({
  info: INFO,
  category: "medical",
  countries: ["GB"],
  countryHelp: "GB = England only for care homes (average weekly cost councils pay for nursing and residential care, GBP; official statistic, not what private self-funders pay)",
  placeName: "England (care home weekly costs paid by councils)",
  status: "live",
  paramNotes: {
    service:
      "GB: care home costs only: 'care home', 'nursing care' or 'residential care'; add 'over 65' (older people) or '18 to 64' (working-age adults) to narrow the age band, otherwise all adult ages. " +
      "GP, hospital and prescription prices are not covered for GB.",
    state: "GB: leave out for the England average, or give an English region ('North East', 'London', 'South West'...) or a council ('Gateshead', 'Kent', 'Westminster').",
    setting: "GB: not used, leave out.",
  },
  examples: [
    { params: { country: "GB", service: "care home" } },
    { params: { country: "GB", service: "nursing care over 65", state: "London" }, smoke: false },
    { params: { country: "GB", service: "residential care", state: "Gateshead" }, smoke: false },
  ],
  method:
    "England: the average weekly unit cost per person that councils reported in the Adult Social Care Finance Return, from the DHSC finance report data tables (Table 52), for the latest financial year, by setting, age band and area. " +
    "It is what councils paid providers, not what private self-funders pay.",
  handle: (p, ctx) => gbCareHomeCosts({ service: str(p.service), state: str(p.state), setting: str(p.setting), baseUrl: ctx.baseUrl }),
});
