// Manifest: Poland home sales (Real Estate Price Register RCN, GUGiK). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, PLACES, plHomeSales } from "./source";

const cities = PLACES.map((p) => p.label).join(", ");

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["PL"],
  countryHelp: "PL = Poland (national Real Estate Price Register: notarised flat sales in the 19 biggest cities)",
  placeName: "Poland (flats in the big cities)",
  status: "live",
  paramNotes: {
    town: `PL: a city, required (${cities}); Polish or English spelling. Flats only. A city county is read as a whole; districts are not available.`,
    postcode: "PL: not supported; give the city as town.",
    property_type: "PL: only flats are in the register extract we read, so leave out or use any.",
    months: "PL: 1 to 6 months of 30 days up to today; default 3. Large cities are read as a sample of up to 300 records per 30 days (the answer says so).",
  },
  examples: [
    { params: { country: "PL", town: "Warszawa" } },
    { params: { country: "PL", town: "Krakow", months: "2" }, smoke: false },
  ],
  pages: [
    { params: { country: "PL", town: "Warszawa" }, label: "Warsaw", question: "What do flats sell for in Warsaw, Poland?" },
    { params: { country: "PL", town: "Krakow" }, label: "Krakow", question: "What do flats sell for in Krakow, Poland?" },
    { params: { country: "PL", town: "Wroclaw" }, label: "Wroclaw", question: "What do flats sell for in Wroclaw, Poland?" },
    { params: { country: "PL", town: "Gdansk" }, label: "Gdansk", question: "What do flats sell for in Gdansk, Poland?" },
    { params: { country: "PL", town: "Poznan" }, label: "Poznan", question: "What do flats sell for in Poznan, Poland?" },
    { params: { country: "PL", town: "Lodz" }, label: "Lodz", question: "What do flats sell for in Lodz, Poland?" },
  ],
  // Poland shares home-sales with eu-home-price-index (the national index): this source answers when a city is given as town.
  serves: (p) => !!str(p.town),
  method:
    "Poland: notarised flat sales on the free market from the national Real Estate Price Register (GUGiK), read live from the official Geoportal WFS service in 30-day slices; median and 10th-90th percentile of the gross price per flat and per m2, implausible records dropped, and only the aggregate kept.",
  handle: (p, ctx) =>
    plHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
