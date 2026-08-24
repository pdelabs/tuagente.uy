# roles/ — one agent per trade, hired separately

A client doesn't buy "an assistant": they buy **a team** and hire one role at
a time. Each role is a Hermes *profile* with its own SOUL, its own skills,
its own memory and its own name; they all live in the same container, share
the board and the company's data.

We didn't invent this. The engine already ships `hermes profile`, the
`distribution.yaml` format, and a board **shared across profiles** that
routes by the role's description. We verified it before writing a line
(16/8/2026, see `notes/spike-profiles.md`): a client request split in two,
routed to `marketing` and to `support`, dispatched in parallel, each half
asking for its own approval separately.

## What's here

    roles/
      catalog.json            the roster: which role exists, what it does, what
                              it costs, AND the name and face it ships with
      build_role.py           builds a role's installable distribution
      <role>/
        role.json             skills, plugins, connections, keys, flows
        identity.md           the role's own SOUL block
        flows/                the curated flows that ship with the role

## The name and the face live in the roster only

`roles/catalog.json` carries each role's `identity` (name + `look` axes) and
`build_role.py` injects it into the distribution's `role.json`. It used to be in
BOTH, and both drifted: the 2026-08-22 redesign changed the catalog — Vera lost
her glasses and gained skin specks, Tino got his bow tie, everyone got the new
`hat` axis — and every already-hired role kept serving the old face, because the
adapter reads the installed profile's `role.json` ABOVE the catalog
(`_role_identity`, and that precedence is correct: a role nobody hired still
needs a face). An `identity` key in `roles/<id>/role.json` is a build failure now.

Refreshing it never overwrites the client: a rename or a redraw from the portal
lands in `policy/roles/identities.json`, which sits above both and is not
`distribution_owned`.

Skills **aren't copied here**. They live once — in `skills/`, or inside a
plugin's skills surface (`plugins/<id>/skills/<name>/`) — and a role claims
them two ways in `role.json`: `skills` names a kit skill, `plugins` names a
plugin and takes all of its skills. A plugin's skill is never named under
`skills`; the build and the split both stop on it. `build_role.py` resolves
both lists and flattens them into one `skills/` directory in the
distribution, which is the only layout the agent has until phase 3
(`../notes/plugin-system-plan.md`).

## One skill, one home

**A skill the split calls SHARED does not travel inside the profile.** It is
installed once, in `<agent>/kit-skills/`, mounted `:ro` at `/opt/kit/skills`
for the whole installation, and every role reads it from there. Only the
role-only ones are packed into the distribution's `skills/` — on a team agent
kit-skills/ holds the shared set and nothing else, so nothing else would
deliver `brand-kit` or `invoices-to-data`.

It used to be both, and that was harmless until each profile got
`skills.external_dirs` (`ae377d5`) and could finally see the kit's copy next to
its own. The engine does not pick a winner: it refuses the name.

    Ambiguous skill name 'deliverable/SKILL.md': 2 skills match across your
    local skills dir and external_dirs. Refusing to guess.

Thirteen of those in one day on the local agent, and the roles flail around
them — 42 tool calls on the worst turn, and the approval it had been asked for
never got filed.

Two consequences worth knowing about:

* **`assistant` and `support` ship an EMPTY `skills/`**, and the empty
  directory is load-bearing. `skills/` is `distribution_owned` and the engine
  wipes a distribution-owned directory before copying it, so shipping it empty
  is what removes the stale copies from an agent hired before this. Leaving
  the directory out would leave them there.
* **`role.json` still lists every skill the role works with**, shared included.
  The manifest describes the role; the directory describes the payload. A
  marketing `role.json` that stopped mentioning `deliverable` would say the
  role cannot leave a file, which is false — the file it reads is the kit's.

`tools/agent-check.py` («roles: one skill, one home») fails over an installed
agent that has both copies, naming the skill and both directories.

## The rule that can't be broken

**The SOUL's `kit:base` block is the same for every role, byte for byte.**
That's where the approval rule, the delivery conventions, and the language
live. If every role had its own editable copy, within three months one of
them would say something different — and that shows up as a role publishing
without asking.

That's why `identity.md` is **only** the role's own part: what it does, what
it never does, which other roles it overlaps with. `build_role.py` composes
`SOUL.md = kit:base + identity.md` and fails if an `identity.md` tries to
redefine anything in the base block.

## The rule against punting work

Every `identity.md` ends with the same warning, and it isn't decoration:
when roles are billed separately, a role has a structural reason to punt
work it could actually do. That's how you end up with a product that feels
crippled.

**Never punt what you can do yourself.** Name the gap only when you truly
can't do it, once, without belaboring it.
