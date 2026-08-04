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

ARCHIVOS=(
  "adapter/portal_adapter.py:scripts/portal_adapter.py"
  "skills/artifact/SKILL.md:skills/artifact/SKILL.md"
  "skills/artifact/create_artifact.py:skills/artifact/create_artifact.py"
  "skills/entregable/SKILL.md:skills/entregable/SKILL.md"
  "skills/entregable/deliver.py:skills/entregable/deliver.py"
  "skills/aprobacion/SKILL.md:skills/aprobacion/SKILL.md"
  "skills/aprobacion/format_request.py:skills/aprobacion/format_request.py"
)

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

cat <<'FIN'

Instalado. Lo que falta hacer a mano:

  1. Componer el SOUL con los bloques de soul/ (ver soul/README.md).
     Sin eso el agente tiene las herramientas pero no las reglas.
  2. En el docker-compose: AGENT_NAME, TZ y los dos CORS
     (API_SERVER_CORS_ORIGINS y PORTAL_CORS_ORIGINS).
  3. docker compose up -d
  4. Verificar:  python3 tools/portal-check.py --key <API_SERVER_KEY>
     0 fallas o no se entrega.

Las skills tardan unos minutos en aparecer en el índice del agente: es normal,
Hermes reindexa solo al detectar los archivos nuevos.
FIN
