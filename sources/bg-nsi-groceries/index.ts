// Manifest: Bulgaria grocery prices (NSI Household Budget Survey, average prices households paid). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, bgNsiGroceries, bgNsiHarvest, bgNsiHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["BG"],
  countryHelp: "BG = Bulgaria (National Statistical Institute NSI: national annual average price households paid for about 60 main foods and drinks, in EUR)",
  placeName: "Bulgaria",
  status: "live",
  paramNotes: {
    item:
      "BG: NSI's main foods, e.g. milk (litre), bread (white, kg), eggs (per egg), butter, white cheese, yellow cheese, chicken (poultry meat), pork, potatoes, apples, bananas, tomatoes, sugar, " +
      "flour, rice, coffee, beer (litre), wine (litre), sunflower oil.",
    region: "BG: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "BG", item: "milk" } },
    { params: { country: "BG", item: "eggs" }, smoke: false },
  ],
  method:
    "Bulgaria (groceries): the national average price that households reported paying per kg, litre or item for about 60 main foods, from the National Statistical Institute's Household Budget Survey (table HH_6.1), annual. We pass on the published average and its year; it is a survey unit value, not a shelf price or receipt.",
  handle: (p, ctx) => bgNsiGroceries({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => bgNsiHarvest(),
  historyKey: (p) => bgNsiHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
  staleMaxDays: 45,
  noHistory: "Bulgaria: NSI publishes one national average per food and year; the last 8 years sit in extra.published_by_year of the live answer.",
});
