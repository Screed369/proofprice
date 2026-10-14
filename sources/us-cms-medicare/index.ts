// Manifest: US doctor and hospital prices as Medicare paid them (CMS Physician & Other Practitioners + Inpatient Hospitals).
// This is the one registered source for the "medical" category in the US. The fetching and answers live in ../us-cms-physician/source.ts
// and ../us-cms-inpatient/source.ts; the request routing is in ./source.ts (see the note at its top).
import { defineSource, str } from "../../lib/plugin";
import { INFO, medicalPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "medical",
  countries: ["US"],
  countryHelp: "US = United States (what Medicare paid, nationally or by state)",
  placeName: "the United States (what Medicare paid doctors and hospitals)",
  status: "live",
  paramNotes: {
    service:
      "US: plain words ('office visit', 'MRI lower back', 'colonoscopy', 'physical therapy', 'knee replacement', 'pneumonia'), a billing code (HCPCS/CPT such as 99213 or G0121) or an MS-DRG hospital-stay code ('DRG 470').",
    state: "US: a state or territory as a two-letter code or name (TX, Texas). Leave out for the national average.",
    setting:
      "US: office (a doctor's office; the whole service), facility (a hospital outpatient department or surgery centre; the doctor's fee only) or inpatient (a hospital stay, by MS-DRG). Leave out to use the usual setting for the service.",
  },
  examples: [
    { params: { country: "US", service: "99213" } },
    { params: { country: "US", service: "knee replacement", state: "TX" }, smoke: true },
    { params: { country: "US", service: "MRI lower back", state: "CA" }, smoke: false },
    { params: { country: "US", service: "pneumonia" }, smoke: false },
  ],
  method:
    "US: for doctors' services, the average amount Medicare allowed per service (Medicare's payment plus the patient's deductible and coinsurance) that CMS publishes once a year by billing code, setting and state; " +
    "for hospital stays, the average total payment to the hospital per stay by MS-DRG group and state. We pass on the published figure for the latest data year with the number of services or discharges behind it. " +
    "It is what Medicare paid at Medicare rates, not a private-insurance or cash price.",
  handle: (p, ctx) =>
    medicalPrices({
      service: str(p.service),
      state: str(p.state),
      setting: str(p.setting),
      baseUrl: ctx.baseUrl,
    }),
});
