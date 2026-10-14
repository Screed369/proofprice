// schema.org JSON-LD for the website. Pure functions that return plain objects; app/_components/JsonLd.tsx prints them.
// Everything here describes things the visible page also says (Google's rule for structured data).

import { noFullStop, type AnswerPage } from "./answer-pages";
import { CONTACT, MCP_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./constants";

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const API_ID = `${SITE_URL}/#api`;

/** JSON for a <script type="application/ld+json">. Escapes <, > and & so the data can never close the script tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

export function absolute(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

// ---------- home page ----------

export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png`, width: 512, height: 512 },
    image: `${SITE_URL}/og.png`,
    description: SITE_DESCRIPTION,
    email: CONTACT,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: CONTACT, availableLanguage: "en" },
    publishingPrinciples: `${SITE_URL}/trust`,
  };
}

export function webSiteLd() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}

export function webApiLd() {
  return {
    "@type": "WebAPI",
    "@id": API_ID,
    name: "ProofPrice MCP server and REST API",
    description:
      "Answers what people actually paid for homes, fuel and more in a place and period. Returns a median, a typical range, sample size, period, confidence, source and licence. Read-only, no API key.",
    url: MCP_URL,
    documentation: [`${SITE_URL}/connect`, `${SITE_URL}/openapi.json`, `${SITE_URL}/llms.txt`],
    termsOfService: `${SITE_URL}/terms`,
    provider: { "@id": ORG_ID },
    serviceType: "MCP server (Streamable HTTP) and REST API",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
}

/** The home page: who we are, the site, the API, and the page itself with its significant links (including privacy). */
export function homeGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationLd(),
      webSiteLd(),
      webApiLd(),
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: SITE_URL,
        name: `${SITE_NAME}: what people actually paid`,
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": WEBSITE_ID },
        about: { "@id": API_ID },
        significantLink: ["/connect", "/sources", "/trust", "/prices", "/privacy", "/terms", "/openapi.json"].map(absolute),
      },
    ],
  };
}

// ---------- /sources: one Dataset per source ----------

export interface DatasetInput {
  id: string; // source id, also the #anchor on /sources
  name: string;
  whatIsRecorded: string;
  limits: string;
  publisher: string;
  publisherUrl: string;
  licenceUrl: string;
  attribution: string;
  countries: { code: string; name: string }[];
  restUrl: string; // an example request, absolute or relative to the site
  categoryTitle: string;
  dateModified?: string | null; // YYYY-MM-DD the collected aggregates were last refreshed (library sources only)
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function datasetLd(d: DatasetInput) {
  const pageUrl = `${SITE_URL}/sources#${d.id}`;
  return {
    "@type": "Dataset",
    "@id": pageUrl,
    url: pageUrl,
    identifier: d.id,
    name: d.name,
    description: `${sentence(d.whatIsRecorded)} ${sentence(d.limits)}`,
    license: d.licenceUrl,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: d.publisher, url: d.publisherUrl },
    publisher: { "@id": ORG_ID },
    isBasedOn: d.publisherUrl,
    creditText: d.attribution,
    keywords: ["price paid", "prices", "open data", d.categoryTitle, ...d.countries.map((c) => c.name)],
    spatialCoverage: d.countries.map((c) => ({
      "@type": "Place",
      name: c.name,
      address: { "@type": "PostalAddress", addressCountry: c.code },
    })),
    variableMeasured: ["Median price", "10th percentile price", "90th percentile price", "Number of records"],
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: absolute(d.restUrl),
      },
    ],
    ...(d.dateModified ? { dateModified: d.dateModified } : {}),
  };
}

export function sourcesGraph(datasets: DatasetInput[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/sources#page`,
        url: `${SITE_URL}/sources`,
        name: "Sources, licences and attribution",
        isPartOf: { "@id": WEBSITE_ID },
        mainEntity: datasets.map((d) => ({ "@id": `${SITE_URL}/sources#${d.id}` })),
      },
      ...datasets.map(datasetLd),
    ],
  };
}

// ---------- breadcrumbs and answer pages ----------

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absolute(it.path),
    })),
  };
}

/** A page that only needs breadcrumbs (index pages). */
export function breadcrumbGraph(crumbs: { name: string; path: string }[]) {
  return { "@context": "https://schema.org", ...breadcrumbLd(crumbs) };
}

/** An answer page: its Q&A (the same questions and answers the page shows), plus breadcrumbs. */
export function answerPageGraph(page: AnswerPage, crumbs: { name: string; path: string }[]) {
  const url = absolute(page.path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: page.h1,
        description: page.description,
        dateModified: page.asOf,
        isPartOf: { "@id": WEBSITE_ID },
        breadcrumb: breadcrumbLd(crumbs),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        url,
        mainEntity: page.figures.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${f.answer} Source: ${noFullStop(page.source.publisher)}. Licence: ${noFullStop(page.source.licence)}.${f.caveat ? ` ${f.caveat}` : ""}`,
          },
        })),
      },
    ],
  };
}
