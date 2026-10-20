// Manifest: Singapore hospital bills by medical condition (MOH fee benchmarks). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, sgBills } from "./source";

export default defineSource({
  info: INFO,
  category: "medical",
  countries: ["SG"],
  countryHelp: "SG = Singapore (Ministry of Health: median and middle-half hospital bills for medical conditions, Singapore Citizens, 2023)",
  placeName: "Singapore (hospital bills for medical conditions)",
  status: "live",
  paramNotes: {
    service: "Singapore: a medical condition in plain words ('stroke', 'pneumonia', 'dengue', 'heart failure', 'dementia') or an MOH DRG code ('B70A'). Surgery and doctor visits are not covered.",
    state: "Singapore: the ward class, because Singapore has no states: c = public subsidised Ward C (default), b2 = public subsidised Ward B2, b1 = public unsubsidised Ward B1, a = public unsubsidised Ward A, private = private hospital.",
    setting: "Singapore: only inpatient (a hospital stay); leave out.",
  },
  examples: [
    { params: { country: "SG", service: "stroke" } },
    { params: { country: "SG", service: "pneumonia", state: "private" }, smoke: false },
    { params: { country: "SG", service: "B70A", state: "b2" }, smoke: false },
  ],
  method:
    "Singapore hospital bills: the Ministry of Health's published 25th, 50th (median) and 75th percentile of total transacted hospital bills for Singapore Citizens, by medical condition (DRG), setting and ward type, calendar year 2023, GST included, before insurance and MediSave. " +
    "We pass on the published median and range; MOH gives no number of cases.",
  handle: (p, ctx) => sgBills({ service: str(p.service), ward: str(p.state), setting: str(p.setting), baseUrl: ctx.baseUrl }),
});
