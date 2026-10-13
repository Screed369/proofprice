import type { MetadataRoute } from "next";
import { buildRobots } from "../lib/open-book";

// Everyone is welcome, AI crawlers included. The sitemap lists the pages and the machine-readable files.
export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
