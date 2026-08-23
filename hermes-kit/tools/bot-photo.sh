#!/usr/bin/env bash
# Uploads to the Telegram bot the little face the client chose when naming it.
#
#   ./bot-photo.sh tuagente              # ssh alias named the same as the agent
#   ./bot-photo.sh root@1.2.3.4 east     # when the ssh host is NOT named after the agent
#
# The second argument is the slug, i.e. the directory name on the VPS
# (/opt/agentes/<slug>). It defaults to the same as the ssh host, which is how
# we always log in; it's passed separately when logging in as user@ip.
#
# WHY IT'S A SEPARATE STEP: the Bot API does NOT let a bot change its own
# photo (the name, yes, and the adapter does that on its own when naming it).
# The only way is MTProto, which needs our Telegram app's credentials — and
# those live on the Mac, not on the client's box.
#
# WHEN TO RUN IT: after every naming. Otherwise the client picks their little
# face, sees it in the portal, and on the phone still gets a letter over a
# colored circle (or worse, the previous naming's).
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:-}"
[[ -n "$HOST" ]] || { echo 'usage: ./bot-photo.sh <ssh-host> [slug]' >&2; exit 1; }
SLUG="${2:-$HOST}"
DIR="/opt/agentes/$SLUG"
VENV="$HOME/.tuagente-tools/bin/python3"

[[ -x "$VENV" ]] || { echo "missing the venv with telethon: python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon" >&2; exit 1; }

# Whether the directory exists gets checked FIRST: otherwise the scp below
# fails with the same message for "the client hasn't named it yet" and for
# "the slug is wrong," which are two very different problems.
ssh "$HOST" "[ -d $DIR/data ]" || {
  echo "$DIR/data doesn't exist on $HOST" >&2
  echo "if the agent's directory isn't called '$SLUG', pass it as the second" >&2
  echo "argument:  ./bot-photo.sh $HOST <slug>" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

scp -q "$HOST:$DIR/data/bot_avatar.png" "$tmp/avatar.png" 2>/dev/null || {
  echo "no bot_avatar.png on $HOST — the client hasn't named their agent yet" >&2
  exit 1
}
# The token comes from secrets.env AND NOWHERE ELSE. It went through a phase
# of falling back to `$DIR/data/.env`, and that's letting the agent choose
# which token authenticates an operator tool: data/ is theirs. If this agent
# hasn't migrated yet, this fails and `install.sh` gets run, which moves the
# keys.
ssh "$HOST" "grep -h '^TELEGRAM_BOT_TOKEN=' $DIR/secrets.env 2>/dev/null | head -1" > "$tmp/tg.env"
[[ -s "$tmp/tg.env" ]] || {
  echo "no TELEGRAM_BOT_TOKEN in $DIR/secrets.env." >&2
  echo "If this agent still has its keys in data/.env, run install.sh:" >&2
  echo "it moves them (and explains why they can't live there)." >&2
  exit 1
}
chmod 600 "$tmp/tg.env"

"$VENV" "$KIT/tools/avatar-bot.py" --png "$tmp/avatar.png" --env "$tmp/tg.env"
echo "   (close and reopen the chat in Telegram: the photo stays cached for a while)"
