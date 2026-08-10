#!/usr/bin/env bash
# Prepara una VPS para el agente de un cliente y le sube el kit.
#
#   ./desplegar-remoto.sh east "Washi" root@1.2.3.4 agentes.tuagente.uy
#                         ^slug ^nombre  ^servidor   ^dominio base
#
# Deja el agente ARMADO PERO APAGADO: falta cargar data/.env con las claves y
# que el DNS resuelva. Arrancar sin DNS quema intentos de Let's Encrypt, que
# tiene tope semanal — por eso no levanta nada solo.
#
# Idempotente: si el directorio ya existe, actualiza el kit y no pisa .env.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; NOMBRE="${2:-}"; SERVIDOR="${3:-}"; DOMINIO_BASE="${4:-}"

if [[ -z "$SLUG" || -z "$NOMBRE" || -z "$SERVIDOR" || -z "$DOMINIO_BASE" ]]; then
  echo 'uso: ./desplegar-remoto.sh <slug> "<Nombre>" <usuario@ip> <dominio-base>' >&2
  echo 'ej:  ./desplegar-remoto.sh east "Washi" root@1.2.3.4 agentes.tuagente.uy' >&2
  exit 1
fi

[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "slug inválido: minúsculas, números y guiones" >&2; exit 1; }

REMOTO="/opt/agentes/$SLUG"
DOMINIO_API="$SLUG.$DOMINIO_BASE"
DOMINIO_PORTAL="$SLUG-portal.$DOMINIO_BASE"

echo "→ agente   $SLUG ($NOMBRE)"
echo "→ servidor $SERVIDOR:$REMOTO"
echo "→ api      https://$DOMINIO_API"
echo "→ portal   https://$DOMINIO_PORTAL"
echo

ssh -o ConnectTimeout=10 "$SERVIDOR" true || { echo "no llego por ssh a $SERVIDOR" >&2; exit 1; }

# ── 1. Docker y firewall ──────────────────────────────────────────────────
# El firewall se cierra ANTES de que exista nada escuchando, no después.
# Ojo: `docker publish` escribe en iptables por debajo de ufw, así que un
# puerto publicado queda abierto AUNQUE ufw diga que no. Por eso el compose
# remoto no publica nada salvo Caddy: la defensa real es no abrir, no el ufw.
ssh "$SERVIDOR" 'bash -se' <<'REMOTO_SCRIPT'
set -euo pipefail
if ! command -v docker >/dev/null; then
  echo "  instalando docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
if command -v ufw >/dev/null; then
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  for p in 22 80 443; do ufw allow "$p"/tcp >/dev/null; done
  ufw --force enable >/dev/null
  echo "  ufw: 22, 80, 443"
fi
mkdir -p /opt/agentes
REMOTO_SCRIPT

# ── 2. Estructura ─────────────────────────────────────────────────────────
ssh "$SERVIDOR" "mkdir -p $REMOTO/data/skills $REMOTO/data/scripts $REMOTO/politica/tools"

# ── 3. El kit ─────────────────────────────────────────────────────────────
echo "→ subiendo el kit"
rsync -a --delete "$KIT/skills/"            "$SERVIDOR:$REMOTO/data/skills/"
rsync -a          "$KIT/adapter/portal_adapter.py" "$SERVIDOR:$REMOTO/data/scripts/"
rsync -a          "$KIT/compose/docker-compose.remoto.yml" "$SERVIDOR:$REMOTO/docker-compose.yml"
rsync -a          "$KIT/compose/Caddyfile"  "$SERVIDOR:$REMOTO/Caddyfile"
ssh "$SERVIDOR" "mkdir -p $REMOTO/data/connections"
rsync -a "$KIT/connections/catalogo.json" "$SERVIDOR:$REMOTO/data/connections/"

# Un tools.json por conexión, con el nombre de la carpeta: es como los busca la
# guardia (GUARDIA_TOOLS=/opt/politica/tools/<conexion>.json).
for c in "$KIT"/connections/*/tools.json; do
  [[ -f "$c" ]] || continue
  rsync -a "$c" "$SERVIDOR:$REMOTO/politica/tools/$(basename "$(dirname "$c")").json"
done

# LA GUARDIA Y LOS SERVIDORES REALES VAN A politica/, que se monta :ro en el
# contenedor del agente. Si vivieran en data/ el agente podría editarlos, y
# entonces le alcanzaría con sacar la guardia del medio y llamar al servidor
# directo. (Faltaba: la primera corrida del script subió solo los tools.json y
# la guardia quedó sin subir.)
rsync -a "$KIT/mcp-guardia/guardia.py" "$SERVIDOR:$REMOTO/politica/guardia.py"
for m in "$KIT"/connections/*/mcp; do
  [[ -d "$m" ]] || continue
  conexion="$(basename "$(dirname "$m")")"
  ssh "$SERVIDOR" "mkdir -p $REMOTO/politica/mcp/$conexion"
  rsync -a --exclude __pycache__ "$m/" "$SERVIDOR:$REMOTO/politica/mcp/$conexion/"
done
ssh "$SERVIDOR" "[ -s $REMOTO/politica/politica.json ] || echo '{}' > $REMOTO/politica/politica.json"

# EL PRIMER ARRANQUE VA SIN EL CANDADO DE config.yaml, y no es opcional: el
# archivo todavía NO EXISTE, y Docker, al montar algo inexistente, crea un
# DIRECTORIO con ese nombre. Hermes entonces no puede escribir su config y el
# agente no levanta. Se sube comentado y se cierra después del primer arranque
# con tools/cerrar-config.sh.
ssh "$SERVIDOR" "sed -i 's|^\\( *\\)- \\./data/config\\.yaml:/opt/data/config\\.yaml:ro|\\1# PRIMER ARRANQUE: descomentar con tools/cerrar-config.sh|' $REMOTO/docker-compose.yml"

# ── 4. El .env del compose (sin secretos) ─────────────────────────────────
ssh "$SERVIDOR" "cat > $REMOTO/.env" <<EOF
CLIENTE=$SLUG
AGENT_NAME=$NOMBRE
DOMINIO_API=$DOMINIO_API
DOMINIO_PORTAL=$DOMINIO_PORTAL
EMAIL_TLS=soporte@tuagente.uy
EOF

# ── 5. data/.env — plantilla, NUNCA se sube con claves desde acá ───────────
# Las claves se cargan a mano en el servidor. Subirlas por rsync las deja en
# el historial del shell local y en cualquier backup del portátil.
if ssh "$SERVIDOR" "[ -s $REMOTO/data/.env ]"; then
  echo "→ data/.env ya existe, no lo toco"
else
  ssh "$SERVIDOR" "cat > $REMOTO/data/.env" <<'EOF'
API_SERVER_KEY=
OPENROUTER_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
EOF
  ssh "$SERVIDOR" "chmod 600 $REMOTO/data/.env"
  echo "→ data/.env creado VACÍO — hay que completarlo en el servidor"
fi

cat <<EOF

Listo, y apagado a propósito. Falta:

  1. DNS (en Vercel, tuagente.uy):
       $DOMINIO_API      A  -> la IP de la VPS
       $DOMINIO_PORTAL   A  -> la misma IP
     Verificar que resuelva ANTES de levantar:
       dig +short $DOMINIO_API

  2. Las claves, en el servidor (no desde acá):
       ssh $SERVIDOR
       openssl rand -hex 32          # la API_SERVER_KEY, única de este cliente
       nano $REMOTO/data/.env

  3. Levantar:
       ssh $SERVIDOR 'cd $REMOTO && docker compose up -d'

  4. Verificar, y son 0 fallas o no se entrega:
       python3 tools/portal-check.py --key <clave> \\
           --endpoint https://$DOMINIO_API \\
           --adapter  https://$DOMINIO_PORTAL \\
           --origin   https://app.tuagente.uy

  5. El link, que ES la credencial:
       https://app.tuagente.uy/app#endpoint=https://$DOMINIO_API&adapter=https://$DOMINIO_PORTAL&key=<clave>
EOF
