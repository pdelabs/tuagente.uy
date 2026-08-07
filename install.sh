#!/usr/bin/env bash
# Instala el kit de tuagente en el data/ de un agente Hermes.
#
#   ./install.sh /ruta/al/agente/data            instala o actualiza
#   ./install.sh /ruta/al/agente/data --diff     solo muestra diferencias
#
# El kit es la fuente de la verdad: si editaste el adapter o una skill dentro
# de un agente, --diff te lo dice antes de que se pierda.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${1:-}"
MODO="${2:-instalar}"

if [[ -z "$DATA" ]]; then
  echo "uso: $0 /ruta/al/agente/data [--diff]" >&2
  exit 2
fi
if [[ ! -d "$DATA" ]]; then
  echo "No existe $DATA — ¿es el data/ de un agente?" >&2
  exit 2
fi

# La lista de archivos se ARMA desde el repo: cada skill del kit entra entera.
# Antes era una lista a mano y el costo fue real: se agregaron dos skills al
# kit (transcribir, entrada-drive) y el primer agente nuevo salió sin ellas —
# con el SOUL prometiendo transcripciones que el agente no podía hacer.
ARCHIVOS=(
  "adapter/portal_adapter.py:scripts/portal_adapter.py"
  "connections/catalogo.json:connections/catalogo.json"
)
while IFS= read -r f; do
  rel="${f#"$KIT"/}"
  ARCHIVOS+=("$rel:$rel")
done < <(find "$KIT/skills" -type f \( -name "*.md" -o -name "*.py" \) | sort)

if [[ "$MODO" == "--diff" ]]; then
  distintos=0
  for par in "${ARCHIVOS[@]}"; do
    origen="$KIT/${par%%:*}"; destino="$DATA/${par##*:}"
    if [[ ! -f "$destino" ]]; then
      echo "FALTA    ${par##*:}"; distintos=$((distintos+1))
    elif ! diff -q "$origen" "$destino" >/dev/null; then
      echo "DISTINTO ${par##*:}"
      diff -u "$origen" "$destino" | sed 's/^/    /' | head -20
      distintos=$((distintos+1))
    fi
  done
  if [[ $distintos -eq 0 ]]; then
    echo "El agente está al día con el kit."
  else
    echo
    echo "$distintos archivo(s) distintos. Si el cambio bueno está en el agente,"
    echo "copialo al kit antes de instalar, o lo vas a pisar."
  fi
  exit 0
fi

for par in "${ARCHIVOS[@]}"; do
  origen="$KIT/${par%%:*}"; destino="$DATA/${par##*:}"
  mkdir -p "$(dirname "$destino")"
  cp "$origen" "$destino"
  echo "instalado ${par##*:}"
done

# Carpetas que el kit da por sentadas (el portal las lee, las skills escriben).
for carpeta in workspace/entregables workspace/artifacts workspace/entrada workspace/interno; do
  mkdir -p "$DATA/$carpeta"
done

# Manifiesto de QUÉ skills son del kit. El adapter lo usa para distinguir las
# "del producto tuagente" (comunes a todos, sostienen pantallas del portal, no
# se editan desde ahí) de las hechas para ESTE cliente (editables). Sin esto,
# todas parecen del cliente y el portal ofrece editar la que sostiene la
# pestaña de entregas.
ls -1 "$KIT/skills" > "$DATA/skills/.kit_manifest"
echo "instalado skills/.kit_manifest"

cat <<'FIN'

Instalado. Lo que falta hacer a mano:

  1. Componer el SOUL con los bloques de soul/ (ver soul/README.md).
     Sin eso el agente tiene las herramientas pero no las reglas.
  1b. Habilitar las tools nativas de kanban en data/config.yaml. Hacen falta
      LAS DOS claves; con una sola el agente no ve ninguna:
        toolsets:
          - kanban
        platform_toolsets:
          api_server: [hermes-api-server, kanban]
          telegram:   [hermes-telegram, kanban]
          cron:       [hermes-cron, kanban]
      Sin esto el agente no puede tocar sus propios tickets (los improvisa
      con Python y falla). Requiere reiniciar el gateway.
  2. En el docker-compose: AGENT_NAME, TZ y los dos CORS
     (API_SERVER_CORS_ORIGINS y PORTAL_CORS_ORIGINS).
  3. Verificar el data/ ANTES de prender:
       python3 tools/agente-check.py <ruta>/data
     Agarra los olvidos del alta (SOUL con huecos, skills sin frontmatter,
     modelo por defecto vacío) sin necesidad de levantar nada.
  4. docker compose up -d
  5. Verificar el contrato con el portal, ya encendido:
       python3 tools/portal-check.py --key <API_SERVER_KEY>
     0 fallas o no se entrega.

Las skills tardan unos minutos en aparecer en el índice del agente: es normal,
Hermes reindexa solo al detectar los archivos nuevos.
FIN
