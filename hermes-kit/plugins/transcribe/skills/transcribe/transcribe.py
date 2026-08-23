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

Usage:
    python3 transcribe.py --file entrevista.mp4 [--language es] [--output out.txt]
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


def upload(file: Path, language: str, key: str) -> dict:
    boundary = "--" + uuid.uuid4().hex
    fields = [("model", MODEL), ("language", language)]
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
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        return fail("falta OPENROUTER_API_KEY: la conexion de modelos no esta configurada")

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
            res = upload(to_upload, args.language, key)
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

    usage = res.get("usage") or {}
    print(json.dumps({
        "ok": True,
        "transcript": str(output),
        "preview": text[:200],
        "duration_seconds": usage.get("seconds"),
        "cost_usd": usage.get("cost"),
        "language": args.language,
        "note": "El texto completo esta en el archivo 'transcript'; leelo desde ahi.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
