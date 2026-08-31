#!/usr/bin/env python3
"""Open the ticket a news item is worked inside, before a word of it is written.

THE SCRIPT OWNS THE TICKET, and that is the whole point of it existing. The
flow's card promises the client two things -- «Abro un ticket "Noticia <tema>"»
and «Te pido el sí antes de que se publique» -- and until today both were prose
in a SKILL.md. On the from-zero run the model remembered and did them; on an
independent re-run of the same flow with a different URL it did NOT: the draft
came out correct and complete and the board got nothing -- no ticket, no
approval, no trace that any work had happened (`docs/east-requirements.md` 5.5,
`docs/PENDING.md`). Nothing was published, but the gate the card sells did not
run and the client had no record. The interview half of this same plugin has
had `fetch_video.py` opening its ticket from code since day one, keyed on the
video id; this is that same supplier for the news half.

So the script does three things the agent is not asked to remember:

  1. THE TICKET IS OPENED FROM CODE, keyed so that the same note twice is one
     card. For a link the key is the NORMALIZED url (see `normalize_url`): the
     same article pasted with a `utm_source`, with `www.`, over http, or with a
     trailing slash is the same article and must not open a second ticket.
     Material that is not a link is keyed on the material itself -- the file's
     bytes, or the pasted text -- which is the same promise for the other two
     entry paths the flow accepts.
  2. IT IS UNASSIGNED, for the reason `fetch_video.py` spells out: the turn
     that called this script is the one writing the note, and an assignee would
     hand the same work to the dispatcher as well and bill it twice. What the
     ticket is for is VISIBILITY -- and the place the approval lives.
  3. NO TICKET IS A STOP, not a warning. `fetch_video.py` can carry on when the
     board refuses it, because it already has the audio and the audio is worth
     keeping. Here the ticket IS the deliverable's home and the approval's only
     address: writing the note anyway is exactly the failure this script was
     written for. It exits non-zero and says what to tell the client.

Usage:
    python3 open_news_ticket.py --url https://elpais.com.uy/... [--about "el tema"]
    python3 open_news_ticket.py --file /opt/data/workspace/interno/nota.pdf
    python3 open_news_ticket.py --text < nota.txt      # el texto pegado en el chat
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

FLOW = "noticia-para-publicar"

# The same shape as `fetch_video.py`'s, and for the same reason: the agent's
# terminal runs with a sanitized PATH that does not carry /opt/hermes/bin.
HERMES_CANDIDATES = ("/opt/hermes/bin/hermes", "/opt/hermes/.venv/bin/hermes")

# Query parameters that identify the CLICK, not the article. Everything else is
# kept: `?id=4821` on a portal that routes by id IS the note, and dropping it
# would file two different notes under one ticket -- a far worse failure than
# opening two tickets for one note.
TRACKING_PREFIXES = ("utm_",)
TRACKING_KEYS = frozenset({
    "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid",
    "twclid", "igshid", "mc_cid", "mc_eid", "_ga", "ref", "ref_src",
    "ref_url", "source", "s_cid", "cmpid", "sr_share", "__twitter_impression",
})

# Enough of the digest that two different notes colliding is not a thing that
# happens, short enough that the key is readable on a board.
DIGEST = 12
# The subject only names the card. A whole headline in the title makes the
# Pipeline unreadable, and the headline itself is in the deliverable.
MAX_SUBJECT = 60


def fail(msg, **extra):
    print(json.dumps({"ok": False, "error": msg, **extra}, ensure_ascii=False))
    return 2


def resolve(candidates, name):
    for path in candidates:
        if os.access(path, os.X_OK):
            return path
    return shutil.which(name)


def normalize_url(raw):
    """The form of a url that answers "is this the same note?".

    What is folded, and why each one is the same article:

      scheme      http and https are one site; a portal that serves both hands
                  out either link depending on where you copied it from.
      `www.`      the same host. So is a trailing dot and an upper-case host.
      the port    only when it is the scheme's default.
      the path's  `/nota/` and `/nota` are one page on every CMS in use here.
      trailing /
      tracking    a link forwarded through WhatsApp carries `?utm_source=...`;
      parameters  the article does not change because of how it reached us.
      the order   `?a=1&b=2` and `?b=2&a=1` are one request.
      of the rest
      the         `#comentarios` is a place ON the page, not another page.
      fragment

    What is NOT folded: THE CASE OF THE PATH. Uppercase in a path is a
    different resource on any server that is not Windows, and guessing wrong
    there merges two real notes into one ticket.
    """
    parts = urlsplit(raw.strip())
    host = parts.netloc.lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    if parts.scheme == "http" and host.endswith(":80"):
        host = host[:-3]
    if parts.scheme == "https" and host.endswith(":443"):
        host = host[:-4]
    path = re.sub(r"/{2,}", "/", parts.path)
    if len(path) > 1:
        path = path.rstrip("/")
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in TRACKING_KEYS
            and not k.lower().startswith(TRACKING_PREFIXES)]
    # The scheme is fixed rather than kept: this string is a KEY, not a link to
    # visit. The link the client gave is reported back untouched as `url`.
    return urlunsplit(("https", host, path, urlencode(sorted(kept)), ""))


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:DIGEST]


def shorten(text):
    """Trim to a card-sized subject, ON A WORD.

    Cutting at the character breaks headlines mid-word -- the first live run
    opened «Noticia — Dispararon un auto una casa y dejaron cinco heridos que
    fuer», which on a client's board reads as something broken rather than as a
    title that was long.
    """
    words = re.sub(r"\s+", " ", text).strip()
    if len(words) <= MAX_SUBJECT:
        return words
    return words[:MAX_SUBJECT].rsplit(" ", 1)[0].rstrip(" ,.;:-") + "…"


def humanize(text):
    return shorten(re.sub(r"[-_+]+", " ", text)).capitalize()


def subject_from_url(url):
    """The card's name when the agent did not pass one, out of the url itself.

    A slug is what a news site puts in its path, and it is the headline the
    outlet already wrote: `/2026/08/29/condenaron-a-doce-personas/` names the
    card better than anything the agent could improvise before reading. A path
    that carries no slug (an id, a section) falls back to the host, which is at
    least true.
    """
    parts = urlsplit(url)
    for segment in reversed([s for s in parts.path.split("/") if s]):
        segment = re.sub(r"\.(html?|php|aspx?|amp)$", "", segment, flags=re.I)
        # A SLUG, and nothing else: `/notas/4821` would otherwise name the card
        # "Notas", which is the section it is filed under and says nothing about
        # what happened. The host at least does not pretend.
        if "-" in segment and re.search(r"[a-zA-Z]", segment):
            return humanize(segment)
    return parts.netloc


def open_ticket(title, body, key):
    """Open the note's ticket through the CLI. Never SQL, never a guess.

    Unassigned, `--json`, and the key does the deduplication: `hermes kanban
    create` returns the id of the existing non-archived task when one already
    carries the key, so a second run on the same note lands on the same card.

    Returns (ticket_id, ticket_title, problem).
    """
    binary = resolve(HERMES_CANDIDATES, "hermes")
    if not binary:
        return None, "", ("no encontré el CLI de Hermes, así que no puedo abrir "
                          "el ticket de esta noticia")
    try:
        proc = subprocess.run(
            [binary, "kanban", "create", "--json",
             f"--body={body}", f"--idempotency-key={key}", "--", title],
            capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, "", f"no pude crear el ticket de la noticia: {exc}"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-200:]
        return None, "", f"no pude crear el ticket de la noticia: {detail}"
    out = proc.stdout or ""
    try:
        data = json.loads(out)
        if isinstance(data, dict) and isinstance(data.get("id"), str):
            return data["id"], str(data.get("title") or title), ""
    except ValueError:
        pass
    m = re.search(r"^Created\s+(\S+)", out, re.M)
    if m:
        return m.group(1), title, ""
    return None, "", ("el tablero contestó algo que no puedo leer como ticket: "
                      + out.strip()[-200:])


def material(args):
    """What the note is being written from, as (source, key, subject).

    One of the three shapes the flow accepts, and each one keyed on something
    the CODE can compute twice with the same answer -- never on words the model
    chose, which is how the same note gets two cards.
    """
    if args.url:
        if not re.match(r"^https?://", args.url.strip(), re.I):
            return None, "", "", ("la fuente tiene que ser un link http(s) a la "
                                  "nota; si te pasaron un archivo usá --file y si "
                                  "te pegaron el texto usá --text")
        url = args.url.strip()
        normalized = normalize_url(url)
        source = {"kind": "url", "url": url, "normalized_url": normalized}
        return (source, f"news:{urlsplit(normalized).netloc}:{digest(normalized)}",
                subject_from_url(normalized), "")

    if args.file:
        path = Path(args.file)
        if not path.is_file():
            return None, "", "", f"no existe el archivo que me pasaste: {path}"
        # The BYTES, not the name: the same PDF forwarded twice under two names
        # is one note, and the client renaming it is not a second job.
        source = {"kind": "file", "file": str(path.resolve()),
                  "size_bytes": path.stat().st_size}
        content = hashlib.sha256(path.read_bytes()).hexdigest()[:DIGEST]
        return source, f"news:file:{content}", humanize(path.stem), ""

    text = sys.stdin.read()
    if not text.strip():
        return None, "", "", ("no me llegó texto por la entrada estándar: pegá la "
                              "nota, o usá --url / --file")
    # Whitespace is not content: the same article pasted twice out of the chat
    # differs by line breaks and nothing else.
    flat = re.sub(r"\s+", " ", text).strip()
    source = {"kind": "text", "characters": len(flat)}
    first = next((l.strip() for l in text.splitlines() if l.strip()), "")
    return source, f"news:text:{digest(flat)}", humanize(first), ""


def main():
    ap = argparse.ArgumentParser()
    where = ap.add_mutually_exclusive_group(required=True)
    where.add_argument("--url", default="", help="el link de la nota")
    where.add_argument("--file", default="",
                       help="el archivo que te mandaron (pdf, documento, captura)")
    where.add_argument("--text", action="store_true",
                       help="el texto de la nota, pegado por la entrada estándar")
    ap.add_argument("--about", default="",
                    help="de qué es la noticia, en pocas palabras: es el nombre "
                         "de la tarjeta en el tablero")
    args = ap.parse_args()

    source, key, derived, problem = material(args)
    if problem:
        return fail(problem)

    subject = shorten(args.about) or derived
    title = f"Noticia — {subject}" if subject else "Noticia"
    origin = source.get("url") or source.get("file") or "texto pegado en el chat"
    body = (f"Fuente: {origin}\n"
            "El borrador se guarda como entregable y la aprobación se pide "
            "acá adentro, en este mismo ticket.")

    # Already inside a ticket: the dispatcher served one, so a second card for
    # the same note is the mistake the `approval` skill spells out.
    serving = os.environ.get("HERMES_KANBAN_TASK", "").strip()
    if serving:
        ticket, ticket_title, ticket_from = serving, "", "dispatcher"
    else:
        ticket, ticket_title, problem = open_ticket(title, body, key)
        ticket_from = "idempotency-key"
        if problem:
            return fail(
                problem + ". La noticia NO se escribe sin su ticket: sin él no "
                "hay dónde pedirte el sí ni queda rastro del trabajo. Decíselo "
                "al cliente en una línea y pará acá.",
                key=key, source=source)

    print(json.dumps({
        "ok": True,
        "ticket": ticket,
        "ticket_title": ticket_title,
        "ticket_from": ticket_from,
        "key": key,
        "source": source,
        "flow": FLOW,
        "next": ("python3 /opt/kit/skills/deliverable/deliver.py "
                 f'--title "Noticia — {subject or "<tema>"}" --kind borrador '
                 f'--flow {FLOW} --tags "noticia,<tema>"'),
        "note": (f"Trabajá adentro de {ticket}: el borrador va como entregable y "
                 "el pedido de aprobación va como comentario de ESE ticket, que "
                 "después bloqueás con needs_input. Y ahí lo dejás: BLOQUEADO, no "
                 "terminado — un ticket terminado sale de la cola de Aprobaciones "
                 "y tu cliente se queda sin el botón para aprobar. El ticket lo "
                 "cierra el sí, en otro turno. No abras otro ticket: si esta "
                 "noticia ya tenía uno, este es el mismo. Nada se publica ni se "
                 "manda sin el sí."),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
