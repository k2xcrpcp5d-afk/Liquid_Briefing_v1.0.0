#!/usr/bin/env python3
"""Profile the Newstex JSONL snapshot WITHOUT printing article text.

Prints only counts, field names, publisher category labels, IDs, dates and
(for answer-key candidates only) headlines truncated to 90 chars.
No text_content / html_content / excerpt is ever printed or written.

usage: python3 profile_dataset.py <folder-with-jsonl> [summary_out.json]
"""
import hashlib, json, re, statistics, sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

folder = Path(sys.argv[1])
out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else folder / "dataset_profile.json"
files = sorted(folder.glob("*.jsonl"))
if not files:
    sys.exit(f"no .jsonl files in {folder}")

def get(o, path):
    for k in path.split("."):
        if not isinstance(o, dict) or k not in o:
            return None
        o = o[k]
    return o

def parse_date(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None

def norm_body(t):
    return re.sub(r"\s+", " ", (t or "").lower()).strip()

FIELDS = ["$id", "permalink", "date", "language", "headline", "excerpt", "text_content", "html_content",
          "source", "publication.name", "categories", "provider_categories", "company_tickers", "category_scores"]

arts = []
summary = {"files": {}, "notes": "aggregates only; no article text"}
for f in files:
    feed = f.stem
    rows, bad = [], 0
    with f.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                bad += 1
    presence = {fld: sum(1 for r in rows if get(r, fld) not in (None, "", [], {})) for fld in FIELDS}
    top_keys = Counter(k for r in rows for k in r.keys())
    dates = [d for d in (parse_date(r.get("date")) for r in rows) if d]
    lens = [len(r.get("text_content") or "") for r in rows]
    per_day = Counter(d.strftime("%Y-%m-%d") for d in dates)
    pc = Counter()
    for r in rows:
        v = r.get("provider_categories")
        for x in (v if isinstance(v, list) else [v] if v else []):
            pc[x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)[:60]] += 1
    cat_shape = None
    for r in rows:
        c = r.get("categories")
        if c:
            first = c[0] if isinstance(c, list) and c else c
            cat_shape = {"type": type(c).__name__, "item_type": type(first).__name__,
                         "item_keys": sorted(first.keys()) if isinstance(first, dict) else None}
            break
    summary["files"][feed] = {
        "rows": len(rows), "parse_errors": bad,
        "publication_names": dict(Counter(get(r, "publication.name") for r in rows)),
        "languages": dict(Counter(r.get("language") for r in rows)),
        "date_min": min(dates).isoformat() if dates else None,
        "date_max": max(dates).isoformat() if dates else None,
        "from_2026_11_13": sum(1 for d in dates if d >= datetime(2026, 11, 13, tzinfo=timezone.utc)),
        "text_len_median": int(statistics.median(lens)) if lens else 0,
        "text_chars_total": sum(lens),
        "field_presence": presence,
        "all_top_level_keys": dict(top_keys),
        "categories_shape": cat_shape,
        "provider_categories_top": pc.most_common(30),
        "per_day_from_nov13": {k: v for k, v in sorted(per_day.items()) if k >= "2026-11-13"},
    }
    for r in rows:
        arts.append({
            "feed": feed, "id": r.get("$id"), "date": parse_date(r.get("date")),
            "lang": r.get("language"), "author": r.get("source"),
            "headline": r.get("headline") or "", "excerpt": r.get("excerpt") or "",
            "hash": hashlib.sha256(norm_body(r.get("text_content")).encode()).hexdigest(),
        })

# ---- daily totals and briefing windows ------------------------------------------
daily = Counter(a["date"].strftime("%Y-%m-%d") for a in arts if a["date"])
summary["daily_total_from_nov13"] = {k: v for k, v in sorted(daily.items()) if k >= "2026-11-13"}
windows = {}
for day in ["2026-11-17", "2026-11-18", "2026-11-19"]:
    cut = datetime.fromisoformat(day + "T06:00:00+00:00")
    for h in (24, 48):
        sel = [a for a in arts if a["date"] and cut - timedelta(hours=h) <= a["date"] < cut]
        windows[f"{day} 06:00Z, last {h}h"] = {"total": len(sel), "by_feed": dict(Counter(a["feed"] for a in sel))}
summary["briefing_windows"] = windows

# ---- exact duplicates -----------------------------------------------------------
by_hash = defaultdict(list)
for a in arts:
    by_hash[a["hash"]].append(a)
dups = [g for g in by_hash.values() if len(g) > 1]
summary["exact_duplicate_groups"] = {"groups": len(dups), "extra_copies": sum(len(g) - 1 for g in dups),
                                     "examples": [[(x["feed"], x["id"]) for x in g] for g in dups[:5]]}

# ---- translation pairing: same author, |dt| <= 15 min ---------------------------
en = [a for a in arts if a["feed"].startswith("invezz") and a["lang"] == "en" and a["date"]]
trans = {}
for lang in ("de", "nl"):
    src = [a for a in arts if a["feed"].startswith("invezz") and a["lang"] == lang and a["date"]]
    res = Counter()
    ambiguous = []
    for a in src:
        cands = [e for e in en if e["author"] == a["author"] and abs((e["date"] - a["date"]).total_seconds()) <= 900]
        if len(cands) == 1:
            res["unique_match"] += 1
        elif len(cands) > 1:
            res["multiple_candidates"] += 1
            ambiguous.append(a["id"])
        else:
            res["no_match"] += 1
    trans[lang] = {"articles": len(src), **res, "ambiguous_ids": ambiguous[:20]}
summary["translation_pairing_rule"] = trans

# ---- answer-key candidates (headline only, truncated) ---------------------------
KEYS = {
    "ppi_october": r"producer price|\bppi\b|erzeugerpreis|producentenprijs",
    "intel": r"\bintel\b",
    "nvidia_huang": r"\bhuang\b|\bnvidia\b",
}
cands = {}
since = datetime(2026, 11, 13, tzinfo=timezone.utc)
for key, rx in KEYS.items():
    hits = [a for a in arts if a["date"] and a["date"] >= since and re.search(rx, (a["headline"] + " " + a["excerpt"]).lower())]
    cands[key] = {"count": len(hits), "by_feed": dict(Counter(a["feed"] for a in hits)),
                  "items": [{"feed": a["feed"], "id": a["id"], "date": a["date"].strftime("%m-%d %H:%M"),
                             "lang": a["lang"], "headline_90": a["headline"][:90]}
                            for a in sorted(hits, key=lambda x: x["date"])[:30]]}
summary["answer_key_candidates"] = cands

out_path.write_text(json.dumps(summary, indent=1, ensure_ascii=False, default=str))

# ---- console digest ---------------------------------------------------------------
print("FILES")
for feed, s in summary["files"].items():
    print(f"  {feed:14} rows={s['rows']:5} bad={s['parse_errors']} langs={s['languages']} "
          f"since13Nov={s['from_2026_11_13']} median_len={s['text_len_median']} pub={list(s['publication_names'])}")
    missing = {k: v for k, v in s["field_presence"].items() if v < s["rows"]}
    print(f"  {'':14} fields<100%: {missing}")
    print(f"  {'':14} categories_shape={s['categories_shape']}")
print("DAILY", summary["daily_total_from_nov13"])
print("WINDOWS"); [print("  ", k, v) for k, v in windows.items()]
print("EXACT_DUPS", {k: v for k, v in summary["exact_duplicate_groups"].items() if k != "examples"})
print("TRANSLATIONS", {k: {kk: vv for kk, vv in v.items() if kk != "ambiguous_ids"} for k, v in trans.items()})
for k, v in cands.items():
    print(f"CANDIDATES {k}: {v['count']} {v['by_feed']}")
    for it in v["items"]:
        print(f"    {it['date']} {it['feed']:12} {it['lang']} {it['id']}  {it['headline_90']}")
print(f"\nfull summary written to {out_path}")
