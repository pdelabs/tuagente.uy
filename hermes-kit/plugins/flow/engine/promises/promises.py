#!/usr/bin/env python3
"""Checks what the agent SAYS it left running on its own against what's there.

This file deliberately imports nothing from the engine: these are pure
functions over a text and a `data/` folder. That way `tools/agent-check.py`
can run it from the host — with real test cases, including the exact phrase
that cost a client her trust — without booting up an agent.

WHAT PROBLEM THIS SOLVES. On 8/13/2026, in the blind test with a
real-estate client: the client asked for the weekly contract check, the
agent replied "Queda definido: viernes a las 9:30" with both blocks and
everything, and NEVER called `create_flow.py` once. In the Flujos tab it
still said "Todavía no hay nada corriendo solo". Only when she asked
"¿entonces quedó armado o no?" did the agent create it and admit to making
it up. If she hadn't checked, she'd never have known: Friday would come and
nothing would reach her, and the contract would auto-renew on its own.

THE CRITERION. A claim about something running on its own is verifiable by
code: either there's an active FLOW.md with its trigger alive in the cron,
or there isn't. So instead of asking the model to remember, we look at the
disk and, if what it said isn't there, the text goes out with a correction
attached that the client can't miss.

Two rules, and both state FACTS (never accuse the agent of lying, because
detecting the phrase is approximate and the fact isn't):

  R1  it says something got set up/scheduled, talks about something that
      repeats, and there's NO live flow at all.
  R2  in the same line it says something got set up and names a day and
      time, and no live flow fires that day at that time. (This is the one
      that catches drift: the flow exists but runs on Thursdays and the
      agent says Friday.)

Out of scope, said so no one reads more coverage into this than there is:
this only knows about flows. "I sent the email", "I closed the ticket" or
"I uploaded it" aren't checked here — there's no file that contradicts them.
"""
import json
import os
import re
import unicodedata

WEEKDAYS = {
    "domingo": 0, "domingos": 0,
    "lunes": 1,
    "martes": 2,
    "miercoles": 3,
    "jueves": 4,
    "viernes": 5,
    "sabado": 6, "sabados": 6,
}
WEEKDAY_NAME = {0: "domingos", 1: "lunes", 2: "martes", 3: "miércoles",
                4: "jueves", 5: "viernes", 6: "sábados"}

# THE CLOSING PHRASE. We're not chasing the verb "hacer": we're chasing the
# forms that tell someone a thing ALREADY IS. "Queda definido" is first for a
# reason — it's the one that actually happened.
CLOSING_CLAIMS = (
    "queda definido", "quedo definido", "queda definida", "quedo definida",
    "queda armado", "quedo armado", "queda armada", "quedo armada",
    "queda creado", "quedo creado", "queda creada", "quedo creada",
    "queda programado", "quedo programado", "queda programada", "quedo programada",
    "queda agendado", "quedo agendado", "queda agendada", "quedo agendada",
    "queda configurado", "quedo configurado",
    "queda activo", "quedo activo", "queda activa", "quedo activa",
    "queda andando", "quedo andando", "queda corriendo", "quedo corriendo",
    "queda listo", "quedo listo", "queda lista", "quedo lista",
    "queda cambiado", "quedo cambiado", "queda cambiada", "quedo cambiada",
    "queda hecho", "quedo hecho",
    "lo deje armado", "lo deje programado", "lo deje andando",
    "lo deje corriendo", "lo deje listo", "lo deje agendado",
    "lo programe", "lo agende", "lo cree", "ya lo cree", "ya esta creado",
    "sigue activo", "sigue activa", "sigue andando", "sigue corriendo",
    "esta programado", "esta programada", "esta agendado", "esta agendada",
    "esta activo", "esta activa", "esta andando", "esta corriendo",
    "va a correr", "corre solo", "arranca solo", "se hace solo",
    "empieza a correr", "listo:",
)

# WHAT MAKES THE PHRASE BE ABOUT SOMETHING THAT REPEATS. Without this, "el
# informe quedó listo" would fall into the net and the client would read a
# correction about flows when they'd asked for a one-off report.
RECURRENCE_HINTS = (
    "todos los", "todas las", "cada semana", "cada mes", "cada dia",
    "cada lunes", "cada martes", "cada miercoles", "cada jueves",
    "cada viernes", "cada sabado", "cada domingo",
    "semanal", "mensual", "diariamente", "periodic",
    "flujo", "programad", "agendad", "automatic",
    "corre solo", "correr solo", "corriendo solo", "andando",
    "sin que me lo pidas", "sin que se lo pidas", "de ahora en mas",
)

# What flips the meaning of the phrase: "todavia NO quedo armado" isn't a
# promise, it's the truth.
NEGATES = re.compile(r"\b(no|nunca|ni|todavia|aun|sin)\b[^.;:]{0,24}$")

TIME_RE = re.compile(r"\b(\d{1,2})[:.](\d{2})\b")
LOOSE_HOUR_RE = re.compile(r"\ba las (\d{1,2})\b(?![:.]\d)")

MARKER = "Chequeo automático del portal"


def normalize(text):
    """Lowercase and accent-stripped: the model writes 'quedó' and 'quedo' interchangeably."""
    stripped = unicodedata.normalize("NFD", text or "")
    stripped = "".join(c for c in stripped if unicodedata.category(c) != "Mn")
    return stripped.lower()


# ---------------------------------------------------------------- the cron ---

def _field_matches(expr, value):
    """True if `value` falls in a cron field ('*', '5', '1-5', '*/2', '1,4')."""
    expr = expr.strip()
    if expr == "*":
        return True
    for part in expr.split(","):
        part = part.strip()
        step = 1
        if "/" in part:
            part, _, p = part.partition("/")
            if not p.isdigit():
                return False
            step = int(p)
            if part == "*":
                part = ""
        if part == "":
            if value % step == 0:
                return True
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            if not (a.isdigit() and b.isdigit()):
                continue
            if int(a) <= value <= int(b) and (value - int(a)) % step == 0:
                return True
            continue
        if part.isdigit() and int(part) == value:
            return True
    return False


def fires(expr, day=None, hour=None, minute=None):
    """True if cron `expr` can fire on that day of the week at that time.

    `day` follows cron convention (0 and 7 = Sunday). Whatever comes in as
    None isn't required: if the agent said "los viernes" with no time, it's
    enough that the flow runs on Fridays.
    """
    fields = (expr or "").split()
    if len(fields) < 5:
        return False
    m, h, _, _, d = fields[:5]
    if minute is not None and not _field_matches(m, minute):
        return False
    if hour is not None and not _field_matches(h, hour):
        return False
    if day is not None:
        if not (_field_matches(d, day) or (day == 0 and _field_matches(d, 7))):
            return False
    return True


def describe_schedule(expr):
    """The cron said in plain terms, so we can tell the client what actually runs."""
    fields = (expr or "").split()
    if len(fields) < 5:
        return "cada tanto"
    m, h, _, _, d = fields[:5]
    days = [WEEKDAY_NAME[n] for n in range(7) if _field_matches(d, n) or (n == 0 and _field_matches(d, 7))]
    when_days = "todos los días" if len(days) == 7 else "los " + ", ".join(days)
    if h.isdigit() and m.isdigit():
        return f"{when_days} a las {int(h)}:{int(m):02d}"
    return when_days


# --------------------------------------------------------------- the disk ---

def _frontmatter(path):
    fields = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return fields
    if not text.startswith("---"):
        return fields
    body = text.split("---", 2)
    if len(body) < 3:
        return fields
    for line in body[1].splitlines():
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip()] = value.strip().strip('"').strip("'")
    return fields


def live_flows(data):
    """The flows that will actually run: active and with their trigger turned on.

    A FLOW.md with no live trigger in `cron/jobs.json` does NOT count, and
    that's half the value here: it's exactly the state the production agent
    was left in on 8/8 —folder yes, cron no— and the one that reads as
    "everything's fine" from the outside.
    """
    live = []
    root = os.path.join(data, "flows")
    try:
        with open(os.path.join(data, "cron", "jobs.json"), encoding="utf-8") as fh:
            jobs = {j.get("id"): j for j in (json.load(fh).get("jobs") or [])}
    except (OSError, ValueError, AttributeError):
        jobs = {}
    try:
        slugs = sorted(os.listdir(root))
    except OSError:
        return live
    for slug in slugs:
        path = os.path.join(root, slug, "FLOW.md")
        if not os.path.isfile(path):
            continue
        f = _frontmatter(path)
        if f.get("status", "active") != "active":
            continue
        job = jobs.get(f.get("trigger_job", ""))
        if f.get("trigger_type") == "request":
            continue          # doesn't run on its own: starts when the client asks
        if not job or not job.get("enabled", True):
            continue
        expr = ((job.get("schedule") or {}).get("expr")
                or f.get("trigger_cron", ""))
        live.append({"slug": slug,
                     "name": f.get("name", slug),
                     "cron": expr})
    return live


# ---------------------------------------------------------------- the rule --

def _line_claims(line):
    """The closing claim found in that line, if it isn't negated."""
    for phrase in CLOSING_CLAIMS:
        i = line.find(phrase)
        while i != -1:
            if not NEGATES.search(line[:i]):
                return phrase
            i = line.find(phrase, i + 1)
    return None


def _day_and_time(line):
    days = {n for name, n in WEEKDAYS.items() if re.search(rf"\b{name}\b", line)}
    hour = minute = None
    m = TIME_RE.search(line)
    if m and int(m.group(1)) < 24 and int(m.group(2)) < 60:
        hour, minute = int(m.group(1)), int(m.group(2))
    else:
        m = LOOSE_HOUR_RE.search(line)
        if m and int(m.group(1)) < 24:
            hour = int(m.group(1))
    return days, hour, minute


def review(text, data):
    """The notice to append to the message, or None if what it said is true.

    Fails on the side of silence: anything odd —no folder, broken JSON, the
    text doesn't match— returns None. This check can't be the thing that
    breaks a response.
    """
    if not text or MARKER in text:
        return None
    clean = normalize(text)
    if not any(r in clean for r in RECURRENCE_HINTS):
        return None

    # Split by line and by period-plus-space, NEVER by ":" or ";": the colon
    # is exactly what introduces the promise ("Queda definido: viernes a las
    # 9:30"), and splitting there left the day and time in another chunk that
    # rule 2 no longer looked at.
    lines = [r for r in re.split(r"\n+|(?<=\.)\s+", clean) if r.strip()]
    claim = next((r for r in lines if _line_claims(r)), None)
    if claim is None:
        return None

    live = live_flows(data)

    # R1 — there's NOTHING running on its own.
    if not live:
        return (
            f"> **{MARKER}.** Miré lo que hay programado de verdad y **no hay "
            "ningún trabajo corriendo solo**. Si algo de este mensaje dice que "
            "quedó armado, programado o listo para repetirse, no quedó: no va "
            "a pasar nada solo. Lo que sí corre solo aparece en tu pestaña "
            "Flujos."
        )

    # R2 — there are flows, but none fires on the day and time it promised.
    days, hour, minute = _day_and_time(claim)
    if not days and hour is None:
        return None
    targets = sorted(days) or [None]
    for d in targets:
        if any(fires(f["cron"], d, hour, minute) for f in live):
            return None
    said = " ni los ".join(WEEKDAY_NAME[d] for d in targets if d is not None)
    if hour is not None:
        clock = f" a las {hour}:{minute:02d}" if minute is not None else f" a las {hour}"
    else:
        clock = ""
    when_said = (f"los {said}{clock}" if said else clock.strip())
    listing = "; ".join(f"«{f['name']}», {describe_schedule(f['cron'])}" for f in live)
    return (
        f"> **{MARKER}.** No hay nada programado para {when_said}. Lo que "
        f"corre solo hoy es: {listing}. Si arriba dice otra cosa, vale esto."
    )


def with_notice(text, data):
    """The final text: the agent's, plus the correction appended if needed."""
    notice = review(text, data)
    if not notice:
        return None
    return f"{text.rstrip()}\n\n{notice}\n"
