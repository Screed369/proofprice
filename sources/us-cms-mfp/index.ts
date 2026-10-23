// Manifest: US medicines at Medicare's negotiated "maximum fair price" (CMS Drug Price Negotiation Program). Shares the "medicines" country US
// with us-nadac: this source serves basis=mfp and us-nadac serves everything else (a declared serves() change in both folders,
// Gap fix G20261023-PLATFORM-SERVES-MEDICINES-DK, pattern of us-cms-asp / us-medicaid-sdud). The rule is isMfpRequest().
// The `basis` parameter itself is declared by us-cms-partd (extraParams); its text is not changed here (platform task: mention mfp).
import { defineSource, str } from "../../lib/plugin";
import { INFO, isMfpRequest, mfpMedicine, methodText } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["US"],
  countryHelp: "US with basis=mfp = the price Medicare negotiated with the drugmaker for a 30-day supply (CMS maximum fair price, about 40 selected drugs)",
  placeName: "the United States",
  status: "live",
  serves: (p) => isMfpRequest(p),
  paramNotes: {
    medicine:
      "US with basis=mfp: a brand or generic name of a drug selected for Medicare price negotiation ('Eliquis', 'apixaban', 'Stelara', 'Ozempic', 'Ibrance'). Returns the negotiated maximum fair price for a 30-day supply in force today.",
  },
  examples: [{ params: { country: "US", medicine: "Eliquis", basis: "mfp" } }, { params: { country: "US", medicine: "Stelara", basis: "mfp" }, smoke: false }],
  method: methodText(),
  handle: (p, ctx) => mfpMedicine({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
