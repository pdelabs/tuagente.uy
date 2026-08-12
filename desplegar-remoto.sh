#!/usr/bin/env bash
# Prepara una VPS para el agente de un cliente y le sube el kit.
#
#   ./desplegar-remoto.sh east root@1.2.3.4 agentes.tuagente.uy
#                         ^slug ^servidor    ^dominio base
#
# EL AGENTE NO SE NOMBRA ACA. El nombre se lo pone el CLIENTE en el bautizo,
# en el primer paso del onboarding del portal. Hasta entonces dice "Agente".
# (El 10/8 le pase "Washi" —el agente de pdelabs— y quedo con el nombre de
# otro cliente esperando a que Cata lo bautizara.)
#
# Deja el agente ARMADO PERO APAGADO: falta cargar data/.env con las claves y
# que el DNS resuelva. Arrancar sin DNS quema intentos de Let's Encrypt, que
# tiene tope semanal — por eso no levanta nada solo.
#
# Idempotente: si el directorio ya existe, actualiza el kit y no pisa .env.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; SERVIDOR="${2:-}"; DOMINIO_BASE="${3:-}"
NOMBRE="Agente"   # placeholder hasta el bautizo; ver la nota de arriba

if [[ -z "$SLUG" || -z "$SERVIDOR" || -z "$DOMINIO_BASE" ]]; then
  echo 'uso: ./desplegar-remoto.sh <slug> <usuario@ip> <dominio-base>' >&2
  echo 'ej:  ./desplegar-remoto.sh east root@1.2.3.4 agentes.tuagente.uy' >&2
  exit 1
fi

[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "slug inválido: minúsculas, números y guiones" >&2; exit 1; }

REMOTO="/opt/agentes/$SLUG"
DOMINIO_API="$SLUG.$DOMINIO_BASE"
DOMINIO_PORTAL="$SLUG-portal.$DOMINIO_BASE"

echo "→ agente   $SLUG (sin bautizar — lo nombra el cliente)"
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
ssh "$SERVIDOR" "mkdir -p $REMOTO/data/skills $REMOTO/data/scripts $REMOTO/kit-skills $REMOTO/politica/tools"

# ── 3. El kit ─────────────────────────────────────────────────────────────
echo "→ subiendo el kit"
# Las skills del kit van a kit-skills/, NO a data/skills/: el compose las monta
# :ro en /opt/kit/skills y el config las declara en `skills.external_dirs`. Si
# subieran a data/ el agente podria reescribirlas y el curator archivarlas, y
# ademas taparian a las externas (gana el arbol local) dejando el montaje sin
# efecto. El --delete es contra kit-skills/, que es NUESTRO: ahi no hay nada
# del cliente.
rsync -a --delete "$KIT/skills/"            "$SERVIDOR:$REMOTO/kit-skills/"
rsync -a          "$KIT/adapter/portal_adapter.py" "$SERVIDOR:$REMOTO/data/scripts/"
rsync -a          "$KIT/compose/docker-compose.remoto.yml" "$SERVIDOR:$REMOTO/docker-compose.yml"
rsync -a          "$KIT/compose/Caddyfile"  "$SERVIDOR:$REMOTO/Caddyfile"

# EL config.yaml, QUE FALTABA Y ROMPIA TODO. Sin el, Hermes escribe en el
# primer arranque su config de EJEMPLO (86 KB, todo comentado) y arranca con
# los defaults: sin `api_server.enabled` NUNCA bindea el 8642, asi que Caddy
# devuelve 502 para siempre y el sintoma parece de red. Verificado el 10/8 con
# East: el gateway "arrancaba" y no escuchaba nada.
# No se pisa si ya existe: despues del primer arranque Hermes lo migra solo.
if ! ssh "$SERVIDOR" "grep -q 'enabled: true' $REMOTO/data/config.yaml 2>/dev/null"; then
  rsync -a "$KIT/compose/config.base.yaml" "$SERVIDOR:$REMOTO/data/config.yaml"
  echo "→ config.yaml base instalado"
else
  echo "→ config.yaml ya configurado, no lo toco"
fi
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
rsync -a "$KIT/tools/parche-pairing.py"      "$SERVIDOR:$REMOTO/politica/"
rsync -a "$KIT/tools/cont-init-parches.sh"  "$SERVIDOR:$REMOTO/politica/"
ssh "$SERVIDOR" "chmod +x $REMOTO/politica/cont-init-parches.sh"
for m in "$KIT"/connections/*/mcp; do
  [[ -d "$m" ]] || continue
  conexion="$(basename "$(dirname "$m")")"
  ssh "$SERVIDOR" "mkdir -p $REMOTO/politica/mcp/$conexion"
  rsync -a --exclude __pycache__ "$m/" "$SERVIDOR:$REMOTO/politica/mcp/$conexion/"
done
ssh "$SERVIDOR" "[ -s $REMOTO/politica/politica.json ] || echo '{}' > $REMOTO/politica/politica.json"

# EL SOUL, QUE TAMPOCO SE INSTALABA. Sin el, el agente corre con los ~800 bytes
# del preambulo de Nous y nada mas: sin regla de aprobacion, sin convenciones de
# entrega, sin idioma — y contesta como un asistente generico. Se instalan los
# cinco bloques genericos, que podemos completar solos; `00-identidad.md` queda
# para la persona que da de alta al cliente.
# Los dos argumentos: por donde entra el ssh y como se llama el directorio del
# agente. Aca no coinciden —el ssh va a usuario@ip y el agente vive en
# /opt/agentes/$SLUG— y con uno solo el SOUL no se instalaba.
"$KIT/tools/instalar-soul.sh" "$SERVIDOR" "$SLUG" || echo "   (el SOUL no se instalo; revisar a mano)"

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
           --origin   https://tuagente.uy

  5. Despues del bautizo, la foto del bot (la Bot API no deja que un bot
     cambie la suya, va por MTProto desde tu Mac):
       tools/foto-bot.sh $SLUG

  6. El link, que ES la credencial:
       https://tuagente.uy/app#endpoint=https://$DOMINIO_API&adapter=https://$DOMINIO_PORTAL&key=<clave>
EOF
