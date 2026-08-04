"""Agent-facing ticket tools for the Kanban board.

Exposes a single compressed action-oriented tool (``kanban``) instead of one
tool per verb — the same trade-off ``tools/cronjob_tools.py`` documents: nine
separate schemas would cost real context on every single prompt, forever, so
the verb travels as an ``action`` enum instead.

Design rules this file will not bend
------------------------------------

**No write SQL.** Every mutation goes through ``hermes_cli.kanban_db``
(``create_task``, ``add_comment``, ``complete_task``, ``block_task``,
``unblock_task``, ``archive_task``). Those functions own the claim locks, the
run bookkeeping, the event log and the dependency re-gating; a hand-written
UPDATE silently corrupts all four. Reads use the module's own accessors, plus
one read-only SELECT for the idempotency probe.

**Sticky blocks stay sticky.** A ``blocked`` task returns to ``ready`` on its
own unless its most recent block/unblock event is a ``blocked`` one — that is
what ``kanban_db.recompute_ready`` checks. So:

* ``block`` always passes a typed ``kind`` (default ``needs_input``), which is
  what makes ``block_task`` write the ``blocked`` event.
* ``create`` never exposes ``initial_status``. Creating straight into
  ``blocked`` parks the row in that status with **no** event behind it, and the
  next dispatcher tick quietly promotes it back to ``ready``. A ticket that
  exists to ask a human for approval would then look approved. To open a ticket
  that is already waiting on somebody: create it, then block it.

**Compact replies.** A tool result is context too. ``show`` truncates the body
and returns only the last few comments and events; ``list`` returns a handful of
fields per row. Nothing here dumps a whole table.

**Signed writes.** Everything the agent writes is attributed to the agent
identity (``agent:<profile>`` by default, overridable via
``plugins.entries.kanban_tools.author``), so it reads back as distinct from
whatever names the humans and the other integrations write under.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response budget
# ---------------------------------------------------------------------------

_BODY_CHARS = 1200          # ticket body in `show`
_COMMENT_CHARS = 400        # each comment in `show`
_TITLE_CHARS = 120          # each title in `list`
_SUMMARY_CHARS = 300        # each run summary in `runs`
_REASON_CHARS = 200         # block reason echoed in events
_ERROR_CHARS = 300          # unexpected exception text

_SHOW_COMMENTS = 5
_SHOW_EVENTS = 8
_LIST_LIMIT = 20
_LIST_MAX = 100
_RUNS_LIMIT = 10

_MAX_AUTHOR = 80

# Events that say something a human would care about. `show` keeps the last
# few of these and drops the heartbeat-grade noise.
_EVENT_NOTE_KEYS = ("reason", "kind", "status", "author", "outcome", "error")


class _Refuse(Exception):
    """A refusal the agent can act on — surfaced as a plain tool error."""


# ---------------------------------------------------------------------------
# Runtime gate
# ---------------------------------------------------------------------------

def check_kanban_requirements() -> bool:
    """Return True when the board tool belongs in this session's schema.

    Hidden in two contexts, both deliberate:

    * **Dispatcher-spawned workers** (``HERMES_KANBAN_TASK`` set) already get
      the built-in per-task lifecycle tools for the one card they own. Handing
      a worker board-wide create/archive turns a scoped run into an
      unsupervised editor of everyone else's tickets.
    * **``delegate_task`` children**, which run in the parent's process and can
      inherit its env — the same reasoning the built-in kanban tools apply.

    Everywhere else (interactive CLI, gateway sessions, cron runs) the board is
    part of the agent's normal job, so the tool is available. The board itself
    is created on demand by ``kanban_db.connect``, so there is nothing to
    install and nothing to probe for.
    """
    if os.environ.get("HERMES_KANBAN_TASK"):
        return False
    try:
        from agent.delegation_context import is_delegated_child_context

        if is_delegated_child_context():
            return False
    except Exception:
        pass
    return True


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _kb():
    """Import the kanban module lazily so plugin load never depends on it."""
    from hermes_cli import kanban_db

    return kanban_db


def _err(message: str, **extra) -> str:
    try:
        from tools.registry import tool_error

        return tool_error(message, **extra)
    except Exception:  # pragma: no cover — registry always present in-process
        return json.dumps({"error": message, **extra}, ensure_ascii=False)


def _prune(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop null-valued keys. A ``"note": null`` line is pure context tax."""
    return {k: v for k, v in mapping.items() if v is not None}


def _ok(**fields) -> str:
    return json.dumps({"ok": True, **_prune(fields)}, ensure_ascii=False)


def _brief(exc: BaseException) -> str:
    """One readable line for an unexpected error — never a stack trace."""
    text = str(exc).strip().splitlines()
    head = text[0] if text else exc.__class__.__name__
    return _cut(f"{exc.__class__.__name__}: {head}", _ERROR_CHARS)


def _cut(text: Optional[str], limit: int) -> Optional[str]:
    if text is None:
        return None
    text = str(text)
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f"… (+{len(text) - limit} chars)"


def _ts(value: Optional[int]) -> Optional[str]:
    if not value:
        return None
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(value)))
    except Exception:
        return None


def _text(args: Dict[str, Any], key: str) -> Optional[str]:
    value = args.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int(args: Dict[str, Any], key: str) -> Optional[int]:
    value = args.get(key)
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise _Refuse(f"{key} must be a whole number, got {value!r}")


def _profile_name() -> str:
    for env in ("HERMES_PROFILE_NAME", "HERMES_PROFILE"):
        value = (os.environ.get(env) or "").strip()
        if value:
            return value
    try:
        from hermes_cli.profiles import get_active_profile_name

        return get_active_profile_name() or "default"
    except Exception:
        return "default"


def _author() -> str:
    """Identity every write from this tool is signed with.

    Defaults to ``agent:<profile>`` so the board reads back unambiguously:
    whatever a human or another integration writes under, it is not this. An
    operator who wants the agent's display name instead sets
    ``plugins.entries.kanban_tools.author`` in config.yaml.
    """
    configured = ""
    try:
        from hermes_cli.config import cfg_get

        configured = str(cfg_get("plugins.entries.kanban_tools.author", "") or "").strip()
    except Exception:
        configured = ""
    if configured:
        return configured[:_MAX_AUTHOR]
    return f"agent:{_profile_name()}"[:_MAX_AUTHOR]


def _board(kb) -> str:
    try:
        return kb.get_current_board()
    except Exception:
        return "default"


def _require_task(kb, conn, args: Dict[str, Any]):
    task_id = _text(args, "task_id")
    if not task_id:
        raise _Refuse("task_id is required for this action.")
    task = kb.get_task(conn, task_id)
    if task is None:
        raise _Refuse(
            f"no ticket {task_id!r} on board {_board(kb)!r}. "
            "Use action='list' to find the right id — ids look like t_1a2b3c4d5e6f."
        )
    return task


def _statuses(kb) -> str:
    return ", ".join(sorted(kb.VALID_STATUSES))


def _block_kinds(kb) -> str:
    return ", ".join(sorted(kb.VALID_BLOCK_KINDS))


def _sticky(kb, conn, task_id: str) -> bool:
    """True when the ticket's latest block/unblock event is a ``blocked`` one.

    Mirrors the predicate ``recompute_ready`` uses, over the public event
    accessor: if this is False for a ``blocked`` ticket, the dispatcher will
    promote it back to ``ready`` on its own.
    """
    latest = None
    for event in kb.list_events(conn, task_id):
        if event.kind in ("blocked", "unblocked"):
            latest = event.kind
    return latest == "blocked"


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------

def _row(task) -> Dict[str, Any]:
    """Minimal per-ticket shape for `list`."""
    return {
        "id": task.id,
        "title": _cut(task.title, _TITLE_CHARS),
        "status": task.status,
        "priority": task.priority,
        "tenant": task.tenant,
        "assignee": task.assignee,
        "created": _ts(task.created_at),
    }


def _detail(kb, conn, task) -> Dict[str, Any]:
    """Fuller shape for `show` — still truncated, still no dumps."""
    out = _row(task)
    out["title"] = task.title
    out["created_by"] = task.created_by
    body = task.body or ""
    out["body"] = _cut(body, _BODY_CHARS)
    if len(body) > _BODY_CHARS:
        out["body_truncated"] = True
    if task.completed_at:
        out["completed"] = _ts(task.completed_at)
    if task.result:
        out["result"] = _cut(task.result, _SUMMARY_CHARS)
    if task.status == "blocked":
        out["block_kind"] = task.block_kind
        out["sticky_block"] = _sticky(kb, conn, task.id)
    return out


def _event_note(event) -> Optional[str]:
    payload = event.payload or {}
    if not isinstance(payload, dict):
        return None
    parts = []
    for key in _EVENT_NOTE_KEYS:
        value = payload.get(key)
        if value:
            parts.append(f"{key}={_cut(str(value), _REASON_CHARS)}")
    return "; ".join(parts) or None


# ---------------------------------------------------------------------------
# Read actions
# ---------------------------------------------------------------------------

def _do_show(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    want = _int(args, "limit")
    want = _SHOW_COMMENTS if want is None else max(0, min(want, 50))

    comments = kb.list_comments(conn, task.id)
    events = kb.list_events(conn, task.id)

    shown = comments[-want:] if want else []
    payload: Dict[str, Any] = {
        "ticket": _detail(kb, conn, task),
        "comments": [
            {
                "author": c.author,
                "at": _ts(c.created_at),
                "body": _cut(c.body, _COMMENT_CHARS),
            }
            for c in shown
        ],
        "comments_total": len(comments),
        "events": [
            _prune({"kind": e.kind, "at": _ts(e.created_at), "note": _event_note(e)})
            for e in events[-_SHOW_EVENTS:]
        ],
        "events_total": len(events),
    }
    return _ok(**payload)


def _do_list(kb, conn, args: Dict[str, Any]) -> str:
    status = _text(args, "status")
    if status is not None:
        status = status.lower()
        if status not in kb.VALID_STATUSES:
            raise _Refuse(f"unknown status {status!r}. Valid: {_statuses(kb)}")
    limit = _int(args, "limit")
    limit = _LIST_LIMIT if limit is None else max(1, min(limit, _LIST_MAX))

    tasks = kb.list_tasks(
        conn,
        status=status,
        tenant=_text(args, "tenant"),
        assignee=_text(args, "assignee"),
        limit=limit,
    )
    return _ok(
        board=_board(kb),
        count=len(tasks),
        limit=limit,
        tickets=[_row(t) for t in tasks],
    )


def _do_runs(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    runs = kb.list_runs(conn, task.id)
    return _ok(
        task_id=task.id,
        status=task.status,
        runs_total=len(runs),
        runs=[
            _prune(
                {
                    "id": r.id,
                    "status": r.status,
                    "outcome": r.outcome,
                    "started": _ts(r.started_at),
                    "ended": _ts(r.ended_at),
                    "summary": _cut(r.summary, _SUMMARY_CHARS),
                    "error": _cut(r.error, _SUMMARY_CHARS),
                }
            )
            for r in runs[-_RUNS_LIMIT:]
        ],
    )


# ---------------------------------------------------------------------------
# Write actions
# ---------------------------------------------------------------------------

def _do_create(kb, conn, args: Dict[str, Any]) -> str:
    title = _text(args, "title")
    if not title:
        raise _Refuse("title is required to create a ticket.")

    key = _text(args, "idempotency_key")
    existing = None
    if key:
        # Read-only probe so the reply can say whether this call actually
        # created anything; `create_task` does the same lookup and returns the
        # existing id, but silently.
        row = conn.execute(
            "SELECT id FROM tasks WHERE idempotency_key = ? "
            "AND status != 'archived' ORDER BY created_at DESC LIMIT 1",
            (key,),
        ).fetchone()
        existing = row["id"] if row else None

    priority = _int(args, "priority") or 0
    tenant = _text(args, "tenant") or (os.environ.get("HERMES_TENANT") or None)

    # No `initial_status` here, on purpose — see the module docstring. A ticket
    # that has to wait on a human is created, then blocked.
    task_id = kb.create_task(
        conn,
        title=title,
        body=_text(args, "body"),
        tenant=tenant,
        priority=priority,
        idempotency_key=key,
        created_by=_author(),
    )
    reused = bool(existing and existing == task_id)
    task = kb.get_task(conn, task_id)
    return _ok(
        created=not reused,
        reused=reused,
        ticket=_row(task) if task else {"id": task_id},
        note=(
            "An existing ticket matched idempotency_key; nothing new was created."
            if reused
            else None
        ),
    )


def _do_comment(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    body = _text(args, "body")
    if not body:
        raise _Refuse("body is required to comment.")
    author = _author()
    comment_id = kb.add_comment(conn, task.id, author, body)
    return _ok(task_id=task.id, comment_id=comment_id, author=author)


def _do_complete(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    result = _text(args, "result")
    if not kb.complete_task(conn, task.id, result=result, summary=result):
        raise _Refuse(_why_not_complete(task))
    fresh = kb.get_task(conn, task.id)
    return _ok(task_id=task.id, status=fresh.status if fresh else "done")


def _why_not_complete(task) -> str:
    if task.status == "done":
        return f"ticket {task.id} is already done."
    if task.status == "archived":
        return f"ticket {task.id} is archived; archived tickets are final."
    if task.status == "blocked":
        return (
            f"ticket {task.id} is blocked — run action='unblock' first, then complete it."
        )
    return (
        f"ticket {task.id} is in status {task.status!r}; only 'ready' or "
        "'running' tickets can be completed."
    )


def _do_block(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    reason = _text(args, "reason")
    if not reason:
        raise _Refuse(
            "reason is required to block — whoever picks this ticket up needs "
            "to know what it is waiting for."
        )
    kind = (_text(args, "kind") or "needs_input").lower()
    if kind not in kb.VALID_BLOCK_KINDS:
        raise _Refuse(f"unknown block kind {kind!r}. Valid: {_block_kinds(kb)}")

    if not kb.block_task(conn, task.id, reason=reason, kind=kind):
        raise _Refuse(_why_not_block(task))

    fresh = kb.get_task(conn, task.id)
    status = fresh.status if fresh else "blocked"
    sticky = _sticky(kb, conn, task.id)
    note = None
    if status == "todo":
        note = (
            "kind='dependency' parks the ticket in 'todo', not 'blocked': it "
            "re-enters the queue by itself once its parents are done."
        )
    elif status == "triage":
        note = (
            "This ticket has been blocked and unblocked for the same reason too "
            "many times, so it went to 'triage' for a human decision instead."
        )
    elif not sticky:
        note = (
            "WARNING: no sticky 'blocked' event was recorded — this ticket can "
            "be promoted back to 'ready' on its own. Do not treat it as held."
        )
    return _ok(
        task_id=task.id,
        status=status,
        kind=kind,
        sticky_block=sticky,
        note=note,
    )


def _why_not_block(task) -> str:
    if task.status == "blocked":
        return f"ticket {task.id} is already blocked (kind={task.block_kind or 'untyped'})."
    if task.status in ("done", "archived"):
        return f"ticket {task.id} is {task.status}; finished tickets cannot be blocked."
    if task.status == "todo":
        return (
            f"ticket {task.id} is in 'todo' — it is already waiting on its "
            "parent tickets and will queue itself when they finish."
        )
    return (
        f"ticket {task.id} is in status {task.status!r}; only 'ready' or "
        "'running' tickets can be blocked."
    )


def _do_unblock(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    if not kb.unblock_task(conn, task.id):
        raise _Refuse(
            f"ticket {task.id} is in status {task.status!r}; only 'blocked' or "
            "'scheduled' tickets can be unblocked."
        )
    fresh = kb.get_task(conn, task.id)
    return _ok(task_id=task.id, status=fresh.status if fresh else "ready")


def _do_archive(kb, conn, args: Dict[str, Any]) -> str:
    task = _require_task(kb, conn, args)
    if not kb.archive_task(conn, task.id):
        raise _Refuse(f"ticket {task.id} is already archived.")
    return _ok(task_id=task.id, status="archived")


_ACTIONS: Dict[str, Callable[[Any, Any, Dict[str, Any]], str]] = {
    "show": _do_show,
    "list": _do_list,
    "runs": _do_runs,
    "create": _do_create,
    "comment": _do_comment,
    "complete": _do_complete,
    "block": _do_block,
    "unblock": _do_unblock,
    "archive": _do_archive,
}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def handle_kanban(args: Dict[str, Any], **_kw) -> str:
    args = args or {}
    action = str(args.get("action") or "").strip().lower()
    if action not in _ACTIONS:
        return _err(
            f"unknown action {action!r}. Valid: {', '.join(sorted(_ACTIONS))}."
        )
    try:
        kb = _kb()
    except Exception as e:
        logger.warning("kanban tool: board module unavailable: %s", e)
        return _err(f"kanban board is unavailable here ({_brief(e)}).")

    try:
        with kb.connect_closing() as conn:
            return _ACTIONS[action](kb, conn, args)
    except _Refuse as e:
        return _err(str(e))
    except ValueError as e:
        # kanban_db raises ValueError for its own contract violations
        # (unknown task, empty body, bad status). Those are already phrased
        # for a human; pass them through instead of wrapping them.
        return _err(f"kanban {action}: {_cut(str(e), _ERROR_CHARS)}")
    except Exception as e:
        logger.exception("kanban tool: action=%s failed", action)
        return _err(f"kanban {action} failed — {_brief(e)}")


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
#
# Every word below is re-sent on every prompt, so it stays short. The two long
# sentences that survived are the ones that prevent silent data loss: never
# invent an id, and blocking is what makes a block stick.

KANBAN_SCHEMA: Dict[str, Any] = {
    "name": "kanban",
    "description": (
        "Read and update tickets on the kanban board.\n"
        "Read: show (one ticket + recent comments/events), list (filter by "
        "status/tenant/assignee), runs (worker attempt history).\n"
        "Write: create, comment, complete, block, unblock, archive.\n"
        "Ticket ids look like t_1a2b3c4d5e6f — never invent one; get it from "
        "list or show first.\n"
        "block is what records the typed event that keeps a ticket held; a "
        "ticket parked in blocked any other way returns to ready by itself. To "
        "open a ticket that is already waiting on someone, create it and then "
        "block it."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "show", "list", "runs",
                    "create", "comment", "complete", "block", "unblock", "archive",
                ],
                "description": "What to do. create needs title; every other action needs task_id.",
            },
            "task_id": {
                "type": "string",
                "description": "Ticket id, e.g. t_1a2b3c4d5e6f.",
            },
            "title": {"type": "string", "description": "create: ticket title."},
            "body": {
                "type": "string",
                "description": "create: the full ticket text. comment: the comment text.",
            },
            "tenant": {
                "type": "string",
                "description": "Namespace for a client/project. create: set it; list: filter by it.",
            },
            "priority": {
                "type": "integer",
                "description": "create: higher sorts first. Default 0.",
            },
            "idempotency_key": {
                "type": "string",
                "description": (
                    "create: reuse the existing ticket with this key instead of "
                    "creating a duplicate. Use it whenever a retry is possible."
                ),
            },
            "result": {
                "type": "string",
                "description": "complete: short outcome recorded on the ticket.",
            },
            "reason": {
                "type": "string",
                "description": "block: what the ticket is waiting for. Required.",
            },
            "kind": {
                "type": "string",
                "enum": ["needs_input", "capability", "transient", "dependency"],
                "description": (
                    "block: why. needs_input (default) = waiting on a person; "
                    "capability = missing access or tool; transient = may clear "
                    "on its own; dependency = waiting on another ticket, which "
                    "queues itself again instead of staying blocked."
                ),
            },
            "status": {
                "type": "string",
                "description": "list: filter, e.g. ready, blocked, done, archived.",
            },
            "assignee": {"type": "string", "description": "list: filter by assignee."},
            "limit": {
                "type": "integer",
                "description": "list: max tickets (default 20). show: max comments (default 5).",
            },
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}
