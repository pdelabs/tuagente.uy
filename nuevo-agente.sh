#!/usr/bin/env bash
# Crea el esqueleto de un agente para un cliente nuevo y le instala el kit.
#
#   ./nuevo-agente.sh acme "Acme SA" ~/Desktop/Luis/Projects/agente-acme
#                     ^slug ^nombre visible del agente   ^dónde crearlo
#
# Deja todo listo salvo lo artesanal: escribir el SOUL y cargar las claves.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; NOMBRE="${2:-}"; DESTINO="${3:-}"

if [[ -z "$SLUG" || -z "$NOMBRE" || -z "$DESTINO" ]]; then
  echo 'uso: ./nuevo-agente.sh <slug> "<Nombre del agente>" <ruta>' >&2
  exit 2
fi
if [[ -e "$DESTINO" ]]; then
  echo "Ya existe $DESTINO — no piso nada." >&2
  exit 2
fi

# La version del bloque de SOUL se valida ACA, antes de crear nada: si no tiene
# forma de version, el marcador sale mal y `agente-check.py` lo reporta como
# marcadores desbalanceados, que manda a buscar el problema a otro lado. Y si
# esto muriera despues del mkdir, quedaria un agente a medio armar.
[[ -f "$KIT/soul/VERSION" ]] || {
  echo "falta $KIT/soul/VERSION, que dice qué versión del bloque instala el kit." >&2
  echo "Es una línea con la versión (vN): echo v2 > $KIT/soul/VERSION" >&2
  exit 2
}
SOUL_VERSION="$(tr -d '[:space:]' < "$KIT/soul/VERSION")"
[[ "$SOUL_VERSION" =~ ^v[0-9]+$ ]] || {
  echo "soul/VERSION dice '$SOUL_VERSION' y tiene que ser vN (v1, v2, v3…)." >&2
  exit 2
}

mkdir -p "$DESTINO/data"/{skills,scripts,memories,workspace/{entregables,artifacts,entrada,interno}}
cd "$DESTINO"

# Compose, con el slug y el nombre ya reemplazados.
sed -e "s/\${CLIENTE}/$SLUG/g" -e "s/\${AGENT_NAME}/$NOMBRE/g" \
    "$KIT/compose/docker-compose.example.yml" > docker-compose.yml

cat > data/.env.example <<'ENV'
# Copiar a data/.env y completar. NUNCA se commitea.
API_SERVER_KEY=          # openssl rand -hex 32 — única por cliente
OPENROUTER_API_KEY=      # o la del proveedor de modelos que uses
TELEGRAM_BOT_TOKEN=      # de @BotFather
TELEGRAM_ALLOWED_USERS=  # ids autorizados; sin esto le escribe cualquiera
# SMTP_USER=
# SMTP_APP_PASSWORD=
ENV

printf 'data/.env\ndata/*.db*\ndata/cache/\ndata/logs/\n__pycache__/\n.DS_Store\n' > .gitignore

# Config mínima. Hermes la completa y la migra sola en el primer arranque; acá
# solo dejamos lo que el kit necesita y que nadie adivinaría.
cat > data/config.yaml <<'CFG'
model:
  provider: openrouter
  api_key: ${OPENROUTER_API_KEY}
  default: openai/gpt-5.6-luna

api_server:
  enabled: true
  host: 0.0.0.0
  port: 8642
  key: ${API_SERVER_KEY}

# Herramientas nativas de kanban. Hacen falta LAS DOS claves de abajo y no es
# adivinable: `toolsets` abre la compuerta (check_fn), y `platform_toolsets`
# pasa el filtro por plataforma. Con una sola, el agente no ve ninguna tool de
# kanban y termina improvisando por terminal. Verificado el 4/8/2026.
toolsets:
  - kanban

# Herramientas que un agente de cliente no usa nunca y cuyo esquema se paga en
# CADA llamada al modelo. Medido con `hermes prompt-size` sobre un agente
# recien creado: los esquemas pesan 67,6 KB (casi el doble del system prompt
# entero), y sacando estas dos bajan a 60,0 KB sin perder nada.
#   tts        1,8 KB  hablar en voz alta
#   delegation 5,8 KB  crear sub-agentes
# Si un cliente llega a necesitarlas, se sacan de esta lista y se reinicia.
agent:
  # Effort al maximo. Probado el 5/8 sobre el mismo agente, mismos datos y
  # mismas consignas: con el default del proveedor dejaba 3 de 18 clientes
  # afuera de una hoja de ruta diciendo que eran 18, mezclaba meses en un
  # ranking y erraba una bonificacion en cascada. Con `max` las tres salieron
  # bien de primera. Costo: ruido (USD 0,18 por 13 sesiones completas).
  # OJO: no arregla la complacencia — con max igual se auto-acuso de inventar
  # a alguien que estaba en su propio SOUL.
  reasoning_effort: max
  disabled_toolsets:
    - tts
    - delegation
    # cronjob apagado A PROPOSITO, y no para ahorrar contexto: es lo que
    # empuja al agente a la skill `flujo` en vez de improvisar un cron suelto.
    # Verificado el 8/8: un cliente pidio "quiero saber regularmente sobre la
    # competencia", el agente MIRO la skill flujo (skill_view) y aun asi llamo
    # a `cronjob` directo. Salio un cron invisible —sin carpeta, sin FLUJO.md,
    # sin pestaña Flujos— y encima con `deliver=origin`, que entrega a la
    # sesion del portal: iba a correr todos los lunes y no iba a llegar nunca
    # nada, sin ningun aviso. Con el toolset apagado el unico camino comodo es
    # `crear_flujo.py`, que crea el cron con --deliver=local y deja el flujo a
    # la vista. No es una pared: por terminal se puede igual, y de eso se
    # encarga el SOUL. Es sacar la puerta facil que daba al lugar equivocado.
    - cronjob

platform_toolsets:
  api_server:
    - hermes-api-server
    - kanban
  telegram:
    - hermes-telegram
    - kanban

# Sin `platforms.telegram.enabled` el adapter de Telegram bootea a medias:
# loguea "Connecting" pero el polling nunca arranca y los mensajes no llegan
# (descubierto el 7/8/2026 con East: /start sin respuesta, cero errores).
# El home_channel arranca apuntando a soporte; se cambia al chat del cliente
# cuando se empareja.
platforms:
  telegram:
    enabled: true
    home_channel:
      platform: telegram
      chat_id: 'COMPLETAR_CHAT_ID'
      name: COMPLETAR_NOMBRE
      user_id: 'COMPLETAR_CHAT_ID'
  cron:
    - hermes-cron
    - kanban
CFG

# Borrador del SOUL: los bloques pegados, con los placeholders intactos.
# La identidad va PRIMERO y AFUERA de los marcadores: es la parte que se escribe
# cliente por cliente. Lo genérico va adentro de `kit:base`, con su versión —es
# lo que después dice qué reglas corre este agente sin leerle el prompt entero,
# y lo que le da sentido al bloque de precedencia que cierra la lista.
# ($SOUL_VERSION se validó arriba, antes de crear nada.)
{
  cat "$KIT/soul/00-identidad.md"; echo
  echo "<!-- kit:base $SOUL_VERSION -->"; echo
  for bloque in 01-aprobaciones 02-entrega 03-canales 04-lenguaje 05-precedencia; do
    cat "$KIT/soul/$bloque.md"; echo
  done
  echo "<!-- /kit:base -->"
} > data/SOUL.md

cat > README.md <<README
# Agente de $NOMBRE

Agente de tuagente.uy para $NOMBRE. El adapter y las skills se instalan desde
\`hermes-kit\` — no se editan acá (ver \`install.sh --diff\`).

\`\`\`bash
docker compose up -d
\`\`\`
README

"$KIT/install.sh" "$DESTINO/data" >/dev/null
git init -q && git add -A && git commit -qm "Agente de $NOMBRE: esqueleto + kit de tuagente"

cat <<FIN

Listo: $DESTINO

Lo que falta, en orden:

  1. data/SOUL.md — está el borrador con TODOS los placeholders <ASÍ> sin
     completar. Es el trabajo real: quién es, qué hace, qué NO hace y qué
     requiere aprobación. Sin esto el agente tiene herramientas y ninguna regla.
  2. cp data/.env.example data/.env  y completar las claves.
     (data/config.yaml ya viene con el modelo, el api server y las tools
      nativas de kanban — revisalo si el cliente usa otro proveedor.)
  3. python3 $KIT/tools/agente-check.py $DESTINO/data
     0 fallas ANTES de prender: agarra el SOUL con huecos, las skills sin
     frontmatter y los olvidos de config, sin levantar nada.
  4. docker compose up -d
  5. python3 $KIT/tools/portal-check.py --key <API_SERVER_KEY>
     0 fallas o no se entrega.
  6. Primera tarea del agente: que investigue la web de la empresa y entregue
     su brief — ver onboarding/brief-empresa.md. Sale un borrador para revisar,
     y de ahí salen 3-4 líneas para el SOUL.

Runbook completo (canales, WhatsApp, tiempos): tuagente.uy/docs/alta-cliente.md
FIN
