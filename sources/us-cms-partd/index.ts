// Manifest: US medicines as Medicare Part D paid them (CMS, annual). Shares the "medicines" country US with us-nadac:
// this source serves requests with basis=medicare_spend and us-nadac serves everything else (a declared serves() change in both
// folders, Gap fix G20261023-PLATFORM-SERVES-MEDICINES-DK). The rule is isMedicareSpendRequest() in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, isMedicareSpendRequest, partdMedicine } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["US"],
  countryHelp: "US = United States (NADAC pharmacy acquisition cost by default; basis=medicare_spend gives what Medicare Part D spent per tablet or dose, yearly)",
  placeName: "the United States",
  status: "live",
  serves: (p) => isMedicareSpendRequest(p),
  paramNotes: {
    medicine:
      "US with basis=medicare_spend: a brand or generic name as CMS lists it ('Lipitor', 'atorvastatin', 'Eliquis', 'metformin'); strength is ignored. Returns Medicare Part D's average spending per dosage unit in the newest data year.",
  },
  extraParams: {
    basis: z.string().optional().describe("US only: leave out for the pharmacy's acquisition cost (NADAC, weekly); 'medicare_spend' for what Medicare Part D spent per dosage unit (CMS, yearly, before rebates)."),
  },
  examples: [{ params: { country: "US", medicine: "atorvastatin", basis: "medicare_spend" } }, { params: { country: "US", medicine: "Eliquis", basis: "medicare_spend" }, smoke: false }],
  method:
    "United States (medicines, Medicare Part D spending): the average spending per dosage unit that CMS publishes once a year in 'Medicare Part D Spending by Drug', for the newest data year with the claims behind it. Official statistic, before manufacturer rebates; not a cash price.",
  handle: (p, ctx) => partdMedicine({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
