"""The client's posts speak `vos`, and a word of `tú` is caught by code.

WHY CODE. The blind QA of 2026-09-23 got a cover that said «¿Cuál va contigo?»
from a creator whose skill says «Hablale de `vos`» and whose SOUL says
«rioplatense, de vos». Image models and the text they are asked to draw lean
to neutral Spanish, and prose that asks for `vos` is the kind of convention
that has failed every time it depended on the agent remembering. The text a
post shows is known before a single file moves — the caption, and the words a
brief quotes for the picture — so `save_post`, `update_caption` and
`replace_slide` read it and refuse it with the word and its `vos` form.

THE LIST IS SHORT ON PURPOSE. Only forms that are `tú` or `vosotros` and
nothing else: «contigo», «tienes», «puedes» cannot be a third person or a
noun. The `tú` imperatives without a pronoun («descubre», «elige», «prueba»)
are left out because they are also «ella descubre», «el cliente elige», «una
prueba» — a refusal on a correct sentence teaches the creator to ignore the
check. «estás» is out too: it is `vos` as much as `tú`. Matching is by whole
word, accents included, so «tenés» and «sabés» never match «tienes» and
«sabes».

WHERE THE SLIDE'S WORDS ARE. A brief lists the text the picture may carry
between « » (`skills/post/SKILL.md`, step 5), and only what is quoted is
checked: a brief also DESCRIBES the picture, and a description is not copy the
client's followers read. Curly and straight double quotes count too, because
that is how a model quotes when it forgets the guillemets.

THE MODULE IS NAMED `voseo`, a name no other plugin uses: surface modules
share one `sys.modules` namespace (`posts.py`'s docstring).
"""

import re

# `tú`/`vosotros` form -> what the client says. Lowercase; matched without case.
TUTEO = {
    "contigo": "con vos",
    "ti": "vos",
    "tú": "vos",
    "eres": "sos",
    "tienes": "tenés",
    "puedes": "podés",
    "quieres": "querés",
    "sabes": "sabés",
    "vienes": "venís",
    "necesitas": "necesitás",
    "prefieres": "preferís",
    "buscas": "buscás",
    "conoces": "conocés",
    "sientes": "sentís",
    "piensas": "pensás",
    "encuentras": "encontrás",
    "imaginas": "imaginás",
    "escríbenos": "escribinos",
    "cuéntanos": "contanos",
    "síguenos": "seguinos",
    "visítanos": "visitanos",
    "llámanos": "llamanos",
    "guárdalo": "guardalo",
    "compártelo": "compartilo",
    "pruébalo": "probalo",
    "pídelo": "pedilo",
    "descúbrelo": "descubrilo",
    "vosotros": "ustedes",
    "vosotras": "ustedes",
    "tenéis": "tienen",
    "podéis": "pueden",
    "queréis": "quieren",
    "sabéis": "saben",
}

# `\b` is Unicode-aware on `str`, so «tú» ends before «,» and «tienes» does
# not match inside «mantienes»… which is also `tú`, and also left alone: the
# list is words, not stems.
WORD = re.compile(r"\b(" + "|".join(sorted(TUTEO, key=len, reverse=True)) + r")\b",
                  re.IGNORECASE)

# The words a brief asks the picture to carry.
QUOTED = re.compile(r"«([^»]*)»|“([^”]*)”|\"([^\"]*)\"")


def quoted(brief: str) -> list[str]:
    """What a brief quotes, in order: the text the slide shows."""
    return ["".join(groups) for groups in QUOTED.findall(brief)]


def found(text: str) -> list[str]:
    """The `tú` words in `text`, each once, as they were written."""
    return list(dict.fromkeys(match.group(1) for match in WORD.finditer(text)))


def fixes(words: list[str]) -> str:
    """«contigo → con vos, tienes → tenés»: the refusal carries the answer."""
    return ", ".join(f"«{word}» → «{TUTEO[word.lower()]}»" for word in words)


def slide_words(brief: str) -> list[str]:
    """The `tú` words among what a brief quotes."""
    return found(" \n ".join(quoted(brief)))
