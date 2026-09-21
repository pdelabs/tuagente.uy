"""Which look a post wears, and which ones today's post may not.

A BRAND DECLARES ITS LOOKS IN ITS OWN FILE. `marca/brand.md` is the client's,
and every heading of the form «### The `name` block» followed by a fenced block
is one look: the text a slide's brief starts with, word for word. How many there
are and what they look like is the brand's business; this module never names one.

THE CODE READS THE LOOK OFF THE BRIEFS, the model does not declare it. A post's
`prompts` are the briefs its pictures were made from (`posts.py`), and a brief
starts with its look's block, so the look is whichever block the brief carries.
Nothing new for the model to remember, nothing it can get wrong, and the posts
saved before this module existed have a look too.

AND THE ROTATION IS CODE'S, because «no two alike in a row» written in prose is
what produced, on our own agent, a feed where every post was dark with thin
violet lines (2026-09-20): the brand file called that look the default and the
skill's checklist called it «the brand». A model left to choose picks the safe
one every day. So `today()` is a callable instruction of the creator — what the
last posts wore and which looks are therefore off — and `save_post` refuses a
look that is off, before it moves a single file.
"""

import re

from core import config

BRAND = "marca/brand.md"

# «### The `violet` block», then the first fenced block under it.
HEADING = re.compile(r"^###\s+The\s+`([a-z0-9-]+)`\s+block\s*$", re.MULTILINE)
FENCE = re.compile(r"```[^\n]*\n(.*?)```", re.DOTALL)

# How much of a block has to be in a brief for the brief to be that look's.
# Measured in the block's own SENTENCES found word for word in the brief, because
# a block can carry a slot the creator fills in («of PLACE», «OBJECT, made of»):
# the sentence with the slot never matches, and every other one does. The first
# version measured one unbroken run from the start of the block, and on our own
# agent the first `photo` post was saved with no look at all — its slot is in
# the second sentence (2026-09-20). Most of a block is enough; the blocks of one
# brand share sentences (the size, the rule about the text), so the look is the
# block with the MOST of itself in the brief, not the first one past the bar.
ENOUGH = 0.6
SENTENCE = re.compile(r"(?<=[.!?])\s+")


def squash(text: str) -> str:
    """Whitespace out of the way: a brief is the block re-wrapped by a model."""
    return " ".join(text.split())


def declared() -> dict[str, str]:
    """The brand's looks, in the order the file lists them: name → block."""
    path = config.WORKSPACE / BRAND
    if not path.is_file():
        return {}
    text = path.read_text()
    found = {}
    headings = list(HEADING.finditer(text))
    for heading, following in zip(headings, headings[1:] + [None]):
        section = text[heading.end():following.start() if following else len(text)]
        block = FENCE.search(section)
        if block:
            found[heading.group(1)] = squash(block.group(1))
    return found


def of_brief(brief: str, blocks: dict[str, str]) -> str | None:
    """The look whose block this brief carries, or `None`."""
    brief = squash(brief)
    best, share = None, 0.0
    for name, block in blocks.items():
        sentences = SENTENCE.split(block)
        found = sum(1 for sentence in sentences if sentence in brief) / len(sentences)
        if found > share:
            best, share = name, found
    return best if share >= ENOUGH else None


def of_post(post: dict, blocks: dict[str, str]) -> str | None:
    """What a saved post wears: what `save_post` wrote down, or, for a post
    from before it did, what its first brief says."""
    if post.get("look"):
        return post["look"]
    prompts = post.get("prompts") or []
    return of_brief(prompts[0], blocks) if prompts else None


def resting(recent: list[str | None], blocks: dict[str, str]) -> list[str]:
    """The looks today's post may not wear: those of the last few posts.

    HALF THE WARDROBE RESTS. With two looks that is the last post's, which is
    strict alternation; with six it is the last three. A post whose look nobody
    can name rests nothing.
    """
    window = len(blocks) // 2
    return [look for look in dict.fromkeys(recent[:window]) if look in blocks]


def state(posts: list[dict]) -> tuple[dict[str, str], list[str | None], list[str]]:
    """`(blocks, what the posts wore newest first, what rests today)`."""
    blocks = declared()
    recent = [of_post(post, blocks) for post in posts]
    return blocks, recent, resting(recent, blocks)


# Read by the creator, as the last thing before the date. Spanish: it is an
# instruction the agent works from.
TODAY = """\
## El look de hoy

La marca tiene estos looks: {all}.
Los últimos posteos usaron, del más nuevo al más viejo: {recent}.
**Hoy no podés usar: {resting}.** Elegí entre: {free}.

Elegí el que mejor le queda al tema de hoy entre los que están libres, y usá su
bloque palabra por palabra en todas las slides. `save_post` no guarda un posteo
con un look que descansa. La única excepción es que el pedido nombre un look con
todas las letras: ahí usás ese y se lo decís a `save_post`."""

FIRST = """\
## El look de hoy

La marca tiene estos looks: {all}. Todavía no hay posteos con look: elegí el que
mejor le queda al tema y usá su bloque palabra por palabra en todas las slides."""


# The same rotation for HOW THE STORY IS BUILT, which the creator declares to
# `save_post`. The last two rest: six structures, and a week that is three
# lists and two myths reads like a template however different it looks.
STRUCTURES_REST = 2

STORY = """\
## La estructura de hoy

Los últimos carruseles se armaron así, del más nuevo al más viejo: {recent}.
**Hoy no repitas: {resting}.** Elegí otra de la tabla del paso 3, la que le
quede a la idea."""


def story_today(posts: list[dict]) -> str:
    used = [post["structure"] for post in posts if post.get("structure")]
    if not used:
        return ""
    rest = list(dict.fromkeys(used[:STRUCTURES_REST]))
    return STORY.format(
        recent=", ".join(f"`{name}`" for name in used[:5]),
        resting=", ".join(f"`{name}`" for name in rest),
    )


def today(posts: list[dict]) -> str:
    return "\n\n".join(part for part in (look_today(posts), story_today(posts)) if part)


def look_today(posts: list[dict]) -> str:
    blocks, recent, rest = state(posts)
    if len(blocks) < 2:
        return ""
    names = ", ".join(f"`{name}`" for name in blocks)
    # Only looks the brand still declares: a post in a look that was retired
    # is history, and naming it here would read as an option.
    worn = [look for look in recent if look in blocks][: len(blocks)]
    if not worn:
        return FIRST.format(all=names)
    return TODAY.format(
        all=names,
        recent=", ".join(f"`{look}`" for look in worn),
        resting=", ".join(f"`{look}`" for look in rest) or "ninguno",
        free=", ".join(f"`{name}`" for name in blocks if name not in rest),
    )
