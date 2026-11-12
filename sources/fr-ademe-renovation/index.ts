// Manifest: France energy-renovation job costs (ADEME survey of the FAIRE network, 2011-2018). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, frRenovation, planFor } from "./source";

export default defineSource({
  info: INFO,
  category: "home-upgrades",
  countries: ["FR"],
  countryHelp: "FR = France (ADEME survey of invoiced renovation jobs, mostly 2011-2018: HISTORICAL, not current prices; excl. VAT)",
  placeName: "France (historical survey)",
  status: "live",
  paramNotes: {
    measure: "FR: heat_pump, solar_pv, attic_insulation, wall_insulation or windows (total cost of the whole job, excl. VAT, jobs of about 2011-2018). A general renovation figure is not published and returns no_matches.",
    dwelling_type: "FR attic_insulation: loft (default), rafters, sarking or all. FR wall_insulation: external, internal or all (default). Other measures: ignored.",
    area: "FR: a département (Gironde, Rhône, Côtes-d'Armor...) or a region code (BRE, ARA, NAQ...); leave out for all of France. A place with fewer than 5 jobs gives insufficient_data.",
  },
  examples: [
    { params: { country: "FR", measure: "heat_pump" } },
    { params: { country: "FR", measure: "wall_insulation", dwelling_type: "external" }, smoke: false },
  ],
  method:
    "France renovation costs: ADEME's survey of the FAIRE advice network recorded the total cost, excluding VAT, of about 12,000 renovation jobs from invoices or quotes, mostly works of 2011 to 2018. We take the median and 10th to 90th percentile of the jobs asked for (at least 5). It is a historical sample, not today's prices.",
  handle: async (p, ctx) => {
    planFor(String(p.measure ?? ""), str(p.dwelling_type)); // bad input fails before any download
    return frRenovation(String(p.measure ?? ""), { dwelling_type: str(p.dwelling_type), area: str(p.area), baseUrl: ctx.baseUrl });
  },
});
