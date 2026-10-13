import { InputError, SourceError } from "./http";

// Public API: any website or browser-based agent may call it (no cookies are used, so this is safe).
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** cacheSeconds > 0 lets Vercel's CDN serve repeat questions without running the function (cost and abuse control).
 *  Errors and receipts are never cached. */
export function json(data: unknown, status = 200, cacheSeconds = 0) {
  const cache =
    status === 200 && cacheSeconds > 0
      ? `public, max-age=60, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 6}`
      : "no-store";
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, ...CORS_HEADERS },
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "access-control-max-age": "86400" } });
}

export function errorResponse(e: any) {
  const status = e instanceof InputError ? 400 : e instanceof SourceError ? (/required|must be|Give a|Not yet/.test(e.message) ? 400 : 502) : 500;
  return json({ error: e?.message ?? String(e), detail: e?.detail ?? null }, status);
}

export function baseUrl(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}
