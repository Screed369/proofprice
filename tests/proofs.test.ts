// Signed Price Proofs (lib/proofs): sign/verify, tampering, expiry, unknown keys, feature off, key self-provisioning, REST headers,
// MCP _meta, nothing signed on errors, the free verify endpoint and the JWKS. No network: answers are fixtures, keys are made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-proofs-"));
delete process.env.BLOB_STORE_ID;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.PROOFPRICE_PROOF_SIGNING_KEY;
delete process.env.PROOFPRICE_PROOFS;

import { buildAnswer, buildStatisticAnswer } from "../lib/answer";
import type { PriceAnswer } from "../lib/answer";
import { CHECK_TOOL, judge } from "../lib/check";
import { buildToolSpecs, createProofPriceMcpHandler, LIVE_DEPS } from "../lib/mcp-tools";
import type { ToolDeps } from "../lib/mcp-tools";
import { buildOpenApi, buildLlmsTxt } from "../lib/openapi";
import { buildLlmsFullTxt, PUBLIC_PATHS } from "../lib/open-book";
import {
  PROOF_ISSUER, PROOF_META_KEY, PROOF_STATEMENT, buildClaims, humanSummary, proofFor, proofHeaders, verifyProof,
} from "../lib/proofs";
import { b64u, canonicalJson, fromB64u, generateSigningKey, kidFor, publicJwk, sha256Hex, signJws, verifyJws } from "../lib/proofs/jws";
import { getSigningKey, keyMode, keyPath, memoryKeyStore, publicKeys, resetKeyCache, setKeyStore } from "../lib/proofs/keys";
import { CATEGORIES, SOURCE_PLUGINS, SOURCES, categoryById } from "../lib/registry";
import { summarise } from "../lib/stats";

const fuelCat = categoryById("fuel")!;
const itSrc = SOURCE_PLUGINS.find((s) => s.info.id === "it-fuel")!;
const IT_PARAMS = { country: "IT", area: "MI", fuel: "diesel" };
const today = new Date().toISOString().slice(0, 10);

function fuelAnswer(extra?: Record<string, unknown>): PriceAnswer {
  const a = buildAnswer({
    source: itSrc.info,
    query: IT_PARAMS,
    summary: summarise(Array.from({ length: 40 }, (_, i) => 1.7 + i / 100)),
    currency: "EUR",
    unit: "per litre",
    period: { from: today, to: today },
    method: "m",
    describe: (s) => `The median is ${s.median}.`,
  });
  return extra ? { ...a, extra: { ...(a.extra ?? {}), ...extra } } : a;
}

function thinAnswer(): PriceAnswer {
  return buildAnswer({
    source: itSrc.info,
    query: IT_PARAMS,
    summary: summarise([1.7, 1.8]),
    currency: "EUR",
    unit: "per litre",
    period: { from: today, to: today },
    method: "m",
    describe: () => "x",
  });
}

function rentAverage(): PriceAnswer {
  return buildStatisticAnswer({
    source: SOURCES["ie-rtb-rents"],
    query: { country: "IE", town: "Dublin" },
    value: 2165,
    measure: "average",
    currency: "EUR",
    unit: "per month",
    period: { from: "2026-04-01", to: "2026-06-30" },
    reference_period: "2026-Q2",
    method: "m",
    describe: () => "Average rent.",
  });
}

const fresh = generateSigningKey();
const KEY = fresh.key;
const getKey = async () => KEY;

function withEnv<T>(vars: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    old[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  resetKeyCache();
  return body().finally(() => {
    for (const k of Object.keys(old)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
    resetKeyCache();
  });
}

async function withHandle<T>(handle: () => Promise<PriceAnswer>, body: () => Promise<T>): Promise<T> {
  const original = itSrc.handle;
  itSrc.handle = handle as any;
  try {
    return await body();
  } finally {
    itSrc.handle = original;
  }
}

const claimsOf = (jws: string) => JSON.parse(fromB64u(jws.split(".")[1]).toString("utf8"));

// ---------- the cryptography ----------

test("sign and verify round trip: header, claims, kid and a compact size", async () => {
  const answer = fuelAnswer();
  const p = await proofFor("answer", fuelCat.tool, "fuel", answer, PROOF_ISSUER, { getKey });
  assert.ok(p, "an ok answer is signed");
  const header = JSON.parse(fromB64u(p.jws.split(".")[0]).toString("utf8"));
  assert.deepEqual(header, { alg: "EdDSA", kid: KEY.kid, typ: "proofprice-proof+jws" });
  assert.equal(KEY.kid, kidFor(KEY.x));
  assert.equal(KEY.kid.length, 16);
  assert.ok(p.jws.length < 2048, `proof is ${p.jws.length} characters`);
  assert.equal(p.view_url, `${PROOF_ISSUER}/p/${p.jws}`);
  assert.equal(p.verify_url, `${PROOF_ISSUER}/api/v1/proofs/verify`);

  const c = claimsOf(p.jws);
  assert.equal(c.iss, "https://proofprice.com");
  assert.equal(c.exp - c.iat, 90 * 86400);
  assert.equal(c.kind, "answer");
  assert.equal(c.tool, fuelCat.tool);
  assert.equal(c.statement, PROOF_STATEMENT);
  assert.deepEqual(c.query, { area: "MI", country: "IT", fuel: "diesel" });
  assert.equal(c.result.category, "fuel");
  assert.equal(c.result.country, "IT");
  assert.equal(c.result.item, "diesel");
  assert.equal(c.result.area, "MI");
  assert.equal(c.result.median, answer.price!.median);
  assert.equal(c.result.p10, answer.price!.typical_low);
  assert.equal(c.result.p90, answer.price!.typical_high);
  assert.equal(c.result.n, 40);
  assert.equal(c.result.stale, false);
  assert.deepEqual(c.sources, [{ id: "it-fuel", name: itSrc.info.name, licence: itSrc.info.licence }]);
  // the full answer, as the caller receives it (JSON), matches answer_sha256
  assert.equal(c.answer_sha256, sha256Hex(canonicalJson(JSON.parse(JSON.stringify(answer, null, 2)))));

  const v = await verifyProof(p.jws, { keys: [publicJwk(KEY.x)], answer: JSON.parse(JSON.stringify(answer)) });
  assert.equal(v.valid, true);
  assert.equal(v.reason, "ok");
  assert.equal(v.expired, false);
  assert.equal(v.kid, KEY.kid);
  assert.equal(v.answer_matches, true);
  assert.match(String(v.human_summary), /ProofPrice reported official records for diesel in MI, Italy\. Median 1\.\d+ EUR per litre, typical/);

  const other = await verifyProof(p.jws, { keys: [publicJwk(KEY.x)], answer: { ...answer, summary: "changed" } });
  assert.equal(other.valid, true);
  assert.equal(other.answer_matches, false, "a changed answer does not match the signed hash");
});

test("tampering is detected: changed claims, changed signature, swapped header", () => {
  const jws = signJws({ iss: PROOF_ISSUER, iat: 1, exp: 4102444800, result: { median: 1.84 } }, KEY);
  const [h, p, s] = jws.split(".");
  const keys = [publicJwk(KEY.x)];
  assert.equal(verifyJws(jws, keys, PROOF_ISSUER).valid, true);
  const forged = b64u(JSON.stringify({ iss: PROOF_ISSUER, iat: 1, exp: 4102444800, result: { median: 1.5 } }));
  const r1 = verifyJws(`${h}.${forged}.${s}`, keys, PROOF_ISSUER);
  assert.equal(r1.valid, false);
  assert.equal(r1.reason, "bad_signature");
  assert.equal(r1.claims, null, "unverified claims are never returned");
  const badSig = s.slice(0, -2) + (s.endsWith("AA") ? "BB" : "AA");
  assert.equal(verifyJws(`${h}.${p}.${badSig}`, keys, PROOF_ISSUER).reason, "bad_signature");
  const noneAlg = b64u(JSON.stringify({ alg: "none", kid: KEY.kid, typ: "proofprice-proof+jws" }));
  assert.equal(verifyJws(`${noneAlg}.${p}.${s}`, keys, PROOF_ISSUER).reason, "unsupported_alg");
  assert.equal(verifyJws("not.a.jws!", keys, PROOF_ISSUER).reason, "malformed");
  assert.equal(verifyJws("", keys, PROOF_ISSUER).reason, "malformed");
  assert.equal(verifyJws(signJws({ iss: "https://evil.example", iat: 1, exp: 4102444800 }, KEY), keys, PROOF_ISSUER).reason, "wrong_issuer");
});

test("expired: the signature is genuine but the proof is out of date", async () => {
  const p = await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer(), PROOF_ISSUER, { getKey });
  const c = claimsOf(p!.jws);
  const v = await verifyProof(p!.jws, { keys: [publicJwk(KEY.x)], nowSec: c.exp + 1 });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "expired");
  assert.equal(v.expired, true);
  assert.equal(v.signature_valid, true);
  assert.ok(v.claims, "an expired proof still shows what it said");
});

test("a proof signed by a key ProofPrice does not publish is not valid (wrong kid)", async () => {
  const stranger = generateSigningKey().key;
  const p = await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer(), PROOF_ISSUER, { getKey: async () => stranger });
  const v = await verifyProof(p!.jws, { keys: [publicJwk(KEY.x)] });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "unknown_key");
  assert.equal(v.claims, null);
  // same kid in the header but signed with another key
  const forged = signJws({ iss: PROOF_ISSUER, iat: 1, exp: 4102444800 }, { ...stranger, kid: KEY.kid });
  assert.equal(verifyJws(forged, [publicJwk(KEY.x)], PROOF_ISSUER).reason, "bad_signature");
});

// ---------- keys ----------

test("feature off when there is no key: no proof, no header, empty key list", async () => {
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: undefined, BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: undefined }, async () => {
    assert.equal(keyMode(), null);
    assert.equal(await getSigningKey(), null);
    assert.equal(await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer()), null);
    assert.deepEqual(proofHeaders(null), {});
    assert.deepEqual(await publicKeys(), []);
  });
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8, PROOFPRICE_PROOFS: "off" }, async () => {
    assert.equal(await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer()), null, "the kill switch wins over a key");
  });
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: "not-a-key" }, async () => {
    assert.equal(await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer()), null, "a broken key means no proof, never an error");
  });
});

test("the env key is used when set (base64 PKCS8 DER Ed25519)", async () => {
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    assert.equal(keyMode(), "env");
    const k = await getSigningKey();
    assert.equal(k?.kid, KEY.kid);
    const p = await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer());
    assert.equal((await verifyProof(p!.jws)).valid, true, "verifyProof finds the current key by itself");
  });
});

test("self-provisioning: one key is made, stored privately once, and reused; a race uses the key already stored", async () => {
  const store = memoryKeyStore();
  setKeyStore(store);
  try {
    await withEnv({ BLOB_STORE_ID: "store_test", VERCEL_ENV: "preview", PROOFPRICE_PROOF_SIGNING_KEY: undefined }, async () => {
      assert.equal(keyMode(), "blob");
      assert.equal(keyPath(), "proofprice-proof-keys/preview/ed25519-signing-key.json");
      const [a, b] = await Promise.all([getSigningKey(), getSigningKey()]);
      assert.ok(a && b && a.kid === b.kid, "concurrent callers share one load");
      assert.equal(store.creates, 1);
      const stored = JSON.parse(store.files.get(keyPath())!);
      assert.equal(stored.kid, a!.kid);
      assert.ok(stored.pkcs8 && stored.x);
      resetKeyCache();
      assert.equal((await getSigningKey())!.kid, a!.kid, "a new instance reads the stored key");
      assert.equal(store.creates, 1);
      const jwks = await publicKeys();
      assert.deepEqual(jwks.map((k) => k.kid), [a!.kid]);
    });
    // race: another instance wrote between our read and our write
    const racing = memoryKeyStore();
    const winner = generateSigningKey();
    let firstRead = true;
    const raceStore = {
      async read(p: string) {
        if (firstRead) {
          firstRead = false;
          return null;
        }
        return racing.read(p);
      },
      async create(p: string, body: string) {
        racing.files.set(p, JSON.stringify({ v: 1, kid: winner.key.kid, x: winner.key.x, pkcs8: winner.pkcs8, created_at: "x" }));
        return racing.create(p, body);
      },
    };
    setKeyStore(raceStore);
    await withEnv({ BLOB_STORE_ID: "store_test", VERCEL_ENV: "production", PROOFPRICE_PROOF_SIGNING_KEY: undefined }, async () => {
      assert.equal((await getSigningKey())!.kid, winner.key.kid, "the loser of the race uses the winner's key");
    });
    // a store that is down: no proof, no throw
    setKeyStore({ read: async () => { throw new Error("store down"); }, create: async () => { throw new Error("store down"); } });
    await withEnv({ BLOB_STORE_ID: "store_test", PROOFPRICE_PROOF_SIGNING_KEY: undefined }, async () => {
      assert.equal(await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer()), null);
    });
  } finally {
    setKeyStore(null);
  }
});

test("signing is time-boxed: a key that never loads costs at most the deadline and gives no proof", async () => {
  const started = Date.now();
  const p = await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer(), PROOF_ISSUER, { getKey: () => new Promise(() => {}), deadlineMs: 50 });
  assert.equal(p, null);
  assert.ok(Date.now() - started < 1000);
});

// ---------- what is signed ----------

test("never signed: insufficient_data, no_matches, cannot_judge, errors; stale copies are signed and say so", async () => {
  assert.equal(thinAnswer().status, "insufficient_data");
  assert.equal(await proofFor("answer", fuelCat.tool, "fuel", thinAnswer(), PROOF_ISSUER, { getKey }), null);
  assert.equal(await proofFor("answer", fuelCat.tool, "fuel", { ...fuelAnswer(), status: "no_matches", price: null }, PROOF_ISSUER, { getKey }), null);
  assert.equal(await proofFor("answer", fuelCat.tool, "fuel", { error: "x" }, PROOF_ISSUER, { getKey }), null);
  const cj = judge(fuelAnswer(), { category: "fuel", country: "IT", price: 1.8, currency: "GBP", unit: null, includes: null });
  assert.equal(cj.verdict, "cannot_judge");
  assert.equal(await proofFor("check", CHECK_TOOL, "fuel", cj, PROOF_ISSUER, { getKey }), null);
  const stale = await proofFor("answer", fuelCat.tool, "fuel", fuelAnswer({ stale: true, snapshot_date: today }), PROOF_ISSUER, { getKey });
  assert.equal(claimsOf(stale!.jws).result.stale, true);
  assert.match(humanSummary(claimsOf(stale!.jws)), /own recent copy/);
});

test("a check proof carries the verdict and the asked price; an official average has no range and n no_count", async () => {
  const check = judge(rentAverage(), { category: "rent", country: "IE", price: 2400, currency: null, unit: null, includes: null });
  assert.notEqual(check.verdict, "cannot_judge");
  const p = await proofFor("check", CHECK_TOOL, "rent", check, PROOF_ISSUER, { getKey });
  const c = claimsOf(p!.jws);
  assert.equal(c.kind, "check");
  assert.equal(c.result.category, "rent");
  assert.equal(c.result.verdict, check.verdict);
  assert.deepEqual(c.result.asked, { price: 2400, currency: null, unit: null });
  assert.equal(c.result.p10, null);
  assert.equal(c.result.value, 2165);
  assert.equal(c.answer_sha256, sha256Hex(canonicalJson(check)), "a check's hash covers the whole check result");
  assert.match(humanSummary(c), /ProofPrice checked 2,400 EUR per month for Dublin, Ireland against official records: above the official average\. Official average 2,165 EUR per month/);
  const claims = buildClaims("check", CHECK_TOOL, "rent", check, 1_800_000_000);
  assert.equal(claims.iat, 1_800_000_000);
});

test("a proof stays under 2 KB even when a source's licence is a long paragraph", async () => {
  const src = SOURCES["eu-oil-bulletin"];
  assert.ok(src.licence.length > 300, "fixture: the Oil Bulletin licence is long");
  const a = buildStatisticAnswer({
    source: src, query: { country: "IE", fuel: "diesel" }, value: 2.1367, measure: "average", currency: "EUR", unit: "per litre",
    period: { from: "2026-10-26", to: "2026-10-26" }, reference_period: "2026-10-26", method: "m", describe: () => "x",
  });
  const check = judge(a, { category: "fuel", country: "IE", price: 1.89, currency: null, unit: null, includes: null });
  const p = await proofFor("check", CHECK_TOOL, "fuel", check, PROOF_ISSUER, { getKey });
  assert.ok(p!.jws.length < 2048, `proof is ${p!.jws.length} characters`);
  assert.equal(claimsOf(p!.jws).sources[0].licence, "Creative Commons Attribution 4.0 International (CC BY 4.0)");
  assert.match(humanSummary(claimsOf(p!.jws)), /checked 1\.89 EUR per litre for diesel in Ireland against official records: below the official average/);
});

// ---------- REST ----------

test("REST category answer: X-ProofPrice-Proof and Link headers on ok, none on insufficient_data; CORS exposes them", async () => {
  const { GET } = await import("../app/api/v1/[category]/route");
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    await withHandle(async () => fuelAnswer(), async () => {
      const res = await GET(new Request("https://proofprice.com/api/v1/fuel?country=IT&area=MI&fuel=diesel"), { params: Promise.resolve({ category: "fuel" }) });
      assert.equal(res.status, 200);
      const jws = res.headers.get("x-proofprice-proof");
      assert.ok(jws, "proof header present");
      assert.equal(res.headers.get("link"), `<https://proofprice.com/p/${jws}>; rel="proof"`);
      assert.match(String(res.headers.get("access-control-expose-headers")), /x-proofprice-proof/);
      const body = await res.json();
      assert.equal(body.status, "ok");
      assert.equal("proof" in body, false, "the answer body is unchanged");
      const v = await verifyProof(jws!, { answer: body });
      assert.equal(v.valid, true);
      assert.equal(v.answer_matches, true, "the body the caller got matches the signed hash");
    });
    await withHandle(async () => thinAnswer(), async () => {
      const res = await GET(new Request("https://proofprice.com/api/v1/fuel?country=IT&area=MI&fuel=diesel"), { params: Promise.resolve({ category: "fuel" }) });
      assert.equal(res.headers.get("x-proofprice-proof"), null);
      assert.equal(res.headers.get("link"), null);
    });
    await withHandle(async () => { throw new Error("boom"); }, async () => {
      const res = await GET(new Request("https://proofprice.com/api/v1/fuel?country=IT&area=MI&fuel=diesel"), { params: Promise.resolve({ category: "fuel" }) });
      assert.ok(res.status >= 400);
      assert.equal(res.headers.get("x-proofprice-proof"), null, "errors are never signed");
    });
  });
});

test("REST check: a verdict carries a proof whose claims match the check", async () => {
  const { GET } = await import("../app/api/v1/check/route");
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    await withHandle(async () => fuelAnswer(), async () => {
      const res = await GET(new Request("https://proofprice.com/api/v1/check?category=fuel&country=IT&area=MI&fuel=diesel&price=1.89"));
      assert.equal(res.status, 200);
      const body = await res.json();
      const jws = res.headers.get("x-proofprice-proof");
      assert.ok(jws);
      const v = await verifyProof(jws!, { answer: body });
      assert.equal(v.valid, true);
      assert.equal(v.answer_matches, true);
      assert.equal((v.claims as any).kind, "check");
      assert.equal((v.claims as any).result.verdict, body.verdict);
      assert.equal((v.claims as any).result.asked.price, 1.89);
    });
    await withHandle(async () => fuelAnswer(), async () => {
      const res = await GET(new Request("https://proofprice.com/api/v1/check?category=fuel&country=IT&area=MI&fuel=diesel&price=1.89&currency=GBP"));
      assert.equal((await res.json()).verdict, "cannot_judge");
      assert.equal(res.headers.get("x-proofprice-proof"), null, "cannot_judge is never signed");
    });
  });
});

// ---------- MCP ----------

test("MCP: _meta['proofprice/proof'] on ok category answers and checks, never on errors or thin answers", async () => {
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    let next: () => Promise<PriceAnswer> = async () => fuelAnswer();
    const deps: ToolDeps = { ...LIVE_DEPS, categories: CATEGORIES, runCategory: (async () => next()) as any };
    const specs = buildToolSpecs(deps);
    const fuel = specs.find((s) => s.name === fuelCat.tool)!;
    const check = specs.find((s) => s.name === CHECK_TOOL)!;

    const ok = await fuel.call(IT_PARAMS);
    const meta: any = ok._meta?.[PROOF_META_KEY];
    assert.ok(meta, "proof in _meta");
    assert.deepEqual(Object.keys(meta).sort(), ["jws", "verify_url", "view_url"]);
    assert.equal(meta.view_url, `https://proofprice.com/p/${meta.jws}`);
    const v = await verifyProof(meta.jws, { answer: ok.structuredContent });
    assert.equal(v.valid, true);
    assert.equal(v.answer_matches, true);
    assert.equal("proof" in (ok.structuredContent ?? {}), false, "structuredContent is the unchanged answer");

    const ch = await check.call({ category: "fuel", ...IT_PARAMS, price: 1.89 });
    const cm: any = ch._meta?.[PROOF_META_KEY];
    assert.ok(cm);
    assert.equal(claimsOf(cm.jws).kind, "check");
    assert.equal(claimsOf(cm.jws).result.category, "fuel");

    next = async () => thinAnswer();
    assert.equal((await fuel.call(IT_PARAMS))._meta, undefined);
    next = async () => { throw new Error("source down"); };
    const err = await fuel.call(IT_PARAMS);
    assert.equal(err.isError, true);
    assert.equal(err._meta, undefined);
    const cov = specs.find((s) => s.name === "pricepaid_coverage")!;
    assert.equal((await cov.call({}))._meta, undefined, "coverage is not a price answer");
  });
});

test("MCP through the real handler: the SDK passes _meta['proofprice/proof'] through to the client", async () => {
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    const handler = createProofPriceMcpHandler({ ...LIVE_DEPS, runCategory: (async () => fuelAnswer()) as any, historyDays: () => 0 });
    const res = await handler(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: fuelCat.tool, arguments: IT_PARAMS } }),
      }),
    );
    const text = await res.text();
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    const msg = JSON.parse(data ? data.slice(6) : text);
    const meta = msg.result?._meta?.[PROOF_META_KEY];
    assert.ok(meta?.jws, `no proof in ${text.slice(0, 300)}`);
    assert.equal((await verifyProof(meta.jws, { answer: msg.result.structuredContent })).answer_matches, true);
  });
});

// ---------- verify endpoint, JWKS, docs ----------

test("verify endpoint: GET and POST, valid, tampered, missing; free and CORS open", async () => {
  const route = await import("../app/api/v1/proofs/verify/route");
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    const answer = fuelAnswer();
    const p = await proofFor("answer", fuelCat.tool, "fuel", answer);
    const g = await route.GET(new Request(`https://proofprice.com/api/v1/proofs/verify?proof=${p!.jws}`));
    assert.equal(g.status, 200);
    assert.equal(g.headers.get("access-control-allow-origin"), "*");
    const gb = await g.json();
    assert.equal(gb.valid, true);
    assert.equal(gb.kid, KEY.kid);
    assert.equal(gb.expired, false);
    assert.ok(gb.claims && gb.human_summary);
    assert.equal(gb.keys_url, "https://proofprice.com/.well-known/proofprice-keys.json");

    const post = await route.POST(new Request("https://proofprice.com/api/v1/proofs/verify", { method: "POST", body: JSON.stringify({ proof: p!.jws, answer }) }));
    const pb = await post.json();
    assert.equal(pb.valid, true);
    assert.equal(pb.answer_matches, true);

    const [h, , s] = p!.jws.split(".");
    const tampered = `${h}.${b64u(JSON.stringify({ ...claimsOf(p!.jws), result: { median: 0.5 } }))}.${s}`;
    const t = await (await route.GET(new Request(`https://proofprice.com/api/v1/proofs/verify?proof=${tampered}`))).json();
    assert.equal(t.valid, false);
    assert.equal(t.reason, "bad_signature");

    assert.equal((await route.GET(new Request("https://proofprice.com/api/v1/proofs/verify"))).status, 400);
    assert.equal((await route.POST(new Request("https://proofprice.com/api/v1/proofs/verify", { method: "POST", body: "{}" }))).status, 400);
    assert.equal(route.OPTIONS().status, 204);
  });
});

test("JWKS: Ed25519 OKP keys with kid, use sig, alg EdDSA; empty when off", async () => {
  const route = await import("../app/.well-known/proofprice-keys.json/route");
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: fresh.pkcs8 }, async () => {
    const res = await route.GET();
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = await res.json();
    assert.equal(body.issuer, "https://proofprice.com");
    assert.equal(body.keys.length, 1);
    assert.deepEqual(body.keys[0], { kty: "OKP", crv: "Ed25519", x: KEY.x, kid: KEY.kid, use: "sig", alg: "EdDSA" });
    assert.equal(JSON.stringify(body).includes(fresh.pkcs8), false, "never the private key");
    assert.equal(Object.keys(body.keys[0]).includes("d"), false);
  });
  await withEnv({ PROOFPRICE_PROOF_SIGNING_KEY: undefined, BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: undefined }, async () => {
    assert.deepEqual((await (await route.GET()).json()).keys, []);
  });
});

test("docs: /proofs is public, and llms.txt, llms-full.txt and openapi.json describe proofs and the verify endpoint", () => {
  assert.ok(PUBLIC_PATHS.includes("/proofs"));
  const llms = buildLlmsTxt("https://proofprice.com");
  assert.match(llms, /## Signed Price Proofs/);
  assert.match(llms, /\/api\/v1\/proofs\/verify/);
  assert.match(llms, /\.well-known\/proofprice-keys\.json/);
  assert.match(buildLlmsFullTxt("https://proofprice.com"), /## Signed Price Proofs/);
  const api: any = buildOpenApi("https://proofprice.com");
  assert.ok(api.paths["/api/v1/proofs/verify"].get && api.paths["/api/v1/proofs/verify"].post);
  assert.ok(api.paths["/api/v1/check"].get.responses["200"].headers["X-ProofPrice-Proof"]);
  assert.ok(api.paths["/api/v1/fuel"].get.responses["200"].headers["X-ProofPrice-Proof"]);
});
