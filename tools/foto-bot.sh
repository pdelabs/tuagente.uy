#!/usr/bin/env bash
# Sube al bot de Telegram la carita que el cliente eligio en el bautizo.
#
#   ./foto-bot.sh tuagente
#
# POR QUE ES UN PASO APARTE: la Bot API NO permite que un bot cambie su propia
# foto (el nombre si, y eso lo hace el adapter solo al bautizar). La unica via
# es MTProto, que necesita las credenciales de nuestra app de Telegram — y esas
# viven en la Mac, no en la caja del cliente.
#
# CUANDO CORRERLO: despues de cada bautizo. Si no, el cliente elige su carita,
# la ve en el portal, y en el telefono le sigue apareciendo una letra sobre un
# circulo de color (o peor, la del bautizo anterior).
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:-}"
[[ -n "$HOST" ]] || { echo 'uso: ./foto-bot.sh <host-ssh>' >&2; exit 1; }
DIR="/opt/agentes/$HOST"
VENV="$HOME/.tuagente-tools/bin/python3"

[[ -x "$VENV" ]] || { echo "falta el venv con telethon: python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

scp -q "$HOST:$DIR/data/bot_avatar.png" "$tmp/avatar.png" 2>/dev/null || {
  echo "no hay bot_avatar.png en $HOST — el cliente todavia no bautizo a su agente" >&2
  exit 1
}
ssh "$HOST" "grep '^TELEGRAM_BOT_TOKEN=' $DIR/data/.env" > "$tmp/tg.env"
chmod 600 "$tmp/tg.env"

"$VENV" "$KIT/tools/avatar-bot.py" --png "$tmp/avatar.png" --env "$tmp/tg.env"
echo "   (cerrá y abrí el chat en Telegram: la foto queda cacheada un rato)"
