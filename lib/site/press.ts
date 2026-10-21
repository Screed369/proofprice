// Facts for the /press page. Every number is read from the live registry (coverage), nothing is typed in here.

import { CATEGORIES, SOURCE_PLUGINS } from "../registry";
import { countryName } from "./areas";
import { MCP_URL, SITE_URL } from "./constants";

export const PRESS_LOGOS = [
  { path: "/logo.svg", label: "Logo with name (SVG)" },
  { path: "/icon-512.png", label: "Icon, 512 px (PNG)" },
  { path: "/icon-64.png", label: "Icon, 64 px (PNG)" },
  { path: "/og.png", label: "Social share image, 1200 x 630 (PNG)" },
];

export function pressFacts() {
  const countryCodes = Array.from(new Set(SOURCE_PLUGINS.flatMap((s) => s.countries))).sort();
  const categories = CATEGORIES.map((c) => ({ id: c.id, title: c.title, tool: c.tool, rest: `/api/v1/${c.restPath}` }));
  return {
    sources: SOURCE_PLUGINS.length,
    countries: countryCodes.length,
    countryNames: countryCodes.map(countryName),
    categories,
    mcpUrl: MCP_URL,
    siteUrl: SITE_URL,
  };
}
