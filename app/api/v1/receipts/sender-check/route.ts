import { checkSender, checkAllMarketplaces } from "../../../../../lib/receipts/senderCheck";
import { json } from "../../../../../lib/route-helpers";

export const maxDuration = 30;

// GET /api/v1/receipts/sender-check            -> checks every marketplace on our list
// GET /api/v1/receipts/sender-check?domain=x   -> checks one domain
export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get("domain");
  if (domain) return json(await checkSender(domain));
  return json({ checked_at: new Date().toISOString(), results: await checkAllMarketplaces() });
}
