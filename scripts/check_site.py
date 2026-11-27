#!/usr/bin/env python3
"""Checks run before every deploy (and locally):  python3 scripts/check_site.py
- every data file parses; every question has 4 options, a valid answer index, 4 explanations,
  a mini-lesson that exists, and cited sources that exist
- served answer positions are balanced (each position 20–30%) per area
- every flashcard and lesson cites known sources
- sw.js precaches exactly the current files with the current content hash
- no private details in the published files
"""
import hashlib, json, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
errors = []


def load(n):
    return json.load(open(os.path.join(SITE, "data", n + ".json"), encoding="utf-8"))


qs, fcs, lessons, minis, sources = (load(n) for n in ("questions", "flashcards", "lessons", "minis", "sources"))
src = {s["id"] for s in sources}
mini_ids = {m["id"] for m in minis}
ids = set()
for q in qs:
    if q["id"] in ids:
        errors.append(f"duplicate id {q['id']}")
    ids.add(q["id"])
    if len(q["o"]) != 4 or len(set(q["o"])) != 4:
        errors.append(f"{q['id']}: needs 4 distinct options")
    if q["k"] not in range(4):
        errors.append(f"{q['id']}: bad answer index")
    if len(q["e"]) != 4 or not all(q["e"]):
        errors.append(f"{q['id']}: needs an explanation for every option")
    if q["m"] not in mini_ids:
        errors.append(f"{q['id']}: mini-lesson {q['m']} missing")
    if not q["src"] or any(s not in src for s in q["src"]):
        errors.append(f"{q['id']}: unknown or missing source")
for area in ("GenEd", "ProfEd", "TLE"):
    c = collections.Counter(q["k"] for q in qs if q["a"] == area)
    n = sum(c.values())
    for k in range(4):
        if n and not 0.20 <= c[k] / n <= 0.30:
            errors.append(f"{area}: answer position {k} at {c[k] / n:.0%}")
for c in fcs:
    if not c["src"] or any(s not in src for s in c["src"]):
        errors.append(f"{c['id']}: unknown source")
for l in lessons:
    for s in re.findall(r"SRC-\d{4}", l["md"]):
        if s not in src:
            errors.append(f"lesson {l['id']}: unknown source {s}")

# service worker matches the files on disk
files = sorted(os.path.relpath(os.path.join(dp, f), SITE).replace(os.sep, "/")
               for dp, _, fns in os.walk(SITE) for f in fns if f != "sw.js" and not f.startswith("."))
h = hashlib.sha256()
for rel in files:
    h.update(rel.encode())
    h.update(open(os.path.join(SITE, rel), "rb").read())
sw = open(os.path.join(SITE, "sw.js"), encoding="utf-8").read()
if f"let-study-{h.hexdigest()[:12]}" not in sw:
    errors.append("site/sw.js is stale: run python3 scripts/build_sw.py")

private = re.compile(r"@icloud|@gmail|did not pass|private repo", re.I)
for dp, _, fns in os.walk(os.path.join(ROOT, "content")):
    for f in fns:
        t = open(os.path.join(dp, f), encoding="utf-8", errors="ignore").read()
        if private.search(t):
            errors.append(f"private detail in content/{f}")

print(f"{len(qs)} questions, {len(fcs)} flashcards, {len(lessons)} lessons, {len(minis)} mini-lessons, {len(sources)} sources")
if errors:
    print("\n".join(errors[:50]))
    sys.exit(1)
print("site OK")
