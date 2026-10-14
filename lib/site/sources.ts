// View-models for /sources, /status and the Dataset JSON-LD, all built from the registry (coverage()) so a new source
// folder appears on the website with no edit here.

import type { SourceInfo } from "../plugin";
import { readMeta, type SourceMeta } from "../library/store";
import { SOURCE_PLUGINS, categoryById, coverage, exampleUrls } from "../registry";
import { countryName } from "./areas";
import { PAGE_SOURCES } from "./answer-pages";
import { SITE_URL } from "./constants";
import type { DatasetInput } from "./jsonld";

export const PRICE_TYPE_LABEL: Record<SourceInfo["price_type"], string> = {
  transaction: "Price actually paid (completed sale)",
  posted_pump_price: "Posted pump price (what the station displays; not a receipt)",
  posted_price: "Posted price (not a receipt)",
  contract_price: "Contract price",
  reimbursement_price: "Reimbursement price",
  official_statistic: "Official statistic (published average or median)",
};

export const PRICE_TYPE_SHORT: Record<SourceInfo["price_type"], string> = {
  transaction: "Paid (completed sale)",
  posted_pump_price: "Posted pump price",
  posted_price: "Posted price",
  contract_price: "Contract price",
  reimbursement_price: "Reimbursement price",
  official_statistic: "Official statistic",
};

/** Short headings for the category groups; falls back to the registry title for a new category. */
const CATEGORY_HEADING: Record<string, string> = {
  "home-sales": "Home sale prices",
  fuel: "Fuel prices",
  cars: "Car prices",
};
const CATEGORY_ORDER = ["home-sales", "fuel", "cars"];

export interface SourceCard {
  id: string;
  name: string;
  countryCodes: string[];
  countryNames: string[];
  categoryId: string;
  categoryHeading: string;
  tool: string;
  publisher: string;
  homepage: string;
  whatIsRecorded: string;
  priceType: SourceInfo["price_type"];
  priceTypeLabel: string;
  priceTypeShort: string;
  freshness: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  limits: string;
  method: string | null;
  status: "live" | "beta";
  exampleRest: string | null; // path and query, relative to the site
  collected: boolean; // true when the source feeds the daily price library
  library: SourceMeta | null;
  pricesPath: string | null; // /prices/<cc>/<category> when this source has answer pages
}

export function sourceCards(): SourceCard[] {
  const cov = coverage();
  const byId = new Map(cov.sources.map((s) => [s.id, s]));
  const exampleFor = new Map<string, string>();
  for (const ex of exampleUrls()) if (!exampleFor.has(ex.source)) exampleFor.set(ex.source, ex.path); // the first example of each source
  const cards: SourceCard[] = [];
  for (const s of SOURCE_PLUGINS) {
    const info = byId.get(s.info.id) ?? s.info;
    const cat = categoryById(s.category);
    const pages = PAGE_SOURCES.find((p) => p.sourceId === info.id);
    cards.push({
      id: info.id,
      name: info.name,
      countryCodes: s.countries,
      countryNames: s.countries.map(countryName),
      categoryId: s.category,
      categoryHeading: CATEGORY_HEADING[s.category] ?? cat?.title ?? s.category,
      tool: cat?.tool ?? "",
      publisher: info.publisher,
      homepage: info.homepage,
      whatIsRecorded: info.what_is_recorded,
      priceType: info.price_type,
      priceTypeLabel: PRICE_TYPE_LABEL[info.price_type] ?? info.price_type,
      priceTypeShort: PRICE_TYPE_SHORT[info.price_type] ?? info.price_type,
      freshness: info.freshness,
      licence: info.licence,
      licenceUrl: info.licence_url,
      attribution: info.attribution,
      limits: info.limits,
      method: s.method ?? null,
      status: s.status,
      exampleRest: exampleFor.get(info.id) ?? null,
      collected: !!s.harvest,
      library: s.harvest ? readMeta(info.id) : null,
      pricesPath: pages ? `/prices/${pages.country.toLowerCase()}/${pages.category}` : null,
    });
  }
  return cards;
}

export interface SourceGroup {
  categoryId: string;
  heading: string;
  cards: SourceCard[];
}

export function groupByCategory(cards: SourceCard[]): SourceGroup[] {
  const ids = [...new Set(cards.map((c) => c.categoryId))].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return ids.map((id) => {
    const list = cards.filter((c) => c.categoryId === id);
    return { categoryId: id, heading: list[0].categoryHeading, cards: list };
  });
}

/** Dataset JSON-LD input for one card. */
export function datasetInput(c: SourceCard): DatasetInput {
  return {
    id: c.id,
    name: c.name,
    whatIsRecorded: c.whatIsRecorded,
    limits: c.limits,
    publisher: c.publisher,
    publisherUrl: c.homepage,
    licenceUrl: c.licenceUrl,
    attribution: c.attribution,
    countries: c.countryCodes.map((code) => ({ code, name: countryName(code) })),
    restUrl: c.exampleRest ?? `${SITE_URL}/api/v1/coverage`,
    categoryTitle: c.categoryHeading,
    dateModified: c.library?.last_ok_at ? c.library.last_ok_at.slice(0, 10) : null,
  };
}

