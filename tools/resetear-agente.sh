#!/usr/bin/env bash
# Deja un agente como recién instalado, sin tocar sus claves ni el kit.
#
#   ./resetear-agente.sh tuagente            # alias ssh que se llama como el agente
#   ./resetear-agente.sh root@1.2.3.4 east   # host ssh que NO se llama como el agente
#
# El segundo argumento es el slug: el nombre del directorio en la VPS
# (/opt/agentes/<slug>). Por defecto es el mismo que el host ssh.
#
# BORRA todo lo del cliente: bautizo, look, empresa, canal, sesiones, tablero,
# entregables, memorias, flujos, crons, pairing y el SOUL.
# CONSERVA .env, config.yaml, skills/, scripts/, connections/ y politica/.
#
# OJO CON LOS PERMISOS, que es lo que se rompió la primera vez: el adapter
# corre como ROOT y el agente como `hermes` (uid 10000), compartiendo el mismo
# volumen. Si un archivo que el agente escribe se recrea con dueño root, el
# agente no puede abrirlo — y `kanban.db is not writable` en bucle se ve como
# "el agente me da errores", no como un problema de permisos. Por eso al final
# esto le devuelve el dueño a lo que el agente necesita escribir.
set -euo pipefail

HOST="${1:-}"
[[ -n "$HOST" ]] || { echo 'uso: ./resetear-agente.sh <host-ssh> [slug]' >&2; exit 1; }
SLUG="${2:-$HOST}"
DIR="/opt/agentes/$SLUG"

ssh "$HOST" "[ -d $DIR/data ]" || {
  echo "no existe $DIR/data en $HOST" >&2
  echo "si el directorio del agente no se llama '$SLUG', pasalo como segundo" >&2
  echo "argumento:  ./resetear-agente.sh $HOST <slug>" >&2
  exit 1
}

echo "→ respaldo"
ssh "$HOST" "mkdir -p /root/respaldos && tar czf /root/respaldos/$SLUG-\$(date +%Y%m%d-%H%M%S).tgz -C $DIR data 2>/dev/null; ls -1t /root/respaldos | head -1 | sed 's/^/   /'"

echo "→ apagando"
ssh "$HOST" "cd $DIR && docker compose stop hermes portal-adapter" >/dev/null 2>&1

echo "→ borrando lo del cliente"
ssh "$HOST" "cd $DIR/data && rm -rf \
  SOUL.md portal_identidad.json bot_avatar.png \
  sessions kanban kanban.db kanban.db-shm kanban.db-wal \
  kanban.db.dispatch.lock kanban.db.init.lock \
  workspace flujos entregables artifacts \
  cron pairing platforms state state.db state.db-shm state.db-wal \
  memories memory insights plans pending_messages \
  response_store.db response_store.db-shm response_store.db-wal \
  channel_directory.json gateway_state.json .skills_prompt_snapshot.json \
  logs image_cache audio_cache sandboxes 2>/dev/null || true"

echo "→ levantando"
ssh "$HOST" "cd $DIR && docker compose up -d --force-recreate hermes portal-adapter" >/dev/null 2>&1

echo "→ esperando al gateway"
arriba=0
for _ in $(seq 1 45); do
  sleep 6
  # Se le pregunta al gateway, no al sistema: `ss` no siempre está en la
  # imagen y su ausencia se ve igual que "todavía no levantó" — el script se
  # daba por vencido con el agente ya andando.
  if [[ "$(ssh "$HOST" "docker exec $SLUG-hermes curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8642/health" 2>/dev/null)" == "200" ]]; then
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
ssh "$HOST" "cd $DIR/data && mkdir -p \
  workspace/entregables workspace/artifacts workspace/entrada workspace/interno"

echo "→ devolviendo permisos al agente"
ssh "$HOST" "cd $DIR/data && chown -R 10000:10000 \
  kanban.db kanban.db-shm kanban.db-wal state.db response_store.db \
  workspace memories sessions 2>/dev/null || true"
ssh "$HOST" "cd $DIR && docker compose restart hermes" >/dev/null 2>&1

echo "→ chequeando que no queden errores de escritura"
sleep 25
n=$(ssh "$HOST" "cd $DIR && docker compose logs hermes --since 30s 2>&1 | grep -c 'not writable' || true")
if [[ "$n" == "0" ]]; then
  echo "   sin errores de permisos"
else
  echo "   OJO: $n errores de escritura — revisá los dueños en $DIR/data" >&2
fi

echo
echo "Listo. El agente está sin bautizar. Acordate de abrir el portal en una"
echo "ventana de incógnito: el localStorage del browser se acuerda del nombre"
echo "y del look aunque el agente ya no."
