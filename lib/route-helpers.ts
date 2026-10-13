import { SourceError } from "./http";

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function errorResponse(e: any) {
  const status = e instanceof SourceError ? (/required|must be|Give a|Not yet/.test(e.message) ? 400 : 502) : 500;
  return json({ error: e?.message ?? String(e), detail: e?.detail ?? null }, status);
}

export function baseUrl(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}
