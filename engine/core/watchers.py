"""What fires an `event` flow: a plugin's own code, looking for what is new.

THE MODEL DOES NOT POLL. Until 2026-09-20 the Instagram flow ran on a cron: every
fifteen minutes a whole turn of the agent — some 23,000 input tokens — existed to
call two tools and say «sin novedades». Nearly a hundred turns a day for
nothing, a hundred conversations nobody typed in, and a message answered a
quarter of an hour late on a channel that gives 24 hours.

So the looking is CODE. A plugin registers a watcher by name
(`engine.watcher("instagram.inbox", fn, every=60)`), a flow names it
(`trigger: event`, `event: instagram.inbox`), and the scheduler calls the
function on its own clock. The function returns `None` when nothing is new and,
when something is, THE TEXT OF WHAT IS NEW — which the run receives inside its
own prompt. A flow only ever becomes a turn when there is work in it.

A push from outside (a webhook) is a second way to make the same function worth
calling, not a second mechanism: it lands here when there is a public URL to
receive it on, and the poll stays as the net under it.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Watcher:
    # Returns what is new, as the run will read it, or `None`. SYNC: the
    # scheduler runs it in a thread, since what it does is HTTP.
    fn: Callable[[], str | None]
    # Seconds between two looks when nothing is happening.
    every: int


WATCHERS: dict[str, Watcher] = {}


def register(name: str, fn: Callable[[], str | None], every: int) -> None:
    if name in WATCHERS:
        raise ValueError(f"two plugins registered the watcher {name!r}")
    WATCHERS[name] = Watcher(fn, every)


# ── tickers ─────────────────────────────────────────────────────────────────
#
# THE SAME CLOCK WITH NO FLOW AT THE END OF IT. A watcher's text becomes a run
# of the agent; some code on a clock never should — the `notify` plugin reads
# what happened and mails the owner, and a model turn there would be the
# fifteen-minute cron all over again. A ticker is called every `every` seconds
# and what it does is all there is.


@dataclass(frozen=True)
class Ticker:
    # Sync, in a thread, like a watcher — or ASYNC, on the engine's loop, for
    # a ticker that runs a model (`kit/plugins/business/`). What it raises is
    # logged, once per distinct error, and the next call happens on schedule.
    fn: Callable[[], None] | Callable[[], Awaitable[None]]
    every: int


TICKERS: dict[str, Ticker] = {}


def register_ticker(name: str, fn: Callable, every: int) -> None:
    if name in TICKERS:
        raise ValueError(f"two plugins registered the ticker {name!r}")
    TICKERS[name] = Ticker(fn, every)
