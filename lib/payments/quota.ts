// Free quota per caller per UTC day. ProofPrice has no API keys, so a caller is "a network address": the address is hashed with a
// salt that changes every day and only the hash is kept in memory (never written anywhere, never returned, never logged).
// Best-effort by design: counters live in one server instance's memory, so the real free allowance can be somewhat higher than
// the number set (several instances) and resets when an instance restarts. Stronger counting needs a shared store (later).
import { createHash, randomBytes } from "node:crypto";

const MAX_CALLERS = 20_000;
let day = "";
let salt = randomBytes(16).toString("hex");
let counts = new Map<string, number>();
let paidToday = 0;

function roll(now: Date) {
  const d = now.toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    salt = randomBytes(16).toString("hex");
    counts = new Map();
    paidToday = 0;
  }
}

export function callerHash(address: string): string {
  return createHash("sha256").update(`${salt}|${address}`).digest("hex").slice(0, 24);
}

/** Take one free call if the caller has any left today. */
export function takeFree(address: string, key: string, perDay: number, now = new Date()): boolean {
  roll(now);
  const id = `${key}|${callerHash(address)}`;
  const used = counts.get(id) ?? 0;
  if (used >= perDay) return false;
  if (!counts.has(id) && counts.size >= MAX_CALLERS) return false; // table full: ask for payment rather than grow without limit
  counts.set(id, used + 1);
  return true;
}

export function paidCapReached(cap: number, now = new Date()): boolean {
  roll(now);
  return paidToday >= cap;
}
export function notePaid(now = new Date()): void {
  roll(now);
  paidToday++;
}
export function resetQuota(): void {
  day = "";
  counts = new Map();
  paidToday = 0;
}
