#!/usr/bin/env python3
"""Swaps a SOUL's `kit:base` block for a new one, without touching the rest.

    python3 tools/replace-block.py <old-soul.md> <new-block.md>
    python3 tools/replace-block.py <old-soul.md> <new-block.md> --rescue

Writes the resulting SOUL to stdout. Notices go to stderr, so it can be
piped without polluting the file.

WHY IT EXISTS: `install-soul.sh` knew how to install the block where there
was none, and nothing else. Updating it meant "take the old one out by hand",
which on a 15 KB file on a server is exactly the kind of task where someone
takes the identity block down with it without noticing.

WHAT'S ALWAYS KEPT: EVERYTHING outside the markers. On an already-named
agent that includes the `portal:identity` block the portal wrote (the
client's name and company) and `00-identity.md`, where the hand-crafted part
lives —including that company's own sensitive actions—. It's a property of
the algorithm, not a promise: the text outside gets cut and pasted back
as-is.

WHAT HAPPENS TO WHAT'S INSIDE: the old block is compared WHOLE against the
canonical block of ITS OWN version, frozen at `soul/versions/vN.md`. If it's
identical, there's nothing of anyone's inside and the replacement goes
ahead. If there's extra text, someone wrote it by hand for THAT client: the
script FAILS, prints it line by line, and with `--rescue` moves it out of the
block —into the identity's "What this company never does without
permission" section— before replacing. It never deletes it.

HISTORY, because it explains this script's shape (12/8/2026): the comparison
used to look ONLY at the text of `<!-- por-cliente: … -->` comments, and
`01-approvals.md`'s template said to write the sensitive actions "in the same
format as the ones above", i.e. as a markdown list and OUTSIDE the comment.
The guard was watching the one place nobody wrote in. In the lab, a v4→v5
replacement took the company's four sensitive actions down with it with
exit 0 and three reassuring notices. The real fix is that list no longer
lives inside the block (it now goes in `00-identity.md`, untouchable by
construction); this comparison against the whole canonical text is the net
for the agents that already have it inside, and for whoever writes there
anyway.

Exit 0 = done · 2 = there's hand-written text inside the block · 3 = there's
no block to replace · 4 = can't tell what belongs to the client (missing the
canonical block, or the new block isn't the canonical one for its version).
"""
import argparse
import difflib
import os
import re
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSIONS = os.path.join(KIT, "soul", "versions")

OPEN_TAG = re.compile(r"<!--\s*kit:base(?:\s+(v\d+))?\s*-->")
CLOSE_TAG = re.compile(r"<!--\s*/kit:base\s*-->")
COMMENT = re.compile(r"<!--.*?-->", re.S)

# Where, outside the block, each company's own sensitive material lives. The
# same heading `soul/00-identity.md` carries, and the one the HARD RULE
# points at: change it in one place, change it in all three.
SECTION = "## Lo que en esta empresa no se hace sin permiso"


class Halt(Exception):
    """A reason to write nothing, with its exit code."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def lines_of(text):
    """The text as lines, with no trailing spaces or blank edges."""
    return [l.rstrip() for l in text.strip("\n").split("\n")]


def note_indices(text):
    """The lines that are an HTML comment or blank.

    The block's comments are notes for whoever composes the SOUL, not rules
    for the agent: an agent missing them or having them rewritten isn't lost
    text —the template itself says "if there's none, delete this comment"—.
    Everything else that's missing IS lost text, and that's why it gets told
    apart.
    """
    t = text.strip("\n")
    mark = bytearray(len(t))
    for m in COMMENT.finditer(t):
        for i in range(m.start(), m.end()):
            mark[i] = 1
    notes, pos = set(), 0
    for n, line in enumerate(t.split("\n")):
        if all(mark[pos + i] for i, c in enumerate(line) if not c.isspace()):
            notes.add(n)
        pos += len(line) + 1
    return notes


def compare(installed, canonical):
    """(additions, losses) of the installed block against the canonical one.

    additions: [(anchor, order, line)] — what a person wrote inside.
               `anchor` is where it would fall in the canonical text; it's
               used to tell whether it's an addition to the HARD RULE or an
               edit anywhere else.
    losses:    [(index, line)] — kit text the installed block no longer has.
               Someone edited the rules: a script doesn't solve that.

    `autojunk=False` isn't decorative: past 200 lines, difflib starts
    treating heavily-repeated lines —the blank ones— as junk and the diff
    comes out shifted. A SOUL block has 400.
    """
    # The version stamped on the opening marker doesn't enter the comparison:
    # an agent having v4 while the canonical text says v4 is expected, but
    # with `--canonical` the comparison is deliberately against another
    # version's block, and there the marker would show up as "something a
    # person wrote". It's structure, not client text.
    canonical = OPEN_TAG.sub("<!-- kit:base -->", canonical, count=1)
    installed = OPEN_TAG.sub("<!-- kit:base -->", installed, count=1)
    canon_lines, inst_lines = lines_of(canonical), lines_of(installed)
    notes = note_indices(canonical)
    additions, losses = [], []
    matcher = difflib.SequenceMatcher(None, canon_lines, inst_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("delete", "replace"):
            losses += [(i, canon_lines[i]) for i in range(i1, i2) if i not in notes]
        if tag in ("insert", "replace"):
            additions += [(i1, j, inst_lines[j]) for j in range(j1, j2) if inst_lines[j].strip()]
    return additions, losses


def hard_rule_range(canonical):
    """(first, last) line of the HARD RULE section in the canonical block.

    It's the only spot in the block that has a thought-out destination
    outside it. An addition anywhere else is reported and stops the run:
    moving it to the sensitive-actions list would make it say something
    nobody wrote.
    """
    canon_lines = lines_of(canonical)
    start = next((i for i, l in enumerate(canon_lines) if l.startswith("## REGLA DURA")), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(canon_lines)) if canon_lines[i].startswith("## ")),
               len(canon_lines))
    return start, end


def canonical_path(version):
    return os.path.join(VERSIONS, f"{version}.md")


def canonical_for(version, override=None):
    """The canonical block for a version, from the frozen file or the one passed in."""
    path = override or canonical_path(version)
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read(), path
    except OSError:
        return None, path


def with_section(before, rescued):
    """`before` (everything above the block) with the rescued text inside the
    sensitive-actions section: creates it if missing, and if present appends
    the lines at the end, before the next heading."""
    m = re.search(rf"^{re.escape(SECTION)}[ \t]*$", before, re.M)
    if m:
        rest = before[m.end():]
        nxt = re.search(r"^## ", rest, re.M)
        cut = m.end() + (nxt.start() if nxt else len(rest))
        return (before[:cut].rstrip("\n") + "\n\n" + rescued + "\n\n"
                + before[cut:].lstrip("\n"))
    return (before.rstrip("\n") + ("\n\n" if before.strip() else "")
            + SECTION + "\n\n" + rescued + "\n")


def find_block(soul):
    """(open, close) of the single kit:base block, or halts explaining why."""
    opens, closes = list(OPEN_TAG.finditer(soul)), list(CLOSE_TAG.finditer(soul))
    if not opens or not closes or closes[0].start() < opens[0].start():
        raise Halt(3,
                   "this SOUL doesn't have a whole kit:base block to replace "
                   "(never installed? then it's an install, not a replacement)")
    # With two blocks there's no way to guess which one counts: replacing the
    # first would leave the SOUL with two openings and two closings, and by
    # the precedence rule the one that wins is the lower one, i.e. the old
    # one. It's the same failure `agent-check.py` reports as unbalanced
    # markers.
    if len(opens) != 1 or len(closes) != 1:
        raise Halt(2,
                   f"this SOUL has {len(opens)} opening marker(s) and "
                   f"{len(closes)} closing one(s): I don't know which to replace, "
                   "and leaving it with two blocks would make the old one win. "
                   "Leave a single one by hand and run again")
    return opens[0], closes[0]


def check_new_block(new_block, new_version):
    """The new block has to be the frozen canonical text for its version.

    It's not red tape: today's frozen text is what the agent is going to be
    compared against the day it moves to the next version. If a block that
    isn't frozen gets in, the next update is left with no baseline, and we're
    back to not knowing what a person wrote from what the kit brought.
    """
    canon, path = canonical_for(new_version)
    freeze_cmd = (f"   ./tools/install-soul.sh --block > soul/versions/"
                  f"{new_version}.md")
    if canon is None:
        raise Halt(4,
                   f"{path} doesn't exist, meaning this kit never froze block "
                   f"{new_version}.\nWithout that, this agent's next update won't "
                   "have anything to\ncompare against and it's going back to not "
                   "telling the kit's text apart from the client's.\n\nFreeze it "
                   "(with a clean tree, it's the version you're about to "
                   "install):\n" + freeze_cmd)
    if lines_of(canon) != lines_of(new_block):
        raise Halt(4,
                   f"the block you gave me claims to be {new_version} but it "
                   f"doesn't match what's frozen at\n{path}.\nEither you changed "
                   "soul/'s blocks without bumping soul/VERSION —in which case "
                   f"there are two\ndifferent things both called {new_version} "
                   "going around—, or the frozen one went stale.\n\nBump the "
                   "version and freeze the new one, or re-freeze this one:\n"
                   + freeze_cmd)


def check_old_block(old, old_version, canonical_path_arg, no_canonical):
    """(additions, canonical, path). Halts if it can't tell what belongs to the client."""
    canon, path = canonical_for(old_version, canonical_path_arg)
    if canon is None:
        if no_canonical:
            return [], None, None
        extra = ""
        if old_version == "v1":
            extra = ("\nHeads up: `v1` is the bare marker, from before "
                     "versioning, and there's no possible\ncanonical block for "
                     "it — several things coexisted under that marker.\n")
        raise Halt(4,
                   f"I don't have the canonical block for {old_version} ({path}), so "
                   "I CAN'T tell\nwhat in that block the kit wrote and what a person "
                   "wrote for this client.\n" + extra +
                   "\nWays out, in order of preference:\n"
                   "  · give me the old canonical block with --canonical <file>\n"
                   "  · look at the old block yourself, and if there's nothing "
                   "hand-written inside,\n    say so with --no-canonical (it's on "
                   "your word, not the script's)")
    additions, losses = compare(old, canon)
    if losses:
        sample = "\n".join("  " + l for _, l in losses[:12])
        more = f"\n  … and {len(losses) - 12} more line(s)" if len(losses) > 12 else ""
        raise Halt(2,
                   f"this agent's {old_version} block is NOT the kit's: it's "
                   f"missing or has changed\n{len(losses)} line(s) that ARE in "
                   f"{path}.\nSomeone edited this agent's rules by hand. A script "
                   "doesn't solve that:\nlook at the diff, decide what counts, and "
                   "leave the block matching the canonical\ntext before uploading "
                   "it.\n\nWhat the kit has and this agent doesn't:\n" + sample + more)
    return additions, canon, path


def replace_block(soul, new_block, rescue=False, canonical=None, no_canonical=False):
    """(new_soul, notices). Raises Halt if it can't be done, with its code."""
    open_m, close_m = find_block(soul)
    old = soul[open_m.start(): close_m.end()]
    before, after = soul[: open_m.start()], soul[close_m.end():]

    # `v1` is the bare marker, from before the block had a version.
    old_version = open_m.group(1) or "v1"
    new_match = OPEN_TAG.search(new_block)
    if not new_match or not CLOSE_TAG.search(new_block):
        raise Halt(2, "the new block doesn't have the kit:base markers: "
                      "there's no way to even tell what version it is")
    new_version = new_match.group(1) or "v1"

    check_new_block(new_block, new_version)
    additions, canon, canon_path = check_old_block(
        old, old_version, canonical, no_canonical)

    notices = [f"block {old_version} → {new_version}"]
    if additions:
        # In the order they appear in the agent's block, not the diff's.
        written = [l for _, _, l in sorted(additions, key=lambda a: a[1])]
        rule_range = hard_rule_range(canon) if canon else None
        outside_hard_rule = rule_range is None or any(
            not (rule_range[0] < anchor <= rule_range[1]) for anchor, _, _ in additions)
        if outside_hard_rule or not rescue:
            common_msg = (f"inside the {old_version} block there's {len(written)} "
                     "line(s) a person wrote\nfor THIS client, and the replacement "
                     "would take them down with it:\n\n"
                     + "\n".join("  " + l for l in written))
            if outside_hard_rule:
                raise Halt(2, common_msg + "\n\nAnd they're not in the HARD RULE, "
                           "they're scattered across the block: moving them alone "
                           "to the\nsensitive-actions list would make them say "
                           "something nobody wrote. Move them\nyourself outside the "
                           "block (the identity, above the opening marker) and run "
                           "again.")
            raise Halt(2, common_msg + "\n\nMove them outside the block —the "
                       "replacement keeps EVERYTHING outside it, word for\nword— "
                       "and run again. Or let this script do it, which puts them in "
                       "the\n" + f'"{SECTION.lstrip("# ")}" section of the identity:\n\n'
                       "   … replace-block.py <soul> <block> --rescue")
        before = with_section(before, "\n".join(written))
        notices.append(f'{len(written)} line(s) rescued from the block → '
                      f'"{SECTION.lstrip("# ")}" section, outside')
        notices += ["   " + l for l in written]
    elif canon is None:
        # Ran with --no-canonical: nothing was checked and there's no other
        # way to put it. A reassuring notice about something that wasn't
        # looked at is exactly what lost the lab's four lines.
        notices.append(f"inside the {old_version} block: NOT checked "
                      "—you asked for --no-canonical—, so if there was "
                      "anything hand-written, it's gone")
    else:
        against = (f"the canonical {old_version}" if canon_path == canonical_path(old_version)
                  else f"{os.path.relpath(canon_path, KIT)}")
        notices.append(f"inside the block: matches {against}, "
                      "there was nothing hand-written")

    if "portal:identity" in after or "portal:identity" in before:
        notices.append("the portal:identity block stays intact")
    notices.append(f"outside the block: {len((before + after).strip())} characters, "
                  "kept as-is")

    # The new block is pasted with a blank line on each side and without
    # duplicating ones that were already there: a SOUL with three blank lines
    # in a row looks bad in the prompt and changes the diff every time it
    # gets reinstalled.
    return before.rstrip("\n") + ("\n\n" if before.strip() else "") \
        + new_block.strip("\n") + "\n\n" + after.lstrip("\n"), notices


def main():
    ap = argparse.ArgumentParser(
        description="Swaps a SOUL's kit:base block for a new one, "
                    "keeping everything else.",
        epilog="The new SOUL goes to stdout; notices, to stderr.",
    )
    ap.add_argument("soul", help="the agent's SOUL, with its kit:base block")
    ap.add_argument("block", help="the new block (tools/install-soul.sh --block)")
    ap.add_argument(
        "--rescue", action="store_true",
        help="move what a person wrote inside the block into the identity's "
             f'"{SECTION.lstrip("# ")}" section, outside the block, and only '
             "then replace")
    ap.add_argument(
        "--canonical", metavar="FILE",
        help="the OLD version's canonical block, if it isn't frozen in "
             "soul/versions/")
    ap.add_argument(
        "--no-canonical", action="store_true",
        help="proceed with no old canonical block: you're asserting you "
             "looked and there's nothing hand-written inside")
    args = ap.parse_args()

    with open(args.soul, encoding="utf-8") as fh:
        soul = fh.read()
    with open(args.block, encoding="utf-8") as fh:
        block = fh.read()
    try:
        new_soul, notices = replace_block(soul, block, rescue=args.rescue,
                                   canonical=args.canonical,
                                   no_canonical=args.no_canonical)
    except Halt as exc:
        print(str(exc), file=sys.stderr)
        return exc.code
    for n in notices:
        print("   " + n, file=sys.stderr)
    sys.stdout.write(new_soul)
    return 0


if __name__ == "__main__":
    sys.exit(main())
