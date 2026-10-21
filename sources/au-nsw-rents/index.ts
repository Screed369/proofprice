// Manifest: New South Wales (Australia) rents from rental bond lodgements. Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, nswHarvest, nswRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["AU"],
  countryHelp: "AU = Australia, New South Wales only (rental bonds)",
  placeName: "New South Wales, Australia",
  status: "live",
  paramNotes: {
    town: "AU: use 'NSW' for the whole state; otherwise give a postcode (NSW rents are published by postcode).",
    postcode: "AU: a four-digit NSW postcode, e.g. 2000 (Sydney CBD), 2150 (Parramatta), 2500 (Wollongong).",
    property_type: "AU: apartment (flat or unit), house (includes terraces, townhouses and semi-detached) or any. Rooms are not published.",
    bedrooms: "AU: 0 (studio), 1, 2, 3 or 4 (4 means four or more).",
    months: "AU: 3 or 12 (anything up to 4 uses the latest 3 months, longer uses 12). By default the latest 3 months, widening to 12 when a postcode is quiet.",
  },
  examples: [
    { params: { country: "AU", postcode: "2000" } },
    { params: { country: "AU", postcode: "2150", property_type: "apartment", bedrooms: "2" }, smoke: false },
  ],
  // Australia has two rent sources: this one (the default) and au-qld-rents, which takes Queensland postcodes (4xxx, 9xxx) or town "QLD".
  serves: (p) => {
    const t = (str(p.town) ?? "").trim();
    const pc = (str(p.postcode) ?? "").trim() || (/^\d{4}$/.test(t) ? t : "");
    if (/^\d{4}$/.test(pc)) return !/^[49]/.test(pc);
    return !/^(qld|queensland)$/i.test(t);
  },
  method:
    "New South Wales rents: the collector reads the monthly NSW Fair Trading rental bond lodgement files once a day into our price library; answers are the median and 10th–90th percentile of the weekly rent on bonds lodged in the latest 3 or 12 months, by postcode, dwelling type and bedrooms. These are rents of new tenancies as provided by the agent or landlord; rooms, garages and car spaces are left out.",
  handle: (p, ctx) =>
    nswRents({
      postcode: str(p.postcode),
      town: str(p.town),
      property_type: str(p.property_type),
      bedrooms: num(p.bedrooms),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
  harvest: nswHarvest,
});
