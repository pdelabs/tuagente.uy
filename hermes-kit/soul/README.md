# How an agent's SOUL is composed

The SOUL is the system prompt: what the agent **is** and the rules it can't
break. It's built by pasting these blocks in order and replacing whatever is
in angle brackets.

```
00-identity.md       ← the client's own, written each time, and goes OUTSIDE the block.
                       Inside it goes the section `## Lo que en esta empresa
                       no se hace sin permiso` (the literal heading the tools
                       match on): the business's own sensitive actions
<!-- kit:base v13 -->
01-approvals.md      ← the hard rule, generic; points back to that section above
02-delivery.md       ← generic, ships as-is
03-channels.md       ← generic, ships as-is
04-language.md       ← generic, ships as-is
05-precedence.md     ← generic, closes the block: the tie-breaking rule
<!-- /kit:base -->
```

**Nothing client-specific goes inside the block.** The block gets replaced
whole when the kit's version bumps; what's outside it is kept word for word.
That's why a company's sensitive actions live in the identity, not in
`01-approvals.md`, and the HARD RULE brings them in by reference ("and
whatever the … section of your identity says"). It cost four lost lines to
learn that: the story is below, in "The canonical block for each version."

Only `new-agent.sh` (for a new agent) and `tools/install-soul.sh` (for one
that already exists and doesn't have it) do this on their own. By hand it
gets pasted the same way, in that order and with the markers.

## The markers and the version

The generic blocks are wrapped between `<!-- kit:base v3 -->` and
`<!-- /kit:base -->`. The two markers do three things:

- **They say which rules an agent has installed** without reading it the
  whole prompt: the version is in the opening marker, and which version each
  agent has is in `fleet.md`.
- **They give `05-precedence.md` something to point to**: the tie-breaking
  rule needs to be able to point at where what governs starts and ends.
- **They make installation idempotent**: `install-soul.sh` doesn't touch an
  agent that already has a block, whatever version it is, and it says which
  one it has.

**Updating the block on an agent that already has one:**

```bash
tools/install-soul.sh --replace <host> [slug]
tools/install-soul.sh --replace --rescue <host> [slug]
```

Pulls out the old block between the markers and drops in the new one
**keeping everything outside it**: the identity and the `portal:identity`
block the naming step wrote. Before uploading anything it leaves a copy of
the old SOUL on your machine.

And it **refuses** if there's text inside the old block that isn't in that
version's canonical block: someone wrote that for that client, and the
replacement would wipe it out. It prints it line by line; with `--rescue` it
moves it outside the block — into the identity's `## Lo que en esta empresa
no se hace sin permiso` section (`SECTION` in `replace-block.py`) — and only
then replaces it. If, on top of that, kit lines are missing or changed, it
stops without offering anything: someone edited the rules, and that's for a
person to look at.

The version lives in `soul/VERSION`: one line, shaped `vN`. `new-agent.sh`,
`tools/install-soul.sh` and `tools/agent-check.py` all read it from there,
and if the file is missing or says something else, the first two refuse to
stamp the marker.

It gets bumped when a new rule shows up or an existing one changes meaning:
in other words, when already-installed agents fall behind and need the
block reinstalled. `v1` is the marker without a version, from before this
existed, and `agent-check.py` reports it as such.

## The canonical block for each version

`soul/versions/vN.md` is the block **exactly as it shipped** for that
version, frozen. It isn't documentation: it's the only way to look at an
agent's block and know what in there the kit wrote and what a person wrote.
Without it, `replace-block.py` can't tell one from the other — and on
12/8/2026, when the comparison looked only at `<!-- por-cliente: … -->`
comments, a v4→v5 replacement wiped out a company's four sensitive actions
with exit 0 and three reassuring notices.

**When the version bumps, it has to be frozen**, and the three scripts that
compose the block refuse to run if you haven't:

```bash
echo v7 > soul/VERSION
./tools/install-soul.sh --block > soul/versions/v7.md
```

`v2`, `v3` and `v4` were reconstructed from the kit's git history (the
composition didn't change between those versions); the reconstructed `v4`
came out byte for byte identical to the block on the production agent,
which is what says the reconstruction is the right one. There's no possible
canonical for `v1`: several blocks coexisted under that bare marker. For
those cases, `replace-block.py` asks for `--canonical <file>` or
`--no-canonical`, which is a claim YOU make, not the script, and the warning
says so.

## SOUL comments have five forbidden words

The engine scans the SOUL before putting it into the prompt, and one of its
patterns matches **any HTML comment containing `ignore`, `override`,
`system`, `secret` or `hidden`**, upper or lower case. When it matches, it
doesn't erase the comment: it **discards the whole SOUL** and drops a
`[BLOCKED: SOUL.md contained potential prompt injection]` in its place. The
agent starts up with no identity and no rules, answers as if nothing
happened, and the only trace is a line in the engine's log.

Which means a well-meaning comment in a client's identity — "ignore los
mails de facturación," "override de precios para mayoristas," "los datos
hidden del panel" — silently turns off every rule the agent has. Write them
in Spanish and without those words. `agent-check.py` checks for this — it
looks at every comment in the SOUL, not just ours.

General rule, then: **a SOUL comment is a short note, in Spanish, for
whoever composes it.** Anything that needs a long explanation goes in the
agent's repo, not inside the prompt.

## What things are called

Five names for the same thing force the agent to guess what you're talking
about. These are the ones the generic blocks use, and the client's SOUL
should stick to the same ones:

| Say | Meaning | Instead of |
|---|---|---|
| **tu cliente** | la persona que dirige al agente y aprueba lo sensible — es lo que queda cuando se reemplaza `<RESPONSABLE>` | "el usuario", "la persona", "el responsable" |
| **gente de afuera** | clientes, proveedores y desconocidos de la empresa: tono de la empresa y nada de información interna | "los clientes", que se confunde con tu cliente |
| **flujo** | lo que corre solo, cada tanto o ante un disparador | "cron", "tarea programada", "automatización" |
| **entregable** | un archivo que tu cliente va a releer, guardar o reenviar | "documento", "reporte", "output" |
| **artefacto** | solo los `art_...` del portal: lo que se mira, no lo que se lee | usarlo para cualquier archivo |

## Three rules for writing it

**The SOUL isn't the skills catalog.** Hermes' own index handles that,
reading the `description` in each `SKILL.md`'s frontmatter. What goes here
are the business rules: what needs approval, what's out of scope, how to
talk.

**If a convention matters, have a script enforce it.** Everything that
depended on the model remembering has failed. Everything that ended up in
code has held. The model supplies the words; the code supplies the format.

**Keep it short, but know where the cost is.** Every line competes for
attention with the rest, so anything that doesn't change a decision is
excess. That said, measured with `hermes prompt-size` on a freshly created
agent (2026-08-05):

```
system prompt   39.6 KB   ← of that, ~11 KB are these blocks
tool schemas    67.6 KB   ← almost DOUBLE, and it's paid on every call
```

In other words: **the big lever is the tools, not the prose.** Dropping
`tts` and `delegation` alone saved 7.6 KB — more than everything you gain by
rewriting paragraphs. Before trimming the SOUL, check `agent.disabled_toolsets`
in `config.yaml`.

Rule of thumb: the generic block has grown and needs watching — 11 KB before
the generic hard rule, 14.4 KB in v2, 19.2 KB in v7, **23.4 KB in v10**, and
you can measure it exactly with `wc -c soul/versions/*.md` — and every rule
it has is there because something failed without it. What's worth actually
watching is **the client's part** (`00-identity`, including its sensitive
actions): aim for ~4 KB.

`agent-check.py` measures both parts separately and only warns about the
client's, with a 10 KB threshold:

```
[OK  ] SOUL composed — 31.0 KB — client 7.5 KB + block v10 23.4 KB
```

Measured across real agents, a well-written identity weighs between 4.6 and
7.5 KB, so the 10 KB isn't crossed by writing with detail: it's crossed by
pasting a manual inside the prompt. (Until 13/8/2026 the check looked at the
whole SOUL against an 18 KB threshold, i.e. 5 KB below the floor the kit's
own block imposes: the warning fired every time — even with zero client
lines — and blamed the client for the kit's own size.)

## What the agent must NOT know

Don't put any of this in, and if the runtime puts it in on its own, don't
reinforce it:

- What it runs on (the runtime's name, its docs, how to configure it). The
  agent is **\<CLIENTE\>'s agent, provided by tuagente.uy**, full stop.
- Its infrastructure: absolute system paths, container names, commands to
  start or restart itself.
- How to install skills on itself or change its own configuration. It's not
  just noise: an agent that knows it can extend itself is one that can be
  talked into extending itself.
- Anything about our business: prices, margins, that this kit exists, or
  that there are other clients.
