#!/usr/bin/env bash
# Sube al bot de Telegram la carita que el cliente eligio en el bautizo.
#
#   ./foto-bot.sh tuagente              # alias ssh que se llama como el agente
#   ./foto-bot.sh root@1.2.3.4 east     # cuando el host ssh NO se llama como el agente
#
# El segundo argumento es el slug, o sea el nombre del directorio en la VPS
# (/opt/agentes/<slug>). Por defecto es el mismo que el host ssh, que es como
# entramos siempre; se pasa aparte cuando se entra por usuario@ip.
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
[[ -n "$HOST" ]] || { echo 'uso: ./foto-bot.sh <host-ssh> [slug]' >&2; exit 1; }
SLUG="${2:-$HOST}"
DIR="/opt/agentes/$SLUG"
VENV="$HOME/.tuagente-tools/bin/python3"

[[ -x "$VENV" ]] || { echo "falta el venv con telethon: python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon" >&2; exit 1; }

# Que el directorio exista se pregunta ANTES: si no, el scp de abajo falla con
# el mismo mensaje para "el cliente no bautizo todavia" y para "el slug esta
# mal", que son dos problemas muy distintos.
ssh "$HOST" "[ -d $DIR/data ]" || {
  echo "no existe $DIR/data en $HOST" >&2
  echo "si el directorio del agente no se llama '$SLUG', pasalo como segundo" >&2
  echo "argumento:  ./foto-bot.sh $HOST <slug>" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

scp -q "$HOST:$DIR/data/bot_avatar.png" "$tmp/avatar.png" 2>/dev/null || {
  echo "no hay bot_avatar.png en $HOST — el cliente todavia no bautizo a su agente" >&2
  exit 1
}
# El token sale de secretos.env Y DE NINGUN OTRO LADO. Estuvo un rato con
# `$DIR/data/.env` de respaldo y eso es dejar que el agente elija con que token
# se autentica una herramienta del operador: data/ es suya. Si el agente no
# migro todavia, esto falla y se corre `install.sh`, que mueve las claves.
ssh "$HOST" "grep -h '^TELEGRAM_BOT_TOKEN=' $DIR/secretos.env 2>/dev/null | head -1" > "$tmp/tg.env"
[[ -s "$tmp/tg.env" ]] || {
  echo "no hay TELEGRAM_BOT_TOKEN en $DIR/secretos.env." >&2
  echo "Si este agente todavia tiene las claves en data/.env, corré install.sh:" >&2
  echo "las mueve (y explica por que no pueden vivir ahi)." >&2
  exit 1
}
chmod 600 "$tmp/tg.env"

"$VENV" "$KIT/tools/avatar-bot.py" --png "$tmp/avatar.png" --env "$tmp/tg.env"
echo "   (cerrá y abrí el chat en Telegram: la foto queda cacheada un rato)"
