// The method, in plain words, shown on the scoreboard page (slice b) and kept next to the code that does it.
// Wording rules: say "typical", never "fair", "correct", "guaranteed" or "verified price". State facts only.

export const METHOD_STEPS: string[] = [
  "We wrote the questions and the scoring rule first, and dated them. They are in the code and do not change for this set.",
  "Each question is a plain sentence a person would ask. The answer key is our own typical range (10th to 90th percentile) from official sales records, with the number of records, the data date, the licence and the source.",
  "The key is frozen on the day the set is made. We do not recompute it, so a recorded answer is always compared with the figures that stood when it was asked.",
  "We ask each assistant ourselves, word for word, and record the model, its version, the date and its full reply. We never publish a score we did not record.",
  "An answer is inside if it is in our typical range, near if it is within 20% of the edge of that range, far if it is further out, and none if no single price was given.",
  "Every question and every answer is shown, including the ones an assistant gets right.",
];

export const LIMITS: string[] = [
  "Official records have gaps and delays, and define things in their own way (a median sale is not an average, and area borders differ). An assistant can land far from our range because it answered a slightly different question.",
  "One typical range is a guide, not the price of any one home.",
  "This set covers Ireland and England and Wales home sales only. More categories need more questions and a new dated set.",
];
