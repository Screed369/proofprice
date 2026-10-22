// Manifest: Sweden rents of newly built rented flats (Statistics Sweden, table BO0404 / TAB6421). Logic lives in ./source.ts.
// Answers rent requests for SE that carry new_build=true; sources/se-scb-rents answers every other SE rent request (declared serves() in both).
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, seNewBuildRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["SE"],
  countryHelp: "SE = Sweden (Statistics Sweden rent survey; with new_build=true, rents of newly built rented flats)",
  placeName: "Sweden",
  status: "live",
  extraParams: {
    new_build: z.boolean().optional().describe("SE only: true = rents of newly built rented flats (built from 2022) instead of the all-flats rent survey."),
  },
  paramNotes: {
    town: "SE with new_build=true: optional region group: 'Sweden' (default), 'Greater Stockholm', 'Greater Gothenburg', 'Greater Malmo', 'large municipalities' or 'small municipalities'.",
    bedrooms: "SE with new_build=true: optional number of ROOMS (1, 2, 3 or 4 = four or more); leave out for all new-build flats together.",
  },
  examples: [
    { params: { country: "SE", new_build: "true", town: "Greater Stockholm", bedrooms: "2" } },
    { params: { country: "SE", new_build: "true" }, smoke: false },
  ],
  method:
    "Sweden new-build rents: the average monthly rent of rented flats in newly constructed buildings at 31 December (Statistics Sweden, table BO0404), by region group and number of rooms, with the number of flats behind it. It is a published average, not a list of rents.",
  serves: (p) => p.new_build === true || String(p.new_build ?? "").toLowerCase() === "true",
  handle: (p, ctx) => seNewBuildRent({ town: str(p.town), rooms: num(p.bedrooms), baseUrl: ctx.baseUrl }),
});
