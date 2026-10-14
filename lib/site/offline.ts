// Build-time safety net for the answer pages: while a page is being prepared, no source may touch the network.
//
// Pages are static and are built at deploy time. A source that answers from the price library (rents, home prices, ONS
// price levels, BLS averages ...) can give its real answer without leaving the machine, so the page shows exactly what the
// API would say. A source that needs its live official feed must not be called during a build: it is switched off here,
// its request fails at once, and the page falls back to the "ask live" form (the question, the tool, the REST link and no number).
//
// The switch is scoped to one async call tree (AsyncLocalStorage), so a request being served at the same moment, or a
// retry a source schedules after we stopped waiting, is treated correctly: only code started inside runOffline() is blocked.

import { AsyncLocalStorage } from "node:async_hooks";

export class OfflineError extends Error {
  constructor(url: string) {
    super(`Network access is switched off while the answer pages are prepared (${url}).`);
    this.name = "OfflineError";
  }
}

const scope = new AsyncLocalStorage<{ offline: true }>();
const MARK = Symbol.for("proofprice.offline-guard");

/** Wrap the current global fetch once. Re-wraps when something (a test, a framework) has replaced the global since. */
function ensureGuard(): void {
  const current = globalThis.fetch as any;
  if (typeof current !== "function" || current[MARK]) return;
  const guarded = function (this: unknown, input: any, init?: any) {
    if (scope.getStore()?.offline) {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      return Promise.reject(new OfflineError(url));
    }
    return current.call(globalThis, input, init);
  } as any;
  guarded[MARK] = true;
  globalThis.fetch = guarded;
}

/** Run `fn` with the network switched off for everything it starts. */
export function runOffline<T>(fn: () => Promise<T>): Promise<T> {
  ensureGuard();
  return scope.run({ offline: true }, fn);
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof OfflineError || (err as any)?.cause instanceof OfflineError || /Network access is switched off/.test(String((err as any)?.message ?? ""));
}
