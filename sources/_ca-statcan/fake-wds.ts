// A fake Web Data Service for the tests: answers getCubeMetadata and getDataFromCubePidCoordAndLatestNPeriods from the
// real replies captured in each source's fixtures.ts. A coordinate that was not captured comes back FAILED, as WDS does for a series
// that does not exist.

import type { Poster } from "./wds";

interface Item {
  status: string;
  object: { coordinate: string; [k: string]: unknown };
}

export function fakeWds(opts: { meta: unknown; data: unknown; calls?: { path: string; body: unknown }[] }): Poster {
  return async (path, body) => {
    opts.calls?.push({ path, body });
    if (path === "getCubeMetadata") return opts.meta;
    if (path === "getDataFromCubePidCoordAndLatestNPeriods") {
      const reqs = body as { productId: number; coordinate: string; latestN: number }[];
      const have = opts.data as Item[];
      return reqs.map(
        (r) =>
          have.find((s) => s.object.coordinate === r.coordinate) ?? {
            status: "FAILED",
            object: { responseStatusCode: 2, productId: r.productId, coordinate: r.coordinate, vectorId: 0, vectorDataPoint: [] },
          },
      );
    }
    throw new Error(`unexpected WDS method ${path}`);
  };
}
