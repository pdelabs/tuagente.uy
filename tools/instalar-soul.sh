#!/usr/bin/env bash
# Instala el SOUL base del kit en un agente que no lo tiene.
#
#   ./instalar-soul.sh tuagente
#
# POR QUE EXISTE: `desplegar-remoto.sh` nunca instalaba SOUL. Los agentes
# remotos corrian con los 800 bytes del preambulo de Nous y NADA mas: sin regla
# de aprobacion, sin convenciones de entrega, sin idioma. Por eso contestaban
# como un asistente generico. (Visto el 11/8 con Mr.Wobble: 10 lineas de SOUL.)
#
# QUE INSTALA: los cuatro bloques cuyos huecos podemos llenar solos —
# aprobaciones, entrega, canales y lenguaje— con <RESPONSABLE> resuelto como
# "tu cliente", que es exactamente quien tiene el portal en la mano.
#
# QUE NO: `00-identidad.md`, que tiene ocho huecos y es la parte artesanal (a
# que se dedica, quien es quien, que jamas puede pasar sin OK). El bloque que
# el portal escribe en el bautizo ya cubre nombre y empresa; el resto lo
# escribe una persona, cliente por cliente.
#
# Es idempotente: si ya esta puesto, no lo duplica.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:-}"
[[ -n "$HOST" ]] || { echo 'uso: ./instalar-soul.sh <host-ssh>' >&2; exit 1; }
DIR="/opt/agentes/$HOST"
MARCA="<!-- kit:base -->"

if ssh "$HOST" "grep -q '$MARCA' $DIR/data/SOUL.md 2>/dev/null"; then
  echo "El SOUL base ya está puesto en $HOST. Nada que hacer."
  exit 0
fi

tmp="$(mktemp)"
{
  echo "$MARCA"
  echo
  for b in 01-aprobaciones 02-entrega 03-canales 04-lenguaje; do
    sed 's/<RESPONSABLE>/tu cliente/g' "$KIT/soul/$b.md"
    echo
  done
  echo "<!-- /kit:base -->"
  echo
} > "$tmp"

# Se ANTEPONE a lo que ya hay: el preambulo de Nous y, sobre todo, el bloque
# `portal:identidad` que el adapter reescribe en cada bautizo. Pisar el archivo
# entero borraria el nombre y la empresa que el cliente ya cargo.
ssh "$HOST" "cat > /tmp/soul-base.md" < "$tmp"
rm -f "$tmp"
ssh "$HOST" "cd $DIR/data && \
  { cat /tmp/soul-base.md; [ -f SOUL.md ] && cat SOUL.md; } > SOUL.nuevo && \
  mv SOUL.nuevo SOUL.md && chown 10000:10000 SOUL.md && rm -f /tmp/soul-base.md"

echo "→ SOUL instalado en $HOST"
ssh "$HOST" "wc -c < $DIR/data/SOUL.md | sed 's/^/   /' ; echo '   bytes'"
echo
echo "FALTA lo artesanal: 00-identidad.md (a qué se dedica, quién aprueba qué,"
echo "qué jamás puede pasar sin OK). Eso lo escribe una persona, por cliente."
