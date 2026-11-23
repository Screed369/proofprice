// The collector's lane pool: a few sources at a time, never two of one country together, queue order kept, budget respected.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HARVEST_CONCURRENCY, harvestConcurrency, laneOf, runLanes } from "../lib/library/harvest-pool";

const tick = (ms = 1) => new Promise<void>((r) => setTimeout(r, ms));

test("laneOf: the id's first part is the lane", () => {
  assert.equal(laneOf("tw-home-sales"), "tw");
  assert.equal(laneOf("eu-oil-bulletin"), "eu");
  assert.equal(laneOf("single"), "single");
  assert.equal(laneOf("-odd"), "-odd");
});

test("harvestConcurrency: a whole number from 1 to 8, anything else is the default", () => {
  assert.equal(harvestConcurrency(undefined), DEFAULT_HARVEST_CONCURRENCY);
  assert.equal(harvestConcurrency("1"), 1);
  assert.equal(harvestConcurrency("8"), 8);
  for (const bad of ["0", "9", "-2", "2.5", "many", ""]) assert.equal(harvestConcurrency(bad), DEFAULT_HARVEST_CONCURRENCY, bad);
});

test("runLanes: never more than the limit at once, never two of one lane together, everything runs once", async () => {
  const ids = ["tw-a", "tw-b", "tw-c", "fr-a", "fr-b", "gb-a", "sg-a", "sg-b", "us-a", "ie-a", "es-a"];
  let running = 0;
  let peak = 0;
  const live = new Set<string>();
  const done: string[] = [];
  await runLanes(ids, {
    concurrency: 3,
    laneOf,
    expired: () => false,
    onSkip: () => assert.fail("nothing is skipped"),
    run: async (id) => {
      assert.ok(!live.has(laneOf(id)), `two ${laneOf(id)} sources ran together`);
      live.add(laneOf(id));
      peak = Math.max(peak, ++running);
      await tick(2 + (id.length % 3));
      live.delete(laneOf(id));
      running--;
      done.push(id);
    },
  });
  assert.equal(peak, 3);
  assert.deepEqual([...done].sort(), [...ids].sort());
});

test("runLanes: with one at a time it is exactly the old one-by-one order", async () => {
  const seen: string[] = [];
  await runLanes(["b-1", "a-1", "b-2", "c-1"], { concurrency: 1, laneOf, expired: () => false, onSkip: () => {}, run: async (id) => void seen.push(id) });
  assert.deepEqual(seen, ["b-1", "a-1", "b-2", "c-1"]);
});

test("runLanes: the earliest waiting source whose lane is free starts next (a busy lane does not block the queue)", async () => {
  const started: string[] = [];
  await runLanes(["tw-1", "tw-2", "fr-1", "gb-1"], {
    concurrency: 2,
    laneOf,
    expired: () => false,
    onSkip: () => {},
    run: async (id) => {
      started.push(id);
      await tick(id === "tw-1" ? 20 : 2);
    },
  });
  // tw-2 must wait for tw-1, so fr-1 and gb-1 go ahead of it
  assert.deepEqual(started, ["tw-1", "fr-1", "gb-1", "tw-2"]);
});

test("runLanes: once the budget is used up nothing new starts and the rest are skipped in order", async () => {
  let spent = false;
  const ran: string[] = [];
  const skipped: string[] = [];
  await runLanes(["a-1", "b-1", "c-1", "d-1", "e-1"], {
    concurrency: 2,
    laneOf,
    expired: () => spent,
    onSkip: (id) => skipped.push(id),
    run: async (id) => {
      ran.push(id);
      await tick(3);
      spent = true; // the budget runs out while the first two are working
    },
  });
  assert.deepEqual(ran, ["a-1", "b-1"]);
  assert.deepEqual(skipped, ["c-1", "d-1", "e-1"]);
});

test("runLanes: a crash in one source's bookkeeping does not stop the others, and is reported at the end", async () => {
  const ran: string[] = [];
  await assert.rejects(
    runLanes(["a-1", "b-1", "c-1"], {
      concurrency: 1,
      laneOf,
      expired: () => false,
      onSkip: () => {},
      run: async (id) => {
        ran.push(id);
        if (id === "a-1") throw new Error("disk full");
      },
    }),
    /disk full/,
  );
  assert.deepEqual(ran, ["a-1", "b-1", "c-1"]);
});

test("runLanes: an empty queue resolves at once", async () => {
  await runLanes([], { concurrency: 4, laneOf, expired: () => true, onSkip: () => assert.fail("no items"), run: async () => assert.fail("no items") });
});
