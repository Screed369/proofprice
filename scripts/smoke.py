"""Smoke test: ask a ProofPrice deployment every example question in /api/v1/coverage, then talk to its MCP server.

Usage: python3 -I scripts/smoke.py https://proofprice.com
Prints one line per example (OK / STALE / FAIL), then the MCP checks, then a summary. Exit code 1 if any example or MCP check fails.
A "stale" answer (served from our library copy because the official source did not respond) counts as a warning.
The MCP checks (POST /api/mcp, 20 seconds each, however slowly the server answers) are what an AI app does when it connects:
initialize, tools/list, one small tools/call, and the 2026-protocol "subscriptions/listen" request, which must be answered
and closed at once (an open stream is what ran into Vercel's 60 second limit on 15 Oct 2026).
Standard library only, so it runs anywhere.
"""

import http.client
import json
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "ProofPrice-smoke/1.1 (+https://proofprice.com; hello@proofprice.com)"
MCP_BUDGET = 20  # seconds each MCP request may take, start to last byte
MCP_CLIENT = {"name": "proofprice-smoke", "version": "1"}


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


def post_mcp(base: str, payload: dict, extra_headers: dict | None = None, budget: float = MCP_BUDGET):
    """POST one JSON-RPC message to <base>/api/mcp and read the whole answer, stopping at `budget` seconds from the start.
    Returns (status, body bytes, seconds, timed_out). timed_out is True when the answer had not finished by then (for
    example an event stream the server keeps open); status is 0 when no answer arrived at all."""
    url = urllib.parse.urlsplit(base + "/api/mcp")
    conn_class = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        **(extra_headers or {}),
    }
    start = time.time()
    conn = conn_class(url.netloc, timeout=budget)
    status, chunks = 0, []
    try:
        conn.request("POST", url.path or "/", body=json.dumps(payload).encode(), headers=headers)
        sock = conn.sock  # kept: http.client drops conn.sock once the response is handed over
        resp = conn.getresponse()  # headers, within the connection timeout
        status = resp.status
        while True:
            left = budget - (time.time() - start)
            if left <= 0:
                return status, b"".join(chunks), time.time() - start, True
            sock.settimeout(left)
            chunk = resp.read1(65536)
            if not chunk:
                return status, b"".join(chunks), time.time() - start, False
            chunks.append(chunk)
    except (socket.timeout, TimeoutError):
        return status, b"".join(chunks), time.time() - start, True
    except Exception as e:  # network error
        return status, str(e).encode(), time.time() - start, False
    finally:
        conn.close()


def rpc_messages(body: bytes) -> list:
    """The JSON-RPC messages in an MCP answer, whether it came as plain JSON or as server-sent events."""
    text = body.decode("utf-8", "replace")
    out = []
    for line in text.splitlines():
        if line.startswith("data:"):
            try:
                out.append(json.loads(line[5:].strip()))
            except Exception:
                pass
    if not out:
        try:
            parsed = json.loads(text)
            out = parsed if isinstance(parsed, list) else [parsed]
        except Exception:
            pass
    return [m for m in out if isinstance(m, dict)]


def rpc_result(body: bytes) -> dict:
    """The first JSON-RPC response (the one carrying an id and a result or error), or {}."""
    for m in rpc_messages(body):
        if "result" in m or "error" in m:
            return m
    return {}


def check_mcp(base: str):
    """The MCP checks. Returns (lines to print, names of the checks that failed, number that passed)."""
    lines, fails, passed = [], [], 0

    def report(ok: bool, name: str, status: int, secs: float, detail: str, extra: str = ""):
        nonlocal passed
        tag = "OK   " if ok else "FAIL "
        lines.append(f"{tag} {status} {secs:5.1f}s MCP {name}\n      {detail}" + (f"\n      {extra}" if extra else ""))
        if ok:
            passed += 1
        else:
            fails.append(f"MCP {name}")

    def why_not(status: int, secs: float, timed_out: bool, body: bytes) -> str:
        if timed_out:
            return f"no complete answer within {MCP_BUDGET} s (HTTP {status or 'none'}, {len(body)} bytes so far)"
        return f"HTTP {status}: {body[:160].decode('utf-8', 'replace')!r}"

    # 1. initialize (the handshake of the 2025 protocol, what most AI apps still send first)
    init = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": MCP_CLIENT},
    }
    status, body, secs, timed_out = post_mcp(base, init)
    res = rpc_result(body).get("result") or {}
    info = res.get("serverInfo") or {}
    ok = status == 200 and not timed_out and info.get("name") == "proofprice"
    list_changed = ((res.get("capabilities") or {}).get("tools") or {}).get("listChanged")
    report(
        ok, "initialize", status, secs,
        f"server {info.get('name')} {info.get('version')}, protocol {res.get('protocolVersion')}, tools.listChanged={list_changed}"
        if ok else why_not(status, secs, timed_out, body),
    )

    # 2. tools/list
    status, body, secs, timed_out = post_mcp(base, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools = ((rpc_result(body).get("result") or {}).get("tools")) or []
    names = {t.get("name") for t in tools if isinstance(t, dict)}
    ok = status == 200 and not timed_out and {"pricepaid_home_sales", "pricepaid_coverage"} <= names
    report(ok, "tools/list", status, secs, f"{len(tools)} tools" if ok else why_not(status, secs, timed_out, body))

    # 3. one small tools/call: Irish home sales, county Cork (the first example of the IE source)
    call = {
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "pricepaid_home_sales", "arguments": {"country": "IE", "county": "Cork"}},
    }
    status, body, secs, timed_out = post_mcp(base, call)
    result = rpc_result(body).get("result") or {}
    answer = result.get("structuredContent") or {}
    stale = bool((answer.get("extra") or {}).get("stale"))
    ok = status == 200 and not timed_out and not result.get("isError") and answer.get("status") == "ok"
    summary = str(answer.get("summary") or "").replace("\n", " ")[:150]
    report(
        ok, "tools/call pricepaid_home_sales IE Cork", status, secs,
        (summary or "ok") if ok else why_not(status, secs, timed_out, body),
        "answered from our library copy (the official source did not respond)" if ok and stale else "",
    )

    # 4. the 2026 protocol's subscriptions/listen. This server never sends tool-list changes (stateless), so it must say so,
    #    acknowledge the request and close the stream at once. A stream that stays open is cut by Vercel at 60 seconds.
    meta = {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": MCP_CLIENT,
        "io.modelcontextprotocol/clientCapabilities": {},
    }
    listen = {
        "jsonrpc": "2.0", "id": 4, "method": "subscriptions/listen",
        "params": {"notifications": {"toolsListChanged": True}, "_meta": meta},
    }
    status, body, secs, timed_out = post_mcp(
        base, listen, {"mcp-protocol-version": "2026-07-28", "mcp-method": "subscriptions/listen"}
    )
    ok = 0 < status < 500 and not timed_out
    report(
        ok, "subscriptions/listen closes at once", status, secs,
        f"closed after {secs:.1f}s, {len(body)} bytes" if ok else why_not(status, secs, timed_out, body),
    )
    return lines, fails, passed


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

    print(f"\nMCP server ({base}/api/mcp, {MCP_BUDGET} s for each request):")
    mcp_lines, mcp_fails, mcp_ok = check_mcp(base)
    for line in mcp_lines:
        print(line)

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

    print(
        f"\nSUMMARY: {len(examples) - len(fails) - len(stale)} ok, {len(stale)} stale, {len(fails)} failed; "
        f"mcp: {mcp_ok} ok, {len(mcp_fails)} failed; {lib_note}"
    )
    for p in fails:
        print(f"  FAILED {p}")
    for name in mcp_fails:
        print(f"  FAILED {name}")
    for p in stale:
        print(f"  STALE  {p}")
    return 1 if fails or mcp_fails else 0


if __name__ == "__main__":
    sys.exit(main())
