// Receipt verifier: proves an order/sale email is genuine using its built-in seal (DKIM signature),
// then extracts only the receipt facts (marketplace, date, amounts, item hints).
// The email itself is processed in memory and never stored. Names and addresses are not returned.

import { dkimVerify } from "mailauth";
import { simpleParser } from "mailparser";
import { matchMarketplace, sameOrgDomain } from "./marketplaces";

export type Resolver = (domain: string, rrtype: string) => Promise<string[][] | string[]>;

export interface AmountHit {
  currency: string;
  value: number;
  label: string | null; // e.g. "total", "item price", "sold for"
  context: string; // short snippet around the amount (personal data stripped)
}

export interface ReceiptCheck {
  verified: boolean;
  verdict: string;
  seal: {
    present: boolean;
    valid: boolean;
    signing_domain: string | null;
    aligned_with_from: boolean;
    covers_subject: boolean;
    covers_whole_body: boolean;
    algorithm: string | null;
  };
  marketplace: { name: string; kind: string } | null;
  from_domain: string | null;
  sent_at: string | null;
  subject: string | null;
  amounts: AmountHit[];
  likely_total: AmountHit | null;
  item_hints: string[];
  reasons: string[];
  all_seals: { domain: string | null; result: string | null; comment: string | null }[];
  privacy: string;
}

const CURRENCY_SYMBOL: Record<string, string> = { "£": "GBP", "€": "EUR", $: "USD", "US$": "USD", "A$": "AUD", "C$": "CAD" };
const LABELS = [
  "order total", "grand total", "total paid", "you paid", "amount paid", "total", "subtotal", "item price", "item subtotal",
  "sold for", "sale price", "price", "payment", "importe total", "total pagado", "montant total", "gesamtbetrag",
];

export function parseAmount(raw: string): number {
  let s = raw.replace(/\s/g, "");
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else s = s.replace(/,/g, ""); // 1,234.56
  return Number(s);
}

export function findAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  const num = "([0-9]{1,3}(?:[.,\\s][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)";
  const pre = new RegExp(`(US\\$|A\\$|C\\$|£|€|\\$|GBP|EUR|USD)\\s?${num}`, "g");
  const post = new RegExp(`${num}\\s?(€|EUR|GBP|USD)`, "g");
  const push = (cur: string, rawNum: string, index: number) => {
    const value = parseAmount(rawNum);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return;
    const currency = CURRENCY_SYMBOL[cur] ?? cur.toUpperCase();
    const before = text.slice(Math.max(0, index - 60), index).toLowerCase();
    const label = LABELS.find((l) => before.includes(l)) ?? null;
    const context = redact(text.slice(Math.max(0, index - 40), index + rawNum.length + 8).replace(/\s+/g, " ").trim());
    hits.push({ currency, value, label, context });
  };
  for (const m of text.matchAll(pre)) push(m[1], m[2], m.index ?? 0);
  for (const m of text.matchAll(post)) push(m[2], m[1], m.index ?? 0);
  // de-duplicate identical value+currency+label
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.currency}|${h.value}|${h.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function pickTotal(hits: AmountHit[]): AmountHit | null {
  const rank = (h: AmountHit) => {
    if (!h.label) return 0;
    if (/(order total|grand total|total paid|you paid|amount paid|importe total|total pagado|montant total|gesamtbetrag)/.test(h.label)) return 4;
    if (/(sold for|sale price)/.test(h.label)) return 3;
    if (h.label === "total") return 2;
    return 1;
  };
  const sorted = [...hits].sort((a, b) => rank(b) - rank(a) || b.value - a.value);
  return sorted.length && rank(sorted[0]) > 0 ? sorted[0] : null;
}

const DEVICE_WORDS =
  /(iphone|ipad|macbook|imac|airpods|apple watch|galaxy|pixel|oneplus|xiaomi|redmi|huawei|nokia|motorola|playstation|ps5|ps4|xbox|nintendo|switch|steam deck|gopro|canon|nikon|sony|fujifilm|thinkpad|surface|kindle|garmin|dyson)/i;

export function findItemHints(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 160);
  const hints = lines.filter((l) => DEVICE_WORDS.test(l) || /\b\d{2,4}\s?(GB|TB)\b/i.test(l));
  return Array.from(new Set(hints.map(redact))).slice(0, 8);
}

// Remove things that look like personal data from snippets we return.
export function redact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (/^\d{1,3}([.,]\d{3})*([.,]\d{2})?$/.test(m.replace(/\s/g, "")) ? m : "[number]"))
    .replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/g, "[postcode]")
    .replace(/\b\d{5}\b(?=\s+[A-Za-z])/g, "[postcode]");
}

export async function verifyReceiptEmail(raw: Buffer | string, opts: { resolver?: Resolver } = {}): Promise<ReceiptCheck> {
  const reasons: string[] = [];
  const dkim: any = await dkimVerify(raw, opts.resolver ? { resolver: opts.resolver } : {});
  const fromAddr: string | undefined = dkim?.headerFrom?.[0];
  const fromDomain = fromAddr ? fromAddr.split("@").pop()!.toLowerCase() : null;

  // mailauth reports an unsigned message as a single result with status "none"; drop those.
  const results: any[] = (Array.isArray(dkim?.results) ? dkim.results : []).filter(
    (r: any) => r?.signingDomain || r?.status?.result !== "none",
  );
  const passing = results.filter((r) => r?.status?.result === "pass");
  // Prefer a passing signature from a known marketplace domain.
  // Prefer a passing seal from a known marketplace that matches the From address; an email can carry several
  // seals (e.g. amazon.es plus its mail provider amazonses.com) and only the brand's own seal proves the receipt.
  const best =
    passing.find((r) => matchMarketplace(r.signingDomain) && fromDomain && sameOrgDomain(r.signingDomain, fromDomain)) ??
    passing.find((r) => matchMarketplace(r.signingDomain)) ??
    passing[0] ?? results[0] ?? null;

  const signingDomain: string | null = best?.signingDomain ?? null;
  const valid = best?.status?.result === "pass";
  const signedHeaders: string[] = (best?.signingHeaders?.keys ?? best?.status?.headers ?? [])
    .toString()
    .toLowerCase()
    .split(/[:,\s]+/)
    .filter(Boolean);
  const coversSubject = signedHeaders.length ? signedHeaders.includes("subject") : false;
  const coversWholeBody = !(best?.canonBodyLengthLimited === true);
  const aligned = !!(signingDomain && fromDomain && sameOrgDomain(signingDomain, fromDomain));
  const market = matchMarketplace(signingDomain);

  if (results.length === 0) reasons.push("No email seal (DKIM signature) found. Forward the email as an attachment (.eml), not inline.");
  else if (!valid) reasons.push(`Seal check failed: ${best?.status?.comment ?? best?.status?.result ?? "unknown"}. The email may have been altered, or forwarded inline.`);
  if (valid && !market) reasons.push(`Seal is valid but from ${signingDomain}, which is not on our list of accepted marketplaces.`);
  if (valid && !aligned) reasons.push("The seal's domain does not match the From address.");
  if (valid && !coversWholeBody) reasons.push("The seal covers only part of the email body, so the price could have been added afterwards.");
  if (valid && signedHeaders.length && !coversSubject) reasons.push("The seal does not cover the Subject line.");

  const parsed = await simpleParser(typeof raw === "string" ? Buffer.from(raw) : raw);
  const text = (parsed.text || (typeof parsed.html === "string" ? htmlToText(parsed.html) : "") || "").slice(0, 200_000);
  const amounts = findAmounts(text);
  const total = pickTotal(amounts);
  if (valid && market && amounts.length === 0) reasons.push("Seal is valid but no price was found in the email text.");

  const verified = valid && !!market && aligned && coversWholeBody;
  return {
    verified,
    verdict: verified
      ? `Genuine ${market!.name} email: the seal from ${signingDomain} is valid and covers the whole message.`
      : "Not accepted as a verified receipt.",
    seal: {
      present: results.length > 0,
      valid,
      signing_domain: signingDomain,
      aligned_with_from: aligned,
      covers_subject: coversSubject,
      covers_whole_body: coversWholeBody,
      algorithm: best?.algo ?? null,
    },
    marketplace: market ? { name: market.name, kind: market.kind } : null,
    from_domain: fromDomain,
    sent_at: parsed.date ? parsed.date.toISOString() : null,
    subject: parsed.subject ? redact(parsed.subject) : null,
    amounts,
    likely_total: total,
    item_hints: findItemHints(text),
    reasons,
    all_seals: results.map((r) => ({
      domain: r?.signingDomain ?? null,
      result: r?.status?.result ?? null,
      comment: r?.status?.comment ?? null,
    })),
    privacy: "The email was checked in memory and not stored. Names, email addresses, phone numbers and postcodes are removed from returned snippets.",
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&pound;/g, "£")
    .replace(/&euro;/g, "€")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
}
