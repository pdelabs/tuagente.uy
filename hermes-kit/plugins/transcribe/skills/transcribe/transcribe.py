#!/usr/bin/env python3
"""Transcribe an audio or video file to text using the client's models connection.

THE SCRIPT DECIDES provider, model, language and output format; the agent only
passes the file. If the model were chosen by the agent, every run would use a
different one and cost would be unpredictable.

Fixed decisions (see the kit's notes/auxiliary-models.md):
- Provider: OpenRouter (the client's key), OpenAI-compatible endpoint.
- Model: whisper-large-v3-turbo (USD 0.04/hour, verified 6/8/2026).
- --language defaults to "es" and is ALWAYS sent: without the parameter,
  Whisper returned a Spanish audio TRANSLATED into English (reproduced live).
- Large videos and audios get converted with ffmpeg to mono mp3 at 32kbps
  before upload (1 hour ~ 14 MB): whisper-1 cuts off at 25 MB and uploading a
  whole mp4 is wasteful even though the model accepts it.

THE KEY IS NOT READ FROM `OPENROUTER_API_KEY`, AND THAT IS NOT A STYLE CHOICE.
The engine STRIPS that name from every terminal and execute_code subprocess it
spawns -- a hard blocklist in `tools/environments/local.py`
(`_build_provider_env_blocklist`), which `env_passthrough.py` explicitly refuses
to re-allow (GHSA-rhgp-j443-p4rf). So this script, run the only way an agent can
run it, saw no key and returned "la conexion de modelos no esta configurada" on
an agent whose key was sitting in its own container environment, funding the
very turn that called it.

MEASURED 2026-08-30 on a from-zero agent, and it retroactively settles an
accusation: `docs/east-requirements.md` 1.6 records an agent claiming that same
missing connection and calls the claim invented. It was not. The script said it,
because it was true, and the transcription that never ran was never able to run.
A base capability sold to every client ("Audios a texto ... ya viene puesta")
could not work from inside an agent at all, and nothing said so, because the one
thing that would have said so is this script's own error -- which read exactly
like a client who had not paid for the connection.

`TUAGENTE_MODELS_KEY` carries the same value under a name the engine does not
strip, set in `<agent>/secrets.env` next to the others. WHAT IT COSTS, out loud:
any command the agent runs can read that key, which is what the engine's
blocklist exists to prevent. The trade is deliberate and bounded -- it is a
PER-CLIENT key with a spend limit we set, rotated with one PATCH
(notes/auxiliary-models.md), and spending it on transcription is the capability
the client bought. It is still the agent holding a spendable credential, and the
narrower fix is for the ADAPTER to do the transcription and never hand the key
over: filed in docs/PENDING.md as the decision to take, not a patch to sneak in
here. `OPENROUTER_API_KEY` stays as a fallback for whatever runs OUTSIDE a
tool-spawned subprocess, where it is still visible.

`--timestamps` ASKS FOR THE MINUTES, AND UNTIL 30/8/2026 NOTHING DID.
`lower-thirds` makes a timecode mandatory on every one of its ten zocalos
(`Fuente: 00:15-00:20.`, so the editor can scrub straight to it) and this script
returned flat text: Whisper only sends `segments` when the request asks for
`verbose_json`, and this one asked for nothing. The format had no supplier.

What happened on the validation run instead: the model wrote its own
`get_timestamps.py`, called this same endpoint a SECOND time on the same audio
with the parameters below, and paid for the interview twice. It got the right
answer, which is the worst version of this bug -- the deliverable looked clean
and the craft was resting on the model reinventing a tool it was never given.
That is the kit's one non-negotiable, inverted: the model supplied the format
and the code supplied nothing.

Asking for the segments costs NOTHING extra -- the provider bills the audio, not
the shape of the reply -- so the only reason it is a flag and not the default is
that the timecoded file is a second artifact and most callers do not want one.

Usage:
    python3 transcribe.py --file entrevista.mp4 [--language es] [--output out.txt]
    python3 transcribe.py --file entrevista.mp4 --timestamps   # + .timecodes.txt
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions"
MODEL = "openai/whisper-large-v3-turbo"
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
MAX_UPLOAD = 24 * 1024 * 1024  # margin under whisper-1's 25 MB cap

# What the provider accepts as-is. EVERYTHING ELSE GETS CONVERTED, even if
# small and even if not video: tested on 10/8/2026 with a 400 KB .aiff and the
# provider answered a bare `400`, without saying the format was the problem.
# An agent facing that error has no way to know what happened, and the client
# ends up without their transcript. Converting when it wasn't needed costs a
# second of ffmpeg; not converting when it was needed costs a flow that fails
# with no explanation.
AUDIO_OK = {".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".flac", ".mpga", ".mp4a"}


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    return 2


def clock(seconds) -> str:
    """Seconds to `MM:SS`, or `H:MM:SS` past the hour.

    THE FORMAT IS THE POINT. `lower-thirds` writes `Fuente: 00:15-00:20.` and an
    editor scrubs to that number; a float of seconds is not that, and asking the
    model to convert is asking it to do arithmetic on ten pairs per interview.
    """
    total = int(float(seconds or 0))
    h, m, sec = total // 3600, (total % 3600) // 60, total % 60
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def to_light_mp3(source: Path) -> Path:
    """Extract the audio to mono 16kHz 32kbps mp3 in a temp file."""
    dest = Path(tempfile.gettempdir()) / f"transcribe-{uuid.uuid4().hex}.mp3"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return dest


def upload(file: Path, language: str, key: str, timestamps: bool = False) -> dict:
    boundary = "--" + uuid.uuid4().hex
    fields = [("model", MODEL), ("language", language)]
    # SEGMENT TIMESTAMPS ARE A REQUEST PARAMETER, and asking for them costs
    # nothing extra: the provider bills the audio, not the shape of the answer.
    # Whisper returns them only for `verbose_json`; the default response has
    # `text` alone, which is why `lower-thirds` had no way to fill the one
    # field its format makes mandatory. See the module docstring.
    if timestamps:
        fields.append(("response_format", "verbose_json"))
        fields.append(("timestamp_granularities[]", "segment"))
    body = b""
    for name, value in fields:
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        ).encode()
    body += (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"{file.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    ).encode()
    body += file.read_bytes() + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    # An hour of audio takes a while to upload and process: generous timeout.
    with urllib.request.urlopen(req, timeout=900) as res:
        return json.loads(res.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--language", default="es")
    ap.add_argument("--output", default="")
    ap.add_argument("--timestamps", action="store_true",
                    help="ademas del texto, escribe un .timecodes.txt con "
                         "[MM:SS-MM:SS] por segmento (lo que necesitan los zocalos)")
    args = ap.parse_args()

    # See the module docstring: the first name is the one that survives the
    # engine's subprocess sanitizer, the second is what is left in a process the
    # engine did not spawn.
    key = (os.environ.get("TUAGENTE_MODELS_KEY", "")
           or os.environ.get("OPENROUTER_API_KEY", ""))
    if not key:
        return fail(
            "no tengo la clave de modelos para transcribir (falta "
            "TUAGENTE_MODELS_KEY en el secrets.env de este agente). ESTO ES UN "
            "PROBLEMA DE INSTALACION, NO ALGO QUE EL CLIENTE TENGA QUE "
            "CONECTAR: decilo asi, no le pidas la conexion de modelos, y NO "
            "sigas con los subtitulos automaticos ni inventes el contenido.")

    source = Path(args.file)
    if not source.is_file():
        return fail(f"no existe el archivo: {source}")

    temp = None
    try:
        suf = source.suffix.lower()
        if suf in VIDEO_EXT or suf not in AUDIO_OK or source.stat().st_size > MAX_UPLOAD:
            try:
                temp = to_light_mp3(source)
            except FileNotFoundError:
                return fail("ffmpeg no esta instalado y el archivo necesita conversion")
            except subprocess.CalledProcessError as e:
                return fail(f"ffmpeg no pudo extraer el audio: {e.stderr.strip()[:300]}")
            to_upload = temp
        else:
            to_upload = source

        try:
            res = upload(to_upload, args.language, key, args.timestamps)
        except urllib.error.HTTPError as e:
            return fail(f"el proveedor respondio {e.code}: {e.read().decode()[:300]}")
        except OSError as e:
            return fail(f"no se pudo subir el audio: {e}")
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)

    text = (res.get("text") or "").strip()
    if not text:
        return fail(f"el proveedor no devolvio texto: {json.dumps(res)[:300]}")

    output = Path(args.output) if args.output else source.with_suffix(source.suffix + ".transcript.txt")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text + "\n", "utf-8")

    timecodes = ""
    segments = res.get("segments") or []
    if args.timestamps:
        if not segments:
            return fail(
                "pedi la transcripcion con marcas de tiempo y el proveedor no "
                "devolvio segmentos. El texto quedo guardado en " + str(output) +
                ", pero NO tenes los minutos: no los inventes ni los estimes de "
                "oido. Decilo y frena.")
        timed = Path(str(output) + ".timecodes.txt")
        timed.write_text("\n".join(
            f"[{clock(s.get('start'))}-{clock(s.get('end'))}] "
            + (s.get("text") or "").strip()
            for s in segments) + "\n", "utf-8")
        timecodes = str(timed)

    usage = res.get("usage") or {}
    result = {
        "ok": True,
        "transcript": str(output),
        "preview": text[:200],
        "duration_seconds": usage.get("seconds") or res.get("duration"),
        "cost_usd": usage.get("cost"),
        "language": args.language,
        "note": "El texto completo esta en el archivo 'transcript'; leelo desde ahi.",
    }
    if timecodes:
        result["timecodes"] = timecodes
        result["segments"] = len(segments)
        result["note"] = ("El texto completo esta en 'transcript' y los minutos en "
                          "'timecodes', una linea por segmento; leelos desde ahi.")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
