// Manifest: Tasmania (Australia) rents from rental bond lodgements. Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, tasHarvest, tasHistoryKey, tasRents } from "./source";

// A few well-known Tasmanian towns, so a plain place name routes here instead of to the NSW source (which asks for a postcode).
const TAS_PLACES = new Set([
  "tas", "tasmania", "hobart", "launceston", "devonport", "burnie", "glenorchy", "clarence", "kingston", "sorell", "new norfolk",
  "ulverstone", "george town", "smithton", "bridgewater", "rosny park", "moonah", "sandy bay", "battery point", "bellerive", "howrah",
  "lindisfarne", "claremont", "latrobe", "wynyard", "somerset", "st helens", "huonville", "penguin", "legana", "prospect", "newstead",
]);

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["AU"],
  countryHelp: "AU = Australia, Tasmania only here (rental bond lodgements); New South Wales, Queensland and South Australia have their own sources",
  placeName: "Tasmania, Australia",
  status: "live",
  paramNotes: {
    town: "AU (Tasmania): 'Tasmania' for the whole state, or a suburb or town such as Hobart, Launceston, Devonport or Glenorchy; a postcode is more precise. A suburb name covers that suburb only (Hobart is the city centre, not Greater Hobart).",
    postcode: "AU (Tasmania): a four-digit postcode starting with 7, e.g. 7000 (Hobart), 7250 (Launceston), 7310 (Devonport), 7010 (Glenorchy).",
    property_type: "AU (Tasmania): apartment (unit or flat), house (includes townhouses and semi-detached) or any. Rooms are not published.",
    bedrooms: "AU (Tasmania): 0 (studio), 1, 2, 3 or 4 (4 means four or more).",
    months: "AU (Tasmania): 3 or 12 (up to 4 uses the latest 3 months, longer uses 12). By default the latest 3 months, widening to 12 when an area is quiet.",
  },
  examples: [
    { params: { country: "AU", postcode: "7000" } },
    { params: { country: "AU", town: "Launceston", property_type: "house", bedrooms: "3" }, smoke: false },
  ],
  // Australia has four rent sources. This folder name sorts before au-nsw-rents on purpose: the registry takes the first source whose serves()
  // says yes, and au-nsw-rents also says yes for 7xxx postcodes. Platform task: make au-nsw-rents serves() exclude 7xxx, then the order no longer matters.
  serves: (p) => {
    const t = (str(p.town) ?? "").trim();
    const pc = (str(p.postcode) ?? "").trim() || (/^\d{4}$/.test(t) ? t : "");
    if (/^\d{4}$/.test(pc)) return /^7/.test(pc);
    return TAS_PLACES.has(t.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " "));
  },
  method:
    "Tasmanian rents: the collector reads the Department of Justice's monthly Rental Bond and Rental Data workbooks (sheet Active Bonds, new private tenancies) once a day into our price library, checking each month that the median bond is four weeks of rent; answers are the median and 10th–90th percentile of the weekly rent on bonds lodged in the latest 3 or 12 months, by postcode or suburb, dwelling type and bedrooms. These are rents of new tenancies as reported by the agent or landlord; community housing is left out.",
  handle: (p, ctx) =>
    tasRents({
      postcode: str(p.postcode),
      town: str(p.town),
      property_type: str(p.property_type),
      bedrooms: num(p.bedrooms),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
  harvest: tasHarvest,
  historyKey: (p) => tasHistoryKey({ postcode: str(p.postcode), town: str(p.town), property_type: str(p.property_type), bedrooms: num(p.bedrooms) }),
  referenceDates: true,
});
