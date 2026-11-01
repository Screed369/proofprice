// Manifest: Japan official land prices (MLIT Land Price Publication, annual appraisals of benchmark plots), in the commercial-property tool. Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, jpLandPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["JP"],
  countryHelp: "JP = Japan (MLIT Land Price Publication: official 1 January appraisals of benchmark plots, yen per m² of land; appraisals, not recorded sales)",
  placeName: "Japan",
  status: "live",
  paramNotes: {
    town: "JP: a Tokyo ward in English (Shibuya, Minato, Chiyoda, Setagaya...) or Japanese, a prefecture name (Osaka, Aichi), or a Japanese municipality name together with the prefecture parameter. One prefecture per question.",
    postcode: "JP: not supported; give prefecture and town.",
    property_type: "JP: land (default, all benchmark plots) or commercial (plots in commercial or industrial zones). Values are official appraisals, not sales.",
    months: "JP: ignored; the figures are annual (1 January valuation, newest edition).",
  },
  extraParams: {
    prefecture: z.string().optional().describe("JP only: prefecture, English (Tokyo, Osaka, Hokkaido), Japanese (東京都) or 2-digit JIS code (13). Needed unless town is a Tokyo ward."),
  },
  examples: [
    { params: { country: "JP", town: "Shibuya", property_type: "land" } },
    { params: { country: "JP", prefecture: "Osaka", property_type: "commercial" }, smoke: false },
  ],
  method:
    "Japan: median and 10th-90th percentile of the official appraised land price per m² (yen) over the MLIT Land Price Publication benchmark plots in the chosen prefecture or municipality, 1 January valuation of the newest edition. Appraisals, not recorded sales.",
  handle: (p, ctx) =>
    jpLandPrices({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), prefecture: str(p.prefecture), baseUrl: ctx.baseUrl }),
});
