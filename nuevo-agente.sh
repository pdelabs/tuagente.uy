#!/usr/bin/env bash
# Crea el esqueleto de un agente para un cliente nuevo y le instala el kit.
#
#   ./nuevo-agente.sh acme "Acme SA" ~/Desktop/Luis/Projects/agente-acme [8642]
#                     ^slug ^nombre visible del agente   ^dónde crearlo  ^puerto
#
# El cuarto argumento es el puerto del GATEWAY en el host; el adapter va en el
# siguiente. Por defecto 8642/8643, que es lo correcto cuando el cliente tiene
# su propia VPS. En un host donde ya vive otro agente hay que moverlo: 8742,
# 8842, etc.
#
# Deja todo listo salvo lo artesanal: escribir el SOUL y cargar las claves.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; NOMBRE="${2:-}"; DESTINO="${3:-}"; PUERTO="${4:-8642}"

if [[ -z "$SLUG" || -z "$NOMBRE" || -z "$DESTINO" ]]; then
  echo 'uso: ./nuevo-agente.sh <slug> "<Nombre del agente>" <ruta> [puerto-base]' >&2
  exit 2
fi
if [[ -e "$DESTINO" ]]; then
  echo "Ya existe $DESTINO — no piso nada." >&2
  exit 2
fi

# LOS PUERTOS SE VALIDAN ACA, ANTES DE CREAR NADA, por el mismo motivo que la
# version del SOUL: si el choque aparece en el `docker compose up -d` —que es
# donde aparecia, porque los nombres de contenedor SI llevan el slug y no
# chocan— ya escribiste el SOUL y cargaste las claves. Los tres ultimos agentes
# del lab se editaron a mano despues de crearlos.
[[ "$PUERTO" =~ ^[0-9]+$ ]] && (( PUERTO >= 1024 && PUERTO <= 65534 )) || {
  echo "el puerto base tiene que ser un número entre 1024 y 65534 (dijiste '$PUERTO')." >&2
  exit 2
}
PUERTO_ADAPTER=$((PUERTO + 1))

ocupado() {
  # `lsof` ve cualquier listener del host, incluido el docker-proxy de otro
  # agente; el `/dev/tcp` de bash es el plan B para una máquina sin lsof.
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    exec 3<&-
    return 0
  fi
  return 1
}

tomados=()
for p in "$PUERTO" "$PUERTO_ADAPTER"; do
  if ocupado "$p"; then tomados+=("$p"); fi
done
if (( ${#tomados[@]} )); then
  sugerido="$PUERTO"
  for _ in $(seq 1 100); do
    sugerido=$((sugerido + 100))
    if ! ocupado "$sugerido" && ! ocupado $((sugerido + 1)); then break; fi
  done
  echo "puerto(s) ocupado(s) en este host: ${tomados[*]} — ¿ya hay otro agente acá?" >&2
  echo "Cada agente necesita DOS puertos libres y consecutivos (gateway y adapter)." >&2
  echo "   ./nuevo-agente.sh $SLUG \"$NOMBRE\" $DESTINO $sugerido" >&2
  exit 2
fi

# La version del bloque de SOUL se valida ACA, antes de crear nada: si no tiene
# forma de version, el marcador sale mal y `agente-check.py` lo reporta como
# marcadores desbalanceados, que manda a buscar el problema a otro lado. Y si
# esto muriera despues del mkdir, quedaria un agente a medio armar.
[[ -f "$KIT/soul/VERSION" ]] || {
  echo "falta $KIT/soul/VERSION, que dice qué versión del bloque instala el kit." >&2
  echo "Es una línea con la versión (vN): echo v2 > $KIT/soul/VERSION" >&2
  exit 2
}
SOUL_VERSION="$(tr -d '[:space:]' < "$KIT/soul/VERSION")"
[[ "$SOUL_VERSION" =~ ^v[0-9]+$ ]] || {
  echo "soul/VERSION dice '$SOUL_VERSION' y tiene que ser vN (v1, v2, v3…)." >&2
  exit 2
}

mkdir -p "$DESTINO/data"/{skills,scripts,memories,workspace/{entregables,artifacts,entrada,interno}}
cd "$DESTINO"

# Compose, con el slug, el nombre y los puertos ya reemplazados.
sed -e "s/\${CLIENTE}/$SLUG/g" -e "s/\${AGENT_NAME}/$NOMBRE/g" \
    -e "s/\${PUERTO_GATEWAY}/$PUERTO/g" -e "s/\${PUERTO_ADAPTER}/$PUERTO_ADAPTER/g" \
    "$KIT/compose/docker-compose.example.yml" > docker-compose.yml
# Si quedó algún ${…} sin resolver, el compose no arranca y el error de Docker
# no dice cuál es: mejor enterarse acá.
if grep -n '\${' docker-compose.yml >/dev/null; then
  echo "el compose generado quedó con placeholders sin resolver:" >&2
  grep -n '\${' docker-compose.yml >&2
  exit 2
fi

# LAS CLAVES VAN AFUERA DE data/. `data/` es del agente —la tiene rw y adentro
# corre como root—, y este archivo es el env_file de los dos servicios: con las
# claves ahi adentro, el agente se escribe un PYTHONPATH y ejecuta codigo suyo
# adentro del adapter. Medido. Vive en la raiz del agente, que no monta nadie.
cat > secretos.env <<'ENV'
# Las claves del agente. NUNCA se commitea. root:root 600 en el servidor.
API_SERVER_KEY=          # openssl rand -hex 32 — única por cliente
OPENROUTER_API_KEY=      # o la del proveedor de modelos que uses
TELEGRAM_BOT_TOKEN=      # de @BotFather
TELEGRAM_ALLOWED_USERS=  # ids autorizados; sin esto le escribe cualquiera
# SMTP_USER=
# SMTP_APP_PASSWORD=
ENV
chmod 600 secretos.env

# EL .gitignore VA POR LISTA BLANCA, y no es prolijidad: `data/` es del agente y
# del motor, que escriben ahi en cada arranque (auth.json, gateway.pid,
# gateway-starts.log, cron/, bin/, state/, sus 70 skills stock, las bases y sus
# -wal/-shm…). Con la lista negra que habia —`data/*.db*`, `cache/` y `logs/`—
# el `git status` del repo del cliente salia con 30 entradas despues del PRIMER
# arranque, casi todas del motor, y dejaba de servir para lo unico que sirve:
# ver si tocaste algo. Y una lista negra nace incompleta: cada version del motor
# estrena archivos nuevos y nadie va a volver a este archivo a agregarlos.
#
# Se versiona lo que escribe una PERSONA o lo que pone el kit: el SOUL, el
# config, el catalogo de conexiones y el manifiesto de skills del kit. Todo lo
# de afuera de data/ (kit-skills/, kit-adapter/, politica/, el compose) ya se
# versiona entero — es justamente lo que un `install.sh` cambia y hay que poder
# revisar.
cat > .gitignore <<'IGNORE'
# Las claves, nunca.
secretos.env
data/.env

# data/ es del agente: se ignora entero y se nombra lo que si versionamos.
data/*
!data/SOUL.md
!data/config.yaml
!data/connections/
!data/skills/
data/skills/*
!data/skills/.kit_manifest

__pycache__/
.DS_Store
IGNORE

# Config: la MISMA que usa el despliegue remoto, sin copia paralela. Antes esto
# era un heredoc con el config repetido acá adentro, y ya habia empezado a
# separarse del de compose/. El bloque de skills apagadas son 66 nombres
# generados: mantenerlo en dos lados era garantia de que uno quedara viejo.
cp "$KIT/compose/config.base.yaml" data/config.yaml

# Borrador del SOUL: la identidad con los placeholders intactos, y abajo el
# bloque del kit. La identidad va PRIMERO y AFUERA de los marcadores: es la
# parte que se escribe cliente por cliente —incluidas las acciones sensibles
# propias de la empresa— y es la que el reemplazo de version conserva palabra
# por palabra. Lo generico va adentro de `kit:base`, con su version: es lo que
# despues dice que reglas corre este agente sin leerle el prompt entero.
#
# El bloque sale del CONGELADO (soul/versiones/vN.md), no de pegar los .md acá:
# tiene que ser byte a byte el mismo que instala `instalar-soul.sh` y contra el
# que `reemplazar-bloque.py` va a comparar el dia que este agente suba de
# version. Con dos composiciones distintas —esta no resolvia <RESPONSABLE>—, el
# primer reemplazo veia esa diferencia como texto escrito por el cliente.
# ($SOUL_VERSION se validó arriba, antes de crear nada.)
BLOQUE="$KIT/soul/versiones/$SOUL_VERSION.md"
[[ -f "$BLOQUE" ]] || {
  echo "falta $BLOQUE: este kit nunca congeló el bloque $SOUL_VERSION." >&2
  echo "   ./tools/instalar-soul.sh --bloque > soul/versiones/$SOUL_VERSION.md" >&2
  exit 2
}
if ! "$KIT/tools/instalar-soul.sh" --bloque | diff -q "$BLOQUE" - >/dev/null; then
  echo "los bloques de soul/ ya no componen lo que dice $BLOQUE." >&2
  echo "Subí soul/VERSION y congelá la nueva, o volvé a congelar esta:" >&2
  echo "   ./tools/instalar-soul.sh --bloque > soul/versiones/$SOUL_VERSION.md" >&2
  exit 2
fi
{
  cat "$KIT/soul/00-identidad.md"; echo
  cat "$BLOQUE"
} > data/SOUL.md

cat > README.md <<README
# Agente de $NOMBRE

Agente de tuagente.uy para $NOMBRE. El adapter y las skills se instalan desde
\`hermes-kit\` — no se editan acá (ver \`install.sh --diff\`).

\`\`\`bash
docker compose up -d
\`\`\`
README

"$KIT/install.sh" "$DESTINO/data" >/dev/null
git init -q && git add -A && git commit -qm "Agente de $NOMBRE: esqueleto + kit de tuagente"

cat <<FIN

Listo: $DESTINO
Puertos en este host: gateway 127.0.0.1:$PUERTO · adapter 127.0.0.1:$PUERTO_ADAPTER

Lo que falta, en orden:

  1. data/SOUL.md — está el borrador con TODOS los placeholders <ASÍ> sin
     completar. Es el trabajo real: quién es, qué hace, qué NO hace y qué
     requiere aprobación. Sin esto el agente tiene herramientas y ninguna regla.
  2. completar las claves en secretos.env (está en la raíz del agente,
     NO adentro de data/: ahí el agente las podría leer y reescribir).
     (data/config.yaml ya viene con el modelo, el api server y las tools
      nativas de kanban — revisalo si el cliente usa otro proveedor.)
  3. python3 $KIT/tools/agente-check.py $DESTINO/data
     0 fallas ANTES de prender: agarra el SOUL con huecos, las skills sin
     frontmatter y los olvidos de config, sin levantar nada.
  4. docker compose up -d
  5. python3 $KIT/tools/portal-check.py --key <API_SERVER_KEY> \\
       --endpoint http://127.0.0.1:$PUERTO --adapter http://127.0.0.1:$PUERTO_ADAPTER
     0 fallas o no se entrega.
  6. Primera tarea del agente: que investigue la web de la empresa y entregue
     su brief — ver onboarding/brief-empresa.md. Sale un borrador para revisar,
     y de ahí salen 3-4 líneas para el SOUL.
  7. DEJALO EN CERO, que es lo último que se hace y lo que más se olvida:
     $KIT/tools/resetear-agente.sh --local $DESTINO --entrega
     Los pasos 5 y 6 ensucian —conversaciones, gasto en Uso, entregables de
     prueba— y el cliente abre su portal el primer día. Esto borra esa huella
     y conserva lo que escribiste: el SOUL, los flujos y las tareas.
  8. python3 $KIT/tools/portal-check.py --key <API_SERVER_KEY> --entrega \\
       --endpoint http://127.0.0.1:$PUERTO --adapter http://127.0.0.1:$PUERTO_ADAPTER
     0 fallas = cumple el contrato Y llega en cero. Recién ahí se manda el link.

Runbook completo (canales, WhatsApp, tiempos): tuagente.uy/docs/alta-cliente.md
FIN
