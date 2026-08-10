#!/usr/bin/env python3
"""Transcribe un audio o video a texto con la conexion de modelos del cliente.

EL SCRIPT DECIDE proveedor, modelo, idioma y formato de salida; el agente solo
pasa el archivo. Si el modelo lo eligiera el agente, cada corrida usaria uno
distinto y el costo seria impredecible.

Decisiones fijadas (ver notas/modelos-auxiliares.md del kit):
- Proveedor: OpenRouter (la key del cliente), endpoint OpenAI-compatible.
- Modelo: whisper-large-v3-turbo (USD 0.04/hora, verificado 6/8/2026).
- --idioma default "es" y SIEMPRE se manda: sin el parametro, Whisper devolvio
  un audio en espanol TRADUCIDO al ingles (reproducido en vivo).
- Videos y audios grandes se convierten con ffmpeg a mp3 mono 32kbps antes de
  subir (1 hora ~ 14 MB): whisper-1 corta en 25 MB y subir un mp4 entero es
  desperdicio aunque el modelo lo acepte.

Uso:
    python3 transcribir.py --archivo entrevista.mp4 [--idioma es] [--salida out.txt]
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
MODELO = "openai/whisper-large-v3-turbo"
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
MAX_SUBIDA = 24 * 1024 * 1024  # margen bajo el limite de 25 MB de whisper-1

# Lo que el proveedor acepta tal cual. TODO LO DEMAS SE CONVIERTE, aunque sea
# chico y aunque no sea video: probado el 10/8/2026 con un .aiff de 400 KB y el
# proveedor contesto un `400` pelado, sin decir que el formato era el problema.
# Un agente frente a ese error no tiene como saber que le pasa, y el cliente se
# queda sin su transcripcion. Convertir de mas cuesta un segundo de ffmpeg;
# convertir de menos cuesta un flujo que falla sin explicacion.
AUDIO_OK = {".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".flac", ".mpga", ".mp4a"}


def fallo(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    return 2


def a_mp3_liviano(origen: Path) -> Path:
    """Extrae el audio a mp3 mono 16kHz 32kbps en un temporal."""
    destino = Path(tempfile.gettempdir()) / f"transcribir-{uuid.uuid4().hex}.mp3"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(origen), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        str(destino),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return destino


def subir(archivo: Path, idioma: str, key: str) -> dict:
    limite = "--" + uuid.uuid4().hex
    campos = [("model", MODELO), ("language", idioma)]
    cuerpo = b""
    for nombre, valor in campos:
        cuerpo += (
            f"--{limite}\r\nContent-Disposition: form-data; name=\"{nombre}\"\r\n\r\n{valor}\r\n"
        ).encode()
    cuerpo += (
        f"--{limite}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"{archivo.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    ).encode()
    cuerpo += archivo.read_bytes() + f"\r\n--{limite}--\r\n".encode()

    req = urllib.request.Request(
        ENDPOINT,
        data=cuerpo,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={limite}",
        },
        method="POST",
    )
    # Una hora de audio tarda en subir y procesar: timeout generoso.
    with urllib.request.urlopen(req, timeout=900) as res:
        return json.loads(res.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", required=True)
    ap.add_argument("--idioma", default="es")
    ap.add_argument("--salida", default="")
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        return fallo("falta OPENROUTER_API_KEY: la conexion de modelos no esta configurada")

    origen = Path(args.archivo)
    if not origen.is_file():
        return fallo(f"no existe el archivo: {origen}")

    temporal = None
    try:
        suf = origen.suffix.lower()
        if suf in VIDEO_EXT or suf not in AUDIO_OK or origen.stat().st_size > MAX_SUBIDA:
            try:
                temporal = a_mp3_liviano(origen)
            except FileNotFoundError:
                return fallo("ffmpeg no esta instalado y el archivo necesita conversion")
            except subprocess.CalledProcessError as e:
                return fallo(f"ffmpeg no pudo extraer el audio: {e.stderr.strip()[:300]}")
            a_subir = temporal
        else:
            a_subir = origen

        try:
            res = subir(a_subir, args.idioma, key)
        except urllib.error.HTTPError as e:
            return fallo(f"el proveedor respondio {e.code}: {e.read().decode()[:300]}")
        except OSError as e:
            return fallo(f"no se pudo subir el audio: {e}")
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)

    texto = (res.get("text") or "").strip()
    if not texto:
        return fallo(f"el proveedor no devolvio texto: {json.dumps(res)[:300]}")

    salida = Path(args.salida) if args.salida else origen.with_suffix(origen.suffix + ".transcripcion.txt")
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(texto + "\n", "utf-8")

    uso = res.get("usage") or {}
    print(json.dumps({
        "ok": True,
        "transcripcion": str(salida),
        "vistazo": texto[:200],
        "duracion_segundos": uso.get("seconds"),
        "costo_usd": uso.get("cost"),
        "idioma": args.idioma,
        "nota": "El texto completo esta en el archivo 'transcripcion'; leelo desde ahi.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
