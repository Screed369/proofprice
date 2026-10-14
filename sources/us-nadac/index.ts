// Manifest: United States medicine prices (NADAC, pharmacy acquisition cost). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, nadacMedicine } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["US"],
  countryHelp: "US = United States (NADAC: the average price retail pharmacies pay to acquire a drug, weekly, per tablet/capsule/mL/gram; not the patient's counter price)",
  placeName: "the United States",
  status: "live",
  paramNotes: {
    medicine:
      "US: generic or brand name, optionally with strength and form ('atorvastatin', 'atorvastatin 20mg', 'metformin 500 mg tablet', 'Lipitor'). " +
      "NADAC uses American generic names ('acetaminophen' for paracetamol, 'albuterol' for salbutamol; the common British names are mapped). Returns the per-unit cost to the pharmacy.",
  },
  examples: [
    { params: { country: "US", medicine: "atorvastatin" } },
    { params: { country: "US", medicine: "metformin" }, smoke: false },
    { params: { country: "US", medicine: "atorvastatin 20mg" }, smoke: false },
  ],
  method:
    "United States (medicines): the weekly NADAC (National Average Drug Acquisition Cost) from the Centers for Medicare & Medicaid Services, read live from data.medicaid.gov. It is the average price retail community pharmacies pay to acquire a drug per unit (tablet, mL or gram), calculated by CMS from pharmacy purchase invoices. Official statistic; not the price a patient pays at the counter.",
  handle: (p, ctx) => nadacMedicine({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
