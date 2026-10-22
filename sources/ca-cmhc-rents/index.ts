// Manifest: Canada rents (CMHC Rental Market Survey via Statistics Canada table 34-10-0133-01). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { INFO, caRent, caRentHarvest, rentHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["CA"],
  countryHelp: "CA = Canada (CMHC Rental Market Survey, average rents of purpose-built rental units, official statistic)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    town: "CA: required. A town or city of 10,000 people or more, e.g. Toronto, Montréal (or Montreal), Vancouver, Calgary, Edmonton, Ottawa, Winnipeg, Halifax. Add the province to be exact ('London, Ontario').",
    postcode: "CA: not used; give a town.",
    property_type: "CA: apartment (or flat) means apartment buildings of three or more units; leave out for rows and apartments of three or more units. Houses and rooms are not published.",
    bedrooms: "CA: 0 (bachelor), 1, 2 or 3 (three or more). Leave out for two bedrooms, CMHC's usual headline size; the answer lists every size.",
    months: "CA: ignored; the figure is for the newest October survey.",
    house_type: "CA: not used (houses are not published).",
  },
  examples: [
    { params: { country: "CA", town: "Toronto", bedrooms: "2" } },
    { params: { country: "CA", town: "Vancouver", property_type: "apartment", bedrooms: "1" }, smoke: false },
  ],
  method:
    "Canada rents: the average monthly rent of purpose-built rental units from CMHC's October Rental Market Survey (Statistics Canada table 34-10-0133-01), for the area, unit size and structure type asked, with the change on the previous year's survey. " +
    "It is a published average, not a list of rents and not an asking rent; no range is calculated.",
  handle: (p, ctx) =>
    caRent({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      house_type: str(p.house_type),
      bedrooms: num(p.bedrooms),
      baseUrl: ctx.baseUrl,
    }),
  // A daily copy of the newest October survey, so a Statistics Canada outage is answered from it (stale-if-error). Each row is one
  // published average (n is NO_COUNT), dated by the survey month.
  harvest: () => caRentHarvest(),
  historyKey: (p) =>
    rentHistoryKey(
      { town: str(p.town), property_type: str(p.property_type), bedrooms: num(p.bedrooms) },
      [...new Set((readLatestDay(INFO.id)?.rows ?? []).map((r) => r.area))],
    ),
  referenceDates: true,
  nominalCounts: true,
});
