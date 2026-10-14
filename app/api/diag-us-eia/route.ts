// TEMPORARY diagnostic route for the us-eia builder. Never merge. Returns a base64 slice of an eia.gov file.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const url = q.get("u") ?? "";
  if (!/^https:\/\/www\.eia\.gov\//.test(url)) return new Response("only eia.gov", { status: 400 });
  const off = Number(q.get("off") ?? 0);
  const len = Number(q.get("len") ?? 2500000);
  const res = await fetch(url, { headers: { "user-agent": "ProofPrice-verifier/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
  const buf = Buffer.from(await res.arrayBuffer());
  return Response.json({ status: res.status, type: res.headers.get("content-type"), total: buf.length, off, len, b64: buf.subarray(off, off + len).toString("base64") });
}
