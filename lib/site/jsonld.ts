// schema.org JSON-LD for the website. Pure functions that return plain objects; app/_components/JsonLd.tsx prints them.
// Everything here describes things the visible page also says (Google's rule for structured data).

import { noFullStop, type AnswerPage } from "./answer-pages";
import { CONTACT, MCP_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./constants";
import type { ExamplePage } from "./example-pages";

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

// ---------- /prices pages: one Dataset per page that shows a figure ----------

interface PageDatasetInput {
  url: string;
  name: string;
  description: string;
  source: { id: string; publisher: string; homepage: string; licence_url: string; attribution: string };
  countryCode: string;
  countryName: string;
  placeName: string | null; // a named place inside the country, when the page is about one
  categoryLabel: string;
  temporal: string | null; // ISO 8601 date or interval: "2025-10-02/2026-10-02"
  dateModified: string | null;
  restUrl: string | null; // the live answer, when the API can give one
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function pageDatasetLd(d: PageDatasetInput) {
  return {
    "@type": "Dataset",
    "@id": `${d.url}#dataset`,
    url: d.url,
    identifier: d.source.id,
    name: d.name,
    description: d.description,
    license: d.source.licence_url,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: d.source.publisher, url: d.source.homepage },
    publisher: { "@id": ORG_ID },
    isBasedOn: d.source.homepage,
    creditText: d.source.attribution,
    keywords: ["price paid", "prices", "open data", d.categoryLabel, d.countryName, ...(d.placeName ? [d.placeName] : [])],
    spatialCoverage: {
      "@type": "Place",
      name: d.placeName ? `${d.placeName}, ${d.countryName}` : d.countryName,
      address: { "@type": "PostalAddress", addressCountry: d.countryCode },
    },
    variableMeasured: ["Median price", "10th percentile price", "90th percentile price", "Number of records"],
    ...(d.temporal ? { temporalCoverage: d.temporal } : {}),
    ...(d.dateModified && ISO_DAY.test(d.dateModified) ? { dateModified: d.dateModified } : {}),
    ...(d.restUrl
      ? { distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: absolute(d.restUrl) }] }
      : {}),
  };
}

const interval = (from: string | undefined, to: string | undefined, fallback: string | null) =>
  from && to && ISO_DAY.test(from) && ISO_DAY.test(to) ? `${from}/${to}` : fallback && ISO_DAY.test(fallback) ? fallback : null;

/** The Dataset behind an answer page (a place of a library source). */
export function answerPageDatasetLd(page: AnswerPage) {
  const url = absolute(page.path);
  return pageDatasetLd({
    url,
    name: page.h1,
    description: page.description,
    source: page.source,
    countryCode: page.country,
    countryName: page.countryName,
    placeName: page.national ? null : page.area.label,
    categoryLabel: page.categoryLabel,
    temporal: interval(page.period?.from, page.period?.to, page.asOf),
    dateModified: page.asOf,
    restUrl: page.figures.find((f) => f.liveRestPath)?.liveRestPath ?? page.historyRestPath,
  });
}

/** The Dataset behind an example page. Only when the page shows a figure: an "ask live" page states no data. */
export function examplePageDatasetLd(page: ExamplePage) {
  const f = page.figure;
  if (!f) return null;
  const period = f.periodText?.match(/^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/);
  const refPeriod = f.referencePeriod && /^\d{4}(-\d{2}|-Q[1-4])?$/.test(f.referencePeriod) ? f.referencePeriod : null;
  return pageDatasetLd({
    url: absolute(page.path),
    name: page.h1,
    description: page.description,
    source: page.source,
    countryCode: page.country,
    countryName: page.countryName,
    placeName: null,
    categoryLabel: page.categoryLabel,
    temporal: period ? `${period[1]}/${period[2]}` : refPeriod ?? f.asOf,
    dateModified: f.asOf,
    restUrl: page.liveRestPath,
  });
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

/** A page of plain questions and answers (for example /pricing): breadcrumbs plus FAQPage. The answers must match the visible page. */
export function faqPageGraph(path: string, crumbs: { name: string; path: string }[], qas: { question: string; answer: string }[]) {
  const url = absolute(path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#page`, url, isPartOf: { "@id": WEBSITE_ID }, breadcrumb: breadcrumbLd(crumbs) },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        url,
        mainEntity: qas.map((q) => ({
          "@type": "Question",
          name: q.question,
          acceptedAnswer: { "@type": "Answer", text: q.answer },
        })),
      },
    ],
  };
}

/** An example page: breadcrumbs, and its Q&A only when the page shows an answer. The "ask live" form states no answer, so it has no FAQ. */
export function examplePageGraph(page: ExamplePage, crumbs: { name: string; path: string }[]) {
  const url = absolute(page.path);
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: page.h1,
      description: page.description,
      ...(page.asOf ? { dateModified: page.asOf } : {}),
      isPartOf: { "@id": WEBSITE_ID },
      breadcrumb: breadcrumbLd(crumbs),
    },
  ];
  if (page.figure) {
    const f = page.figure;
    const ds = examplePageDatasetLd(page);
    if (ds) {
      (graph[0] as Record<string, unknown>).mainEntity = { "@id": `${url}#dataset` };
      graph.push(ds);
    }
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      url,
      mainEntity: [
        {
          "@type": "Question",
          name: page.h1,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${f.answer} Source: ${noFullStop(page.source.publisher)}. Licence: ${noFullStop(page.source.licence)}.${f.caveat ? ` ${f.caveat}` : ""}`,
          },
        },
      ],
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
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
        mainEntity: { "@id": `${url}#dataset` },
      },
      answerPageDatasetLd(page),
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
