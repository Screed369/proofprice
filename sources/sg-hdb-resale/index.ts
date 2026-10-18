// Manifest: Singapore public-housing (HDB) resale prices. Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { INFO, sgHomeSales, SG_FLAT_TYPES } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["SG"],
  countryHelp: "SG = Singapore HDB resale flats",
  placeName: "Singapore public housing",
  status: "live",
  paramNotes: { town: "SG: required, one of the 26 HDB towns, e.g. 'Tampines', 'Ang Mo Kio', 'Bukit Merah', 'Kallang/Whampoa', 'Central Area' (case, hyphens and ', Singapore' are forgiven; 'Kallang' and 'CBD' are understood)." },
  extraParams: {
    flat_type: z.enum(SG_FLAT_TYPES).optional().describe("SG only: HDB flat type."),
  },
  examples: [
    { params: { country: "SG", town: "Tampines" } },
    { params: { country: "SG", town: "Tampines", flat_type: "4 ROOM" }, smoke: false },
  ],
  handle: (p, ctx) => {
    const town = str(p.town) ?? str(p.area);
    if (!town) throw new InputError("A town is required.");
    return sgHomeSales({ town, flat_type: str(p.flat_type), months: num(p.months), baseUrl: ctx.baseUrl });
  },
});
