// Manifest: Norway household electricity prices by type of contract, quarterly (Statistics Norway, table 14491). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { CONTRACTS, INFO, noElHarvest, noElHistoryKey, noElectricity, noElMethod } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["NO"],
  countryHelp: "NO = Norway (Statistics Norway: average household electricity price in NOK per kWh by contract type, quarterly, official statistic)",
  placeName: "Norway",
  status: "live",
  // Shares NO with eu-energy (Eurostat): this source answers household electricity for NO; eu-energy keeps NO gas and the business sector
  // (declared serves() change in sources/eu-energy, commit 5cc30995).
  serves: (p) => p.sector !== "business" && String(p.country ?? "").toUpperCase() === "NO" && String(p.energy ?? "") === "electricity",
  paramNotes: {
    energy: "Norway: electricity only here (SSB's table has no gas); NOK per kWh, a national average of the power itself, without grid rent.",
    consumption_band: "Norway: not used; SSB publishes no consumption bands. Use contract instead.",
    taxes: "Norway: all = including VAT (default); none or excl_vat = excluding taxes. SSB publishes only these two levels.",
  },
  extraParams: {
    contract: z
      .string()
      .optional()
      .describe(`Norway only: type of electricity contract: ${CONTRACTS.map((c) => `${c.key} = ${c.help}`).join("; ")}. Default total.`),
  },
  examples: [{ params: { country: "NO", energy: "electricity" } }, { params: { country: "NO", energy: "electricity", contract: "spot", taxes: "none" }, smoke: false }],
  method: noElMethod(),
  harvest: () => noElHarvest(),
  referenceDates: true,
  nominalCounts: true,
  historyKey: (p) => noElHistoryKey({ contract: str(p.contract), taxes: str(p.taxes) }),
  handle: (p, ctx) => noElectricity({ contract: str(p.contract), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
