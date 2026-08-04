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

platform_toolsets:
  api_server:
    - hermes-api-server
    - kanban
  telegram:
    - hermes-telegram
    - kanban
  cron:
    - hermes-cron
    - kanban
CFG

# Borrador del SOUL: los bloques pegados, con los placeholders intactos.
{
  for bloque in 00-identidad 01-aprobaciones 02-entrega 03-canales 04-lenguaje; do
    cat "$KIT/soul/$bloque.md"; echo
  done
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
  5. Primera tarea del agente: que investigue la web de la empresa y entregue
     su brief — ver onboarding/brief-empresa.md. Sale un borrador para revisar,
     y de ahí salen 3-4 líneas para el SOUL.

Runbook completo (canales, WhatsApp, tiempos): tuagente.uy/docs/alta-cliente.md
FIN
