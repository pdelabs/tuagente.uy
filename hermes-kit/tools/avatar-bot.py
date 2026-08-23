#!/usr/bin/env python3
"""Uploads a Telegram bot's profile photo (the agentito face the client picked).

The Bot API does NOT let a bot change its own photo (only BotFather, by hand).
The way out is MTProto: Telethon logged in AS THE BOT (with its token) can call
photos.UploadProfilePhotoRequest. Requires tuagente's own API credentials
(api_id + api_hash from https://my.telegram.org — a one-time, free
procedure).

Runs on the HOST (not inside the agent): telethon doesn't ship in Hermes's
image and the photo only changes once per naming, not worth a permanent
dependency.

Setup (once):
    python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon
    # and save {"api_id": ..., "api_hash": "..."} to
    # tuagente.uy/.secrets/telegram_api.json
    # to draw on its own (without --png): cd hermes-kit/tools && npm install

Usage — with a PNG already captured (the portal's):
    ~/.tuagente-tools/bin/python3 avatar-bot.py \
        --png /path/agent/data/bot_avatar.png \
        --env /path/agent/data/.env      # this is where TELEGRAM_BOT_TOKEN comes from

Usage — drawing it on its own, with no portal or browser (draw-agentito.mjs):
    ~/.tuagente-tools/bin/python3 avatar-bot.py \
        --role assistant --agent /path/agent \
        --env /path/agent/data/.env
    # --role alone: the catalog's face. --agent too: the client's naming.
"""
import argparse
import asyncio
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SECRETS = Path.home() / "Desktop/Luis/Projects/tuagente.uy/.secrets"
API_JSON = SECRETS / "telegram_api.json"
DRAW = Path(__file__).resolve().parent / "draw-agentito.mjs"


def token_from_env(path):
    m = re.search(r"^TELEGRAM_BOT_TOKEN=(.+)$", Path(path).read_text(), re.M)
    if not m:
        sys.exit("that .env has no TELEGRAM_BOT_TOKEN")
    return m.group(1).strip()


async def upload(api_id, api_hash, token, png):
    from telethon import TelegramClient
    from telethon.tl.functions.photos import UploadProfilePhotoRequest
    # One session per bot, in .secrets: doesn't ask for a phone number (bot login).
    session = SECRETS / f"bot-{token.split(':')[0]}"
    client = TelegramClient(str(session), api_id, api_hash)
    await client.start(bot_token=token)
    await client(UploadProfilePhotoRequest(file=await client.upload_file(png)))
    me = await client.get_me()
    print(f"Photo uploaded to @{me.username}")
    await client.disconnect()


def _has_alpha(png: Path) -> bool:
    """True if the PNG has pixels that are REALLY transparent.

    Telegram doesn't support alpha in profile photos: it flattens it against
    BLACK. A light face cut out over a black square gets discovered by
    looking at the phone, not the log — and by then the client has already
    seen it.

    WATCH OUT FOR THE SHORTCUT: looking at the IHDR's color type doesn't
    work. A browser canvas ALWAYS exports RGBA, whether it has transparency
    or not, so that check screams on every photo —including the correct
    ones— and a warning that always screams gets ignored. You have to look at
    the pixels.

    Without Pillow, nothing gets reported: better silent than raising false
    alarms.
    """
    try:
        from PIL import Image
    except ImportError:
        return False
    try:
        with Image.open(png) as im:
            if im.mode not in ("RGBA", "LA", "PA"):
                return False
            alpha = im.convert("RGBA").getchannel("A")
            return (alpha.getextrema() or (255, 255))[0] < 250
    except Exception:
        return False


def draw(role, agent, dest):
    """Draw the face with the headless tool: the telegram preset already lands
    on 512px with a solid background, so the alpha warning below never fires."""
    cmd = ["node", str(DRAW), "--for", "telegram", "--png", str(dest)]
    if role:
        cmd += ["--role", role]
    if agent:
        cmd += ["--agent", agent]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", help="PNG already ready (the one the portal captured)")
    ap.add_argument("--role", help="draws that role's face with draw-agentito.mjs")
    ap.add_argument("--agent", help="agent path: uses the naming from policy/roles/identities.json")
    ap.add_argument("--env", required=True, help="the agent's .env (for the token)")
    args = ap.parse_args()

    if not API_JSON.is_file():
        sys.exit(f"missing the my.telegram.org credentials at {API_JSON} "
                 '(format: {"api_id": 123, "api_hash": "..."})')
    creds = json.loads(API_JSON.read_text())

    if args.png:
        png = Path(args.png)
    elif args.role or args.agent:
        png = Path(tempfile.mkdtemp()) / "agentito.png"
        draw(args.role, args.agent, png)
    else:
        sys.exit("missing the face: --png <file>, or --role/--agent to draw it on its own")

    if _has_alpha(png):
        print("WARNING: the PNG has transparency. Telegram flattens it against "
              "BLACK on profile photos — the face is going to end up cut out "
              "over a black square. Composite it over an opaque background first.",
              file=sys.stderr)
    if not png.is_file() or not png.read_bytes().startswith(b"\x89PNG"):
        sys.exit("the PNG doesn't exist or isn't a PNG")
    asyncio.run(upload(creds["api_id"], creds["api_hash"],
                      token_from_env(args.env), str(png)))


if __name__ == "__main__":
    main()
