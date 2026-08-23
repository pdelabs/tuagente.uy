# The profiles spike — 8/16/2026

Before writing a single line of the team pivot, the question was whether the
engine truly supports several roles or whether we'd have to build the
orchestration ourselves. **It supports it.** This is what was measured, in a
local lab, from scratch.

## The four questions

| | Question | Result |
|---|---|---|
| 1 | Does the decomposer route by description? | **Yes**, and well |
| 2 | Is `kanban.db` shared across profiles? | **Yes** — a single one in `/opt/data/` |
| 3 | Does the result come back to one place? | **Yes** — the adapter returns everything together |
| 4 | Does one gateway serve all profiles? | **Yes**, with `gateway.multiplex_profiles: true` |

## The routing

Two profiles (`marketing`, `support`), each with a one-sentence description.
A ticket written the way a client would write it, **without naming roles**:

> "We changed our hours: now we open Saturdays from 9 to 1. I want to
> announce it on Instagram this week, and also reply to people who already
> asked on WhatsApp whether we open Saturdays. There's about ten unanswered
> messages."

`hermes kanban decompose` split it into two children and routed them:

    t_777a4819  marketing  Post the new Saturday hours on Instagram
    t_62111e08  support    Reply to pending questions about opening hours

Both were dispatched **in parallel** and both ended up `blocked`, which on our
board means "waiting on your OK": marketing asked for approval of the exact
copy before publishing, support asked for approval before messaging external
contacts. **SOUL v12 works the same way inside a profile.**

Support also honestly reported that it didn't find WhatsApp configured and
emitted `connection:whatsapp` — picking an id from the closed catalog instead
of making up free text.

## What's useful for the portal

Comments already come signed with the profile's name:

    [02:14] commented {'author': 'support',   'len': 681}
    [02:16] commented {'author': 'marketing', 'len': 1168}

The attribution we want to render — the chip on the board, the signature in
chat — doesn't need to be invented. The data travels; the adapter just needs
to expose it.

## What needs fixing

**The adapter doesn't expose `assignee`.** It returns all three tasks with
`assignee: null`. Without that, there's no role chip.

**Adding a role requires restarting the gateway.** `profiles_to_serve` only
runs at startup: I created the profiles and the gateway kept serving
`['default']` until I restarted it. Hiring a role isn't instant — we need to
decide whether a short restart is acceptable or whether we look for a reload.

**The `scratch` workspace gets deleted when the task ends.** The engine warns
about this in a ticket event. For roles we need to use `--workspace dir:`
pointing at the shared workspace, or the work evaporates — the same class of
bug as the images that got stuck in the cache.

## Packaging (phase 1)

`hermes profile install <dir>` on top of what `roles/build_role.py` builds:

    ✓ Installed 'marketing' v0.1.0
      Env vars: OPENROUTER_API_KEY (required, ✓ set)

It validated the key on its own. Then the test that carries the whole
packaging story — I seeded client data, hand-edited the SOUL, bumped to
v0.2.0, and ran `update`:

| | |
|---|---|
| `workspace/brand/brand.json` | **survived** |
| `memories/MEMORY.md` | **survived** |
| local `SOUL.md` edit | **overwritten** |

It's exactly `install.sh` + the sha256 checks + the allowlist + the drift
check, but native.

An installed role **doesn't need `config.yaml`**: it inherits the model from
the install. In `hermes profile list` it shows up as `Model: —`, which is just
how it's displayed, not a blocker. It ran in 11 seconds and answered in its
own trade.

## Cost

Cents, on an OpenRouter key minted for the spike with a US$ 5 cap
(`lab-equipo-spike`). Revoke it once the lab is no longer needed.
