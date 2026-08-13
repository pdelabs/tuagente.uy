#!/usr/bin/env bash
# Deja un agente en cero, sin tocar sus claves ni el kit.
#
#   ./resetear-agente.sh tuagente                    # ssh: alias que se llama como el agente
#   ./resetear-agente.sh root@1.2.3.4 east           # ssh: host + slug (/opt/agentes/<slug>)
#   ./resetear-agente.sh --local ~/…/agente-acme     # un agente de ESTA máquina
#   ./resetear-agente.sh --local ~/…/agente-acme --entrega
#
# En modo ssh el segundo argumento es el slug: el nombre del directorio en la
# VPS (/opt/agentes/<slug>). Por defecto, el mismo que el host ssh.
#
# HAY DOS MODOS, y la diferencia es qué se conserva:
#
#   completo (por defecto) — reciclar un agente: se lleva TAMBIÉN el SOUL, los
#     flujos y las tareas programadas. Queda como recién instalado.
#
#   --entrega — el último paso de un alta: borra la huella de la verificación
#     (conversaciones, uso, tablero, aprobaciones, entregables, artefactos,
#     memorias, bautizo y la foto del bot) y CONSERVA lo que se escribió para
#     este cliente: el SOUL —menos el bloque `portal:identidad`, que lo escribe
#     el bautizo—, los flujos (`flujos/`) y sus tareas programadas
#     (`cron/jobs.json`), sin el historial de corridas.
#
# Los dos modos conservan siempre: secretos.env, config.yaml, skills/,
# scripts/, connections/, politica/, kit-skills/ y kit-adapter/.
#
# POR QUÉ EXISTE EL MODO LOCAL: la receta para dejar en cero un agente de la
# máquina de uno vivía como ocho líneas de `rm -rf` sueltas en un documento de
# OTRO repo, así que el último paso del alta —que el cliente no abra su portal y
# encuentre una conversación nuestra y gasto en la pestaña de Uso— dependía de
# que alguien se acordara de ir a buscarlas. La receta es esta y es una sola,
# ande el agente donde ande.
#
# OJO CON LOS PERMISOS, que es lo que se rompió la primera vez: el agente corre
# como `hermes` (uid 10000) y comparte el volumen con el adapter. Si un archivo
# que el agente escribe se recrea con dueño root, el agente no puede abrirlo — y
# `kanban.db is not writable` en bucle se ve como "el agente me da errores", no
# como un problema de permisos. Por eso al final esto le devuelve el dueño a lo
# que el agente necesita escribir.
set -euo pipefail

MODO=ssh
ENTREGA=0
POS=()
while (( $# )); do
  case "$1" in
    --local)   MODO=local; DIR="${2:-}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    --entrega) ENTREGA=1; shift ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "opción desconocida: $1" >&2; exit 2 ;;
    *)         POS+=("$1"); shift ;;
  esac
done

if [[ "$MODO" == local ]]; then
  [[ -n "${DIR:-}" ]] || { echo 'uso: ./resetear-agente.sh --local <ruta-del-agente> [--entrega]' >&2; exit 2; }
  DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "no existe ese directorio" >&2; exit 1; }
  SLUG="$(basename "$DIR")"
else
  HOST="${POS[0]:-}"
  [[ -n "$HOST" ]] || { echo 'uso: ./resetear-agente.sh <host-ssh> [slug]   |   --local <ruta> [--entrega]' >&2; exit 2; }
  SLUG="${POS[1]:-$HOST}"
  DIR="/opt/agentes/$SLUG"
fi

# El único lugar donde se decide si esto corre acá o del otro lado del ssh: los
# comandos son los mismos, para que la receta no se bifurque en dos que se
# separan sin que nadie se entere.
correr() {
  if [[ "$MODO" == ssh ]]; then ssh "$HOST" "$1"; else bash -c "$1"; fi
}

correr "[ -d '$DIR/data' ]" || {
  echo "no existe $DIR/data" >&2
  [[ "$MODO" == ssh ]] && {
    echo "si el directorio del agente no se llama '$SLUG', pasalo como segundo" >&2
    echo "argumento:  ./resetear-agente.sh $HOST <slug>" >&2
  }
  exit 1
}

if (( ENTREGA )); then
  echo "→ modo ENTREGA: conservo SOUL.md, flujos/ y cron/jobs.json"
else
  echo "→ modo COMPLETO: se va también el SOUL, los flujos y las tareas"
fi

echo "→ respaldo"
# La marca de tiempo se resuelve ACA y no del otro lado: metida adentro de las
# comillas simples que protegen la ruta, `$(date …)` no se expande y el respaldo
# queda llamándose literalmente `agente-$(date +%Y%m%d-%H%M%S).tgz`.
TS="$(date +%Y%m%d-%H%M%S)"
if [[ "$MODO" == ssh ]]; then
  RESP="/root/respaldos"
else
  # Afuera del repo del agente: adentro ensuciaría su `git status`, que es donde
  # se mira "¿toqué algo?".
  RESP="$(dirname "$DIR")/respaldos"
fi
correr "mkdir -p '$RESP' && tar czf '$RESP/$SLUG-$TS.tgz' -C '$DIR' data 2>/dev/null; ls -l '$RESP/$SLUG-$TS.tgz' | sed 's|^|   |'"

echo "→ apagando"
correr "cd '$DIR' && docker compose stop hermes portal-adapter" >/dev/null 2>&1

echo "→ borrando lo del cliente"
# La huella de uso: lo que el cliente NO tiene que encontrar el primer día.
BORRAR="portal_identidad.json bot_avatar.png \
  sessions kanban kanban.db kanban.db-shm kanban.db-wal \
  kanban.db.dispatch.lock kanban.db.init.lock \
  workspace entregables artifacts \
  pairing platforms state state.db state.db-shm state.db-wal \
  memories memory insights plans pending_messages \
  response_store.db response_store.db-shm response_store.db-wal \
  channel_directory.json gateway_state.json .skills_prompt_snapshot.json \
  logs image_cache audio_cache sandboxes \
  cron/executions.db cron/executions.db-shm cron/executions.db-wal cron/output \
  cron/ticker_heartbeat cron/ticker_last_success"
# Lo que se escribió para ESTE cliente. En un alta es el trabajo del día; en un
# reciclado es justamente lo que hay que sacar.
(( ENTREGA )) || BORRAR="$BORRAR SOUL.md flujos cron"
# shellcheck disable=SC2086
correr "cd '$DIR/data' && rm -rf $BORRAR 2>/dev/null || true"

if (( ENTREGA )); then
  # El bautizo escribe un bloque `portal:identidad` DENTRO del SOUL, además de
  # portal_identidad.json. Sin sacarlo, el agente se sigue presentando con el
  # nombre que le pusimos probando y el portal vuelve a pedir el bautizo: dos
  # fuentes de identidad diciendo cosas distintas.
  echo "→ sacando el bloque portal:identidad del SOUL (si el bautizo lo dejó)"
  # SE EXIGEN LOS DOS MARCADORES, y no es prolijidad: si estuviera solo el de
  # apertura, el rango de sed borraría desde ahí HASTA EL FINAL DEL ARCHIVO, o
  # sea el trabajo del alta entero. Y se buscan los MARCADORES, no la palabra:
  # el bloque del kit menciona `portal:identidad` en prosa (v10, línea 508), así
  # que con un `grep portal:identidad` esto decía "sacado" en todos los agentes,
  # incluso en los que nunca se bautizaron.
  abre='<!-- *portal:identidad *-->'
  cierra='<!-- */portal:identidad *-->'
  correr "cd '$DIR/data' && if [ -f SOUL.md ] && grep -q '$abre' SOUL.md && grep -q '$cierra' SOUL.md; then
      sed '/$abre/,/${cierra//\//\\/}/d' SOUL.md > SOUL.md.nuevo && mv SOUL.md.nuevo SOUL.md && echo '   sacado'
    else echo '   no había (este agente nunca se bautizó)'; fi"
fi

echo "→ levantando"
correr "cd '$DIR' && docker compose up -d --force-recreate hermes portal-adapter" >/dev/null 2>&1

echo "→ esperando al gateway"
# El contenedor se resuelve DESPUÉS del up: con --force-recreate el id cambia.
if [[ "$MODO" == ssh ]]; then
  CONT="$SLUG-hermes"
else
  CONT="$(docker compose --project-directory "$DIR" ps -q hermes)"
fi
arriba=0
for _ in $(seq 1 45); do
  sleep 6
  # Se le pregunta al gateway, no al sistema: `ss` no siempre está en la
  # imagen y su ausencia se ve igual que "todavía no levantó" — el script se
  # daba por vencido con el agente ya andando.
  if [[ "$(correr "docker exec $CONT curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8642/health" 2>/dev/null)" == "200" ]]; then
    arriba=1; break
  fi
done
[[ $arriba == 1 ]] || { echo "el gateway no levantó — mirá 'docker compose logs hermes'" >&2; exit 1; }

# El dueño, DESPUES de arrancar: recién ahí existen los archivos que Hermes
# recrea. `hermes` es uid 10000 en la imagen.
# Las carpetas del workspace se BORRARON arriba (van adentro de `workspace`) y
# Hermes no las recrea: son nuestras, no suyas. Sin ellas el agente guarda un
# entregable y falla, y `agente-check.py` marca "faltan carpetas". Se recrean
# antes del chown para que salgan con el dueño correcto de una.
echo "→ recreando el workspace"
correr "cd '$DIR/data' && mkdir -p \
  workspace/entregables workspace/artifacts workspace/entrada workspace/interno"

# Cambiar el dueño A OTRO uid solo lo puede hacer root, así que si acá no somos
# root no se intenta: fallaría siempre y el aviso pasaría a ser ruido fijo. En
# la VPS corre como root y hace falta; en una Mac con Docker Desktop no hace
# falta (el volumen se mapea al uid del contenedor igual).
if [[ "$MODO" == ssh || "$(id -u)" == 0 ]]; then
  echo "→ devolviendo permisos al agente"
  correr "cd '$DIR/data' && chown -R 10000:10000 \
    kanban.db kanban.db-shm kanban.db-wal state.db response_store.db \
    workspace memories sessions 2>/dev/null || true"
else
  echo "→ permisos: no soy root, no toco dueños (en Docker Desktop no hace falta;"
  echo "  en un host Linux, si ves 'not writable' en el log, corré el chown con sudo)"
fi
correr "cd '$DIR' && docker compose restart hermes" >/dev/null 2>&1

echo "→ chequeando que no queden errores de escritura"
sleep 25
n=$(correr "cd '$DIR' && docker compose logs hermes --since 30s 2>&1 | grep -c 'not writable' || true")
if [[ "$n" == "0" ]]; then
  echo "   sin errores de permisos"
else
  echo "   OJO: $n errores de escritura — revisá los dueños en $DIR/data" >&2
fi

echo
echo "Listo. El agente está sin bautizar. Acordate de abrir el portal en una"
echo "ventana de incógnito: el localStorage del browser se acuerda del nombre"
echo "y del look aunque el agente ya no."
if (( ENTREGA )); then
  echo
  echo "Antes de mandar el link, verificá que quedó en cero:"
  echo "  python3 tools/portal-check.py --key <API_SERVER_KEY> --entrega \\"
  echo "      --endpoint http://127.0.0.1:<puerto> --adapter http://127.0.0.1:<puerto+1>"
fi
