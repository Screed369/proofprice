import { verifyReceiptEmail } from "../../../../../lib/receipts/verify";
import { json, errorResponse } from "../../../../../lib/route-helpers";

export const maxDuration = 30;
const MAX_BYTES = 3 * 1024 * 1024;

// POST /api/v1/receipts/verify   body: the raw .eml file (Content-Type: message/rfc822 or application/octet-stream)
// Also accepts multipart/form-data with a field named "email".
// The email is checked in memory and never stored.
export async function POST(req: Request) {
  try {
    let raw: Buffer;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("email");
      if (!f || typeof f === "string") return json({ error: "Attach the .eml file in a field named 'email'." }, 400);
      raw = Buffer.from(await f.arrayBuffer());
    } else {
      raw = Buffer.from(await req.arrayBuffer());
    }
    if (raw.length === 0) return json({ error: "Empty body. Send the raw .eml file." }, 400);
    if (raw.length > MAX_BYTES) return json({ error: "Email too large (max 3 MB)." }, 413);
    return json(await verifyReceiptEmail(raw));
  } catch (e) {
    return errorResponse(e);
  }
}
