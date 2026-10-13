// End-to-end test of the email-seal check, using a locally generated signing key and a
// stand-in DNS lookup (the real service looks the key up in public DNS).

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { dkimSign } from "mailauth";
import { verifyReceiptEmail, findAmounts, pickTotal, redact } from "../lib/receipts/verify";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function resolverFor(domain: string, selector: string) {
  return async (name: string, rrtype: string) => {
    if (rrtype === "TXT" && name === `${selector}._domainkey.${domain}`) return [[`v=DKIM1; k=rsa; p=${pubB64}`]];
    const err: any = new Error("not found");
    err.code = "ENOTFOUND";
    throw err;
  };
}

function orderEmail(fromDomain: string, total: string) {
  return [
    `From: "eBay" <orders@${fromDomain}>`,
    "To: Jane Buyer <jane.buyer@example.com>",
    "Subject: Order confirmed: Apple iPhone 13 128GB Midnight (Unlocked)",
    "Date: Mon, 05 Oct 2026 10:15:00 +0000",
    "Message-ID: <abc123@" + fromDomain + ">",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi Jane,",
    "Thanks for your order. Order number 12-34567-89012",
    "Apple iPhone 13 128GB Midnight (Unlocked) - Good condition",
    "Item price: £298.00",
    "Postage: £4.99",
    `Order total: ${total}`,
    "Delivery to: 12 High Street, Bristol BS8 1AB, phone 07700 900123",
    "",
  ].join("\r\n");
}

async function sign(msg: string, domain: string, selector = "s1") {
  const res: any = await dkimSign(msg, {
    canonicalization: "relaxed/relaxed",
    signatureData: [{ signingDomain: domain, selector, privateKey: privPem }],
  });
  assert.equal(res.errors?.length ?? 0, 0, JSON.stringify(res.errors));
  return res.signatures + msg;
}

test("genuine marketplace email is verified and only receipt facts come back", async () => {
  const signed = await sign(orderEmail("ebay.co.uk", "£302.99"), "ebay.co.uk");
  const r = await verifyReceiptEmail(signed, { resolver: resolverFor("ebay.co.uk", "s1") });
  assert.equal(r.seal.valid, true, JSON.stringify(r.reasons));
  assert.equal(r.verified, true, JSON.stringify(r.reasons));
  assert.equal(r.marketplace?.name, "eBay");
  assert.equal(r.likely_total?.value, 302.99);
  assert.equal(r.likely_total?.currency, "GBP");
  assert.ok(r.item_hints.some((h) => /iPhone 13 128GB/.test(h)));
  const out = JSON.stringify(r);
  assert.ok(!out.includes("jane.buyer@example.com"), "email address must not be returned");
  assert.ok(!out.includes("07700 900123"), "phone number must not be returned");
  assert.ok(!out.includes("BS8 1AB"), "postcode must not be returned");
});

test("changing the price after sending breaks the seal", async () => {
  const signed = await sign(orderEmail("ebay.co.uk", "£302.99"), "ebay.co.uk");
  const tampered = signed.replace("Order total: £302.99", "Order total: £202.99");
  const r = await verifyReceiptEmail(tampered, { resolver: resolverFor("ebay.co.uk", "s1") });
  assert.equal(r.seal.valid, false);
  assert.equal(r.verified, false);
});

test("an email with no seal (e.g. forwarded inline or typed by hand) is rejected", async () => {
  const r = await verifyReceiptEmail(orderEmail("ebay.co.uk", "£302.99"), { resolver: resolverFor("ebay.co.uk", "s1") });
  assert.equal(r.seal.present, false);
  assert.equal(r.verified, false);
  assert.match(r.reasons.join(" "), /attachment/);
});

test("a valid seal from a shop not on our list is not accepted", async () => {
  const signed = await sign(orderEmail("fake-phones.example", "£99.00"), "fake-phones.example");
  const r = await verifyReceiptEmail(signed, { resolver: resolverFor("fake-phones.example", "s1") });
  assert.equal(r.seal.valid, true);
  assert.equal(r.verified, false);
  assert.match(r.reasons.join(" "), /not on our list/);
});

test("a seal from a marketplace that doesn't match the From address is not accepted", async () => {
  const signed = await sign(orderEmail("not-ebay.example", "£302.99"), "ebay.co.uk");
  const r = await verifyReceiptEmail(signed, { resolver: resolverFor("ebay.co.uk", "s1") });
  assert.equal(r.verified, false);
});

test("amount finder handles UK, euro and US formats", () => {
  const hits = findAmounts("Order total: £1,234.56\nTotal pagado: 312,00 €\nYou paid $89.99");
  const vals = hits.map((h) => `${h.currency}${h.value}`);
  assert.ok(vals.includes("GBP1234.56"));
  assert.ok(vals.includes("EUR312"));
  assert.ok(vals.includes("USD89.99"));
  assert.equal(pickTotal(hits)?.label !== null, true);
  assert.equal(redact("call 07700 900123 or a@b.com, BS8 1AB"), "call [number] or [email], [postcode]");
});
