// THROWAWAY (never merged): shows the raw answer of Statistics Finland's public PxWeb API for one query, so a real fixture can be copied.
export const dynamic = "force-dynamic";

const ALLOWED = /^https:\/\/pxdata\.stat\.fi\/PxWeb\/api\/v1\/en\/StatFin\/ashi\/(15is|13mt|13mx)\.px$/;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const u = params.get("u") ?? "";
  const b = params.get("b");
  if (!ALLOWED.test(u)) return new Response("url not allowed", { status: 400 });
  const res = await fetch(
    u,
    b
      ? { method: "POST", headers: { "content-type": "application/json", "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" }, body: b }
      : { headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } },
  );
  const text = await res.text();
  return new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-upstream-status": String(res.status), "x-upstream-type": res.headers.get("content-type") ?? "" } });
}
