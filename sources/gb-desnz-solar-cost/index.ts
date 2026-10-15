// Manifest: Great Britain solar PV installed cost (DESNZ solar PV cost data from MCS certificates). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, gbSolar, solarHarvest, solarSelect } from "./source";

export default defineSource({
  info: INFO,
  category: "home-upgrades",
  countries: ["GB"],
  countryHelp: "GB = Great Britain (solar PV: DESNZ declared installed cost per kW from MCS certificates; heat pumps: Boiler Upgrade Scheme statistics; England and Wales for heat pumps, Great Britain for solar)",
  placeName: "Great Britain",
  status: "live",
  serves: (p) => p.measure === "solar_pv",
  paramNotes: {
    measure: "GB: solar_pv (DESNZ, per kW installed) and heat_pump (Boiler Upgrade Scheme, per installation). Insulation and windows have no open GB cost statistic yet and return no_matches.",
    dwelling_type:
      "GB solar_pv: leave out for all small installations (median); or domestic, non-domestic, retrofit (domestic, existing home) or new build (domestic): these are means. GB heat_pump: not published, ignored.",
    area: "GB: national figures only; an area is ignored and the answer says so.",
  },
  extraParams: {
    size_kw: z.number().optional().describe("GB solar_pv: system size in kW; picks the DESNZ size band (0-4, 4-10 or 10-50 kW). Default: the 0-4 kW band."),
  },
  examples: [
    { params: { country: "GB", measure: "solar_pv" } },
    { params: { country: "GB", measure: "solar_pv", dwelling_type: "domestic", size_kw: "6" }, smoke: false },
  ],
  method:
    "Great Britain solar panels: DESNZ publishes each year the median and mean cost per kW of small-scale solar PV installations certified under the Microgeneration Certification Scheme, by size band, with the number of installations. We pass on that figure and its financial year. It is the installer's declared installed cost, not a receipt or a quote.",
  handle: (p, ctx) => {
    solarSelect({ dwelling_type: str(p.dwelling_type), size_kw: num(p.size_kw) }); // bad input fails before any download
    return gbSolar({ dwelling_type: str(p.dwelling_type), size_kw: num(p.size_kw), area: str(p.area), baseUrl: ctx.baseUrl });
  },
  harvest: solarHarvest,
  historyKey: (p) => {
    const s = solarSelect({ dwelling_type: str(p.dwelling_type), size_kw: num(p.size_kw) });
    return { area: "GB", item: s.key, label: `Great Britain solar PV, ${s.type}, ${s.band} kW` };
  },
});
