// Licence guard for paid calls. A premium call (price check, history) may be CHARGED only when every source behind the
// answer is on this list. Any other source (or one we cannot work out) is served free with a short note: never a 402, never charged.
//
// The list is taken from the Notion Source Pipeline: a source goes in ONLY when its row has a line starting "Licence checked:"
// that says "commercial: yes". "unclear", "no" and "no line at all" all mean NOT cleared. A new source is not cleared by default:
// add its id here once its row says "commercial: yes".
//
// Last synced with the Source Pipeline: 2026-10-20.
export const CLEARED_FOR_PAID: ReadonlySet<string> = new Set([
  "eu-energy", // Eurostat reuse policy / CC BY 4.0, "commercial: yes" (checked 2026-10-18)
  "no-childcare-fees", // Statistics Norway, CC BY 4.0, "commercial: yes" (checked 2026-10-18)
  "ca-cmhc-rents", // CMHC licence agreement, "commercial: yes" (checked 2026-10-17)
  "ca-farm-prices", // Statistics Canada Open Licence, "commercial: yes" (checked 2026-10-18)
  "wb-fpn-diet-costs", // World Bank CC BY 4.0, "commercial: yes" (checked 2026-10-18)
]);

export const UNCLEARED_NOTE =
  "Served free: this answer uses a source not yet cleared for paid use, so it is never charged. Payment (if sent) was ignored.";

/** True only when there is at least one source id and every one is cleared. Anything else (empty, unknown) is NOT cleared. */
export function allCleared(ids: readonly string[] | null | undefined): boolean {
  return !!ids && ids.length > 0 && ids.every((id) => typeof id === "string" && CLEARED_FOR_PAID.has(id));
}
