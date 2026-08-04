# kanban_tools

One compressed `kanban` tool that gives the agent native ticket operations on
the Kanban board.

## Why

Hermes ships the whole kanban stack — CLI, dashboard, dispatcher, workers — and
a built-in `kanban` toolset. That toolset is gated: its twelve tools only enter
the schema inside a dispatcher-spawned worker (`HERMES_KANBAN_TASK`) or for a
profile that lists `kanban` under `toolsets:` in config.yaml. In an ordinary
agent session the board is therefore invisible.

An agent asked to touch a ticket in that state has nothing to call, so it
improvises: `execute_code` against `hermes_cli.kanban_db`, a dozen turns of
trial and error, the occasional `SyntaxError`, and sometimes it gives up and
answers "sure, let's close it" without closing anything. This plugin is the
missing surface.

It is also the *ticket* surface, not the *worker* surface: the built-in tools
are about one worker finishing one card, this one is about an assistant
managing a board.

## The tool

`kanban(action=…)` — one tool, one enum, nine actions.

| Action     | Arguments                                                | Does |
|------------|----------------------------------------------------------|------|
| `show`     | `task_id`, `limit` (comments, default 5)                  | ticket + recent comments + recent events |
| `list`     | `status`, `tenant`, `assignee`, `limit` (default 20)      | matching tickets, minimal fields |
| `runs`     | `task_id`                                                 | worker attempt history |
| `create`   | `title`, `body`, `tenant`, `priority`, `idempotency_key`  | new ticket in `ready`, unassigned |
| `comment`  | `task_id`, `body`                                         | appends a signed comment |
| `complete` | `task_id`, `result`                                       | → `done`, records the outcome |
| `block`    | `task_id`, `reason` (required), `kind`                    | → `blocked` with a typed event |
| `unblock`  | `task_id`                                                 | → `ready` (or `todo` if parents are open) |
| `archive`  | `task_id`                                                 | → `archived` |

Deliberately **out of scope**: `dispatch`/`daemon`/`watch`/`gc`/`repair`/`init`,
deleting tickets, creating or deleting boards, attachments,
`notify-subscribe`, and every worker-orchestration verb
(`assign`, `claim`, `swarm`, `decompose`). Those are operator and dispatcher
concerns; they stay on the CLI, where a human is holding the keyboard.

## Install

Drop the directory into one of the loader's plugin sources — user plugins are
the usual one:

```
$HERMES_HOME/plugins/kanban_tools/     # e.g. ~/.hermes/plugins/kanban_tools/
```

Then enable it in `config.yaml`:

```yaml
plugins:
  enabled:
    - kanban_tools
```

Restart the gateway. Check it landed:

```
hermes tools list        # → Plugin toolsets: ✓ enabled  kanban  🔌 Kanban
```

The tool registers under `toolset: kanban`, alongside the built-in worker
tools. Those keep their own gate, so a normal session gains exactly one schema,
not thirteen.

### Authorship

Every write is signed. The default is `agent:<active profile>`, which is
unambiguous next to whatever names humans and other integrations write under.
Override it when the agent has a display name of its own:

```yaml
plugins:
  entries:
    kanban_tools:
      author: Ada
```

## Two design decisions worth knowing about

### One tool, not nine

`tools/cronjob_tools.py` states the rule out loud: *"Expose a single compressed
action-oriented tool to avoid schema/context bloat."* Nine separate schemas
would ride along in every prompt for the rest of the session. So the verb is an
enum, the descriptions are short, and the replies are truncated — `show` cuts
the body and returns the last few comments and events, `list` returns a handful
of fields per row. A tool result is context too.

### `create` cannot open a blocked ticket

`kanban_db.create_task` accepts `initial_status="blocked"`. This plugin does not
expose it, and that is a correctness decision, not a simplification.

A `blocked` ticket returns to `ready` on its own unless its most recent
block/unblock event is a `blocked` one — that is exactly what
`recompute_ready`/`_has_sticky_block` check. Creating straight into `blocked`
parks the row in that status with **no event behind it**, so the next
dispatcher tick promotes it back. A ticket whose whole purpose was to ask a
human for approval then reads as approved, and the work continues as if it had
been authorised.

Measured on a live board, 60 seconds apart:

```
# created with initial_status="blocked"          → status: ready   (promoted)
# created normally, then action='block'          → status: blocked (held)
```

So `block` always sends a typed `kind` (default `needs_input`), which is what
makes `block_task` write the event, and the reply carries `sticky_block` so the
caller can tell. To open a ticket that is already waiting on someone: create it,
then block it.

`kind="dependency"` is the one exception, and it is honest about it: that kind
routes to `todo` rather than `blocked` by design, so the ticket re-queues itself
once its parents finish. The reply says so and reports `sticky_block: false`.

## Writes go through the module, never through SQL

Every mutation calls `hermes_cli.kanban_db` (`create_task`, `add_comment`,
`complete_task`, `block_task`, `unblock_task`, `archive_task`). Those functions
own the claim locks, the run bookkeeping, the event log and the dependency
re-gating. A hand-written `UPDATE` corrupts all four silently. The only raw SQL
here is one read-only `SELECT` behind `create`'s idempotency probe, so the reply
can say whether it actually created anything.

## Errors

Failures come back as plain tool errors that say what to do next — never a
stack trace:

```
unknown status 'pending'. Valid: archived, blocked, done, ready, review, running, scheduled, todo, triage
no ticket 't_deadbeef' on board 'default'. Use action='list' to find the right id — ids look like t_1a2b3c4d5e6f.
ticket t_49226854 is blocked — run action='unblock' first, then complete it.
reason is required to block — whoever picks this ticket up needs to know what it is waiting for.
```

## Gating

`check_kanban_requirements()` hides the tool in two contexts:

* **dispatcher-spawned workers** (`HERMES_KANBAN_TASK` set) — they already have
  the built-in lifecycle tools for the one card they own, and board-wide
  create/archive would let a scoped run edit everyone else's tickets;
* **`delegate_task` children**, which run in the parent's process and can
  inherit its env.

Everywhere else — interactive CLI, gateway sessions, cron runs — the board is
part of the agent's normal job.
