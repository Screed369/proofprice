// Manifest: US medicines as State Medicaid programmes reimbursed them (CMS State Drug Utilization Data, quarterly). Shares the "medicines"
// country US with us-nadac and us-cms-partd: this source serves basis=medicaid, us-nadac serves everything that is neither
// basis=medicare_spend nor basis=medicaid (declared serves() change in us-nadac, Gap fix G20261023-PLATFORM-SERVES-MEDICINES-DK).
// The `basis` parameter itself is declared by us-cms-partd (extraParams); its text is not changed here (platform task: mention medicaid).
import { defineSource, str } from "../../lib/plugin";
import { INFO, isMedicaidRequest, medicaidMedicine } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["US"],
  countryHelp: "US with basis=medicaid = what State Medicaid programmes reimbursed pharmacies per tablet or dose (CMS, newest quarter)",
  placeName: "the United States",
  status: "live",
  serves: (p) => isMedicaidRequest(p),
  paramNotes: {
    medicine:
      "US with basis=medicaid: a brand or generic name ('Lipitor', 'atorvastatin', 'Eliquis', 'metformin'); strength is ignored. Returns the average Medicaid reimbursement per dosage unit in the newest quarter.",
  },
  examples: [{ params: { country: "US", medicine: "atorvastatin", basis: "medicaid" } }, { params: { country: "US", medicine: "Eliquis", basis: "medicaid" }, smoke: false }],
  method:
    "United States (medicines, Medicaid reimbursement): national State Drug Utilization Data from CMS for the newest quarter; amount reimbursed divided by units, with the prescriptions behind it. A reimbursement to pharmacies, not a cash price.",
  handle: (p, ctx) => medicaidMedicine({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
