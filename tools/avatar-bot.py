#!/usr/bin/env python3
"""Sube la foto de perfil de un bot de Telegram (el agentito que eligio el cliente).

La Bot API NO permite que un bot cambie su propia foto (solo BotFather a mano).
La salida es MTProto: Telethon logueado COMO EL BOT (con su token) puede llamar
photos.UploadProfilePhotoRequest. Requiere las credenciales de API de tuagente
(api_id + api_hash de https://my.telegram.org — tramite unico, gratis).

Corre en el HOST (no en el agente): telethon no viene en la imagen de Hermes y
la foto se cambia una vez por bautizo, no vale una dependencia permanente.

Preparacion (una vez):
    python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon
    # y guardar {"api_id": ..., "api_hash": "..."} en
    # tuagente.uy/.secrets/telegram_api.json

Uso:
    ~/.tuagente-tools/bin/python3 avatar-bot.py \
        --png /ruta/agente/data/bot_avatar.png \
        --env /ruta/agente/data/.env      # de aca sale TELEGRAM_BOT_TOKEN
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

SECRETS = Path.home() / "Desktop/Luis/Projects/tuagente.uy/.secrets"
API_JSON = SECRETS / "telegram_api.json"


def token_de_env(ruta):
    m = re.search(r"^TELEGRAM_BOT_TOKEN=(.+)$", Path(ruta).read_text(), re.M)
    if not m:
        sys.exit("ese .env no tiene TELEGRAM_BOT_TOKEN")
    return m.group(1).strip()


async def subir(api_id, api_hash, token, png):
    from telethon import TelegramClient
    from telethon.tl.functions.photos import UploadProfilePhotoRequest
    # Una sesion por bot, en .secrets: no pide telefono (login de bot).
    sesion = SECRETS / f"bot-{token.split(':')[0]}"
    client = TelegramClient(str(sesion), api_id, api_hash)
    await client.start(bot_token=token)
    await client(UploadProfilePhotoRequest(file=await client.upload_file(png)))
    yo = await client.get_me()
    print(f"Foto subida a @{yo.username}")
    await client.disconnect()


def _tiene_alfa(png: Path) -> bool:
    """True si el PNG tiene pixeles REALMENTE transparentes.

    Telegram no soporta alfa en las fotos de perfil: la aplasta contra NEGRO.
    Una carita clara recortada sobre un cuadrado negro se descubre mirando el
    telefono, no el log — y ahi ya la vio el cliente.

    OJO CON EL ATAJO: mirar el color type del IHDR NO sirve. Un canvas de
    browser SIEMPRE exporta RGBA, tenga o no transparencia, asi que ese
    chequeo grita en todas las fotos —incluidas las correctas— y un aviso que
    grita siempre se ignora. Hay que mirar los pixeles.

    Sin Pillow no se avisa nada: mejor callado que dando alarmas falsas.
    """
    try:
        from PIL import Image
    except ImportError:
        return False
    try:
        with Image.open(png) as im:
            if im.mode not in ("RGBA", "LA", "PA"):
                return False
            alfa = im.convert("RGBA").getchannel("A")
            return (alfa.getextrema() or (255, 255))[0] < 250
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--env", required=True, help=".env del agente (para el token)")
    args = ap.parse_args()

    if not API_JSON.is_file():
        sys.exit(f"faltan las credenciales de my.telegram.org en {API_JSON} "
                 '(formato: {"api_id": 123, "api_hash": "..."})')
    creds = json.loads(API_JSON.read_text())
    png = Path(args.png)
    if _tiene_alfa(png):
        print("AVISO: el PNG tiene transparencia. Telegram la aplasta contra "
              "NEGRO en las fotos de perfil — la cara va a quedar recortada "
              "sobre un cuadrado negro. Componela sobre un fondo opaco antes.",
              file=sys.stderr)
    if not png.is_file() or not png.read_bytes().startswith(b"\x89PNG"):
        sys.exit("el PNG no existe o no es un PNG")
    asyncio.run(subir(creds["api_id"], creds["api_hash"],
                      token_de_env(args.env), str(png)))


if __name__ == "__main__":
    main()
