"""Smoke test: ask a ProofPrice deployment every example question in /api/v1/coverage.

Usage: python3 -I scripts/smoke.py https://proofprice.com
Prints one line per example (OK / STALE / FAIL), then a summary. Exit code 1 if any example fails.
A "stale" answer (served from our library copy because the official source did not respond) counts as a warning.
Standard library only, so it runs anywhere.
"""

import json
import sys
import time
import urllib.error
import urllib.request

UA = "ProofPrice-smoke/1.0 (+https://proofprice.com; hello@proofprice.com)"


def get(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, dict(r.headers), body, time.time() - start
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read(), time.time() - start
    except Exception as e:  # network error or timeout
        return 0, {}, str(e).encode(), time.time() - start


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "https://proofprice.com").rstrip("/")
    status, _, body, _ = get(base + "/api/v1/coverage")
    if status != 200:
        print(f"FAIL coverage HTTP {status}: {body[:200]!r}")
        return 1
    cov = json.loads(body)
    examples = cov.get("examples", [])
    print(f"Smoke test of {base} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    print(f"{len(cov.get('tools', []))} tools, {len(cov.get('sources', []))} sources, {len(examples)} examples\n")

    fails, stale = [], []
    for path in examples:
        code, headers, raw, secs = get(base + path)
        if code in (0, 502, 503, 504):  # one retry for momentary upstream trouble
            time.sleep(3)
            code, headers, raw, secs = get(base + path)
        try:
            ans = json.loads(raw)
        except Exception:
            ans = {}
        st = ans.get("status")
        is_stale = bool((ans.get("extra") or {}).get("stale")) or "x-proofprice-stale" in {k.lower() for k in headers}
        summary = (ans.get("summary") or ans.get("error") or raw[:120].decode("utf-8", "replace")).replace("\n", " ")[:150]
        if code == 200 and st == "ok" and not is_stale:
            tag = "OK   "
        elif code == 200 and st == "ok":
            tag = "STALE"
            stale.append(path)
        else:
            tag = "FAIL "
            fails.append(path)
        print(f"{tag} {code} {secs:5.1f}s {path}\n      {summary}")

    lib_code, _, lib_raw, _ = get(base + "/api/v1/library")
    lib_note = ""
    if lib_code == 200:
        try:
            lib = json.loads(lib_raw)
            errs = [s for s in lib.get("sources", []) if s.get("last_error")]
            missing = lib.get("missing", [])
            lib_note = f"library: {len(errs)} collector error(s)" + (": " + ", ".join(str(s.get("source")) for s in errs) if errs else "")
            if missing:
                lib_note += f"; not yet collected: {', '.join(missing)}"
        except Exception:
            lib_note = "library: unreadable JSON"
    else:
        lib_note = f"library: HTTP {lib_code}"

    print(f"\nSUMMARY: {len(examples) - len(fails) - len(stale)} ok, {len(stale)} stale, {len(fails)} failed; {lib_note}")
    for p in fails:
        print(f"  FAILED {p}")
    for p in stale:
        print(f"  STALE  {p}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
