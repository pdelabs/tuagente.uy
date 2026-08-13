#!/usr/bin/env bash
# Saca de un agente los archivos que el kit dejo de traer. Y NADA MAS.
#
#   tools/limpiar-obsoletos.sh <raiz-del-agente>
#
# Lee dos archivos de esa raiz:
#   .kit-instalado        lo que el kit instalo la vez anterior (ruta<TAB>sha256)
#   .kit-instalado.nuevo  lo que se acaba de instalar
# borra los que estan en el viejo y ya no en el nuevo, y deja el nuevo como
# manifiesto vigente.
#
# POR QUE EXISTE, Y POR QUE NO ES UN `rsync --delete`
#
# La forma obvia de limpiar lo viejo es espejar la carpeta: "borra todo lo que
# no este en el origen". Es tambien la forma obvia de borrarle el trabajo a un
# cliente, y no hace falta equivocarse mucho: alcanza con que el origen salga
# vacio por un error, o con que alguien agregue `data/` a la lista de carpetas
# espejadas, o con no saber que adentro de una carpeta 100% nuestra
# (`politica/`) el adapter escribe `politica.json` y `capacidades/pedidos.jsonl`,
# que son del cliente.
#
# Aca el conjunto de candidatos a borrar no se calcula por diferencia contra un
# directorio: sale del manifiesto, o sea de los archivos que ESCRIBIMOS
# NOSOTROS. Un archivo del cliente no puede estar en esa lista — no es que lo
# excluimos, es que nunca lo pusimos ahi. Y de los que si estan, solo se borra
# el que sigue teniendo el sha256 que escribimos: si alguien lo edito, se avisa
# y se deja, porque borrar el trabajo de otro no es idempotente.
#
# Corre igual en la Mac (instalacion local) y en la VPS (por ssh, con el script
# entrando por stdin): es una sola implementacion, que es justamente el punto de
# todo este cambio.
set -euo pipefail

# LO UNICO QUE EL KIT PUEDE POSEER, y por lo tanto lo unico que este script
# puede llegar a borrar. El manifiesto es un archivo de texto, o sea DATO, y
# hasta hoy era autoridad absoluta: lo que estuviera anotado ahi con el sha
# correcto se borraba, fuera de quien fuera. El README prometia que un archivo
# del cliente "no es que se excluye, es que no puede estar" — esto lo hace
# verdad. Cuatro lineas agregadas a mano al manifiesto alcanzaban para borrar
# `state.db`, `politica.json`, `pedidos.jsonl` y un entregable; con esta lista,
# esas cuatro rutas ni siquiera son candidatas.
#
# Hoy el manifiesto vive en la raiz del agente, que ningun contenedor monta, asi
# que el agente no lo alcanza. Pero la aritmetica de rutas que lo sostiene ya
# fallo una vez (la barra final de `install.sh <data>/`, que hacia que el
# limpiador se comiera el adapter), y una defensa que depende de que las rutas
# siempre se calculen bien no es una defensa.
#
# Si el kit empieza a instalar en un lugar nuevo, se agrega ACA con su motivo.
# La lista es de ARCHIVOS EXACTOS salvo donde la carpeta entera es nuestra, y
# eso es a proposito: lo que no esta enumerado no se toca. `politica/` a secas
# seria un error — adentro viven `politica.json` (los permisos que cargo el
# cliente) y `capacidades/pedidos.jsonl` (los pedidos que hizo), los dos
# escritos por el adapter en tiempo de ejecucion. Enumerando hacia adentro, esos
# dos no son candidatos porque nunca los nombramos.
PUEDE_SER_NUESTRO=(
  "kit-adapter/"                      # el codigo del adapter del portal
  # Donde vivia el adapter hasta el 12/8. Sigue en la lista PARA PODER SACARLO:
  # el agente podia reescribirlo (data/ es suya) y el contenedor lo corria como
  # root con politica/ montada rw. La migracion de los agentes que ya existen es
  # exactamente esto: la ruta nueva se instala y esta se borra sola, porque esta
  # en el manifiesto viejo y ya no en el nuevo. Cuando no quede ningun agente
  # con adapter en data/scripts/, esta linea se va.
  "data/scripts/portal_adapter.py"
  "data/connections/catalogo.json"    # el catalogo de conexiones
  "data/skills/.kit_manifest"         # que skills son del producto
  "politica/guardia.py"               # la guardia de los MCP
  "politica/parche-pairing.py"        # el parche del mensaje de pairing
  "politica/cont-init-parches.sh"     # el cont-init que lo dispara
  "politica/capacidades/catalogo.json"  # OJO: pedidos.jsonl, al lado, es del cliente
  "politica/hooks/"                   # la puerta en codigo
  "politica/tools/"                   # el permiso de cada conexion, para la guardia
  "politica/mcp/"                     # los servidores MCP
  "kit-skills/"                       # las skills del kit (montada :ro, nadie mas escribe)
)

if [[ "${1:-}" == "--prefijos" ]]; then
  # Para que install.sh valide contra la MISMA lista y no una copia.
  printf '%s\n' "${PUEDE_SER_NUESTRO[@]}"
  exit 0
fi

RAIZ="${1:-}"
[[ -n "$RAIZ" && -d "$RAIZ" ]] || { echo "uso: $0 <raiz-del-agente>" >&2; exit 2; }
RAIZ="$(cd "$RAIZ" && pwd)"

VIEJO="$RAIZ/.kit-instalado"
NUEVO="$RAIZ/.kit-instalado.nuevo"
[[ -f "$NUEVO" ]] || { echo "falta $NUEVO: no hay nada que dejar vigente" >&2; exit 2; }

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

puede_ser_nuestro() {   # $1 = ruta relativa del manifiesto
  local ruta="$1" p
  for p in "${PUEDE_SER_NUESTRO[@]}"; do
    case "$p" in
      */) [[ "$ruta" == "$p"* ]] && return 0 ;;
      *)  [[ "$ruta" == "$p"  ]] && return 0 ;;
    esac
  done
  return 1
}

esta_donde_dice() {     # $1 = ruta relativa del manifiesto
  # No alcanza con "cae adentro del agente": tiene que caer EXACTAMENTE donde
  # dice la ruta. Con `politica/hooks` reemplazado por un symlink a
  # `data/workspace/entregables`, el destino seguia estando adentro del agente y
  # el borrado se llevaba puesto un entregable del cliente. Se compara el padre
  # RESUELTO contra el padre LITERAL: si son distintos, hay un symlink en algun
  # componente del camino y no es el archivo que creemos.
  local abs="$RAIZ_REAL/$1" literal resuelto
  literal="$(dirname "$abs")"
  resuelto="$(cd "$literal" 2>/dev/null && pwd -P)" || return 1
  [[ "$resuelto" == "$literal" ]]
}

RAIZ_REAL="$(cd "$RAIZ" && pwd -P)"
quitados=0
tocados=0

if [[ -f "$VIEJO" ]]; then
  # Los que estaban y ya no estan. Se compara por RUTA (campo 1), no por linea:
  # un archivo que sigue viniendo pero cambio de contenido no es un obsoleto.
  while IFS=$'\t' read -r ruta hash; do
    [[ -n "${ruta:-}" ]] || continue

    # El manifiesto es un archivo, o sea que es dato, y el dato no se obedece:
    # una ruta absoluta o con `..` apuntaria afuera del agente. Se descarta.
    case "$ruta" in
      /*|*..*) echo "OJO: ruta sospechosa en el manifiesto, la salteo: $ruta" >&2; continue ;;
    esac

    # Y aunque este anotado: solo se toca lo que el kit PUEDE haber puesto, y
    # solo si sigue adentro del agente después de resolver los symlinks del
    # camino. Las dos cosas juntas son lo que hace que un archivo del cliente no
    # pueda entrar en el conjunto de candidatos ni siendo agregado a mano.
    if ! puede_ser_nuestro "$ruta"; then
      echo "OJO: el manifiesto nombra '$ruta', que no es una ruta que el kit"
      echo "     instale. No la toco. (Si el kit empezó a instalar ahí, la ruta"
      echo "     va en PUEDE_SER_NUESTRO, en tools/limpiar-obsoletos.sh.)"
      continue
    fi

    destino="$RAIZ/$ruta"
    [[ -f "$destino" ]] || continue          # ya no esta: nada que hacer
    if [[ -L "$destino" ]]; then
      echo "OJO: $ruta es un symlink, y el kit no instala symlinks — lo dejo"
      continue
    fi
    if ! esta_donde_dice "$ruta"; then
      echo "OJO: $ruta no está donde dice (hay un symlink en el camino) — lo dejo"
      continue
    fi

    actual="$(sha "$destino")"
    if [[ "$actual" != "$hash" ]]; then
      echo "OJO: $ruta ya no viene en el kit PERO esta editado — lo dejo"
      tocados=$((tocados+1))
      continue
    fi
    rm -f "$destino"
    echo "quitado  $ruta (el kit ya no lo trae)"
    quitados=$((quitados+1))

    # Y el directorio que queda vacio, hasta la raiz del agente sin incluirla:
    # una carpeta vacia de una conexion que sacamos confunde al que la ve.
    dir="$(dirname "$destino")"
    while [[ "$dir" != "$RAIZ" && "$dir" != "/" ]]; do
      rmdir "$dir" 2>/dev/null || break
      dir="$(dirname "$dir")"
    done
    # Las lineas del manifiesto viejo cuya RUTA no esta en el nuevo.
  done < <(awk -F'\t' 'NR==FNR { esta[$1]=1; next } !($1 in esta)' "$NUEVO" "$VIEJO")
fi

mv "$NUEVO" "$VIEJO"

if [[ $quitados -gt 0 || $tocados -gt 0 ]]; then
  echo "limpieza: $quitados quitado(s), $tocados editado(s) que dejo como estan"
fi
