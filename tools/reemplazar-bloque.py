#!/usr/bin/env python3
"""Cambia el bloque `kit:base` de un SOUL por uno nuevo, sin tocar el resto.

    python3 tools/reemplazar-bloque.py <soul-viejo.md> <bloque-nuevo.md>

Escribe el SOUL resultante por stdout. Los avisos van por stderr, así se puede
canalizar sin ensuciar el archivo.

POR QUE EXISTE: `instalar-soul.sh` sabía instalar el bloque donde no había, y
nada más. Actualizarlo era "sacá el viejo a mano", que sobre un archivo de
15 KB en un servidor es exactamente el tipo de tarea donde alguien se lleva
puesto el bloque de identidad sin darse cuenta.

QUE SE CONSERVA: TODO lo que está afuera de los marcadores. En un agente ya
bautizado eso incluye el `portal:identidad` que escribió el portal (nombre y
empresa del cliente) y el `00-identidad.md` si alguien lo escribió. Es la parte
artesanal: perderla es perder el trabajo de una persona.

QUE SE PIERDE, Y POR ESO AVISA: lo agregado por cliente ADENTRO del bloque. Hoy
eso es el comentario `<!-- por-cliente: … -->` de `01-aprobaciones.md`, donde
van las acciones sensibles propias de esa empresa. Si está tal cual vino de la
plantilla, no hay nada que salvar y el reemplazo sigue. Si alguien lo completó,
esto FALLA y lo imprime, para que se copie al bloque nuevo antes.

Exit 0 = listo · 2 = hay agregados del cliente que se perderían · 3 = no hay
bloque que reemplazar.
"""
import re
import sys

ABRE = re.compile(r"<!--\s*kit:base(?:\s+(v\d+))?\s*-->")
CIERRA = re.compile(r"<!--\s*/kit:base\s*-->")
POR_CLIENTE = re.compile(r"<!--\s*por-cliente:.*?-->", re.S)


def normalizar(texto):
    """Espacios colapsados: comparar redacción, no cómo quedó el wrap."""
    return " ".join(texto.split())


def por_cliente(bloque):
    """Los comentarios `por-cliente` de un bloque, tal cual están."""
    return [m.group(0) for m in POR_CLIENTE.finditer(bloque)]


def reemplazar(soul, bloque_nuevo):
    """(soul_nuevo, avisos). Levanta AssertionError si no se puede."""
    aperturas, cierres = list(ABRE.finditer(soul)), list(CIERRA.finditer(soul))
    if not aperturas or not cierres or cierres[0].start() < aperturas[0].start():
        raise AssertionError(
            "este SOUL no tiene un bloque kit:base entero que reemplazar "
            "(¿nunca se instaló? entonces es una instalación, no un reemplazo)"
        )
    # Con dos bloques no hay forma de adivinar cuál vale: reemplazar el primero
    # deja el SOUL con dos aperturas y dos cierres, y por la regla de
    # precedencia el que manda es el de más abajo, o sea el viejo. Es la misma
    # falla que `agente-check.py` reporta como marcadores desbalanceados.
    if len(aperturas) != 1 or len(cierres) != 1:
        raise AssertionError(
            f"este SOUL tiene {len(aperturas)} marcador(es) de apertura y "
            f"{len(cierres)} de cierre: no sé cuál reemplazar, y dejarlo con dos "
            "bloques haría ganar al viejo. Dejá uno solo a mano y volvé a correr"
        )
    abre, cierra = aperturas[0], cierres[0]

    viejo = soul[abre.start(): cierra.end()]
    antes, despues = soul[: abre.start()], soul[cierra.end():]

    # Lo que el cliente haya agregado adentro del bloque: se compara contra lo
    # que trae la plantilla nueva. Si es lo mismo, no hay nada que salvar.
    agregados = [c for c in por_cliente(viejo)
                 if normalizar(c) not in {normalizar(n) for n in por_cliente(bloque_nuevo)}]
    if agregados:
        raise AssertionError(
            "adentro del bloque viejo hay texto puesto para ESTE cliente y el "
            "reemplazo se lo llevaría puesto. Copialo al bloque nuevo (o al SOUL, "
            "afuera del bloque) y volvé a correr:\n\n"
            + "\n\n".join(agregados)
        )

    avisos = []
    version_vieja = abre.group(1) or "sin versión"
    version_nueva = (ABRE.search(bloque_nuevo).group(1)
                     if ABRE.search(bloque_nuevo) else "?") or "sin versión"
    avisos.append(f"bloque {version_vieja} → {version_nueva}")
    if "portal:identidad" in despues or "portal:identidad" in antes:
        avisos.append("el bloque portal:identidad queda intacto")
    afuera = len((antes + despues).strip())
    avisos.append(f"{afuera} caracteres afuera del bloque, sin tocar")

    # El bloque nuevo se pega con un salto de línea a cada lado y sin duplicar
    # los que ya había: un SOUL con tres líneas en blanco seguidas se ve mal en
    # el prompt y encima cambia el diff cada vez que se reinstala.
    return antes.rstrip("\n") + ("\n\n" if antes.strip() else "") \
        + bloque_nuevo.strip("\n") + "\n\n" + despues.lstrip("\n"), avisos


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    with open(sys.argv[1], encoding="utf-8") as fh:
        soul = fh.read()
    with open(sys.argv[2], encoding="utf-8") as fh:
        bloque = fh.read()
    try:
        nuevo, avisos = reemplazar(soul, bloque)
    except AssertionError as exc:
        print(str(exc), file=sys.stderr)
        return 3 if "no tiene un bloque" in str(exc) else 2
    for a in avisos:
        print("   " + a, file=sys.stderr)
    sys.stdout.write(nuevo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
