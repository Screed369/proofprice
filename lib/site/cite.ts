// "How to cite" text for an answer page: one plain line an author, a journalist or an AI can copy, with the figure, its
// label, its period, its source, its licence and the link. Pure: the page passes in what it already shows, so this adds no
// new number and cannot show a figure the page does not (the 5-record rule stays where the figure is built).

import { SITE_URL } from "./constants";
import { longDate } from "./format";

export interface CiteInput {
  /** The page's question or title, e.g. "Diesel price in Madrid". */
  title: string;
  /** The figure as the page prints it, e.g. "€1.52". */
  headline: string;
  /** "per litre", "per month". */
  unit: string;
  /** "median" or "average". */
  measure: string;
  /** An official statistic passed on as published (no records of ours behind it). */
  statistic: boolean;
  /** Records behind the figure; null when the publisher gives none. Never shown below 5. */
  n: number | null;
  /** What kind of price: "posted pump prices", "recorded sale prices". */
  basis: string;
  /** Period the figure covers, in words, if the page has one ("2026-Q2", "12 October 2025 to 12 October 2026"). */
  period: string | null;
  /** YYYY-MM-DD of the library day or the publisher's latest. */
  asOf: string;
  publisher: string;
  licence: string;
  /** Site path of the page, e.g. /prices/es/fuel/madrid. */
  path: string;
}

/** Minimum records for a figure built from records (CLAUDE.md hard rule); a smaller count is dropped from the text. */
const MIN_RECORDS = 5;

export function citationText(c: CiteInput): string {
  const kind = c.statistic ? `official ${c.measure}` : c.measure;
  const records = !c.statistic && c.n !== null && c.n >= MIN_RECORDS ? `, ${c.n.toLocaleString("en-GB")} records` : "";
  const period = c.period ? `, period ${c.period}` : "";
  const trimmedBasis = c.basis.replace(/\.\s*$/, "");
  return (
    `ProofPrice (${SITE_URL}). "${c.title}": ${c.headline} ${c.unit} (${kind}${records}${period}; figures of ${longDate(c.asOf)}). ` +
    `${trimmedBasis}. Source: ${c.publisher.replace(/\.\s*$/, "")}, licence ${c.licence.replace(/\.\s*$/, "")}. ` +
    `${SITE_URL}${c.path}`
  );
}
