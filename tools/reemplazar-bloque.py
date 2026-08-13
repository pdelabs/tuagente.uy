#!/usr/bin/env python3
"""Cambia el bloque `kit:base` de un SOUL por uno nuevo, sin tocar el resto.

    python3 tools/reemplazar-bloque.py <soul-viejo.md> <bloque-nuevo.md>
    python3 tools/reemplazar-bloque.py <soul-viejo.md> <bloque-nuevo.md> --rescatar

Escribe el SOUL resultante por stdout. Los avisos van por stderr, así se puede
canalizar sin ensuciar el archivo.

POR QUE EXISTE: `instalar-soul.sh` sabía instalar el bloque donde no había, y
nada más. Actualizarlo era "sacá el viejo a mano", que sobre un archivo de
15 KB en un servidor es exactamente el tipo de tarea donde alguien se lleva
puesto el bloque de identidad sin darse cuenta.

QUE SE CONSERVA, SIEMPRE: TODO lo que está afuera de los marcadores. En un
agente ya bautizado eso incluye el `portal:identidad` que escribió el portal
(nombre y empresa del cliente) y el `00-identidad.md`, donde va la parte
artesanal —incluidas las acciones sensibles propias de esa empresa—. Es una
propiedad del algoritmo, no una promesa: el texto de afuera se corta y se
vuelve a pegar tal cual.

QUE PASA CON LO DE ADENTRO: el bloque viejo se compara ENTERO contra el bloque
canónico de SU PROPIA versión, congelado en `soul/versiones/vN.md`. Si es
idéntico, adentro no hay nada de nadie y el reemplazo sigue. Si sobra texto,
alguien lo escribió a mano para ESE cliente: el script FALLA, lo imprime línea
por línea, y con `--rescatar` lo mueve afuera del bloque —a la sección
"Lo que en esta empresa no se hace sin permiso" de la identidad— antes de
reemplazar. Nunca lo borra.

HISTORIA, porque explica la forma que tiene esto (12/8/2026): antes la
comparación miraba SOLO el texto de los comentarios `<!-- por-cliente: … -->`,
y la plantilla de `01-aprobaciones.md` mandaba escribir las acciones sensibles
"con el mismo formato que las de arriba", o sea como lista markdown y AFUERA
del comentario. El guardián vigilaba el único lugar donde nadie escribía. En el
lab, un reemplazo v4→v5 se llevó puestas las cuatro acciones sensibles de la
empresa con exit 0 y tres avisos tranquilizadores. El arreglo de fondo es que
esa lista dejó de vivir adentro del bloque (ahora va en `00-identidad.md`, que
es intocable por construcción); esta comparación contra el canónico entero es
la red para los agentes que ya la tienen adentro y para el que igual escriba
ahí.

Exit 0 = listo · 2 = adentro del bloque hay texto escrito a mano · 3 = no hay
bloque que reemplazar · 4 = no puedo saber qué es del cliente (falta el bloque
canónico, o el bloque nuevo no es el canónico de su versión).
"""
import argparse
import difflib
import os
import re
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSIONES = os.path.join(KIT, "soul", "versiones")

ABRE = re.compile(r"<!--\s*kit:base(?:\s+(v\d+))?\s*-->")
CIERRA = re.compile(r"<!--\s*/kit:base\s*-->")
COMENTARIO = re.compile(r"<!--.*?-->", re.S)

# Donde vive, afuera del bloque, lo sensible propio de cada empresa. El mismo
# título que trae `soul/00-identidad.md` y al que apunta la REGLA DURA: si lo
# cambiás en un lado, cambialo en los tres.
SECCION = "## Lo que en esta empresa no se hace sin permiso"


class Alto(Exception):
    """Un motivo para no escribir nada, con su código de salida."""

    def __init__(self, codigo, mensaje):
        super().__init__(mensaje)
        self.codigo = codigo


def lineas(texto):
    """El texto en líneas, sin espacios al final ni blancos en los extremos."""
    return [l.rstrip() for l in texto.strip("\n").split("\n")]


def indices_de_nota(texto):
    """Las líneas que son comentario HTML o están en blanco.

    Los comentarios del bloque son notas para quien compone el SOUL, no reglas
    del agente: que en un agente falten o estén reescritos no es texto perdido
    —la plantilla misma dice "si no hay ninguna, borrá este comentario"—. Todo
    lo demás que falte sí lo es, y por eso se distingue.
    """
    t = texto.strip("\n")
    marca = bytearray(len(t))
    for m in COMENTARIO.finditer(t):
        for i in range(m.start(), m.end()):
            marca[i] = 1
    notas, pos = set(), 0
    for n, linea in enumerate(t.split("\n")):
        if all(marca[pos + i] for i, c in enumerate(linea) if not c.isspace()):
            notas.add(n)
        pos += len(linea) + 1
    return notas


def comparar(instalado, canonico):
    """(agregados, perdidas) del bloque instalado contra el canónico.

    agregados: [(ancla, orden, línea)] — lo que escribió una persona adentro.
               `ancla` es dónde caería en el canónico; sirve para saber si es
               un agregado a la REGLA DURA o una edición en cualquier otro lado.
    perdidas:  [(índice, línea)] — texto del kit que el bloque instalado ya no
               tiene. Alguien editó las reglas: eso no lo resuelve un script.

    `autojunk=False` no es decorativo: con más de 200 líneas, difflib empieza a
    tratar como basura las que se repiten mucho —las vacías— y el diff sale
    corrido. Un bloque de SOUL tiene 400.
    """
    # La versión estampada en el marcador de apertura no entra en la
    # comparación: que un agente tenga v4 y el canónico diga v4 es lo esperado,
    # pero con `--canonico` se compara contra el bloque de otra versión a
    # propósito, y ahí el marcador aparecería como "algo que escribió una
    # persona". Es estructura, no texto del cliente.
    canonico = ABRE.sub("<!-- kit:base -->", canonico, count=1)
    instalado = ABRE.sub("<!-- kit:base -->", instalado, count=1)
    can, ins = lineas(canonico), lineas(instalado)
    notas = indices_de_nota(canonico)
    agregados, perdidas = [], []
    cmp = difflib.SequenceMatcher(None, can, ins, autojunk=False)
    for tag, i1, i2, j1, j2 in cmp.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("delete", "replace"):
            perdidas += [(i, can[i]) for i in range(i1, i2) if i not in notas]
        if tag in ("insert", "replace"):
            agregados += [(i1, j, ins[j]) for j in range(j1, j2) if ins[j].strip()]
    return agregados, perdidas


def rango_regla_dura(canonico):
    """(primera, última) línea de la sección REGLA DURA en el bloque canónico.

    Es el único lugar del bloque para el que hay un destino pensado afuera. Un
    agregado en cualquier otra sección se informa y se para: moverlo a la lista
    de acciones sensibles lo pondría a decir algo que nadie escribió.
    """
    can = lineas(canonico)
    ini = next((i for i, l in enumerate(can) if l.startswith("## REGLA DURA")), None)
    if ini is None:
        return None
    fin = next((i for i in range(ini + 1, len(can)) if can[i].startswith("## ")),
               len(can))
    return ini, fin


def ruta_canonico(version):
    return os.path.join(VERSIONES, f"{version}.md")


def canonico_de(version, override=None):
    """El bloque canónico de una versión, del congelado o del que pasaron."""
    ruta = override or ruta_canonico(version)
    try:
        with open(ruta, encoding="utf-8") as fh:
            return fh.read(), ruta
    except OSError:
        return None, ruta


def con_seccion(antes, rescatado):
    """`antes` (todo lo que va arriba del bloque) con lo rescatado adentro de
    la sección de acciones sensibles: la crea si no está, y si está le agrega
    las líneas al final, antes del título que siga."""
    m = re.search(rf"^{re.escape(SECCION)}[ \t]*$", antes, re.M)
    if m:
        resto = antes[m.end():]
        sig = re.search(r"^## ", resto, re.M)
        corte = m.end() + (sig.start() if sig else len(resto))
        return (antes[:corte].rstrip("\n") + "\n\n" + rescatado + "\n\n"
                + antes[corte:].lstrip("\n"))
    return (antes.rstrip("\n") + ("\n\n" if antes.strip() else "")
            + SECCION + "\n\n" + rescatado + "\n")


def encontrar_bloque(soul):
    """(abre, cierra) del único bloque kit:base, o se planta explicando."""
    aperturas, cierres = list(ABRE.finditer(soul)), list(CIERRA.finditer(soul))
    if not aperturas or not cierres or cierres[0].start() < aperturas[0].start():
        raise Alto(3,
                   "este SOUL no tiene un bloque kit:base entero que reemplazar "
                   "(¿nunca se instaló? entonces es una instalación, no un reemplazo)")
    # Con dos bloques no hay forma de adivinar cuál vale: reemplazar el primero
    # deja el SOUL con dos aperturas y dos cierres, y por la regla de
    # precedencia el que manda es el de más abajo, o sea el viejo. Es la misma
    # falla que `agente-check.py` reporta como marcadores desbalanceados.
    if len(aperturas) != 1 or len(cierres) != 1:
        raise Alto(2,
                   f"este SOUL tiene {len(aperturas)} marcador(es) de apertura y "
                   f"{len(cierres)} de cierre: no sé cuál reemplazar, y dejarlo con "
                   "dos bloques haría ganar al viejo. Dejá uno solo a mano y volvé "
                   "a correr")
    return aperturas[0], cierres[0]


def revisar_bloque_nuevo(bloque_nuevo, version_nueva):
    """El bloque nuevo tiene que ser el canónico congelado de su versión.

    No es burocracia: el congelado de HOY es contra lo que se va a comparar el
    agente el día que suba a la versión que sigue. Si entra un bloque que no
    está congelado, la próxima actualización se queda sin línea de base y
    volvemos a no saber qué escribió una persona y qué trajo el kit.
    """
    canon, ruta = canonico_de(version_nueva)
    congelar = (f"   ./tools/instalar-soul.sh --bloque > soul/versiones/"
                f"{version_nueva}.md")
    if canon is None:
        raise Alto(4,
                   f"no existe {ruta}, o sea que este kit nunca congeló el bloque "
                   f"{version_nueva}.\nSin eso, la próxima actualización de este "
                   "agente no va a tener contra qué\ncomparar y va a volver a no "
                   "distinguir lo del kit de lo del cliente.\n\nCongelalo (con el "
                   "árbol limpio, es la versión que estás por instalar):\n" + congelar)
    if lineas(canon) != lineas(bloque_nuevo):
        raise Alto(4,
                   f"el bloque que me pasaste dice ser {version_nueva} pero no es "
                   f"igual al congelado en\n{ruta}.\nO cambiaste los bloques de "
                   "soul/ sin subir soul/VERSION —y entonces hay dos\ncosas "
                   f"distintas llamadas {version_nueva} dando vueltas—, o el "
                   "congelado quedó viejo.\n\nSubí la versión y congelá la nueva, o "
                   "volvé a congelar esta:\n" + congelar)


def revisar_bloque_viejo(viejo, version_vieja, canonico_ruta, sin_canonico):
    """(agregados, canonico, ruta). Se planta si no sabe qué es del cliente."""
    canon, ruta = canonico_de(version_vieja, canonico_ruta)
    if canon is None:
        if sin_canonico:
            return [], None, None
        extra = ""
        if version_vieja == "v1":
            extra = ("\nOjo: `v1` es el marcador pelado, de antes del versionado, "
                     "y no hay un bloque\ncanónico posible — bajo ese marcador "
                     "convivieron varios.\n")
        raise Alto(4,
                   f"no tengo el bloque canónico de {version_vieja} ({ruta}), así que "
                   "NO puedo saber\nqué de ese bloque lo escribió el kit y qué lo "
                   "escribió una persona para este cliente.\n" + extra +
                   "\nSalidas, en orden de preferencia:\n"
                   "  · pasame el bloque canónico viejo con --canonico <archivo>\n"
                   "  · mirá vos el bloque viejo, y si adentro no hay nada escrito a "
                   "mano, decilo\n    con --sin-canonico (queda en tu palabra, no en "
                   "la del script)")
    agregados, perdidas = comparar(viejo, canon)
    if perdidas:
        muestra = "\n".join("  " + l for _, l in perdidas[:12])
        mas = f"\n  … y {len(perdidas) - 12} línea(s) más" if len(perdidas) > 12 else ""
        raise Alto(2,
                   f"el bloque {version_vieja} de este agente NO es el del kit: le "
                   f"faltan o le cambiaron\n{len(perdidas)} línea(s) que sí están en "
                   f"{ruta}.\nAlguien editó las reglas de este agente a mano. Eso no "
                   "lo resuelve un script:\nmirá el diff, decidí qué vale, y dejá el "
                   "bloque igual al canónico antes de subirlo.\n\n"
                   "Lo que el kit tiene y este agente no:\n" + muestra + mas)
    return agregados, canon, ruta


def reemplazar(soul, bloque_nuevo, rescatar=False, canonico=None, sin_canonico=False):
    """(soul_nuevo, avisos). Levanta Alto si no se puede, con su código."""
    abre, cierra = encontrar_bloque(soul)
    viejo = soul[abre.start(): cierra.end()]
    antes, despues = soul[: abre.start()], soul[cierra.end():]

    # `v1` es el marcador pelado, de antes de que el bloque tuviera versión.
    version_vieja = abre.group(1) or "v1"
    m_nueva = ABRE.search(bloque_nuevo)
    if not m_nueva or not CIERRA.search(bloque_nuevo):
        raise Alto(2, "el bloque nuevo no tiene los marcadores kit:base: "
                      "así no se puede saber ni qué versión es")
    version_nueva = m_nueva.group(1) or "v1"

    revisar_bloque_nuevo(bloque_nuevo, version_nueva)
    agregados, canon, ruta_canon = revisar_bloque_viejo(
        viejo, version_vieja, canonico, sin_canonico)

    avisos = [f"bloque {version_vieja} → {version_nueva}"]
    if agregados:
        # En el orden en que aparecen en el bloque del agente, no en el del diff.
        puestas = [l for _, _, l in sorted(agregados, key=lambda a: a[1])]
        rango = rango_regla_dura(canon) if canon else None
        afuera_de_la_regla = rango is None or any(
            not (rango[0] < ancla <= rango[1]) for ancla, _, _ in agregados)
        if afuera_de_la_regla or not rescatar:
            comun = (f"adentro del bloque {version_vieja} hay {len(puestas)} "
                     "línea(s) que escribió una persona\npara ESTE cliente, y el "
                     "reemplazo se las llevaría puestas:\n\n"
                     + "\n".join("  " + l for l in puestas))
            if afuera_de_la_regla:
                raise Alto(2, comun + "\n\nY no están en la REGLA DURA, sino "
                           "repartidas por el bloque: moverlas solas a la lista de\n"
                           "acciones sensibles las haría decir algo que nadie "
                           "escribió. Movelas vos afuera del\nbloque (la identidad, "
                           "arriba del marcador de apertura) y volvé a correr.")
            raise Alto(2, comun + "\n\nMovelas afuera del bloque —el reemplazo "
                       "conserva TODO lo de afuera, palabra por\npalabra— y volvé a "
                       "correr. O dejá que lo haga este script, que las pone en la\n"
                       f'sección "{SECCION.lstrip("# ")}" de la identidad:\n\n'
                       "   … reemplazar-bloque.py <soul> <bloque> --rescatar")
        antes = con_seccion(antes, "\n".join(puestas))
        avisos.append(f'{len(puestas)} línea(s) rescatadas del bloque → sección '
                      f'"{SECCION.lstrip("# ")}", afuera')
        avisos += ["   " + l for l in puestas]
    elif canon is None:
        # Corrió con --sin-canonico: no revisé nada y no lo voy a decir de otra
        # manera. El aviso tranquilizador sobre algo que no se miró es
        # exactamente lo que hizo perder las cuatro líneas del lab.
        avisos.append(f"adentro del bloque {version_vieja}: NO lo revisé "
                      "—pediste --sin-canonico—, así que si había algo escrito "
                      "a mano, se fue")
    else:
        contra = (f"al canónico {version_vieja}" if ruta_canon == ruta_canonico(version_vieja)
                  else f"a {os.path.relpath(ruta_canon, KIT)}")
        avisos.append(f"adentro del bloque: igual {contra}, "
                      "no había nada escrito a mano")

    if "portal:identidad" in despues or "portal:identidad" in antes:
        avisos.append("el bloque portal:identidad queda intacto")
    avisos.append(f"afuera del bloque: {len((antes + despues).strip())} caracteres, "
                  "conservados tal cual")

    # El bloque nuevo se pega con un salto de línea a cada lado y sin duplicar
    # los que ya había: un SOUL con tres líneas en blanco seguidas se ve mal en
    # el prompt y encima cambia el diff cada vez que se reinstala.
    return antes.rstrip("\n") + ("\n\n" if antes.strip() else "") \
        + bloque_nuevo.strip("\n") + "\n\n" + despues.lstrip("\n"), avisos


def main():
    ap = argparse.ArgumentParser(
        description="Cambia el bloque kit:base de un SOUL por uno nuevo, "
                    "conservando todo lo demás.",
        epilog="El SOUL nuevo sale por stdout; los avisos, por stderr.",
    )
    ap.add_argument("soul", help="el SOUL del agente, con su bloque kit:base")
    ap.add_argument("bloque", help="el bloque nuevo (tools/instalar-soul.sh --bloque)")
    ap.add_argument(
        "--rescatar", action="store_true",
        help="mover lo que una persona escribió adentro del bloque a la sección "
             f'"{SECCION.lstrip("# ")}" de la identidad, afuera del bloque, y '
             "recién ahí reemplazar")
    ap.add_argument(
        "--canonico", metavar="ARCHIVO",
        help="el bloque canónico de la versión VIEJA, si no está congelado en "
             "soul/versiones/")
    ap.add_argument(
        "--sin-canonico", action="store_true",
        help="seguir sin bloque canónico viejo: estás afirmando que lo miraste y "
             "que adentro no hay nada escrito a mano")
    args = ap.parse_args()

    with open(args.soul, encoding="utf-8") as fh:
        soul = fh.read()
    with open(args.bloque, encoding="utf-8") as fh:
        bloque = fh.read()
    try:
        nuevo, avisos = reemplazar(soul, bloque, rescatar=args.rescatar,
                                   canonico=args.canonico,
                                   sin_canonico=args.sin_canonico)
    except Alto as exc:
        print(str(exc), file=sys.stderr)
        return exc.codigo
    for a in avisos:
        print("   " + a, file=sys.stderr)
    sys.stdout.write(nuevo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
