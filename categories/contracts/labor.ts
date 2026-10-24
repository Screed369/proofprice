// Shared by sources/us-usaspending and sources/us-gsa-calc (declared platform edit, Platform Builder 24 Oct 2026):
// decides which US source answers a contracts question. Hourly labour-rate questions ("software engineer hourly rate",
// cpv "sin:541330ENG") go to the GSA CALC+ ceiling-rate source; every other US question stays with USAspending awards.
const LABOR_WORDS = /\b(hourly|per hour|an hour|labou?r rates?|labou?r categor(?:y|ies)|billing rates?|bill rates?|day rates?|ceiling rates?)\b/i;

/** True when a contracts request asks for an hourly labour rate (or gives a GSA schedule SIN code). */
export function isLaborRateRequest(p: Record<string, unknown>): boolean {
  const cpv = String(p.cpv ?? "").trim().toLowerCase();
  if (cpv.startsWith("sin:") || cpv.startsWith("calc:")) return true;
  return LABOR_WORDS.test(String(p.what ?? ""));
}

/** "software engineer hourly rate" -> "software engineer". Empty when nothing is left. */
export function laborKeyword(what: string): string {
  return what
    .replace(LABOR_WORDS, " ")
    .replace(/\b(rates?|what|whats|is|are|how|much|do|does|per|for|of|a|an|the|federal|gsa|schedule|contractors?|charge|charges|cost|price|prices)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s/.+&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
