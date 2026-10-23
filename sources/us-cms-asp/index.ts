// Manifest: US physician-administered drug prices as Medicare Part B pays them (CMS payment limit file, quarterly).
// Shares the "medicines" country US with us-nadac: this source serves requests with basis=part_b_asp and us-nadac serves everything
// else (a declared serves() change in both folders, Gap fix G20261023-PLATFORM-SERVES-MEDICINES-DK). The rule is isPartBAspRequest().
import { defineSource, str } from "../../lib/plugin";
import { INFO, aspMedicine, isPartBAspRequest, methodText } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["US"],
  countryHelp: "US = United States (basis=part_b_asp gives Medicare Part B's payment limit for doctor-administered drugs such as injections and biologics, quarterly)",
  placeName: "the United States",
  status: "live",
  serves: (p) => isPartBAspRequest(p),
  paramNotes: {
    medicine:
      "US with basis=part_b_asp: the generic name as CMS describes the drug ('pembrolizumab', 'bevacizumab', 'ranibizumab', 'denosumab') or the HCPCS code (J9271). Brand names are not in the file. Returns Medicare's payment limit per billing dosage (for example per 1 mg).",
  },
  examples: [{ params: { country: "US", medicine: "pembrolizumab", basis: "part_b_asp" } }, { params: { country: "US", medicine: "J9271", basis: "part_b_asp" }, smoke: false }],
  method: methodText(),
  handle: (p, ctx) => aspMedicine({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
