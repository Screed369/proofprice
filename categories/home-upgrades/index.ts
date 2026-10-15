// Tool: what home-upgrade work (heat pumps, solar panels, insulation, windows) costs, from official statistics.
// Sources plug in by declaring category "home-upgrades". The tool name pricepaid_home_upgrade_prices is public: never rename it.
//
// What the figures are: official statistics built from costs that installers or owners declared when a grant or tax claim was made
// (price_type official_statistic). They are NOT receipts and NOT quotes: "declared installed cost at grant/claim". Each source says
// exactly what its figure includes.
//
// TODO(SEAI): Ireland's SEAI (Sustainable Energy Authority of Ireland) publishes grant and cost statistics for heat pumps, solar PV and
// insulation, but its licence for reuse has NOT been confirmed. Do not add an SEAI source until the licence is confirmed and
// Simon has approved it (Notion "Decisions for Simon"). Ireland is covered for now only by the Revenue Home Renovation Incentive.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const MEASURE_ALIASES: Record<string, string> = {
  heat_pump: "heat_pump", "heat pump": "heat_pump", heatpump: "heat_pump", "heat pumps": "heat_pump", ashp: "heat_pump", "air source heat pump": "heat_pump",
  solar_pv: "solar_pv", "solar pv": "solar_pv", solar: "solar_pv", "solar panels": "solar_pv", pv: "solar_pv",
  attic_insulation: "attic_insulation", "attic insulation": "attic_insulation", "loft insulation": "attic_insulation", loft: "attic_insulation", attic: "attic_insulation",
  wall_insulation: "wall_insulation", "wall insulation": "wall_insulation", "cavity wall insulation": "wall_insulation", "external wall insulation": "wall_insulation",
  windows: "windows", window: "windows", glazing: "windows", "double glazing": "windows",
  renovation: "renovation", "home renovation": "renovation", refurbishment: "renovation", any: "renovation", all: "renovation",
};

export const MEASURES = ["heat_pump", "solar_pv", "attic_insulation", "wall_insulation", "windows", "renovation"] as const;

export default defineCategory({
  id: "home-upgrades",
  tool: "pricepaid_home_upgrade_prices",
  restPath: "home-upgrades",
  cacheSeconds: 86400,
  title: "Home upgrade costs (heat pumps, solar, insulation, windows)",
  noun: "Home upgrade prices",
  description: (places) =>
    "Use this when a user asks what a home upgrade costs in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}: a heat pump, solar panels (solar PV), loft/attic or wall insulation, or new windows. ` +
    "Returns an official statistic: the cost that installers or owners declared when a grant or tax claim was made (a median or average the publisher states for a period), " +
    "with the period, the publisher's own wording of what the figure includes, the official source and licence. " +
    "These are declared installed costs at grant or claim, not receipts, not quotes and not what one home paid; price_type is official_statistic, so the range fields can be null and the sample size is given only where the publisher states it. " +
    "Each source covers only some measures: where a measure is not published the answer says so (status no_matches) instead of guessing. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Some countries publish only a general renovation figure that is not split by type of work (the country notes say so). " +
    "Do not use for a quote on a particular home, for installer prices or offers, for running costs or savings, or for other countries.",
  params: {
    measure: z
      .enum([...MEASURES])
      .describe("The upgrade: heat_pump, solar_pv, attic_insulation, wall_insulation, windows, or renovation (any home renovation works, where the publisher does not split by type). Plain words such as 'heat pump' or 'loft insulation' are accepted."),
    dwelling_type: z
      .string()
      .optional()
      .describe("Type of dwelling or job, only where the publisher splits by it (the country notes say which values). Leave out for the publisher's main figure."),
    area: z
      .string()
      .optional()
      .describe("Place, only where the publisher splits by place (the country notes say how). Leave out for the national figure."),
  },
  required: ["measure"],
  prepare: (p) => {
    const raw = (str(p.measure) ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
    const measure = MEASURE_ALIASES[raw] ?? MEASURE_ALIASES[raw.replace(/ /g, "_")];
    if (!measure) throw new InputError('measure must be one of "heat_pump", "solar_pv", "attic_insulation", "wall_insulation", "windows" or "renovation".');
    return { ...p, measure };
  },
});
