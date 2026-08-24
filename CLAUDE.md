# tuagente.uy — monorepo, context for a new session

One repo with the three pieces of the product:

| Where | What it is |
|---|---|
| `app/page.tsx`, `app/blog/` | **the public landing** — marketing, SEO |
| `app/app/` | **the client portal** — the interface a client uses to see and direct their team of agents. Static; all the logic lives in the browser |
| `hermes-kit/` | **what gets installed on each client's agent** — portal adapter, skills, plugins, roles, SOULs, capabilities, compose and conformance checks. Has its own `CLAUDE.md` with the deep context: read it before touching the kit |
| `docs/` | the project's memory (portal + client onboarding) |
| `hermes-kit/notes/` | the kit's memory (measurements, engine knobs, pivot status) |

It used to be two repos (`tuagente.uy` and `hermes-kit`); since 22/8/2026 it's
this monorepo. The old `hermes-kit` repo is now archived. Vercel builds the
root (the Next app) and `.vercelignore` keeps the kit out of the deploy.

## Code rules — no exceptions

- **All code AND internal documentation are written in English**: comments,
  function/variable names, commit messages, docs under `docs/` and
  `hermes-kit/notes/`. Everything. The only thing that stays in Spanish is
  **copy the client reads** — rioplatense neutral, no marketing-speak. That
  means: every string rendered in the portal UI, landing copy and blog posts,
  SOUL prose and role identity prose, `SKILL.md` instruction prose the agent
  follows to work for the client, messages the agent sends the client over any
  channel, onboarding templates the client fills in, persona/avatar names, and
  visible copy in `docs/mockups/*.html`. Catalog VALUES that are labels or
  descriptions stay Spanish too (their KEYS are code, so those are English).
  There's old code with Spanish names; it isn't migrated in bulk, but nothing
  new comes in like that.
- **No protective programming** — let it break loudly. A guard gets added when
  it protects the client from a measured failure state, not "just in case."

## What the product is

tuagente.uy sells **teams of autonomous AI agents installed inside LATAM
companies**, on top of the Hermes runtime (Nous Research). The client hires
roles (marketing, support, sales, accounting, assistant); each role is a
Hermes profile in the same container, with its own SOUL, skills, name and
face. The portal is the same app for everyone: what modules it shows is
decided by the manifest each agent exposes.

**PRINCIPLE ZERO:** the portal and the kit serve ANY Hermes agent of ANY
client. Nothing client-specific goes into the code or into fixed copy.

## What the portal talks to

Two services on the client's agent, never a backend of ours:

- **`:8642` — the Hermes gateway** (native): chat, sessions, jobs. With a
  team, each role answers at `/p/<role>/` with its own key.
- **`:8643` — the adapter** (`hermes-kit/adapter/portal_adapter.py`): what the
  native gateway doesn't expose — tickets, approvals, artifacts, files,
  activity, real usage, capabilities, roles and hires, chat rooms.

Auth: bearer with the client's `API_SERVER_KEY`, delivered via the magic link
(`/app#endpoint=…&adapter=…&key=…`) and kept in localStorage.

**`app/app/lib/agent.ts` is the portal's ONLY network entry point.** If a
module needs something, it gets added there; no stray fetches.

## Portal conventions

- UI kit in `app/app/lib/ui.tsx`: **no shadows**, hairline borders
  `border-black/[0.07]`, `rounded-lg/xl` radii, tonal colors `c-violet`/
  `c-green`/`c-coral`/`c-amber`, `primary` #5B4BE8, Jakarta typography. Lucide
  icons, **zero emojis**.
- The agent's markdown renders through `app/app/lib/Markdown.tsx` (GFM, code
  with highlighting, KaTeX, mermaid, sanitized HTML, entity chips). **Used
  everywhere**, not just in chat.
- Each module lives in its own folder under `app/app/` and doesn't touch
  `lib/` or `layout.tsx`.
- Per-tab welcome screens in `app/app/lib/intros/`: one per module, each with
  its own illustration.
- **Everything that opens has a URL.** "What's open" is READ from the URL with
  `app/app/lib/routes.tsx` (`useRouteParam` / `openInRoute` / `closeInRoute`),
  not from a parallel `useState`. A new module adds its param to `PARAM` and
  documents it in `docs/portal-routes.md`. No link the portal builds carries a
  hash — that's where the credential travels.

## Kit conventions (details in `hermes-kit/CLAUDE.md`)

- **The kit is the source of truth** for what runs on each agent; a fix made
  inside an agent gets brought back to the kit (`install.sh --diff` detects
  it).
- **Closed catalogs** (roles, capabilities, connections): the agent picks ids,
  never drafts free-form requests. Nothing self-installs.
- **The model supplies the words; the code supplies the format.** Every
  convention that depended on the agent remembering has failed.
- Roles live in `hermes-kit/roles/` (identity + flows + role.json); the build
  validates that an identity doesn't override the base SOUL and that no
  identities are clones (`tools/check-clones.py`).

## Documentation (read in this order)

| File | What it's for |
|---|---|
| `docs/COMPACT.md` | status, verified endpoints, and **hard lessons**. Start here. |
| `hermes-kit/notes/team-pivot-status.md` | the state of the team pivot: what's done, what's left, closed decisions |
| `docs/PENDING.md` | what's still open and who unblocks it |
| `docs/portal-routes.md` | **the contract of the portal's URLs** |
| `docs/client-onboarding.md` | runbook for onboarding a new client (teams included) |
| `docs/portal-roadmap.md` | features per tab + big topics still to define |
| `hermes-kit/fleet.md` | which agents are alive and what version they're running |
| `hermes-kit/notes/` | engine knobs, measurements, recipes |

## Verify

```bash
# The portal
npx tsc --noEmit && npm run build
npx next start -p 8090          # against the local agent

# The kit (from the monorepo root)
python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"
python3 -m unittest discover -s hermes-kit/roles -p "test_*.py"
python3 hermes-kit/tools/check-adapter-boundaries.py
python3 hermes-kit/tools/check-clones.py
python3 hermes-kit/tools/check-plugins.py

# An agent, before powering it on
python3 hermes-kit/tools/agent-check.py <path>/data

# A running agent: the portal contract. 0 failures or it doesn't ship.
# THE TWO URLS ARE NOT OPTIONAL IN PRACTICE: the script defaults them to
# 8642/8643, and on a host that already runs an agent the ports move — without
# them the check greets the OTHER agent and passes green.
python3 hermes-kit/tools/portal-check.py --key <API_SERVER_KEY> \
    --endpoint http://127.0.0.1:<port> --adapter http://127.0.0.1:<port+1>
```
