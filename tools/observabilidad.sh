#!/usr/bin/env bash
# Prende o apaga la observabilidad de un agente: ver TODOS sus prompts.
#
#   ./observabilidad.sh tuagente on
#   ./observabilidad.sh tuagente off
#   ./observabilidad.sh tuagente estado
#
# Prendida, las llamadas al modelo pasan por un proxy (litellm) que las manda a
# Phoenix. Apagada, el agente habla directo con OpenRouter y no queda nada.
#
# NO la dejes prendida en un cliente sin avisarle: Phoenix guarda los prompts, y
# los prompts son SUS datos. Ver las notas de compose/docker-compose.observabilidad.yml.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:-}"; ACCION="${2:-estado}"
[[ -n "$HOST" ]] || { echo 'uso: ./observabilidad.sh <host-ssh> [on|off|estado]' >&2; exit 1; }
DIR="/opt/agentes/$HOST"
PROXY="http://litellm:4000"

compose() { ssh "$HOST" "cd $DIR && docker compose -f docker-compose.yml -f docker-compose.observabilidad.yml $*"; }

esperar_gateway() {
  for _ in $(seq 1 40); do
    sleep 6
    [[ "$(ssh "$HOST" "docker exec $HOST-hermes curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8642/health" 2>/dev/null)" == "200" ]] && return 0
  done
  return 1
}

case "$ACCION" in
  estado)
    echo -n "  base_url del modelo: "
    ssh "$HOST" "grep -A3 '^model:' $DIR/data/config.yaml | grep base_url || echo '(sin base_url — directo a OpenRouter)'"
    echo -n "  contenedores       : "
    ssh "$HOST" "docker ps --format '{{.Names}}' | grep -E 'phoenix|litellm' | tr '\n' ' ' || true"
    echo
    ;;

  on)
    echo "→ subiendo el overlay"
    rsync -a "$KIT/compose/docker-compose.observabilidad.yml" "$HOST:$DIR/"
    rsync -a "$KIT/compose/litellm.yaml" "$HOST:$DIR/"
    rsync -a "$KIT/compose/otel-collector.yaml" "$HOST:$DIR/"

    # El modelo sale de la config del agente: litellm no lo manda en el span
    # util y sin el la traza no dice a que le hablaste.
    MODELO="$(ssh "$HOST" "grep -E '^\s*default:' $DIR/data/config.yaml | head -1 | sed 's/.*default:[[:space:]]*//'" | tr -d '\r')"
    echo "→ modelo del agente: ${MODELO:-desconocido}"
    ssh "$HOST" "grep -q '^MODELO_DEL_AGENTE=' $DIR/.env 2>/dev/null \
      && sed -i 's|^MODELO_DEL_AGENTE=.*|MODELO_DEL_AGENTE=${MODELO}|' $DIR/.env \
      || echo 'MODELO_DEL_AGENTE=${MODELO}' >> $DIR/.env"

    echo "→ levantando phoenix y litellm"
    compose "up -d phoenix otel-collector litellm" >/dev/null 2>&1

    # El proxy tiene que contestar ANTES de que Hermes dependa de el: si no,
    # el agente queda mudo hasta que alguien se acuerde de mirar los logs.
    echo -n "→ el proxy responde: "
    listo=""
    for _ in $(seq 1 12); do
      sleep 8
      ssh "$HOST" "docker exec $HOST-hermes curl -s -o /dev/null -w '%{http_code}' -m 8 http://litellm:4000/health/liveliness" 2>/dev/null | grep -q 200 && { listo=1; break; }
    done
    # Se pregunta DESDE hermes y no desde litellm: la imagen del proxy no
    # trae curl, y su ausencia se ve igual que "el proxy no responde". Ademas
    # esto prueba lo que importa de verdad — que hermes LO ALCANCE por la red
    # interna—, que es la unica pregunta que decide si se puede seguir.
    if [[ -n "$listo" ]]; then
      echo "sí"
    else
      echo "NO — no toco el agente, revisá 'docker compose logs litellm'" >&2
      exit 1
    fi

    # config.yaml esta montado :ro EN EL CONTENEDOR, pero en el host es un
    # archivo comun: se edita acá y se reinicia.
    # OJO CON EL PROVIDER, que es lo que costo encontrar: con
    # `provider: openrouter` Hermes IGNORA base_url y se va directo — el proxy
    # queda arriba y sin ver una sola llamada. El proveedor para un endpoint
    # propio es `custom` (`openai` ni existe: tira "Unknown provider").
    echo "→ apuntando el modelo al proxy"
    ssh "$HOST" "python3 - <<'PY'
import pathlib, re
p = pathlib.Path('$DIR/data/config.yaml')
s = p.read_text()
if 'base_url' in s.split('toolsets:')[0]:
    s = re.sub(r'^(\s*)base_url:.*$', r'\1base_url: $PROXY', s, count=1, flags=re.M)
else:
    s = s.replace('model:\n', 'model:\n  base_url: $PROXY\n', 1)
s = re.sub(r'^(\s*)provider:.*$', r'\1provider: custom', s, count=1, flags=re.M)
p.write_text(s)
PY"
    compose "restart hermes" >/dev/null 2>&1
    esperar_gateway || { echo "el gateway no volvió — mirá los logs" >&2; exit 1; }
    echo "→ gateway arriba con el proxy en el medio"
    echo
    echo "Para mirar (los prompts NO salen de la máquina, se van por el túnel):"
    echo "    ssh -L 6006:localhost:6006 $HOST"
    echo "    http://localhost:6006"
    ;;

  off)
    echo "→ sacando el proxy del medio"
    ssh "$HOST" "python3 - <<'PY'
import pathlib, re
p = pathlib.Path('$DIR/data/config.yaml')
s = re.sub(r'^\s*base_url:.*\n', '', p.read_text(), count=1, flags=re.M)
s = re.sub(r'^(\s*)provider:\s*custom\s*$', r'\1provider: openrouter', s, count=1, flags=re.M)
p.write_text(s)
PY"
    compose "restart hermes" >/dev/null 2>&1
    esperar_gateway || { echo "el gateway no volvió — mirá los logs" >&2; exit 1; }
    echo "→ el agente habla directo con OpenRouter"
    compose "stop phoenix otel-collector litellm" >/dev/null 2>&1
    echo "→ phoenix, colector y litellm apagados (las trazas quedan en su volumen)"
    ;;

  *) echo "acción desconocida: $ACCION (on | off | estado)" >&2; exit 1 ;;
esac
