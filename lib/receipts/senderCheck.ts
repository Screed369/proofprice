// Quick feasibility signal: does a marketplace domain publish a strict DMARC policy?
// Strict policies (quarantine/reject) mean the domain authenticates its mail, which usually
// means its emails carry a DKIM seal we can check. Real proof still needs a sample email.

import { resolveTxt } from "node:dns/promises";
import { MARKETPLACES } from "./marketplaces";

export interface SenderCheck {
  domain: string;
  dmarc_record: string | null;
  policy: string | null;
  strict: boolean;
  error?: string;
}

export async function checkSender(domain: string): Promise<SenderCheck> {
  const d = domain.toLowerCase().trim();
  try {
    const recs = await resolveTxt(`_dmarc.${d}`);
    const rec = recs.map((r) => r.join("")).find((r) => r.toLowerCase().startsWith("v=dmarc1")) ?? null;
    const policy = rec?.match(/;\s*p=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
    return { domain: d, dmarc_record: rec, policy, strict: policy === "reject" || policy === "quarantine" };
  } catch (e: any) {
    return { domain: d, dmarc_record: null, policy: null, strict: false, error: e?.code ?? String(e) };
  }
}

export async function checkAllMarketplaces(): Promise<{ marketplace: string; checks: SenderCheck[] }[]> {
  return Promise.all(
    MARKETPLACES.map(async (m) => ({ marketplace: m.name, checks: await Promise.all(m.domains.slice(0, 3).map(checkSender)) })),
  );
}
