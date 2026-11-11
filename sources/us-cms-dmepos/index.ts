// Manifest: US medical equipment and supplies at Medicare's fee schedule (CMS DMEPOS, quarterly), in the "medical" tool.
// Shares country US with us-cms-medicare (doctor and hospital services). Folder order puts this one first, so serves() says yes ONLY for
// equipment requests: basis=dmepos, or a service that is an HCPCS Level II code starting A, E, K or L.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, dmeposPrices, isDmeposRequest, methodText } from "./source";

export default defineSource({
  info: INFO,
  category: "medical",
  countries: ["US"],
  countryHelp: "US = United States (basis=dmepos gives Medicare's fee-schedule amount for medical equipment and supplies such as wheelchairs, CPAP and oxygen, quarterly)",
  placeName: "the United States (Medicare fees for medical equipment)",
  status: "live",
  serves: (p) => isDmeposRequest(p),
  paramNotes: {
    service:
      "US with basis=dmepos: an HCPCS equipment code ('E0601' CPAP, 'E1390' oxygen concentrator, 'K0001' standard wheelchair, 'E0143' walker, add a modifier like 'E0601 RR' for rental) or plain words from the CMS descriptor ('wheelchair', 'oxygen concentrator'). Codes starting A, E, K or L are treated as equipment even without basis.",
    state: "US equipment: a state as a two-letter code or name (TX, Texas). Leave out for the median across states with the cheapest and dearest state.",
  },
  extraParams: {
    basis: z.string().optional().describe("US only: dmepos = Medicare's fee schedule for medical equipment and supplies (wheelchairs, CPAP, oxygen, walkers, test strips). Leave out for doctor and hospital prices."),
  },
  examples: [
    { params: { country: "US", service: "E0601", basis: "dmepos" } },
    { params: { country: "US", service: "K0001", state: "TX" }, smoke: false },
    { params: { country: "US", service: "oxygen concentrator", basis: "dmepos", state: "CA" }, smoke: false },
  ],
  method: methodText(),
  handle: (p, ctx) => dmeposPrices({ service: str(p.service), state: str(p.state), baseUrl: ctx.baseUrl }),
});
