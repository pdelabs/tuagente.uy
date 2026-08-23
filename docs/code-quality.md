# Code Quality Boundaries

These rules protect architectural decisions that previously regressed in
production. They are intentionally narrow: a rule is added only when it
prevents a demonstrated failure mode.

## Language

Code and internal documentation are English: identifiers, comments, commit
messages, `docs/**`, `hermes-kit/notes/**`, `CLAUDE.md`, READMEs. The one
exception is copy the client actually reads or receives — portal UI strings,
messages the agent sends the client, SOUL and skill instruction prose,
catalog `label`/`purpose` values — which stays in plain Rioplatense Spanish,
no marketing tone.

## Portal network boundary

All browser requests to a customer agent belong in `app/app/lib/agent.ts`.
Run:

```bash
npm run check:boundaries
```

The check rejects customer-agent `fetch()` calls elsewhere in `app/app/`.
Public-site requests such as `app/api/agent/route.ts` are outside this rule.

## Adapter boundaries

The adapter is being split by domain without changing its public HTTP contract.
`adapter/workspace.py` owns workspace and artifact confinement.
`adapter/kanban.py` owns read-only board, ticket, approval, and detail models.
`adapter/flows.py` owns flow metadata, derived connection state, execution state,
and workspace result visibility.
Run:

```bash
python3 tools/check-adapter-boundaries.py
python3 -m unittest adapter/test_workspace.py
python3 -m unittest adapter/test_kanban.py
python3 -m unittest adapter/test_flows.py
```

The boundary check rejects direct SQL mutation statements in
`adapter/portal_adapter.py`. Kanban writes must continue through the Hermes CLI.

## Verification

Run the portal checks before a change is considered complete:

```bash
npm run check:boundaries
npx tsc --noEmit
npm run build
```

Run the adapter checks alongside the existing agent and portal conformity
checks. Runtime-owned behavior still requires verification against a disposable
Hermes agent; unit tests cannot model hook, CORS, SSE, or job semantics.
