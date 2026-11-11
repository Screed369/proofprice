# Daily prices without a deploy (Jarvis order, 9–11 Nov 2026) — design, part (b)

Goal: the 03:17 UTC harvest refreshes prices for agents the same day, with NO production build. Target: one build a week.

Today: harvest commits `library/` to main -> main is the only branch that builds (PR #6) -> every daily commit still builds production.

Plan (no secrets, no new service):
1. Harvest commits to a `data` branch instead of main. `data` never builds (vercel.json wildcard `"*": false`).
2. The harvest also writes `library-delta/<date>.json` on `data`: only that day's rows + meta for every source (small).
3. Runtime: bundled `library/` (from the last Tuesday release) + overlay of newer days fetched from raw.githubusercontent.com (repo is public) into /tmp at server start (`instrumentation.ts`) and refreshed every 30 min. `lib/library/store.ts` merges overlay + bundle; its sync API is unchanged, so no source file changes.
4. Tuesday release: a workflow merges `data` into main, so the bundle catches up and the overlay is empty again.
5. Fail safe: if GitHub is unreachable the bundle is used (same as today, at most a week old; stale-if-error copy rules unchanged).
Test: tests/library.test.ts + new overlay tests; the 545-question smoke run must stay all OK/STALE-free before and after.
