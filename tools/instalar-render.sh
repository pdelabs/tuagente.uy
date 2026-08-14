#!/usr/bin/env bash
# Instala el motor de piezas (skills/post-image) en un agente YA desplegado.
#
#   ./instalar-render.sh tuagente               # ssh: alias que se llama igual
#   ./instalar-render.sh root@1.2.3.4 east      # ssh: host + slug
#   ./instalar-render.sh --local ~/…/agente-acme
#
# POR QUE ES UN PASO APARTE Y NO LO HACE install.sh: son binarios NATIVOS.
# `install.sh` corre contra un staging que puede estar en otra plataforma —una
# Mac, por ejemplo—, y ahi npm baja `core-darwin-arm64`, que despues se sube a
# un contenedor Linux y no carga. Andaria en la prueba local y fallaria en el
# cliente, que es la peor forma de fallar.
#
# Por eso el `npm install` corre SIEMPRE adentro de un contenedor Linux glibc,
# que es la plataforma del agente, sin importar desde donde se despliegue ni si
# la VPS tiene node instalado.
#
# Las versiones estan fijas en render/package.json. Es idempotente.
set -euo pipefail

MODO=ssh
POS=()
while (( $# )); do
  case "$1" in
    --local) MODO=local ;;
    *) POS+=("$1") ;;
  esac
  shift
done

NODE_IMAGE="node:22-slim"   # glibc, como la imagen del motor

if [[ "$MODO" == local ]]; then
  AGENTE="${POS[0]:-}"
  [[ -n "$AGENTE" ]] || { echo "uso: $0 --local <ruta-del-agente>" >&2; exit 1; }
  [[ -f "$AGENTE/kit-render/package.json" ]] || {
    echo "no hay kit-render/package.json en $AGENTE — corré install.sh primero" >&2; exit 1; }
  echo "→ instalando el motor de piezas en $AGENTE/kit-render"
  docker run --rm -v "$AGENTE/kit-render:/w" -w /w "$NODE_IMAGE" \
    npm install --omit=dev --no-audit --no-fund
else
  HOST="${POS[0]:-}"
  SLUG="${POS[1]:-$HOST}"
  [[ -n "$HOST" ]] || { echo "uso: $0 <host-ssh> [slug]" >&2; exit 1; }
  DIR="/opt/agentes/$SLUG"
  echo "→ instalando el motor de piezas en $HOST:$DIR/kit-render"
  # shellcheck disable=SC2029
  ssh "$HOST" "set -e
    [ -f '$DIR/kit-render/package.json' ] || { echo 'no hay kit-render/package.json: corré el despliegue primero' >&2; exit 1; }
    docker run --rm -v '$DIR/kit-render:/w' -w /w $NODE_IMAGE npm install --omit=dev --no-audit --no-fund
    ls /w >/dev/null 2>&1 || true"
fi

echo
echo "Listo. Falta que el contenedor TOME el montaje nuevo — un restart no alcanza:"
echo "    docker compose up -d hermes"
echo
echo "Y para verificar que renderiza de verdad, no que instaló:"
echo "    echo '{\"plantilla\":\"portada\",\"titulo\":\"prueba\"}' \\"
echo "      | docker exec -i <slug>-hermes node /opt/kit/skills/post-image/scripts/render.mjs \\"
echo "          --formato feed --out /opt/data/workspace/piezas/prueba.png"
