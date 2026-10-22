// Manifest: Queensland (Australia) rents, median weekly rent of new tenancies by postcode (RTA bond statistics). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, qldHarvest, qldRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["AU"],
  countryHelp: "AU = Australia, Queensland only (RTA rental bond statistics; New South Wales has its own source)",
  placeName: "Queensland, Australia",
  status: "live",
  paramNotes: {
    town: "AU (Queensland): give a four-digit postcode; the RTA publishes by postcode, so a place name has no answer.",
    postcode: "AU (Queensland): a four-digit postcode, e.g. 4000 (Brisbane city), 4217 (Surfers Paradise), 4870 (Cairns), 4350 (Toowoomba). NSW postcodes (2xxx) are answered by the NSW source.",
    property_type: "AU (Queensland): apartment (flat), house or any. Townhouses are published separately and appear in extra.other_dwellings; rooms are not published.",
    bedrooms: "AU (Queensland): flats 1-3, houses 2-4, townhouses 2-3. With no type and no bedrooms the answer is the most common dwelling in the postcode.",
    months: "AU (Queensland): ignored; the RTA publishes one median per quarter (the latest is returned).",
  },
  examples: [
    { params: { country: "AU", postcode: "4000", property_type: "apartment", bedrooms: "2" } },
    { params: { country: "AU", postcode: "4870" }, smoke: false },
  ],
  method:
    "Queensland rents: the collector reads the RTA's quarterly bond statistics workbook once a day into our price library; answers pass on the published median weekly rent of the new tenancies whose bonds were lodged in the latest quarter, for one postcode and dwelling type (flat, house or townhouse by bedrooms), with the number of new bonds as the sample size. These are rents of new tenancies, not sitting tenants; no range is published and a postcode and dwelling with fewer than 5 new bonds gets no figure.",
  // Australia has two rent sources (NSW is the default); Queensland postcodes are 4000-4999 and 9000-9999 (or the state is named).
  serves: (p) => {
    const pc = str(p.postcode) ?? (/^\d{4}$/.test((str(p.town) ?? "").trim()) ? str(p.town)!.trim() : undefined);
    if (pc && /^\d{4}$/.test(pc.trim())) return /^[49]/.test(pc.trim());
    return /^(qld|queensland)$/i.test((str(p.town) ?? "").trim());
  },
  handle: (p, ctx) =>
    qldRents({
      postcode: str(p.postcode),
      town: str(p.town),
      property_type: str(p.property_type),
      bedrooms: num(p.bedrooms),
      baseUrl: ctx.baseUrl,
    }),
  harvest: qldHarvest,
});
