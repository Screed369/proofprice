#!/usr/bin/env python3
"""How fresh is the price library? Counts EVERY collected source, never a sample.

A "collected source" is a folder library/<id>/ with a meta.json whose source still has a harvest() in sources/<id>/index.ts
(retired sources keep their old folder and must not drag the share down). Its age is the time since meta.json last_harvest_at:
the last time the daily collector visited it, whether the visit worked or not (a source that is visited but failing is an
outage, which /api/v1/library and the smoke test already report; this script is about the collector itself not running).

Two uses, both outside the collector's own code:
  guard   python3 -I scripts/library_freshness.py guard [--min-percent 90]
          Prints "true" when at least that share of collected sources was visited TODAY (UTC), else "false". The harvest workflow
          skips a scheduled run only on "true", so a one-source repair run can never stand in for the day's full harvest
          (20, 22 and 23 Nov 2026: a 05:00 one-source run made every scheduled run skip, and 212 of 214 sources went stale).
  report  python3 -I scripts/library_freshness.py report [--alarm-under 80] [--max-age-hours 30]
          Prints one line, starting "ALARM " when fewer than that share were visited within the age limit. The smoke test
          appends it to probes/smoke.txt and the Monitor reads it.
Add --json for the numbers as JSON (tests). --now and --dir are for tests. Standard library only. Always exits 0: a counting
script must never be the thing that fails a workflow.
"""
import argparse
import datetime
import json
import os
import re
import sys

# a manifest that still collects has a `harvest: ...`, `harvest(...)` or shorthand `harvest,` member (a mention in a comment does not count)
HARVEST_WORD = re.compile(r"^\s*(?:async\s+)?harvest\s*[:(,]", re.MULTILINE)


def parse_time(value):
    """An ISO timestamp as an aware UTC datetime, or None when missing or unreadable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        t = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)


def collected_sources(library_dir, sources_dir):
    """[(id, last_harvest_at or None)] for every library folder whose source can still be harvested."""
    out = []
    if not os.path.isdir(library_dir):
        return out
    for name in sorted(os.listdir(library_dir)):
        if name.startswith("_") or name.startswith("."):
            continue
        meta_path = os.path.join(library_dir, name, "meta.json")
        index_path = os.path.join(sources_dir, name, "index.ts")
        if not os.path.isfile(meta_path) or not os.path.isfile(index_path):
            continue
        try:
            with open(index_path, encoding="utf-8") as f:
                if not HARVEST_WORD.search(f.read()):
                    continue
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            out.append((name, None))  # an unreadable meta.json counts as a source that is NOT fresh
            continue
        out.append((name, parse_time(meta.get("last_harvest_at") if isinstance(meta, dict) else None)))
    return out


def measure(sources, now, max_age_hours):
    """The counts behind both uses. `sources` is [(id, datetime or None)]."""
    total = len(sources)
    today = now.date()
    limit = datetime.timedelta(hours=max_age_hours)
    visited_today = sum(1 for _, t in sources if t is not None and t.astimezone(datetime.timezone.utc).date() == today)
    fresh = sum(1 for _, t in sources if t is not None and now - t <= limit)
    ages = [((now - t).total_seconds() / 3600 if t is not None else float("inf"), sid) for sid, t in sources]
    stale = [(sid, age) for age, sid in sorted(ages, key=lambda x: (-x[0], x[1])) if age > max_age_hours]  # oldest first, then by id
    return {
        "total": total,
        "visited_today": visited_today,
        "visited_today_percent": round(100 * visited_today / total, 1) if total else 0.0,
        "fresh": fresh,
        "fresh_percent": round(100 * fresh / total, 1) if total else 0.0,
        "max_age_hours": max_age_hours,
        "today": today.isoformat(),
        "stale": [{"source": sid, "hours": None if age == float("inf") else round(age)} for sid, age in stale],
    }


def report_line(m, alarm_under):
    alarm = m["total"] == 0 or m["fresh_percent"] < alarm_under
    line = (
        f"{'ALARM ' if alarm else ''}LIBRARY FRESHNESS: {m['fresh']} of {m['total']} collected sources were visited by the daily "
        f"collector in the last {m['max_age_hours']:g} hours ({m['fresh_percent']}%); {m['visited_today']} today (UTC {m['today']})."
    )
    if alarm:
        line += f" Below the {alarm_under:g}% floor: the daily harvest is NOT running in full. Check .github/workflows/harvest.yml runs."
    if m["stale"]:
        worst = ", ".join(f"{s['source']} ({'never' if s['hours'] is None else str(s['hours']) + ' h'})" for s in m["stale"][:8])
        line += f" Oldest: {worst}{' and ' + str(len(m['stale']) - 8) + ' more' if len(m['stale']) > 8 else ''}."
    return line


def main(argv):
    p = argparse.ArgumentParser(description="Count how fresh the price library is, across every collected source.")
    p.add_argument("mode", choices=["guard", "report"])
    p.add_argument("--dir", default=".", help="repository root (holds library/ and sources/)")
    p.add_argument("--now", default=None, help="ISO time to treat as now (tests)")
    p.add_argument("--min-percent", type=float, default=90.0, help="guard: share visited today that counts as 'the day is done'")
    p.add_argument("--alarm-under", type=float, default=80.0, help="report: share under the age limit below which the line says ALARM")
    p.add_argument("--max-age-hours", type=float, default=30.0)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    now = parse_time(a.now) if a.now else datetime.datetime.now(datetime.timezone.utc)
    if now is None:
        print("unreadable --now", file=sys.stderr)
        now = datetime.datetime.now(datetime.timezone.utc)
    m = measure(collected_sources(os.path.join(a.dir, "library"), os.path.join(a.dir, "sources")), now, a.max_age_hours)
    if a.mode == "guard":
        done = m["total"] > 0 and m["visited_today_percent"] >= a.min_percent
        m["done"] = done
        print(f"{m['visited_today']} of {m['total']} collected sources were visited today ({m['visited_today_percent']}%); the day counts as harvested at {a.min_percent:g}%.", file=sys.stderr)
        print(json.dumps(m) if a.json else ("true" if done else "false"))
    else:
        m["alarm"] = m["total"] == 0 or m["fresh_percent"] < a.alarm_under
        print(json.dumps(m) if a.json else report_line(m, a.alarm_under))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as e:  # never fail a workflow from here; say what went wrong instead
        print(f"library_freshness.py could not count: {e}", file=sys.stderr)
        mode = sys.argv[1] if len(sys.argv) > 1 else ""
        print("false" if mode == "guard" else f"ALARM LIBRARY FRESHNESS: could not be counted ({e})")
        sys.exit(0)
