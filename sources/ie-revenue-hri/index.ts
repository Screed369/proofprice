// Manifest: Ireland declared value of home renovation works (Revenue Home Renovation Incentive statistics). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ieHri, hriHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "home-upgrades",
  countries: ["IE"],
  countryHelp: "IE = Ireland (Revenue Home Renovation Incentive: declared value of renovation works by county; not split by type of work; SEAI figures are not included yet)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    measure: "IE: only renovation (any qualifying work). The Home Renovation Incentive is not split by heat pump, solar, insulation or windows, so those measures return no_matches.",
    area: "IE: a county (Kerry, Cork, Dublin, Galway...) or a local authority (Fingal, DLR, Cork City...); leave out for all of Ireland.",
    dwelling_type: "IE: not published, ignored.",
  },
  examples: [
    { params: { country: "IE", measure: "renovation" } },
    { params: { country: "IE", measure: "renovation", area: "Kerry" }, smoke: false },
  ],
  method:
    "Ireland home renovation: Revenue publishes, per local authority, the number of properties claimed under the Home Renovation Incentive and the value of works claimants declared. We add up the area asked for and divide the declared value by the number of properties. It is a declared value at claim, not a receipt, not split by type of work, and the newest year in the table is 2018/19.",
  handle: (p, ctx) => ieHri(String(p.measure ?? ""), { area: str(p.area), baseUrl: ctx.baseUrl }),
  harvest: hriHarvest,
  historyKey: () => null,
});
