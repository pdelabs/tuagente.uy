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

# Config: la MISMA que usa el despliegue remoto, sin copia paralela. Antes esto
# era un heredoc con el config repetido acá adentro, y ya habia empezado a
# separarse del de compose/. El bloque de skills apagadas son 66 nombres
# generados: mantenerlo en dos lados era garantia de que uno quedara viejo.
cp "$KIT/compose/config.base.yaml" data/config.yaml

# Borrador del SOUL: la identidad con los placeholders intactos, y abajo el
# bloque del kit. La identidad va PRIMERO y AFUERA de los marcadores: es la
# parte que se escribe cliente por cliente —incluidas las acciones sensibles
# propias de la empresa— y es la que el reemplazo de version conserva palabra
# por palabra. Lo generico va adentro de `kit:base`, con su version: es lo que
# despues dice que reglas corre este agente sin leerle el prompt entero.
#
# El bloque sale del CONGELADO (soul/versiones/vN.md), no de pegar los .md acá:
# tiene que ser byte a byte el mismo que instala `instalar-soul.sh` y contra el
# que `reemplazar-bloque.py` va a comparar el dia que este agente suba de
# version. Con dos composiciones distintas —esta no resolvia <RESPONSABLE>—, el
# primer reemplazo veia esa diferencia como texto escrito por el cliente.
# ($SOUL_VERSION se validó arriba, antes de crear nada.)
BLOQUE="$KIT/soul/versiones/$SOUL_VERSION.md"
[[ -f "$BLOQUE" ]] || {
  echo "falta $BLOQUE: este kit nunca congeló el bloque $SOUL_VERSION." >&2
  echo "   ./tools/instalar-soul.sh --bloque > soul/versiones/$SOUL_VERSION.md" >&2
  exit 2
}
if ! "$KIT/tools/instalar-soul.sh" --bloque | diff -q "$BLOQUE" - >/dev/null; then
  echo "los bloques de soul/ ya no componen lo que dice $BLOQUE." >&2
  echo "Subí soul/VERSION y congelá la nueva, o volvé a congelar esta:" >&2
  echo "   ./tools/instalar-soul.sh --bloque > soul/versiones/$SOUL_VERSION.md" >&2
  exit 2
fi
{
  cat "$KIT/soul/00-identidad.md"; echo
  cat "$BLOQUE"
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
