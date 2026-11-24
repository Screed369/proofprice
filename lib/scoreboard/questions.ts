// The scoreboard question set, FIXED on 24 Nov 2026 before any model was asked (council ruling, Notion 24 Nov 2026).
// Each question is a plain sentence a person would really ask, plus the exact library key our typical range comes from.
// Change this file only by adding a NEW dated set: an old set must stay as it was, or earlier results lose their meaning.
// Only sources with a real record count (n of 5 or more) and a clear open licence are used; asking prices are never used.

export const QUESTION_SET_ID = "2026-11-24";

export interface ScoreboardQuestion {
  id: string;
  /** The sentence put to an assistant, word for word. */
  prompt: string;
  /** Library source id (library/<source>/daily). */
  source: string;
  /** Library area and item key, exactly as stored. */
  area: string;
  item: string;
  currency: "EUR" | "GBP";
  /** What one number means, in words, so a model is not marked wrong for answering a different thing. */
  unit_note: string;
}

const IE_NOTE =
  "Price per home as declared for stamp duty, sales in the 12 months to 13 Nov 2026, second-hand and new homes together, full-market-price sales only.";
const GB_NOTE =
  "Price per home as paid at completion, standard-price sales registered for July 2026 in England and Wales (the latest month; sales register weeks late).";

export const QUESTIONS: ScoreboardQuestion[] = [
  { id: "ie-dublin", prompt: "What did homes in County Dublin typically sell for in the last 12 months? Give one typical price in euro.", source: "ie-ppr", area: "dublin", item: "any:12m", currency: "EUR", unit_note: IE_NOTE },
  { id: "ie-cork", prompt: "What did homes in County Cork typically sell for in the last 12 months? Give one typical price in euro.", source: "ie-ppr", area: "cork", item: "any:12m", currency: "EUR", unit_note: IE_NOTE },
  { id: "ie-galway", prompt: "What did homes in County Galway typically sell for in the last 12 months? Give one typical price in euro.", source: "ie-ppr", area: "galway", item: "any:12m", currency: "EUR", unit_note: IE_NOTE },
  { id: "ie-limerick", prompt: "What did homes in County Limerick typically sell for in the last 12 months? Give one typical price in euro.", source: "ie-ppr", area: "limerick", item: "any:12m", currency: "EUR", unit_note: IE_NOTE },
  { id: "gb-bristol", prompt: "What did homes in the City of Bristol council area typically sell for in July 2026? Give one typical price in pounds.", source: "gb-hmlr-ppd", area: "city-of-bristol", item: "any/month", currency: "GBP", unit_note: GB_NOTE },
  { id: "gb-leeds", prompt: "What did homes in the Leeds council area typically sell for in July 2026? Give one typical price in pounds.", source: "gb-hmlr-ppd", area: "leeds", item: "any/month", currency: "GBP", unit_note: GB_NOTE },
  { id: "gb-manchester", prompt: "What did homes in the Manchester council area typically sell for in July 2026? Give one typical price in pounds.", source: "gb-hmlr-ppd", area: "manchester", item: "any/month", currency: "GBP", unit_note: GB_NOTE },
  { id: "gb-cornwall", prompt: "What did homes in Cornwall typically sell for in July 2026? Give one typical price in pounds.", source: "gb-hmlr-ppd", area: "cornwall", item: "any/month", currency: "GBP", unit_note: GB_NOTE },
  { id: "gb-england-wales", prompt: "What did homes in England and Wales typically sell for in July 2026? Give one typical price in pounds.", source: "gb-hmlr-ppd", area: "ALL", item: "any/month", currency: "GBP", unit_note: GB_NOTE },
];
