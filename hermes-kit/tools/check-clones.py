#!/usr/bin/env python3
"""Are two roles in the roster the same text with a different name? Two skills?

Run it **when writing a new identity or a new skill** (before adding it to the
catalog): `python3 tools/check-clones.py`.

    python3 tools/check-clones.py                 whole corpus, table + exit 0/1
    python3 tools/check-clones.py --threshold 25   moves the FAIL threshold
    python3 tools/check-clones.py --pair a.md b.md one pair, with the overlap in view
    python3 tools/check-clones.py --root /other    another copy of the kit

Exit 0 = nobody clears the FAIL threshold. Exit 1 = at least one pair does.
WARNINGS do not break the check: they are there to look at, not to block.

Why this exists: the roster sells itself as a team. Five roles saying the same
thing under a different name are not five roles, they are one role charged
five times — and the copy-paste is easy to slip in by accident, because
copying the identity next door and swapping the craft passes any review: the
file is well-formed and reads fine. Same story with the kit's skills. That is
why the comparison **neutralizes entities before measuring**: the roster's
names, the capability labels, the skill names and any Capitalized word in the
middle of a sentence get replaced by a placeholder, so a find-and-replace
cannot hide the copy.

How it measures: 8-word shingles over the neutralized text, and the overlap is
`|shared shingles| / |shingles of the smaller file|`. The denominator is the
smaller one on purpose: a clone that had two sections tacked on at the bottom
is still a clone, and a classic Jaccard score would dilute that.

Two separate pools — identities against identities, skills against skills —
because an identity and a skill share no prose and should not: crossing them
only adds noise.

Ported (the idea, not the bash) from `scripts/check-agent-originality.sh` in
the agency-agents repo, MIT. There the corpus had a 0% median and a ~1.5%
worst pair, with WARN 20 / FAIL 40; here the corpus is different and the
thresholds were recalibrated against this repo's own measurement (see
*_THRESHOLD).
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The two pools. Never crossed: an identity and a SKILL.md share no prose.
# A skill that ships inside a plugin is in the SAME pool as one under skills/:
# they are the same kind of file and they install into the same directory, so
# putting them in separate pools would let a clone hide by moving.
POOLS = (
    ("roles", ("roles/*/identity.md",)),
    ("skills", ("skills/*/SKILL.md", "plugins/*/skills/*/SKILL.md")),
)

WINDOW = 8   # shingle length, in words

# --- thresholds -------------------------------------------------------------
# Calibrated against the measured baseline of THIS repo (2026-08-20, 5
# identities + 14 skills, 101 pairs):
#   roles:  worst pair 0.9%, median 0.0%
#   skills: worst pair 3.8% (no-web-search <-> no-images), median 0.0%
# The 3.8% is real and correct: those two skills are siblings — both say "you
# don't have this, offer the capability" — and they share the sentence that
# explains the note disappears on its own. That is overlap worth seeing, not a
# clone, so it stays measured instead of whitelisted.
# The other end of the ruler: a real find-replace clone (an identity copied with
# the role names swapped) measures ~98% here. So the honest corpus lives under
# 5% and a clone lives over 95%; there is nothing in between to split hairs
# about. WARN at 15% is ~4x today's worst honest pair, FAIL at 30% means "a
# third of the smaller file is verbatim the other one", which no two roles can
# defend. Both are set for zero false positives, not for catching more.
# The half-clone case, measured the same way: copy an identity and rewrite half
# of it -> 53% (FAIL); rewrite three quarters -> 22% (WARN); nine tenths -> 9%
# (ok). Which is the behaviour we want — the further you get from the original,
# the less the check has to say about you.
FAIL_THRESHOLD = 30.0
WARN_THRESHOLD = 15.0

# --- what is legitimately shared -------------------------------------------
# Empirical, not theoretical: this list was filled AFTER running the tool on the
# corpus and reading the shared shingles of the worst pairs with `--pair`.
# Everything here is house boilerplate that every file of its kind repeats on
# purpose; leaving it in would charge every new role a few points of overlap it
# did not earn. Anything NOT on this list counts, including similar-sounding
# prose — that is the signal we want.
SHARED_BOILERPLATE = (
    # The anti-punt rule. roles/README.md says it out loud: "cada identity.md
    # termina con la misma advertencia, y no es adorno". A rule every role is
    # REQUIRED to repeat verbatim cannot count as evidence that two roles are
    # the same role. Without this, it alone put ~4 points on every pair.
    r"decilo una vez y segu[ií](?: con\s+lo que s[ií] pod[eé]s hacer)?",
    r"\*\*Pero nunca patees lo que pod[eé]s hacer\.\*\*",
    # Same story with the rule about company facts belonging to the shared file
    # instead of to one role's memory: house rule, repeated on purpose.
    r"va al archivo compartido",
    r"el resto del equipo sigue diciendo lo viejo",
    # Section headings. Also prescribed: an identity is "qué hace, qué no hace
    # nunca, con qué otros roles se cruza" (roles/README.md), so the skeleton is
    # the template's, not the author's. What hangs UNDER each heading is the
    # author's, and that is still fully measured.
    r"^#+ .*$",
)
_BOILERPLATE = re.compile("|".join(SHARED_BOILERPLATE), re.IGNORECASE | re.MULTILINE)

PLACEHOLDER = " ¶ "   # placeholder that survives tokenization as a word

CAP_WORD = re.compile(r"\b[A-ZÁÉÍÓÚÜÑ][\wÀ-ſ]*")
# Chars that mean "a sentence starts right after me". A capitalized word right
# after one of these is just Spanish orthography, not a proper noun, so it stays.
SENTENCE_START = set(".!?:;\n")
# Markdown decoration to see through when looking backwards for the real char.
DECORATION = " \t*_`#>-–—•|\"'([«"


def strip_frontmatter(text):
    """Drop the YAML frontmatter — it is metadata, not prose."""
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2]
    return text


def entities(root):
    """Names a find-replace clone would swap: roster, capabilities, skills.

    Read from the catalogs rather than hardcoded so this check cannot drift out
    of sync with the roster the way a copied literal silently would.
    """
    terms = set()

    roles_catalog = root / "roles" / "catalog.json"
    if roles_catalog.is_file():
        data = json.loads(roles_catalog.read_text(encoding="utf-8"))
        for role in data.get("roles", []):
            for key in ("id", "label"):
                if role.get(key):
                    terms.add(str(role[key]))
            name = (role.get("identity") or {}).get("name")
            if name:
                terms.add(str(name))

    capabilities_catalog = root / "capabilities" / "catalog.json"
    if capabilities_catalog.is_file():
        data = json.loads(capabilities_catalog.read_text(encoding="utf-8"))
        for cap in data.get("capabilities", []):
            for key in ("id", "label"):
                if cap.get(key):
                    terms.add(str(cap[key]))

    for skill in sorted((root / "skills").glob("*/SKILL.md")):
        terms.add(skill.parent.name)

    for skill in sorted(root.glob("plugins/*/skills/*/SKILL.md")):
        terms.add(skill.parent.name)
    for manifest in sorted(root.glob("plugins/*/plugin.json")):
        terms.add(manifest.parent.name)

    # Longest first: "Cargar facturas" must be replaced before "facturas".
    return sorted(terms, key=len, reverse=True)


def _entities_regex(terms):
    # `-` -> `[- ]` so the id (`no-web-search`) also catches the prose form
    # ("no web search"). Terms of 1-2 chars are dropped: they are not names,
    # they are noise that would blank out half the text.
    parts = [re.escape(t).replace("-", "[- ]") for t in terms if len(t) > 2]
    if not parts:
        return re.compile(r"(?!x)x")   # matches nothing, never the empty string
    return re.compile(r"(?<![\w])(?:" + "|".join(parts) + r")(?![\w])", re.IGNORECASE)


def _neutralize_capitalized(text):
    """Blank out Capitalized words that are NOT starting a sentence.

    The source script neutralized a hardcoded list of markets and platforms; the
    generalization is that any proper noun mid-sentence is an entity — a client,
    a tool, a country, a role name we forgot to put in a catalog — and a clone
    that only swapped those must still score as a clone. Sentence-initial
    capitals are kept because in Spanish every sentence starts with one and
    blanking them would erase real prose.
    """
    out = []
    end = 0
    for m in CAP_WORD.finditer(text):
        before = text[:m.start()].rstrip(DECORATION)
        starting = (not before) or before[-1] in SENTENCE_START
        if starting:
            continue
        out.append(text[end:m.start()])
        out.append(PLACEHOLDER)
        end = m.end()
    out.append(text[end:])
    return "".join(out)


def _normalize(chunk, entities_re):
    chunk = entities_re.sub(PLACEHOLDER, chunk)
    chunk = _neutralize_capitalized(chunk)
    chunk = chunk.lower()
    chunk = unicodedata.normalize("NFD", chunk)
    chunk = "".join(c for c in chunk if not unicodedata.combining(c))
    chunk = re.sub(r"[^a-z0-9¶ ]", " ", chunk)
    return chunk.split()


def words(text, entities_re):
    """Text -> comparable segments: no frontmatter, no boilerplate, no entities.

    Segments, not one flat list, because the boilerplate is CUT OUT rather than
    blanked: if a shingle could span the hole, deleting a shared heading would
    weld the paragraph above to the paragraph below and invent an overlap that
    is not in either file. Nothing crosses a cut.
    """
    text = strip_frontmatter(text)
    return [ws for ws in (_normalize(t, entities_re) for t in _BOILERPLATE.split(text)) if ws]


def shingles(segments, k=WINDOW):
    out = set()
    for ws in segments:
        out.update(" ".join(ws[i:i + k]) for i in range(max(0, len(ws) - k + 1)))
    return out


def overlap(a, b):
    """|shared| / |smaller|, as a percentage. Containment, not plain Jaccard."""
    if not a or not b:
        return 0.0
    return 100.0 * len(a & b) / min(len(a), len(b))


def corpus(root, patterns, entities_re):
    out = {}
    for pattern in patterns:
        for path in sorted(root.glob(pattern)):
            text = path.read_text(encoding="utf-8", errors="replace")
            out[path] = shingles(words(text, entities_re))
    return out


def rel(path, root):
    try:
        return str(Path(path).resolve().relative_to(root))
    except ValueError:
        return str(path)


def label(pct):
    if pct >= FAIL_THRESHOLD:
        return "FAIL"
    if pct >= WARN_THRESHOLD:
        return "WARN"
    return "ok  "


def pairs(files):
    """Every pair in a pool, worst first.

    Sanity check for the numbers this returns: a real identity copied with its
    role names find-replaced scores ~98%, while the two most alike real files
    score under 5%. There is no middle ground in practice.
    """
    scores = []
    for a, b in combinations(sorted(files), 2):
        scores.append((overlap(files[a], files[b]), a, b))
    scores.sort(key=lambda t: -t[0])
    return scores


def pair_mode(path_a, path_b, root):
    """`--pair a b`: the two files, the score, and the shingles they share."""
    entities_re = _entities_regex(entities(root))
    sets = []
    for r in (path_a, path_b):
        p = Path(r)
        if not p.is_file():
            print(f"{r} does not exist")
            return 2
        sets.append((p, shingles(words(p.read_text(encoding="utf-8", errors="replace"), entities_re))))
    (pa, sa), (pb, sb) = sets
    pct = overlap(sa, sb)
    shared = sorted(sa & sb)

    print(f"  A: {pa}  ({len(sa)} shingles)")
    print(f"  B: {pb}  ({len(sb)} shingles)")
    print()
    print(f"  overlap {pct:.1f}%  [{label(pct).strip()}]  "
          f"— {len(shared)} shared shingles out of {min(len(sa), len(sb))}")
    if shared:
        print()
        print("  what they share (already-neutralized text):")
        for s in shared[:40]:
            print(f"    {s}")
        if len(shared) > 40:
            print(f"    … and {len(shared) - 40} more")
    print()
    print(f"  Thresholds: WARN >= {WARN_THRESHOLD:.0f}%, FAIL >= {FAIL_THRESHOLD:.0f}%")
    return 1 if pct >= FAIL_THRESHOLD else 0


def corpus_mode(root, top):
    entities_re = _entities_regex(entities(root))
    print(f"Checking for clones in {root}\n")

    fails = []
    warns = []
    worst_overall = (0.0, None, None)
    empty = True

    for name, patterns in POOLS:
        shown = " + ".join(patterns)
        files = corpus(root, patterns, entities_re)
        if len(files) < 2:
            print(f"{shown} — {len(files)} file(s), nothing to compare\n")
            continue
        empty = False
        scores = pairs(files)
        n = len(scores)
        median = scores[n // 2][0]
        print(f"{shown} — {len(files)} files, {n} pairs")
        for pct, a, b in scores[:top]:
            print(f"  [{label(pct)}] {pct:5.1f}%  {rel(a, root)}  <->  {rel(b, root)}")
            if pct >= FAIL_THRESHOLD:
                fails.append((pct, rel(a, root), rel(b, root)))
            elif pct >= WARN_THRESHOLD:
                warns.append((pct, rel(a, root), rel(b, root)))
        if n > top:
            print(f"  … and {n - top} more pairs, none above {scores[top - 1][0]:.1f}%")
        print(f"  worst pair {scores[0][0]:.1f}%  ·  median {median:.1f}%\n")
        if scores[0][0] > worst_overall[0]:
            worst_overall = (scores[0][0], rel(scores[0][1], root), rel(scores[0][2], root))

    if empty:
        print("No corpus to check.")
        return 0

    print(f"Thresholds: WARN >= {WARN_THRESHOLD:.0f}%, FAIL >= {FAIL_THRESHOLD:.0f}%  "
          f"(worst pair in corpus: {worst_overall[0]:.1f}%)")

    if fails:
        print()
        print(f"FAIL: {len(fails)} pair(s) are the same text under a different name:")
        for pct, a, b in fails:
            print(f"  - {a}  ~{pct:.0f}% the same as  {b}")
        print()
        print("A new role is selling itself as someone else on the team. If it says the")
        print("same thing as another one with the words swapped, it is not a new role: it")
        print("is the same one charged twice. Rewrite the craft, the limits and the")
        print("crossovers, not the name. To see what they share: --pair <a> <b>.")
        return 1

    if warns:
        print(f"\n{len(warns)} warning(s) to look at. They do not block.")
    print("\nPASS")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="Whether two identities (or two skills) are the same text under a different name.",
        epilog="With no arguments, checks the whole kit corpus.")
    ap.add_argument("--threshold", type=float, metavar="N",
                    help="replaces the FAIL threshold; WARN stays at half of it")
    ap.add_argument("--pair", nargs=2, metavar=("A", "B"),
                    help="looks at one specific pair and shows the shared shingles")
    ap.add_argument("--root", metavar="DIR", default=str(ROOT),
                    help="another copy of the kit (defaults to this tools/'s own)")
    ap.add_argument("--top", type=int, default=10, metavar="N",
                    help="how many pairs to show per pool (default 10)")
    args = ap.parse_args()

    global FAIL_THRESHOLD, WARN_THRESHOLD
    if args.threshold is not None:
        FAIL_THRESHOLD = args.threshold
        WARN_THRESHOLD = args.threshold / 2

    root = Path(os.path.abspath(args.root))
    if not root.is_dir():
        print(f"{root} does not exist")
        return 2

    if args.pair:
        return pair_mode(args.pair[0], args.pair[1], root)
    return corpus_mode(root, max(1, args.top))


if __name__ == "__main__":
    sys.exit(main())
