import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceFor, withCategoryEvidence, EVIDENCE_KINDS } from "../lib/answer";

// Gap G20261029-AUDIT-RENT-LABEL: /api/v1/rent?country=AU&postcode=2000 said "Recorded sale prices ... completed sales" for rental bonds.
const sale = (): any => ({ evidence: evidenceFor("transaction") });

test("rent answers describe recorded rents, not sales, and keep the price_type", () => {
  const out: any = withCategoryEvidence("rent", sale());
  assert.equal(out.evidence.type, "transaction");
  assert.equal(out.evidence.label, "Recorded rents of new leases");
  assert.doesNotMatch(out.evidence.meaning, /sales/i);
  assert.match(out.evidence.meaning, /lease|bond/i);
});

test("home sales keep the sale wording", () => {
  assert.equal(withCategoryEvidence("home-sales", sale()).evidence!.label, EVIDENCE_KINDS.transaction.label);
});

test("a source's own custom evidence and other price types are left alone", () => {
  const custom: any = { evidence: { type: "transaction", label: "Median of bond lodgements", meaning: "x" } };
  assert.equal(withCategoryEvidence("rent", custom).evidence!.label, "Median of bond lodgements");
  const stat: any = { evidence: evidenceFor("official_statistic") };
  assert.equal(withCategoryEvidence("rent", stat).evidence!.label, "Official published average");
});
