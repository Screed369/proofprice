import type { MetadataRoute } from "next";
import { buildSitemap } from "../lib/open-book";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap();
}
