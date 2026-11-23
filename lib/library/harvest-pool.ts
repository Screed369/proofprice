// Runs the daily collector's sources a few at a time instead of one after another.
// Why: one at a time, the 36-minute budget covered only 70 to 128 of about 208 sources a run (21 and 19 Nov 2026: 143 and 83
// sources were SKIPped), so no single run could ever collect the whole library. Most of a source's time is waiting for the
// publisher's server, so a few can wait side by side.
// Politeness rule: two sources in the same LANE never run at the same time. The lane is the id's first part (the country or
// body: "tw", "fr", "eu"), because sources of one country usually sit on the same publisher's server (the six tw-* on Taiwan's
// MOI, sg-hdb-* on data.gov.sg), and hitting one host from several connections at once is what gets a collector blocked.
// Order is kept: the next source to start is always the earliest one in the queue whose lane is free.

/** The lane of a source id: its first part ("tw-home-sales" -> "tw"). */
export function laneOf(id: string): string {
  const i = id.indexOf("-");
  return i > 0 ? id.slice(0, i) : id;
}

export const DEFAULT_HARVEST_CONCURRENCY = 4;
export const MAX_HARVEST_CONCURRENCY = 8;

/** How many sources may run side by side: HARVEST_CONCURRENCY when it is a whole number from 1 to 8, else 4. */
export function harvestConcurrency(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && /^\d+$/.test(raw.trim()) && n >= 1 && n <= MAX_HARVEST_CONCURRENCY ? n : DEFAULT_HARVEST_CONCURRENCY;
}

export interface LaneOptions<T> {
  /** At most this many items run at once (at least 1). */
  concurrency: number;
  laneOf: (item: T) => string;
  /** Does the work for one item. A rejection is a crash of the collector itself: the rest still runs, then runLanes rejects with it. */
  run: (item: T) => Promise<void>;
  /** True once the time budget is used up: nothing new is started and every item still waiting is handed to onSkip, in order. */
  expired: () => boolean;
  onSkip: (item: T) => void;
}

/** Start items in queue order, up to `concurrency` at once, never two of one lane together. Resolves when everything started has finished. */
export function runLanes<T>(items: readonly T[], opts: LaneOptions<T>): Promise<void> {
  const limit = Math.max(1, Math.floor(opts.concurrency) || 1);
  const queue = [...items];
  const busy = new Set<string>();
  let running = 0;
  let crash: unknown = null;
  let crashed = false;
  return new Promise<void>((resolve, reject) => {
    const finish = () => (crashed ? reject(crash) : resolve());
    const pump = () => {
      if (queue.length && opts.expired()) for (const item of queue.splice(0)) opts.onSkip(item);
      while (running < limit && queue.length) {
        const i = queue.findIndex((item) => !busy.has(opts.laneOf(item)));
        if (i < 0) break; // every waiting item's lane is busy: wait for one to finish
        const [item] = queue.splice(i, 1);
        const lane = opts.laneOf(item);
        busy.add(lane);
        running++;
        Promise.resolve()
          .then(() => opts.run(item))
          .catch((e) => {
            if (!crashed) {
              crashed = true;
              crash = e;
            }
          })
          .finally(() => {
            busy.delete(lane);
            running--;
            pump();
          });
      }
      if (running === 0 && queue.length === 0) finish();
    };
    pump();
  });
}
