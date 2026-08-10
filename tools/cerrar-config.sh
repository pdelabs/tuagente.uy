#!/usr/bin/env bash
# Pone config.yaml en solo lectura, después del primer arranque.
#
#   ./cerrar-config.sh east                    # en una VPS (por ssh)
#   ./cerrar-config.sh ~/Projects/agente-x     # en un agente local
#
# POR QUE: config.yaml vive dentro de ./data y es propiedad del usuario del
# agente, o sea que el agente lo escribe. Ahí están `disabled_toolsets` —donde
# apagamos `cronjob` a propósito— y el registro de servidores MCP. Sin este
# candado el agente puede devolverse cronjob y registrar un MCP salteando la
# guardia; solo tiene que esperar un reinicio.
#
# POR QUE NO VA DESDE EL ARRANQUE: en el primer boot el archivo todavía NO
# EXISTE, y Docker, al montar algo inexistente, crea un DIRECTORIO con ese
# nombre. El agente entonces no levanta. Por eso `desplegar-remoto.sh` lo sube
# comentado y esto lo cierra después.
#
# Para volver a abrirlo (registrar un MCP, cambiar un toolset):
#   tools/con-config-abierta.sh <agente> hermes mcp add ...
set -euo pipefail

DESTINO="${1:-}"
[[ -n "$DESTINO" ]] || { echo 'uso: ./cerrar-config.sh <host-ssh|dir-local>' >&2; exit 1; }

LINEA='      - ./data/config.yaml:/opt/data/config.yaml:ro'
MARCA='# PRIMER ARRANQUE: descomentar con tools/cerrar-config.sh'

if [[ -d "$DESTINO" ]]; then
  correr() { bash -c "$1"; }
  DIR="$DESTINO"
else
  correr() { ssh "$DESTINO" "$1"; }
  DIR="/opt/agentes/$DESTINO"
fi

correr "grep -q '$MARCA' $DIR/docker-compose.yml" || {
  echo "El candado ya está puesto (o el compose no tiene la marca). Nada que hacer."
  exit 0
}

# El archivo tiene que existir ANTES de montarlo, si no Docker crea un directorio.
correr "test -s $DIR/data/config.yaml" || {
  echo "config.yaml no existe o está vacío en $DIR/data/ — arrancá el agente primero." >&2
  exit 1
}

echo "→ cerrando config.yaml"
correr "sed -i 's|^ *$MARCA|$LINEA|' $DIR/docker-compose.yml"
correr "cd $DIR && docker compose up -d --force-recreate hermes >/dev/null 2>&1"

# Sin comillas anidadas: se trae la salida y se filtra ACA. Pasar un
# `sh -c '...'` a traves de ssh dentro de otra cadena entrecomillada se rompe
# en silencio, y el sintoma es un bucle que espera para siempre algo que ya
# estaba listo.
CONTENEDOR="${DIR##*/}-hermes"
echo "→ esperando al gateway"
arriba=0
for _ in $(seq 1 40); do
  sleep 5
  if correr "docker exec $CONTENEDOR ss -lnt" 2>/dev/null | grep -q 8642; then
    echo "→ gateway arriba"
    arriba=1
    break
  fi
done
[[ $arriba == 1 ]] || { echo "el gateway no levanto — revisa 'docker compose logs hermes'" >&2; exit 1; }

echo -n "→ el agente puede escribir su config: "
if correr "docker exec -u hermes $CONTENEDOR touch /opt/data/config.yaml" 2>/dev/null; then
  echo "SI — EL CANDADO NO QUEDO PUESTO" >&2
  exit 1
else
  echo "no (bien)"
fi
