// Manifest: Singapore Certificate of Entitlement (COE) prices. Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { COE_CLASSES, INFO, sgCoe } from "./source";

export default defineSource({
  info: INFO,
  category: "cars",
  countries: ["SG"],
  countryHelp: "SG = Singapore COE (Certificate of Entitlement) bidding results",
  placeName: "Singapore car ownership rights (COE)",
  status: "live",
  paramNotes: { product: "SG: 'coe'." },
  extraParams: {
    vehicle_class: z.enum(COE_CLASSES).optional().describe("SG only: COE category. A = cars up to 1600cc (default), B = cars above 1600cc, C = goods vehicles/buses, D = motorcycles, E = open."),
  },
  examples: [
    { params: { country: "SG", product: "coe", vehicle_class: "A" } },
    { params: { country: "SG", product: "coe", vehicle_class: "D", months: "24" }, smoke: false },
  ],
  method: "Singapore COE: median of the winning premium across bidding rounds from the Land Transport Authority's official results.",
  handle: (p, ctx) => sgCoe({ vehicle_class: str(p.vehicle_class), months: num(p.months), baseUrl: ctx.baseUrl }),
});
