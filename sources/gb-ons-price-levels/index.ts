// Manifest: United Kingdom grocery and everyday prices (ONS price level distributions of grocery products). Logic lives in ./source.ts.
// The daily collector (harvest) copies the newest monthly ONS workbook into the price library; requests are answered from the library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, gbHarvest, gbOnsPriceLevels } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (Office for National Statistics: median shop prices of about 200 grocery and drink product types, monthly, UK and 12 regions and nations)",
  placeName: "the United Kingdom",
  status: "live",
  paramNotes: {
    item:
      "GB: ONS's product types, each in one pack size, e.g. eggs (free-range, pack of 12), milk (whole, 4 pints), semi-skimmed milk (2 pints), bread (sliced white, 800 g), butter (250 g), cheese (cheddar, per kg), " +
      "chicken (whole, per kg), beef mince (per kg), bananas, apples, potatoes (per kg), rice, pasta, instant coffee, tea bags, sugar, lager, wine.",
    region:
      "GB: leave out for the whole UK, or give an English region (North East, North West, Yorkshire and the Humber, East Midlands, West Midlands, East of England, London, South East, South West), Scotland, Wales or Northern Ireland " +
      "(a big city maps to its region). ONS withholds a regional figure when fewer than ten observations stand behind it.",
  },
  examples: [
    { params: { country: "GB", item: "eggs" } },
    { params: { country: "GB", item: "milk" } },
  ],
  method:
    "United Kingdom (groceries): the median shop price of about 200 grocery and drink product types (one pack size each) that the Office for National Statistics publishes every month from the prices behind its consumer price index " +
    "(price collectors in shops and online combined with retailer scanner data), with the lower and upper quartile, mean, lowest and highest. We copy the ONS file once a day and pass on the published figures and their month. " +
    "ONS advises against comparing months, so there is no change on a year earlier; these are shelf prices, not receipts.",
  nominalCounts: true,
  harvest: gbHarvest,
  // ONS advises against comparing months and its product keys change with each release: no price history is offered for the UK.
  historyKey: () => null,
  handle: (p, ctx) => gbOnsPriceLevels({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
