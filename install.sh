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
# NORMALIZAR LA RUTA NO ES COSMETICA: ES EL BUG MAS CARO QUE TUVO ESTE SCRIPT.
# `AGENTE` sale de un `cd && pwd`, o sea que viene limpia; `DATA` venia tal cual
# la tipeo la persona. Con la barra final que agrega el tab-completion
# (`install.sh <agente>/data/`) las rutas del manifiesto salian con doble barra
# —`data//scripts/portal_adapter.py`—, y a la corrida siguiente sin barra el
# limpiador veia esa ruta como obsoleta, la resolvia al archivo recien instalado
# (el doble slash lo colapsa el sistema de archivos), le daba el sha correcto
# —es el mismo byte a byte— y LO BORRABA. En silencio y con rc=0. Se llevaba
# puesto el adapter del portal y el catalogo de conexiones: el servicio :8643
# entero, o sea tickets, aprobaciones, entregables, archivos, actividad, uso y
# capacidades. Pasaba en las dos direcciones y no se curaba solo.
DATA="$(cd "$DATA" && pwd)"

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
# EL CODIGO DEL ADAPTER NO VIVE MAS ADENTRO DE data/, Y ES UNA ESCALADA DE
# PRIVILEGIO, NO UNA prolijidad. `data/` es del agente (uid 10000, montada rw en
# su contenedor), asi que el agente podia REESCRIBIR
# `data/scripts/portal_adapter.py`. Y ese archivo es el que el contenedor
# `portal-adapter` ejecuta, hasta hoy como root, con `./politica` montada rw:
# adentro estan `politica.json` (los permisos que cargo el cliente),
# `hooks/puerta.py` (la puerta) y el catalogo de capacidades. O sea que el
# agente llegaba a todos los guardrails en dos saltos —escribir el archivo,
# esperar un reinicio—, justo lo que el compose dice que no se puede ("un
# guardrail que el guardado puede cambiar no es un guardrail").
#
# Ahora vive en `<agente>/kit-adapter/`, hermano de `kit-skills/` y `politica/`,
# que el compose monta :ro para el adapter. Y el adapter corre como uid 10000,
# no como root: verificado en el lab, portal-check 14/14 y escribiendo
# politica.json y pedidos.jsonl igual.
KIT_ADAPTER="$AGENTE/kit-adapter"
# EL ADAPTER DEJO DE SER UN ARCHIVO, y una lista a mano no se entera. Desde que
# se partio en workspace/kanban/flows, `portal_adapter.py` los IMPORTA: subir
# solo el archivo grande deja un adapter que no arranca —ImportError en el
# import de flows— y con el se van tablero, aprobaciones, artefactos, archivos,
# actividad y uso. O sea el producto, y sin ruido: el kit "instala bien".
# Se arma desde el directorio, como los hooks, asi el dia que aparezca un cuarto
# modulo viaja solo. Los `test_*.py` se quedan en el kit.
ADAPTER_PY=()
while IFS= read -r f; do
  ADAPTER_PY+=("$(basename "$f")")
done < <(find "$KIT/adapter" -maxdepth 1 -type f -name "*.py" ! -name "test_*" | sort)
[[ ${#ADAPTER_PY[@]} -gt 0 ]] || { echo "adapter/: no hay ningun .py que instalar" >&2; exit 1; }

ARCHIVOS=(
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
for m in "${ADAPTER_PY[@]}"; do
  ARCHIVOS+=("adapter/$m:$KIT_ADAPTER/$m")
done
# LA RUTA VIEJA SE SIGUE INSTALANDO MIENTRAS EL COMPOSE LA USE. Si sacaramos
# `data/scripts/portal_adapter.py` con el compose todavia apuntando ahi, el
# proceso vivo sigue andando (tiene el archivo abierto) pero un `docker restart`
# —sin `compose up -d`— arranca con el entrypoint viejo sobre un archivo que ya
# no existe: crash-loop del portal, y el cliente sin tablero ni aprobaciones.
# Mientras esta en la lista tambien esta en el manifiesto, asi que el limpiador
# no la ve como obsoleta. Cuando el compose apunte al lugar nuevo, deja de
# instalarse, pasa a ser obsoleta y recien ahi se va sola.
COMPOSE_AGENTE="$AGENTE/docker-compose.yml"
if [[ -f "$COMPOSE_AGENTE" ]] && grep -q '/opt/data/scripts/portal_adapter.py' "$COMPOSE_AGENTE"; then
  # Los modulos van TAMBIEN por la ruta vieja: el import es relativo al archivo
  # que se ejecuta, asi que un agente sin migrar que reciba solo el grande queda
  # igual de roto que uno nuevo.
  for m in "${ADAPTER_PY[@]}"; do
    ARCHIVOS+=("adapter/$m:$DATA/scripts/$m")
  done
fi

# Los hooks se ARMAN desde el directorio, como las skills: el día que haya un
# segundo hook, una lista a mano lo deja afuera y la puerta queda a medias.
while IFS= read -r f; do
  ARCHIVOS+=("politica/hooks/$(basename "$f"):$POLITICA/hooks/$(basename "$f")")
done < <(find "$KIT/politica/hooks" -type f -name "*.py" ! -path "*/__pycache__/*" | sort)
# Los plugins del motor, igual: la carpeta entera, con su plugin.yaml. Van a
# politica/ y NO a data/plugins/ —que es donde el motor los busca— porque
# data/ es del agente: el compose monta politica/plugins encima, de solo
# lectura, y así la guardia de las promesas no se la puede sacar de encima.
while IFS= read -r f; do
  rel="${f#"$KIT"/politica/plugins/}"      # promesas/promesas.py
  ARCHIVOS+=("politica/plugins/$rel:$POLITICA/plugins/$rel")
done < <(find "$KIT/politica/plugins" -type f \( -name "*.py" -o -name "*.yaml" \) ! -path "*/__pycache__/*" | sort)
for c in "$KIT"/connections/*/tools.json; do
  [[ -f "$c" ]] || continue
  ARCHIVOS+=("connections/$(basename "$(dirname "$c")")/tools.json:$POLITICA/tools/$(basename "$(dirname "$c")").json")
done
while IFS= read -r f; do
  rel="${f#"$KIT"/connections/}"           # mercadopago/mcp/servidor.py
  conexion="${rel%%/*}"
  ARCHIVOS+=("connections/$rel:$POLITICA/mcp/$conexion/${rel#"$conexion"/mcp/}")
done < <(find "$KIT"/connections/*/mcp -type f ! -path "*/__pycache__/*" 2>/dev/null | sort)
# WHICH SKILLS THIS AGENT GETS, AND IT IS NO LONGER "ALL OF THEM". The kit used
# to copy every skill into kit-skills/, which the compose mounts for the WHOLE
# installation -- so on a client with a team the accounting role was indexing
# the brand kit and the Instagram writer, and a skill's description is loaded on
# EVERY request. A role carrying the whole kit is the single fat agent this
# pivot exists to replace.
#
# THE MARKER IS THE ROSTER, the same file the adapter reads to decide whether
# this client has a team (`ROLES_CATALOG.is_file()` in portal_adapter.py).
# Presence, never a value someone wrote. Without it nothing changes: a pre-pivot
# client gets the whole kit exactly like yesterday.
#
# With a roster only the shared skills travel here; the craft ones arrive with
# the role that claims them (`tools/contratar-rol.sh` installs the profile with
# its skills inside). Who is shared and who is not is COMPUTED from the roles by
# roles/skills_split.py, not written down here: a list by hand is how two skills
# once made it into the kit and never into a new agent.
ROSTER="$POLITICA/roles/catalogo.json"
SKILLS_A_INSTALAR=()
if [[ -f "$ROSTER" ]]; then
  while IFS= read -r s; do
    SKILLS_A_INSTALAR+=("$s")
  done < <(python3 "$KIT/roles/skills_split.py" --shared)
  # If the split cannot be computed there is no safe fallback: installing
  # everything would put the craft skills back on every role, and installing
  # nothing would take the portal's screens down. Stop before writing anything.
  [[ ${#SKILLS_A_INSTALAR[@]} -gt 0 ]] || {
    echo "roles/skills_split.py no dijo qué skills son compartidas. No instalé nada." >&2
    exit 1
  }
  # The roster is OURS and closed -- the client never writes it (a renamed role
  # lives in the profile's role.json). Keeping it in the install is what makes a
  # new role show up as available to a client that already has a team, instead
  # of waiting for someone to copy a file by hand.
  ARCHIVOS+=("roles/catalogo.json:$ROSTER")
else
  while IFS= read -r d; do
    SKILLS_A_INSTALAR+=("$(basename "$d")")
  done < <(find "$KIT/skills" -mindepth 1 -maxdepth 1 -type d | sort)
fi

for s in "${SKILLS_A_INSTALAR[@]}"; do
  while IFS= read -r f; do
    rel="${f#"$KIT"/}"                     # skills/entregable/SKILL.md
    ARCHIVOS+=("$rel:$KIT_SKILLS/${rel#skills/}")
  done < <(find "$KIT/skills/$s" -type f \( -name "*.md" -o -name "*.py" \) \
    ! -path "*/evals/*" | sort)
done
# Los evals/ NO viajan a proposito: son nuestros, para probar la skill antes de
# soltarla. Adentro del agente no los corre nadie y solo ocupan prompt y disco.

corta() { echo "${1#"$AGENTE"/}"; }        # rutas legibles en los mensajes

# El manifiesto de lo instalado: <ruta relativa al agente><TAB><sha256>. Es la
# lista de los archivos QUE ESCRIBIMOS NOSOTROS, y existe para una sola cosa:
# poder sacar los que el kit dejó de traer sin poder tocar nada más.
#
# Es la diferencia entre "borrá todo lo que no esté en el origen" —que es como
# se le borra el trabajo a un cliente— y "borrá lo que pusiste vos y ya no
# traés". Un archivo del cliente NUNCA está en el manifiesto, así que no hay
# forma de que entre en el conjunto de candidatos a borrar: no es que lo
# excluimos, es que no puede estar. Y aun estando, solo se borra si su sha256
# sigue siendo el que escribimos: si alguien lo editó, se avisa y se deja.
#
# `politica/politica.json` es el ejemplo de por qué: vive en una carpeta 100%
# nuestra pero lo escribe el cliente (sus permisos), igual que
# `politica/capacidades/pedidos.jsonl`. Ninguno de los dos está en el
# manifiesto y por eso ninguno de los dos corre riesgo.
MANIFIESTO="$AGENTE/.kit-instalado"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

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
  # WHAT THIS AGENT GETS, not the kit's whole catalog -- same list the copy uses
  # below. On a team agent `brand-kit` is not shipped here, so a directory by
  # that name under data/skills/ is the CLIENT's, and calling it "una copia
  # vieja que tapa a la del kit" is a lie that ends with us moving it away.
  for s in "${SKILLS_A_INSTALAR[@]}"; do
    vieja="$DATA/skills/$s"
    [[ -d "$vieja" ]] && { echo "SOBRA    data/skills/$s — copia vieja, tapa a la del kit"; distintos=$((distintos+1)); }
  done
  # Lo que el kit instaló alguna vez y ya no trae: la instalación lo va a
  # quitar (si sigue igual a como lo dejamos) o a avisar (si alguien lo editó).
  if [[ -f "$MANIFIESTO" ]]; then
    esperados="$(mktemp)"
    { for par in "${ARCHIVOS[@]}"; do echo "${par##*:}" | sed "s|^$AGENTE/||"; done
      echo "data/skills/.kit_manifest"; } | sort > "$esperados"
    while IFS=$'\t' read -r ruta _; do
      [[ -n "${ruta:-}" && -f "$AGENTE/$ruta" ]] || continue
      echo "OBSOLETO $ruta — el kit ya no lo trae; la instalación lo quita"
      distintos=$((distintos+1))
    done < <(awk -F'\t' 'NR==FNR { esta[$0]=1; next } !($1 in esta)' "$esperados" "$MANIFIESTO")
    rm -f "$esperados"
  fi
  if [[ $distintos -eq 0 ]]; then
    echo "El agente está al día con el kit."
  else
    echo
    echo "$distintos archivo(s) distintos. Si el cambio bueno está en el agente,"
    echo "copialo al kit antes de instalar, o lo vas a pisar."
  fi
  exit 0
fi

# NADA SE COPIA QUE NO PUEDA SER NUESTRO, y se valida ANTES de escribir el
# primer archivo: si esto abortara a mitad del bucle, el agente quedaría con
# medio kit instalado. La lista de prefijos vive en el limpiador —el que después
# borra— y se le pide una sola vez, para que no haya dos copias que se separen.
PREFIJOS="$("$KIT/tools/limpiar-obsoletos.sh" --prefijos)"
for par in "${ARCHIVOS[@]}"; do
  ruta="${par##*:}"; ruta="${ruta#"$AGENTE"/}"
  ok=0
  while IFS= read -r pref; do
    case "$pref" in
      */) [[ "$ruta" == "$pref"* ]] && { ok=1; break; } ;;
      *)  [[ "$ruta" == "$pref"  ]] && { ok=1; break; } ;;
    esac
  done <<< "$PREFIJOS"
  if [[ $ok -eq 0 ]]; then
    echo "El kit iba a instalar '$ruta', que no es una ruta que el kit pueda" >&2
    echo "poseer. Dos causas, y la primera es la más común:" >&2
    echo "  · la ruta del agente está mal escrita — mirá que '$DATA' sea de verdad" >&2
    echo "    el data/ del agente (ojo con mayúsculas: en la Mac 'Data' y 'data'" >&2
    echo "    son el mismo directorio y esto sale distinto);" >&2
    echo "  · el kit empezó a instalar en un lugar nuevo, y entonces la ruta va" >&2
    echo "    (con su motivo) en PUEDE_SER_NUESTRO, en tools/limpiar-obsoletos.sh." >&2
    echo "No instalé nada." >&2
    exit 1
  fi
done

for par in "${ARCHIVOS[@]}"; do
  origen="$KIT/${par%%:*}"; destino="${par##*:}"
  mkdir -p "$(dirname "$destino")"
  # EL DESTINO SE BORRA ANTES DE COPIAR, y no es por prolijidad: `cp` SIGUE el
  # symlink del destino y escribe del otro lado. El agente corre como root con
  # /opt/data de escritura, asi que le alcanza con dejar
  # `data/scripts/portal_adapter.py -> data/state.db` para que el proximo
  # install le escriba el codigo del adapter ADENTRO de su propia base de datos.
  # Probado: pasa. (El camino remoto es inmune porque rsync reemplaza el
  # symlink; el local no lo era.) `cp --remove-destination` no existe en la Mac
  # y `install -T` tampoco, asi que se borra a mano, que anda en los dos lados.
  rm -f "$destino"
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
#
# IT WALKS THIS AGENT'S SELECTION AND NOT THE KIT'S CATALOG, and the difference
# is whose file it is. Setting a directory aside is justified by one sentence:
# there are two copies of THE SAME skill and the one in data/ shadows ours. On a
# team agent the kit does not ship `brand-kit` here -- it travels inside
# marketing's profile -- so a `data/skills/brand-kit` shadows nothing: it is the
# client's. Walking the whole catalog confiscated a client's own skill and told
# them it was shadowing a kit skill this agent is never going to receive.
APARTADAS_DIR="$AGENTE/skills-reemplazadas"
apartadas=0
for nombre in "${SKILLS_A_INSTALAR[@]}"; do
  while IFS= read -r vieja; do
    [[ -f "$vieja/SKILL.md" ]] || continue
    rel="${vieja#"$DATA"/skills/}"
    mkdir -p "$APARTADAS_DIR/$(dirname "$rel")"
    # APARTAR NUNCA PISA ALGO YA APARTADO. Acá había un `rm -rf` del destino, y
    # con eso la SEGUNDA colisión del mismo nombre destruía lo que la primera
    # había salvado: el agente vuelve a crear `data/skills/entregable`, el
    # install la aparta, y el trabajo de meses que estaba apartado ahí abajo se
    # va sin dejar rastro en ningún lado del árbol. Medido. Si el lugar está
    # ocupado, la copia nueva va al lado con la fecha, y si hasta eso choca,
    # no se toca nada y se avisa: perder trabajo no es una opción, tener dos
    # carpetas sí.
    aparte="$APARTADAS_DIR/$rel"
    if [[ -e "$aparte" ]]; then
      aparte="$APARTADAS_DIR/$rel.$(date +%Y%m%d-%H%M%S)"
    fi
    if [[ -e "$aparte" ]]; then
      echo "OJO: no aparté data/skills/$rel — ya hay una apartada y otra con la"
      echo "     misma fecha. Miralas en skills-reemplazadas/ y sacá la que sobre."
      continue
    fi
    mv "$vieja" "$aparte"
    echo "apartada  data/skills/$rel → $(corta "$aparte") (tapaba a la del kit)"
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
#
# IT IS WHAT THIS AGENT GOT, not the kit's whole catalog: on a team agent
# `brand-kit` lives inside marketing's profile and not here. The adapter adds
# the hired roles' skills when it builds the list (`_kit_names`), so a craft
# skill still counts as ours -- and a capability detected by `kit_skill` does
# not tell the client "you already have this" about something that is nowhere.
mkdir -p "$DATA/skills"
printf '%s\n' "${SKILLS_A_INSTALAR[@]}" > "$DATA/skills/.kit_manifest"
echo "instalado data/skills/.kit_manifest"

if [[ -f "$ROSTER" ]]; then
  echo "equipo: kit-skills/ quedó con las compartidas (${SKILLS_A_INSTALAR[*]})"
  echo "        las de oficio viajan con cada rol: tools/contratar-rol.sh <rol> <agente>"
  # OUT LOUD, because the alternative is a skill that reaches nobody: a skill in
  # the kit that no role claims and that is not a fallback note has no way into
  # a team agent. Either a role declares it or it does not exist for this client.
  #
  # A BANNER IS NOT WORTH ABORTING FOR, and under `set -euo pipefail` this
  # assignment was: the install had already copied every file, and a failure
  # here died before writing the manifest -- leaving the agent installed and the
  # cleanup never run. The install was already gated on `--shared` succeeding,
  # up where it still could stop without writing anything; this second call only
  # decorates the output. If it fails, no banner.
  huerfanas="$(python3 "$KIT/roles/skills_split.py" --orphan | tr '\n' ' ')" || huerfanas=""
  [[ -z "${huerfanas// }" ]] || echo "        sin dueño (no las trae ningún rol): ${huerfanas% }"
fi


# El manifiesto de lo que instalamos, y la limpieza de lo que el kit dejó de
# traer. Se arma DESPUÉS de copiar todo, con los sha256 de lo que quedó escrito.
# `data/skills/.kit_manifest` entra también: lo generamos nosotros y si algún día
# dejara de generarse, tiene que irse con lo demás.
{
  for par in "${ARCHIVOS[@]}"; do
    destino="${par##*:}"
    printf '%s\t%s\n' "${destino#"$AGENTE"/}" "$(sha "$destino")"
  done
  printf '%s\t%s\n' "data/skills/.kit_manifest" "$(sha "$DATA/skills/.kit_manifest")"
} | sort > "$MANIFIESTO.nuevo"

# (Las rutas ya se validaron contra PUEDE_SER_NUESTRO antes de copiar nada.)
"$KIT/tools/limpiar-obsoletos.sh" "$AGENTE"

# Y las claves salen de data/, que es del agente. El script no hace nada si ya
# estan afuera, y no las mueve si el compose todavia las nombra ahi (dejaria al
# agente sin arrancar): en ese caso avisa y migra en la pasada siguiente.
"$KIT/tools/migrar-secretos.sh" "$AGENTE"

# EL COMPOSE DE UN AGENTE QUE YA EXISTE NO LO ACTUALIZA NADIE. El remoto sí —el
# despliegue lo vuelve a subir de la plantilla en cada corrida—, pero el de un
# agente local es una copia que se hizo el día del alta. Si todavía arranca el
# adapter desde data/, este install le acaba de sacar ese archivo de ahí y el
# contenedor se va a morir en el próximo reinicio. Se avisa con lo que hay que
# cambiar, textual.
COMPOSE="$AGENTE/docker-compose.yml"
if [[ -f "$COMPOSE" ]] && grep -q '/opt/data/scripts/portal_adapter.py' "$COMPOSE"; then
  cat <<AVISO

OJO: $COMPOSE todavía arranca el adapter desde data/, que es del agente. El
código ya no está ahí (ahora vive en kit-adapter/, que se monta de solo
lectura), así que el contenedor se muere en el próximo reinicio. Cambiá en el
servicio portal-adapter:

    entrypoint: ["python3", "/opt/kit/adapter/portal_adapter.py"]
    user: "10000:10000"
    volumes:
      - ./kit-adapter:/opt/kit/adapter:ro     ← agregar

y después: docker compose up -d portal-adapter

(Está así en compose/docker-compose.example.yml, con el porqué al lado.)
AVISO
fi

# La misma historia con el montaje del plugin: el archivo ya está en
# politica/plugins/, pero el motor los busca en /opt/data/plugins. Sin la línea,
# la guardia de las promesas queda instalada y apagada — que es peor que no
# tenerla, porque `flota.md` va a decir que está.
if [[ -f "$COMPOSE" ]] && ! grep -q 'politica/plugins:/opt/data/plugins' "$COMPOSE"; then
  cat <<AVISO

OJO: $COMPOSE no monta el plugin `promesas`. Es lo que impide que el agente
anuncie un flujo que no creó, y sin el montaje no se carga. Agregá en el
servicio hermes:

    volumes:
      - ./politica/plugins:/opt/data/plugins:ro     ← agregar

y en data/config.yaml (si no está):

    plugins:
      enabled:
        - promesas

y después: docker compose up -d hermes   (un \`restart\` no alcanza: es un
montaje nuevo). Lo verifica tools/agente-check.py.
AVISO
fi

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
