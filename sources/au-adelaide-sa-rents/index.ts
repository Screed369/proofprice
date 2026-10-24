// Manifest: South Australia (Australia) rents, median weekly rent of new tenancies by suburb or postcode (SA Housing Authority Private Rent Report). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, knowsSuburb, saHarvest, saRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["AU"],
  countryHelp: "AU = Australia, South Australia only here (Private Rent Report, by suburb or postcode; New South Wales and Queensland have their own sources)",
  placeName: "South Australia, Australia",
  status: "live",
  paramNotes: {
    town: "AU (South Australia): a suburb name, e.g. Glenelg, Norwood or Mount Barker; or a four-digit 5xxx postcode.",
    postcode: "AU (South Australia): a four-digit postcode, e.g. 5000 (Adelaide), 5067 (Norwood), 5045 (Glenelg), 5290 (Mount Gambier).",
    property_type: "AU (South Australia): apartment (flat or unit), house or any. Rooms are not published.",
    bedrooms: "AU (South Australia): 1, 2, 3 or 4 (4 means four or more); studios (0) are not published.",
    months: "AU (South Australia): ignored; the report gives one median per quarter (the latest is returned).",
  },
  examples: [
    { params: { country: "AU", postcode: "5000" } },
    { params: { country: "AU", town: "Glenelg", property_type: "apartment", bedrooms: "2" }, smoke: false },
  ],
  method:
    "South Australian rents: the collector reads the SA Housing Authority's quarterly Private Rent Report workbook once a day into our price library; answers pass on the published median weekly rent of the new tenancies whose bonds were lodged in the latest quarter, for one suburb or postcode and dwelling type (flat/unit or house, by bedrooms), with the number of bonds as the sample size. These are rents of new tenancies, not sitting tenants; no range is published and a figure needs at least 6 bonds.",
  // Australia has three rent sources (NSW is the default). This folder name sorts before au-nsw-rents on purpose: the registry takes the first source whose
  // serves() says yes, and au-nsw-rents also says yes for 5xxx postcodes. Platform task: make au-nsw-rents serves() exclude 5xxx, then this ordering no longer matters.
  serves: (p) => {
    const t = (str(p.town) ?? "").trim();
    const pc = (str(p.postcode) ?? "").trim() || (/^\d{4}$/.test(t) ? t : "");
    if (/^\d{4}$/.test(pc)) return /^5/.test(pc);
    if (/^(sa|south australia)$/i.test(t)) return true;
    return t.length > 1 && knowsSuburb(t);
  },
  handle: (p, ctx) =>
    saRents({ postcode: str(p.postcode), town: str(p.town), property_type: str(p.property_type), bedrooms: num(p.bedrooms), baseUrl: ctx.baseUrl }),
  harvest: saHarvest,
});
