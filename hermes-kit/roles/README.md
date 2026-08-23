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
      catalog.json            the roster: which role exists, what it does, what it costs
      build_role.py           builds a role's installable distribution
      <role>/
        role.json             identity (name and face), skills, connections
        identity.md           the role's own SOUL block
        flows/                the curated flows that ship with the role

Skills **aren't copied here**. They live once in `skills/`, and each role
declares which ones are its own in `role.json`. `build_role.py` pulls them
together when it builds the distribution.

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
