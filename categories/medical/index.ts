// Tool: what public health insurance allowed or paid for doctors' services and hospital stays (official statistics). Sources plug in by declaring category "medical".
// The tool name pricepaid_medical_prices is public: never rename it.
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "medical",
  tool: "pricepaid_medical_prices",
  restPath: "medical",
  cacheSeconds: 86400,
  title: "Doctor and hospital prices paid",
  noun: "Doctor and hospital prices",
  description: (places) =>
    "Use this when a user asks what a medical service or hospital stay costs, or what was actually paid for it, for example an office visit, an MRI, a colonoscopy, physical therapy, a knee replacement or a pneumonia stay, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the official average amount the public health insurer allowed per service (doctors' services, in an office or a facility) or paid per hospital stay (by hospital-stay group), nationally or for one state where the source publishes it, " +
    "with the number of services or discharges behind it, the share the insurer itself paid, the national average for comparison and the data year, plus the official source and licence. " +
    "These are public-insurance rates (price_type official_statistic): what the insurer allowed or paid, NOT private-insurance negotiated prices or cash prices, which are usually higher, and not a quote. " +
    "A published average, so the range fields are null. Facility figures are the doctor's fee only; the hospital's or surgery centre's fee is separate. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for a quote or what a specific hospital or doctor charges, private-insurance or out-of-pocket costs, drug or prescription prices, dental or vision plans, or other countries.",
  params: {
    service: z
      .string()
      .min(2)
      .describe("The medical service: plain words ('office visit', 'MRI lower back', 'knee replacement'), a billing code or a hospital-stay group code, as the country notes list them. Required."),
    state: z.string().min(2).optional().describe("A state or territory, where the source publishes one (the country notes say how to write it). Leave out for the national average."),
    setting: z
      .enum(["office", "facility", "inpatient"])
      .optional()
      .describe("office = a doctor's office (whole service); facility = hospital outpatient or surgery centre (doctor's fee only); inpatient = a hospital stay. Leave out to use the usual setting for the service."),
  },
  required: ["service"],
});
