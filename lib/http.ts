// Fetch with a hard timeout so a slow government API never hangs an agent.

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", ...(init.headers || {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SourceError(`Source returned HTTP ${res.status}`, body.slice(0, 300));
    }
    return await res.json();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class SourceError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}
