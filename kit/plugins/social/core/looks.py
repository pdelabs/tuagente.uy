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

# «### The `ink` block», then the first fenced block under it.
HEADING = re.compile(r"^###\s+The\s+`([a-z0-9-]+)`\s+block\s*$", re.MULTILINE)
FENCE = re.compile(r"```[^\n]*\n(.*?)```", re.DOTALL)

# How much of a block has to be in a brief for the brief to be that look's.
# The blocks of one brand share their first and last sentences — the size, the
# rule about the text — so the beginning alone tells nothing apart; two hundred
# characters in is where a background, a material or a photograph is named.
PROBE = 200


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
    """The look whose block this brief carries, or `None`.

    THE LONGEST SHARED RUN WINS. A brief is compared with every block, by how
    far into the block it still agrees, and the look is the one that agrees the
    furthest — past `PROBE`, so two blocks that open with the same sentence are
    not confused for each other.
    """
    brief = squash(brief)
    best, reach = None, 0
    for name, block in blocks.items():
        start = brief.find(block[:40])
        if start < 0:
            continue
        shared = 0
        for a, b in zip(block, brief[start:]):
            if a != b:
                break
            shared += 1
        if shared > reach:
            best, reach = name, shared
    return best if reach >= PROBE else None


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


def today(posts: list[dict]) -> str:
    blocks, recent, rest = state(posts)
    if len(blocks) < 2:
        return ""
    names = ", ".join(f"`{name}`" for name in blocks)
    worn = [look for look in recent if look][: len(blocks)]
    if not worn:
        return FIRST.format(all=names)
    return TODAY.format(
        all=names,
        recent=", ".join(f"`{look}`" for look in worn),
        resting=", ".join(f"`{look}`" for look in rest) or "ninguno",
        free=", ".join(f"`{name}`" for name in blocks if name not in rest),
    )
