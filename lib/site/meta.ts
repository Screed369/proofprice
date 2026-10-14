// One helper so every page gets the same metadata shape: title (with the site suffix from the layout template),
// description, a canonical URL, and Open Graph / Twitter cards. Next replaces openGraph and twitter wholesale when a page
// sets them, so each page must pass the image again: this helper does that in one place.

import type { Metadata } from "next";
import { SITE_NAME, SITE_URL, TAGLINE } from "./constants";

export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: `${SITE_NAME}: ${TAGLINE}` };

export function canonicalUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

export function pageMetadata(o: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  const full = o.absoluteTitle ? o.title : `${o.title} · ${SITE_NAME}`;
  const url = canonicalUrl(o.path);
  return {
    title: o.absoluteTitle ? { absolute: o.title } : o.title,
    description: o.description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: SITE_NAME, url, title: full, description: o.description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description: o.description, images: [OG_IMAGE.url] },
  };
}
