// Manifest: Brazil raw milk paid to producers (IBGE, Pesquisa Trimestral do Leite, SIDRA table 1086, quarterly, Brazil + 27 states). Logic lives in ./source.ts.
// Licence not cleared (IBGE terms unreadable on 7 Nov 2026): free tier only, not listed in lib/payments/cleared.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, STATE_NAMES, ibgeMilkHarvest, ibgeMilkHistoryKey, ibgeMilkPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["BR"],
  countryHelp: "BR = Brazil (IBGE Quarterly Milk Survey: average price dairies paid milk producers per litre, Brazil and the 27 states, quarterly official statistic, not a live price)",
  placeName: "Brazil",
  status: "live",
  paramNotes: {
    product: "Brazil: only raw milk ('milk' or 'leite'). IBGE's price is reais per litre paid by dairies to producers, per quarter.",
    region: `Brazil: optional; leave out for the national figure, or give a state by name or two-letter code (for example São Paulo or SP, Minas Gerais, Paraná, Rio Grande do Sul, Goiás). States: ${STATE_NAMES.join(", ")}. IBGE withholds a state's figure in a quarter when too few dairies report it.`,
  },
  examples: [
    { params: { country: "BR", product: "milk" } },
    { params: { country: "BR", product: "milk", region: "Minas Gerais" }, smoke: false },
    { params: { country: "BR", product: "leite", region: "RS" }, smoke: false },
  ],
  method:
    "Brazil (farm-gate prices): IBGE's quarterly average price that dairies under inspection paid producers for raw milk (SIDRA table 1086), for Brazil and each state. " +
    "We pass on the published average and its quarter, with the change on the previous quarter and a year earlier that we calculate from two published averages; it is an average, not a sale or a live price, and no range is calculated.",
  handle: (p, ctx) => ibgeMilkPrices({ product: str(p.product), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest quarter, so an IBGE outage is answered from it (stale-if-error). Each row is one published average (n is NO_COUNT).
  harvest: () => ibgeMilkHarvest(),
  historyKey: (p) => ibgeMilkHistoryKey({ product: str(p.product), region: str(p.region) }),
  referenceDates: true,
  staleMaxDays: 30,
  nominalCounts: true,
});
