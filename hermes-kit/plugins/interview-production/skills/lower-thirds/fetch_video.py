#!/usr/bin/env python3
"""Bring an interview published at a URL down to an audio file we can transcribe.

THE SCRIPT OWNS THE DOWNLOAD, and that is the whole point of it existing. The
one interview the first production client ever processed arrived as a YouTube
link pasted into the portal chat, and the agent handled it by improvising
`uv run --with yt-dlp yt-dlp ...`: no version pinned, no timeout, no size limit,
and -- the part that cost real quality -- it took the platform's AUTOMATIC
CAPTIONS and built the transcript out of them. Five `[VERIFICAR CONTRA EL VIDEO]`
markers ended up in copy that goes to air, one of them inside a shipped
lower-third (docs/east-requirements.md, 1.6).

So this script does four things the agent is not asked to remember:

  1. THE VERSION IS PINNED (`YT_DLP_VERSION`). yt-dlp is not in the engine image
     and never will be -- `uvx` is, so the downloader is fetched at the pinned
     version and cached under the workspace. An unpinned downloader is a
     different program every week against a site that changes every week.
  2. AUDIO ONLY, AND NEVER SUBTITLES. `--no-write-subs --no-write-auto-subs` is
     not tidiness: automatic captions are the failure above, and the only way to
     make sure they are not used is to not have them on disk. The transcript
     comes from `transcribe.py`, on the client's model connection.
  3. ONE TICKET PER INTERVIEW, FROM THE CODE. The original flow's step 2 said
     "por cada entrevista nueva creo un ticket" and the one run there ever was
     skipped it. Every convention that depended on the agent remembering has
     failed in this kit, so the ticket is opened here, keyed on the video id so
     re-running never opens a second one.
  4. IT SAYS WHAT COMES NEXT, with the command already written. The agent's only
     job is to run it.

Usage:
    python3 fetch_video.py --url https://www.youtube.com/watch?v=XXXX
    python3 fetch_video.py --url ... --no-ticket        # already inside a ticket
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# PINNED. Bumping it is a deliberate act: run one real interview through the new
# version before changing this line, because the failure mode of a bad bump is a
# flow that stops finding audio and says so only from inside a cron.
YT_DLP_VERSION = "2026.8.19"

DATA = Path("/opt/data")
WORKSPACE = DATA / "workspace"
# Scaffolding, not a deliverable: `interno/` is exactly where the audio, the
# metadata and the transcript belong, and the client's Archivos tab does not
# show it. What they read is what `deliverable` saves.
INTERNAL = WORKSPACE / "interno"

# The downloader is fetched once and cached here, next to the work, so the
# second interview of the day does not pay for it again.
UV_CACHE = INTERNAL / ".uv-cache"

# Ten minutes for the whole fetch. A three-minute interview takes seconds; a
# figure this size is what stops a wedged download from eating a cron slot in
# silence -- and silence is what the client reads as "there was nothing new".
FETCH_TIMEOUT = 600
# An interview, not a broadcast day. Above this the agent has to ask which piece
# to work with instead of billing an hour of transcription nobody asked for.
MAX_DURATION_SECONDS = 3 * 3600
MAX_FILESIZE = "500M"

# `uvx` ships in the engine image at this path; the PATH is the fallback. The
# same shape as create_flow.py's `hermes_binary()`, and for the same reason: the
# agent's terminal runs with a sanitized PATH that does not carry /opt/hermes/bin.
UVX_CANDIDATES = ("/usr/local/bin/uvx", "/usr/bin/uvx")
HERMES_CANDIDATES = ("/opt/hermes/bin/hermes", "/opt/hermes/.venv/bin/hermes")


def fail(msg, **extra):
    print(json.dumps({"ok": False, "error": msg, **extra}, ensure_ascii=False))
    return 2


def resolve(candidates, name):
    for path in candidates:
        if os.access(path, os.X_OK):
            return path
    return shutil.which(name)


def open_ticket(title, body, key):
    """Open the interview's ticket through the CLI. Never SQL, never a guess.

    UNASSIGNED ON PURPOSE, which is the opposite of what the portal does when a
    client files work. The portal's ticket is a REQUEST for the dispatcher to
    pick up, so it has to carry an assignee or it sits in `ready` for ever
    (verified trap, 2026-08-04). This one is not a request: the turn that just
    called this script is the one doing the interview, and handing the same work
    to the dispatcher as well would run it twice and bill it twice. What the
    ticket is for is VISIBILITY -- the client watching one interview move
    through their Pipeline -- and if the turn dies before closing it, an
    interview left open on the board is exactly the loud failure we want instead
    of nothing at all.

    Returns (ticket_id, note). A board that cannot be written to is not a reason
    to lose the audio we already have: the note says so and the work goes on.
    """
    binary = resolve(HERMES_CANDIDATES, "hermes")
    if not binary:
        return None, ("no encontré el CLI de Hermes, así que la entrevista no "
                      "quedó como ticket en el tablero: decilo en el chat en vez "
                      "de dar el Pipeline por actualizado")
    try:
        proc = subprocess.run(
            [binary, "kanban", "create", "--json",
             f"--body={body}", f"--idempotency-key={key}", "--", title],
            capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"no pude crear el ticket de la entrevista: {exc}"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-200:]
        return None, f"no pude crear el ticket de la entrevista: {detail}"
    out = proc.stdout or ""
    try:
        data = json.loads(out)
        if isinstance(data, dict) and isinstance(data.get("id"), str):
            return data["id"], ""
    except ValueError:
        pass
    m = re.search(r"^Created\s+(\S+)", out, re.M)
    return (m.group(1) if m else None), ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="el link público de la entrevista")
    ap.add_argument("--dest", default="",
                    help="dónde dejar el material (por defecto workspace/interno/entrevista-<id>)")
    ap.add_argument("--no-ticket", action="store_true", dest="no_ticket",
                    help="no abrir ticket: ya estás trabajando adentro de uno")
    args = ap.parse_args()

    if not re.match(r"^https?://", args.url.strip(), re.I):
        return fail("la entrada tiene que ser un link http(s) a la entrevista")

    uvx = resolve(UVX_CANDIDATES, "uvx")
    if not uvx:
        return fail("no encontré uvx en el contenedor, así que no puedo bajar el "
                    "video: pedile a soporte que lo revise y decíselo al cliente")

    INTERNAL.mkdir(parents=True, exist_ok=True)
    UV_CACHE.mkdir(parents=True, exist_ok=True)
    # Probe first: the id names the folder, so it has to be known before there is
    # a folder. It also settles duration and title before anything is downloaded.
    env = dict(os.environ, UV_CACHE_DIR=str(UV_CACHE))
    base = [uvx, "--from", f"yt-dlp=={YT_DLP_VERSION}", "yt-dlp",
            "--no-playlist", "--no-warnings", "--no-progress",
            "--no-write-subs", "--no-write-auto-subs"]
    try:
        probe = subprocess.run(base + ["--dump-single-json", "--skip-download", args.url],
                               capture_output=True, text=True, timeout=FETCH_TIMEOUT, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return fail(f"no pude leer el video en {FETCH_TIMEOUT}s: {exc}")
    if probe.returncode != 0:
        return fail("no pude abrir ese link como video: "
                    + (probe.stderr or probe.stdout or "").strip()[-300:])
    try:
        info = json.loads(probe.stdout)
    except ValueError:
        return fail("el link respondió algo que no es un video")

    video_id = str(info.get("id") or "")
    if not re.match(r"^[\w.-]{1,64}$", video_id):
        return fail(f"el video vino con un id que no puedo usar como carpeta: {video_id!r}")
    duration = info.get("duration")
    if isinstance(duration, (int, float)) and duration > MAX_DURATION_SECONDS:
        return fail(
            f"el video dura {int(duration) // 60} minutos y el tope es "
            f"{MAX_DURATION_SECONDS // 3600} horas. Preguntale al cliente qué "
            "tramo hay que trabajar en vez de transcribir todo.")

    workdir = Path(args.dest) if args.dest else INTERNAL / f"entrevista-{video_id}"
    workdir.mkdir(parents=True, exist_ok=True)
    audio = workdir / f"{video_id}.mp3"

    try:
        got = subprocess.run(
            base + ["-f", "bestaudio/best", "-x", "--audio-format", "mp3",
                    "--audio-quality", "5", "--max-filesize", MAX_FILESIZE,
                    "-o", str(workdir / "%(id)s.%(ext)s"), args.url],
            capture_output=True, text=True, timeout=FETCH_TIMEOUT, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return fail(f"no pude bajar el audio en {FETCH_TIMEOUT}s: {exc}")
    if got.returncode != 0 or not audio.is_file():
        return fail("no pude bajar el audio de ese video: "
                    + (got.stderr or got.stdout or "").strip()[-300:])

    source = {
        "url": info.get("webpage_url") or args.url,
        "title": info.get("title") or "",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration_seconds": duration,
        "upload_date": info.get("upload_date") or "",
        "video_id": video_id,
    }
    (workdir / "source.json").write_text(
        json.dumps(source, ensure_ascii=False, indent=2), encoding="utf-8")

    ticket, ticket_note = None, ""
    # Already inside a ticket: the dispatcher served one, so a second card for
    # the same interview is the mistake the `approval` skill spells out.
    serving = os.environ.get("HERMES_KANBAN_TASK", "").strip()
    if serving:
        ticket = serving
    elif not args.no_ticket:
        ticket, ticket_note = open_ticket(
            f"Entrevista {source['title'] or video_id} → zócalos",
            f"Fuente: {source['url']}\nCanal: {source['channel']}\n"
            f"Material: {workdir}",
            f"interview:{video_id}")

    result = {
        "ok": True,
        "source": source,
        "audio": str(audio),
        "workdir": str(workdir),
        "ticket": ticket,
        "next": ("python3 /opt/kit/skills/transcribe/transcribe.py "
                 f"--file {audio} --output {workdir / 'transcripcion.txt'}"),
        "note": ("El audio salió del video, NO de los subtítulos automáticos: la "
                 "transcripción la hace transcribe.py. Si te falta algo, marcalo "
                 "con [VERIFICAR CONTRA EL VIDEO]; no lo completes."),
    }
    if ticket_note:
        result["ticket_warning"] = ticket_note
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
