// Manifest: Norway kindergarten fees (Statistics Norway table 11573). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, noChildcare } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["NO"],
  countryHelp: "NO = Norway (Statistics Norway average kindergarten fees by municipality, January)",
  placeName: "Norway",
  status: "live",
  paramNotes: {
    area: "NO: a municipality such as Oslo, Bergen, Trondheim, Stavanger or Tromso (Norwegian spellings work). Leave out for the whole country.",
    age_group: "NO: ignored; the table averages all kindergarten children.",
    care_type: "NO: ignored; the table averages all kindergartens.",
    hours: "NO: ignored; the table gives one monthly average.",
  },
  examples: [
    { params: { country: "NO", area: "Oslo" } },
    { params: { country: "NO" }, smoke: false },
  ],
  method:
    "Norway childcare: each request reads Statistics Norway table 11573 and passes on the published average monthly parental payment per kindergarten place in January for the chosen municipality or the whole country, including free places, food and additional fees. A municipal average, not a range.",
  handle: (p, ctx) => noChildcare({ area: str(p.area), baseUrl: ctx.baseUrl }),
});
