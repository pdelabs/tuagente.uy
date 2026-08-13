#!/usr/bin/env bash
# ¿Un agente LOCAL y uno REMOTO reciben exactamente el mismo kit?
#
#   tools/comparar-instaladores.sh
#
# Arma dos agentes de mentira en /tmp —uno con `install.sh`, el camino local, y
# otro con `desplegar-remoto.sh --destino-local`, el camino de la VPS— y compara
# los dos arboles archivo por archivo, por ruta y por sha256. Cualquier
# diferencia es una falla.
#
# POR QUE EXISTE. Durante meses hubo dos instaladores del mismo kit con dos
# listas escritas a mano, y divergieron cuatro veces sin que nada fallara:
#
#   - el catalogo de capacidades no llego a NINGUN agente remoto — o sea que la
#     feature entera estuvo muerta en los clientes de verdad, no en las pruebas;
#   - el parche del pairing no llego a los locales: el cliente recibia el primer
#     mensaje del bot en ingles, pidiendole que corriera un comando de terminal
#     justo cuando el portal le decia "pegá el código acá";
#   - `HERMES_DASHBOARD=0` se arreglo en el compose remoto y nunca llego a la
#     plantilla de altas: crash-loop 27 veces por minuto en todo agente local;
#   - `.kit_manifest` y las carpetas del workspace, en uno solo de los dos.
#
# Todas la misma firma: nada rompe, nadie se entera, el cliente recibe una
# version peor. El arreglo de fondo fue dejar UN instalador —el desplegador le
# corre install.sh a un staging y sube eso—, pero un arreglo que depende de que
# nadie vuelva a agregar una linea a mano no esta terminado. Esto es lo que
# convierte esa deriva en una falla ruidosa.
#
# ⚠️ ESTO NO VALIDA EL PROTOCOLO, Y NO ES UN DETALLE. Corre el desplegador con
# `--destino-local`, o sea rsync en modo local, y el rsync de la Mac es
# **openrsync**, no el GNU de la VPS. Los dos no se comportan igual:
# `--no-implied-dirs` paso este chequeo con rc=0 y "29 archivos idénticos"
# mientras rompia el despliegue remoto al 100% (GNU aborta el envio entero,
# rc=2, cero archivos, el agente sin adapter ni politica/ ni kit-skills).
# Lo que se valida aca es QUE archivos van y con que contenido.
# **Cualquier opcion de rsync se prueba con `tools/probar-despliegue-ssh.sh`,
# que despliega contra un sshd de verdad con el rsync de GNU.**
set -uo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BANCO="$(mktemp -d)"
trap 'rm -rf "$BANCO"' EXIT

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

echo "banco de pruebas: $BANCO"
echo

# ── el camino LOCAL: install.sh sobre el data/ de un agente ───────────────
LOCAL_AG="$BANCO/local"
mkdir -p "$LOCAL_AG/data"
"$KIT/install.sh" "$LOCAL_AG/data" > "$BANCO/salida-local.txt" 2>&1 || {
  echo "FALLA: install.sh no pudo instalar"; sed 's/^/   /' "$BANCO/salida-local.txt"; exit 1; }
echo "camino local:  $(wc -l < "$LOCAL_AG/.kit-instalado" | tr -d ' ') archivos"

# ── el camino REMOTO: el desplegador contra un directorio ─────────────────
REMOTO_RAIZ="$BANCO/remoto"
"$KIT/desplegar-remoto.sh" prueba --destino-local "$REMOTO_RAIZ" ejemplo.local \
  > "$BANCO/salida-remota.txt" 2>&1 || {
  echo "FALLA: el desplegador no pudo desplegar"; sed 's/^/   /' "$BANCO/salida-remota.txt"; exit 1; }
REMOTO_AG="$REMOTO_RAIZ/opt/agentes/prueba"
echo "camino remoto: $(wc -l < "$REMOTO_AG/.kit-instalado" | tr -d ' ') archivos"
echo

# ── la comparacion ────────────────────────────────────────────────────────
fallas=0

# 1. Los manifiestos, que son la lista de lo que cada camino dice haber puesto.
if ! diff -q "$LOCAL_AG/.kit-instalado" "$REMOTO_AG/.kit-instalado" >/dev/null; then
  echo "FALLA: los dos caminos instalan cosas distintas —"
  diff "$LOCAL_AG/.kit-instalado" "$REMOTO_AG/.kit-instalado" \
    | grep '^[<>]' | sed 's/^</   solo LOCAL : /; s/^>/   solo REMOTO: /' | cut -c1-100
  fallas=$((fallas+1))
fi

# 2. Y los archivos de verdad, no solo lo que el manifiesto promete: cada ruta
#    de la union de los dos, comparada por contenido en los dos arboles.
while IFS= read -r rel; do
  a="$LOCAL_AG/$rel"; b="$REMOTO_AG/$rel"
  if [[ ! -f "$a" ]]; then echo "FALLA: falta en el agente LOCAL:  $rel"; fallas=$((fallas+1)); continue; fi
  if [[ ! -f "$b" ]]; then echo "FALLA: falta en el agente REMOTO: $rel"; fallas=$((fallas+1)); continue; fi
  if [[ "$(sha "$a")" != "$(sha "$b")" ]]; then
    echo "FALLA: distinto contenido: $rel"; fallas=$((fallas+1)); continue
  fi
  # El bit de ejecucion cuenta: sin el, `cont-init-parches.sh` no lo corre s6 y
  # el cliente recibe el mensaje de pairing en ingles, sin un error en el log.
  if [[ -x "$a" && ! -x "$b" ]] || [[ ! -x "$a" && -x "$b" ]]; then
    echo "FALLA: permisos distintos (uno es ejecutable y el otro no): $rel"; fallas=$((fallas+1))
  fi
done < <(cut -f1 "$LOCAL_AG/.kit-instalado" "$REMOTO_AG/.kit-instalado" | sort -u)

# 2b. Los ARBOLES de verdad, no solo lo que los manifiestos prometen. Sin esto,
#     una linea agregada a mano en el desplegador —un `rsync` de mas— pone un
#     archivo en el agente del cliente que el camino local no tiene, y ningun
#     manifiesto se entera. Lo unico que puede diferir es lo que es propio de
#     una VPS: el compose, el Caddyfile, los .env y el config.yaml.
# `secretos.env` está acá y `data/.env` NO: las claves salieron de data/ (era
# ejecución de código adentro del adapter, ver PENDIENTES). Si alguna vez
# reaparece un data/.env, que este chequeo se queje.
SOLO_DESPLIEGUE="docker-compose.yml Caddyfile .env data/config.yaml secretos.env"
arbol() { (cd "$1" && find . -type f | sed 's|^\./||' | sort); }
arbol "$LOCAL_AG" > "$BANCO/arbol-local.txt"
printf '%s\n' $SOLO_DESPLIEGUE | sort > "$BANCO/solo-despliegue.txt"
arbol "$REMOTO_AG" | comm -23 - "$BANCO/solo-despliegue.txt" > "$BANCO/arbol-remoto.txt"
while IFS= read -r extra; do
  [[ -n "$extra" ]] || continue
  echo "FALLA: el despliegue puso un archivo que el instalador local no pone: $extra"
  echo "       (¿alguien volvió a agregar una línea a mano en desplegar-remoto.sh?)"
  fallas=$((fallas+1))
done < <(comm -13 "$BANCO/arbol-local.txt" "$BANCO/arbol-remoto.txt")
while IFS= read -r falta; do
  [[ -n "$falta" ]] || continue
  echo "FALLA: el instalador local pone un archivo que al remoto no le llega: $falta"
  fallas=$((fallas+1))
done < <(comm -23 "$BANCO/arbol-local.txt" "$BANCO/arbol-remoto.txt")

# 3. Las carpetas que el kit da por sentadas y que no son archivos: si el
#    remoto no las crea, las skills escriben en un lugar que no existe.
while IFS= read -r d; do
  [[ -d "$REMOTO_AG/$d" ]] || { echo "FALLA: el agente REMOTO no tiene la carpeta $d/"; fallas=$((fallas+1)); }
done < <(cd "$LOCAL_AG" && find . -type d -empty | sed 's|^\./||' | sort)

# 3b. LA BARRA FINAL. `install.sh <agente>/data/` —la que agrega el
#     tab-completion— tiene que dar el MISMO manifiesto que sin barra. Cuando no
#     lo daba, las rutas salian `data//scripts/portal_adapter.py`, la corrida
#     siguiente las veia como obsoletas, resolvian al archivo recien instalado,
#     el sha coincidia y el limpiador BORRABA el adapter del portal: el servicio
#     :8643 entero, en silencio y con rc=0. Se cura normalizando `DATA` con
#     `cd && pwd`; esto esta aca para que no vuelva.
BARRA="$BANCO/barra"
mkdir -p "$BARRA/data"
"$KIT/install.sh" "$BARRA/data/" > "$BANCO/salida-barra.txt" 2>&1 || {
  echo "FALLA: install.sh con barra final terminó con error"; sed 's/^/   /' "$BANCO/salida-barra.txt"
  fallas=$((fallas+1)); }
if [[ -f "$BARRA/.kit-instalado" ]]; then
  if ! diff -q <(cut -f1 "$LOCAL_AG/.kit-instalado") <(cut -f1 "$BARRA/.kit-instalado") >/dev/null; then
    echo "FALLA: el manifiesto cambia según se pase la ruta con barra final o sin ella —"
    diff <(cut -f1 "$LOCAL_AG/.kit-instalado") <(cut -f1 "$BARRA/.kit-instalado") | grep '^[<>]' | sed 's/^/   /'
    fallas=$((fallas+1))
  fi
  # Y la segunda corrida, la que borraba: sin barra sobre lo instalado con barra.
  "$KIT/install.sh" "$BARRA/data" > "$BANCO/salida-barra2.txt" 2>&1
  for imprescindible in kit-adapter/portal_adapter.py data/connections/catalogo.json; do
    [[ -f "$BARRA/$imprescindible" ]] || {
      echo "FALLA: la segunda corrida borró $imprescindible"; fallas=$((fallas+1)); }
  done
fi

# 4. Lo que NO tiene que viajar nunca.
if [[ -f "$REMOTO_AG/politica/politica.json" ]]; then
  contenido="$(tr -d '[:space:]' < "$REMOTO_AG/politica/politica.json")"
  [[ "$contenido" == "{}" ]] || { echo "FALLA: politica.json del staging viajó con contenido"; fallas=$((fallas+1)); }
fi
if grep -qxF "politica/politica.json" <(cut -f1 "$LOCAL_AG/.kit-instalado"); then
  echo "FALLA: politica.json entró al manifiesto — el despliegue se lo pisaría al cliente"
  fallas=$((fallas+1))
fi

echo
if [[ $fallas -eq 0 ]]; then
  echo "Los dos caminos instalan lo mismo: $(wc -l < "$LOCAL_AG/.kit-instalado" | tr -d ' ') archivos idénticos."
  exit 0
fi
echo "$fallas divergencia(s) entre el instalador local y el despliegue remoto."
echo "Los dos tienen que poner lo mismo: el kit se instala en un solo lugar"
echo "(install.sh) y el desplegador sube ESO. Si agregaste algo a uno solo, sacalo."
exit 1
