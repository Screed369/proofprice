// Manifest: Brazil building cost per m2 by state (IBGE SIDRA table 2296, SINAPI). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, STATES, brSinapi } from "./source";

export default defineSource({
  info: INFO,
  category: "construction",
  countries: ["BR"],
  countryHelp: "BR = Brazil (all 27 states plus the national figure; IBGE SINAPI average cost per m2)",
  placeName: "Brazil",
  status: "live",
  paramNotes: {
    area: "BR: state name or two-letter code ('São Paulo', 'SP', 'Bahia', 'RJ'); leave out for the national figure (Brasil). States: " + Object.values(STATES).map((s) => `${s.uf} = ${s.name}`).join(", ") + ".",
    component: "BR: total (default) = average cost per m2; material = materials part; labour = labour part. All in BRL per m2, monthly.",
  },
  examples: [
    { params: { country: "BR" } },
    { params: { country: "BR", area: "SP", component: "labour" }, smoke: false },
  ],
  method:
    "Brazil building cost: IBGE's SINAPI survey (with Caixa) gives, every month, the average cost of building one square metre in each state, split into materials and labour. We pass on the latest published month and the one before it. It is a survey of unit costs, not a list of invoices.",
  handle: (p, ctx) => brSinapi({ area: str(p.area) ?? str(p.town), component: str(p.component), baseUrl: ctx.baseUrl }),
});
