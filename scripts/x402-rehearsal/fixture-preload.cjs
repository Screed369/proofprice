// Rehearsal helper: answers the Statistics Canada calls from the captured fixtures (sources/ca-cmhc-rents/fixtures.ts, dumped to FIXTURE_JSON)
// so a paid call can return a real answer on a machine that cannot reach government sites. Everything else goes to the real fetch.
const fx = JSON.parse(require("node:fs").readFileSync(process.env.FIXTURE_JSON, "utf8"));
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url?.url ?? url);
  if (u.includes("www150.statcan.gc.ca")) {
    const body = u.includes("getCubeMetadata") ? fx.meta : fx.data;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  return real(url, init);
};
