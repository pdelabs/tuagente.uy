"""promises — keeps the agent from announcing a flow that doesn't exist.

The engine calls `transform_llm_output` ONCE per turn, in
`hermes:agent/turn_finalizer.py:485-505`, with the final response already
assembled and BEFORE saving it and sending it. What we return here replaces
the text: it's what gets persisted in `state.db`, what travels in
`assistant.completed`, and what the portal draws in the bubble (the portal
overwrites what it streamed with that event — `app/app/lib/agent.ts:997`).
So the correction isn't lost even on refresh.

WHY A PLUGIN AND NOT A SHELL HOOK, which is what the rest of the kit uses:
`agent/shell_hooks.py:580-620` only knows how to return `block`
(pre_tool_call) or `continue` (pre_verify) or `context`; a shell hook CANNOT
replace the response's text. And `pre_verify`, which would be the natural
place to make it retry, only fires **if the turn edited files**
(`agent/conversation_loop.py:6808-6815`): the turn with the bug wrote
nothing — it looked at skills and answered —, so that path didn't exist.

The plugin is loaded via `plugins.enabled` in the config (which is :ro for
the agent) and lives in `policy/plugins/`, mounted :ro at
`/opt/data/plugins`: a guardrail that whatever gets saved could change
isn't a guardrail.

A HIRED ROLE REACHES THE SAME DIRECTORY THROUGH A LINK, and it has to: the
engine only ever looks in HERMES_HOME/plugins, and a role's home is
`/opt/data/profiles/<role>/`. `tools/hire-role.sh` leaves
`plugins -> ../../plugins` there and projects `plugins.enabled` into the
role's config; `tools/agent-check.py` fails, naming the role, when either
half is missing. It takes both — with the link and no key the engine
discovers this plugin and loads it turned off.

THE LIMIT, MEASURED: what we add does NOT stay in the history. `finalize_turn`
persists the session at its line 352 and only transforms at line 485, so
`state.db` keeps the original text. Verified against an agent on 8/13: the
notice arrived in `assistant.completed` and the portal drew it, but
`GET /api/sessions/<id>/messages` returns the bare message. So the
correction is visible when it arrives and disappears if the client
refreshes. That's enough for what matters — that they find out in the
moment — and it can't be closed from here: it's two lines in the engine
(`notes/engine-knobs.md`, section 8).
"""
import logging

from hermes_constants import get_hermes_home

from . import promises

logger = logging.getLogger(__name__)


def _home():
    """The home of the profile whose turn this is, resolved AT CALL TIME.

    NOT `os.environ["HERMES_HOME"]`, which is what this used to read once at
    import. The engine's PluginManager is a process singleton with a
    `_discovered` latch (`hermes:hermes_cli/plugins.py:2048-2056`) and the
    gateway serves every profile in ONE process, scoping a turn with a
    context-local home override (`hermes_cli/profiles.py:950-990`). So this
    module is imported exactly once, under whichever home discovered first, and
    a frozen path means every profile after that one gets checked against
    somebody else's disk.

    On this agent that was not hypothetical: the client's own home has no
    `flows/` at all and marketing's has three. Read from the environment, a
    teammate saying "queda armado: todos los lunes" was contradicted by a
    correction that had gone looking in the client's folder -- the guard
    telling the client the truth about the wrong person. `get_hermes_home()`
    returns the override when there is one and the process env when there is
    not, which is exactly the home the turn is running under.
    """
    return str(get_hermes_home())


def _review_response(response_text=None, session_id="", platform="", **_):
    try:
        result = promises.with_notice(response_text or "", _home())
    except Exception:
        # Failing here can't cost the client their response. It goes to
        # agent.log, which is where you check if the notice stopped showing up.
        logger.warning("promises: could not review the response", exc_info=True)
        return None
    if result:
        logger.warning(
            "promises: the agent announced something running on its own that "
            "doesn't exist (session=%s platform=%s) — appended the correction",
            session_id, platform,
        )
    return result


def register(ctx):
    ctx.register_hook("transform_llm_output", _review_response)
