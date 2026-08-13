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

# LAS SKILLS DEL KIT YA NO VAN ADENTRO DE data/. Van a <agente>/kit-skills/,
# que el compose monta :ro en /opt/kit/skills y que config.yaml declara en
# `skills.external_dirs`. El motor las indexa igual, pero:
#   - el agente no puede reescribirlas (skill_manage sobre un :ro da EROFS),
#   - el curator no las archiva nunca: para el motor una skill externa no es
#     elegible, y las de data/skills/ SÍ lo eran — a los 90 dias sin uso se
#     mueve el directorio a .archive/ y el portal se queda sin `entregable`.
AGENTE="$(cd "$DATA/.." && pwd)"
KIT_SKILLS="$AGENTE/kit-skills"

# La lista de archivos se ARMA desde el repo: cada skill del kit entra entera.
# Antes era una lista a mano y el costo fue real: se agregaron dos skills al
# kit (transcribir, entrada-drive) y el primer agente nuevo salió sin ellas —
# con el SOUL prometiendo transcripciones que el agente no podía hacer.
# El destino de cada par es una ruta absoluta: no todo va al mismo lado.
#
# POLITICA/ VA ACA TAMBIEN, y hasta hoy no venía: `desplegar-remoto.sh` subía la
# guardia, los tools.json, el parche del pairing y el cont-init, y un agente
# LOCAL no recibía nada de eso. El síntoma no era un error sino un cliente
# perdido: sin el parche, el primer mensaje del bot de Telegram sale en inglés
# pidiéndole que corra `hermes pairing approve …` en una terminal, justo cuando
# el portal le está diciendo "pegá el código acá". Dos instaladores para la
# misma carpeta es la forma de que uno quede atrás; ahora los dos ponen lo
# mismo y `--diff` lo controla.
POLITICA="$AGENTE/politica"
ARCHIVOS=(
  "adapter/portal_adapter.py:$DATA/scripts/portal_adapter.py"
  "connections/catalogo.json:$DATA/connections/catalogo.json"
  # EL CATALOGO DE CAPACIDADES VA A politica/, NO A data/. Es el texto de la
  # tarjeta que ve el cliente: en data/ el agente —que corre como root— podia
  # reescribir lo que su cliente lee sobre lo que el agente puede hacer, y
  # borrar el registro de pedidos. El markdown que el agente LEE ya estaba :ro
  # en kit-skills/, o sea que podia mentirle al cliente pero no a si mismo.
  "capacidades/catalogo.json:$POLITICA/capacidades/catalogo.json"
  # El parche del mensaje de pairing y el cont-init que lo dispara. El .sh se
  # monta como /etc/cont-init.d/03-parches y s6 lo corre en cada arranque,
  # antes del gateway; el .py es lo que ese script ejecuta.
  "tools/parche-pairing.py:$POLITICA/parche-pairing.py"
  "tools/cont-init-parches.sh:$POLITICA/cont-init-parches.sh"
  # La guardia de los MCP y el permiso de cada conexión: sin esto, una conexión
  # configurada en config.yaml apunta a un archivo que no existe.
  "mcp-guardia/guardia.py:$POLITICA/guardia.py"
)
# Los hooks se ARMAN desde el directorio, como las skills: el día que haya un
# segundo hook, una lista a mano lo deja afuera y la puerta queda a medias.
while IFS= read -r f; do
  ARCHIVOS+=("politica/hooks/$(basename "$f"):$POLITICA/hooks/$(basename "$f")")
done < <(find "$KIT/politica/hooks" -type f -name "*.py" ! -path "*/__pycache__/*" | sort)
for c in "$KIT"/connections/*/tools.json; do
  [[ -f "$c" ]] || continue
  ARCHIVOS+=("connections/$(basename "$(dirname "$c")")/tools.json:$POLITICA/tools/$(basename "$(dirname "$c")").json")
done
while IFS= read -r f; do
  rel="${f#"$KIT"/connections/}"           # mercadopago/mcp/servidor.py
  conexion="${rel%%/*}"
  ARCHIVOS+=("connections/$rel:$POLITICA/mcp/$conexion/${rel#"$conexion"/mcp/}")
done < <(find "$KIT"/connections/*/mcp -type f ! -path "*/__pycache__/*" 2>/dev/null | sort)
while IFS= read -r f; do
  rel="${f#"$KIT"/}"                       # skills/entregable/SKILL.md
  ARCHIVOS+=("$rel:$KIT_SKILLS/${rel#skills/}")
done < <(find "$KIT/skills" -type f \( -name "*.md" -o -name "*.py" \) | sort)

corta() { echo "${1#"$AGENTE"/}"; }        # rutas legibles en los mensajes

if [[ "$MODO" == "--diff" ]]; then
  distintos=0
  for par in "${ARCHIVOS[@]}"; do
    origen="$KIT/${par%%:*}"; destino="${par##*:}"
    if [[ ! -f "$destino" ]]; then
      echo "FALTA    $(corta "$destino")"; distintos=$((distintos+1))
    elif ! diff -q "$origen" "$destino" >/dev/null; then
      echo "DISTINTO $(corta "$destino")"
      diff -u "$origen" "$destino" | sed 's/^/    /' | head -20
      distintos=$((distintos+1))
    fi
  done
  for s in "$KIT"/skills/*/; do
    vieja="$DATA/skills/$(basename "$s")"
    [[ -d "$vieja" ]] && { echo "SOBRA    data/skills/$(basename "$s") — copia vieja, tapa a la del kit"; distintos=$((distintos+1)); }
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
  origen="$KIT/${par%%:*}"; destino="${par##*:}"
  mkdir -p "$(dirname "$destino")"
  cp "$origen" "$destino"
  echo "instalado $(corta "$destino")"
done

# MIGRACION: la copia vieja adentro de data/skills/ TAPA a la del kit-skills.
# El motor resuelve por directorio local primero (agent/skill_utils.py:566-574,
# tools/skill_manager_tool.py:645-662) y el indice del prompt saltea la externa
# si ya vio ese nombre (agent/prompt_builder.py:1738-1760). O sea: con las dos
# presentes, el agente sigue usando la vieja y este install.sh no tiene efecto,
# sin un solo mensaje de error. No se borra —se aparta— porque borrar el
# trabajo de alguien no es idempotente.
#
# Y se aparta AFUERA de data/skills/, que es lo unico que cuenta: el motor
# indexa ese arbol entero y solo saltea los nombres de EXCLUDED_SKILL_DIRS
# (agent/skill_utils.py:26-44). Un directorio con punto NO alcanza —`.archive`
# esta en esa lista, `.loquesea` no—, asi que "apartar" adentro de data/skills/
# deja la copia vieja indexada y tapando igual. Va a un hermano de data/.
# Se busca en TODO el arbol, no solo en data/skills/<nombre>: una copia bajo una
# categoria (data/skills/productivity/flujo/) tapa exactamente igual, y es lo
# que reporta agente-check. Se saltean los directorios que el motor tampoco
# indexa (EXCLUDED_SKILL_DIRS): lo que esta en .archive/ ya esta fuera de juego.
APARTADAS_DIR="$AGENTE/skills-reemplazadas"
apartadas=0
for s in "$KIT"/skills/*/; do
  nombre="$(basename "$s")"
  while IFS= read -r vieja; do
    [[ -f "$vieja/SKILL.md" ]] || continue
    rel="${vieja#"$DATA"/skills/}"
    mkdir -p "$APARTADAS_DIR/$(dirname "$rel")"
    rm -rf "${APARTADAS_DIR:?}/$rel"
    mv "$vieja" "$APARTADAS_DIR/$rel"
    echo "apartada  data/skills/$rel → skills-reemplazadas/$rel (tapaba a la del kit)"
    apartadas=$((apartadas+1))
  done < <(find "$DATA/skills" \
             \( -name .archive -o -name .git -o -name .github -o -name .hub \
                -o -name node_modules -o -name __pycache__ -o -name .venv \) -prune -o \
             -type d -name "$nombre" -print 2>/dev/null)
done

# Carpetas que el kit da por sentadas (el portal las lee, las skills escriben).
for carpeta in workspace/entregables workspace/artifacts workspace/entrada workspace/interno; do
  mkdir -p "$DATA/$carpeta"
done

# LO EJECUTABLE DE politica/. Los hooks los corre el motor con su intérprete,
# pero `cont-init-parches.sh` lo corre s6 por ruta: sin el bit de ejecución no
# se aplica el parche y —como el cont-init es lo único que lo dispara— el
# cliente recibe el mensaje de pairing en inglés sin un solo error en el log.
chmod +x "$POLITICA"/hooks/*.py "$POLITICA/cont-init-parches.sh"

# La política de la guardia. Se crea VACIA si no está, nunca se pisa: acá se
# anota lo que cada cliente habilitó, y es del agente, no del kit.
[[ -s "$POLITICA/politica.json" ]] || { echo '{}' > "$POLITICA/politica.json"; echo "creado politica/politica.json"; }

# MIGRACION del catalogo de capacidades, que antes se instalaba en data/. Se
# borra solo si es IDENTICO al del kit —o sea, nuestro y sin tocar—: un archivo
# viejo en la ruta que el adapter ya no lee es una trampa para el que venga a
# depurar. Si alguien lo edito, se avisa y se deja: borrar el trabajo de otro no
# es idempotente.
VIEJO="$DATA/capacidades/catalogo.json"
if [[ -f "$VIEJO" ]]; then
  if diff -q "$KIT/capacidades/catalogo.json" "$VIEJO" >/dev/null 2>&1; then
    rm -f "$VIEJO"; rmdir "$DATA/capacidades" 2>/dev/null || true
    echo "quitado data/capacidades/catalogo.json (ahora vive en politica/, de solo lectura)"
  else
    echo "OJO: data/capacidades/catalogo.json está editado y ya no se lee (el bueno es politica/capacidades/catalogo.json)"
  fi
fi

# Manifiesto de QUÉ skills son del kit. El adapter lo usa para distinguir las
# "del producto tuagente" (comunes a todos, sostienen pantallas del portal, no
# se editan desde ahí) de las hechas para ESTE cliente (editables). Sin esto,
# todas parecen del cliente y el portal ofrece editar la que sostiene la
# pestaña de entregas.
mkdir -p "$DATA/skills"
ls -1 "$KIT/skills" > "$DATA/skills/.kit_manifest"
echo "instalado data/skills/.kit_manifest"

if [[ $apartadas -gt 0 ]]; then
  cat <<AVISO

OJO: aparté $apartadas skill(s) que estaban duplicadas en data/skills/. Ese
directorio le gana al externo, así que hasta ahora el agente corría la copia
vieja. Quedaron en $APARTADAS_DIR/
—afuera del árbol que el motor indexa—: revisá que no hubiera nada hecho a
mano y borralas cuando estés seguro.
AVISO
fi

cat <<'FIN'

Instalado. Lo que falta hacer a mano:

  0. El compose tiene que montar las skills del kit de solo lectura y el
     config declararlas, o el agente no las ve:
       volumes:  - ./kit-skills:/opt/kit/skills:ro     (hermes y portal-adapter)
       config:   skills.external_dirs: ["/opt/kit/skills"]
     Los dos vienen puestos en compose/ y en compose/config.base.yaml.

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
