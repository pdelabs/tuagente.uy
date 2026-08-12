#!/usr/bin/env python3
"""Genera el bloque `skills:` de config.yaml que apaga las skills del motor.

    python3 tools/perilla-skills.py --imagen nousresearch/hermes-agent:v2026.7.30
    python3 tools/perilla-skills.py --agente /ruta/al/agente/data
    python3 tools/perilla-skills.py --imagen <tag> --aplicar compose/config.base.yaml

POR QUE GENERADO Y NO A MANO: son ~70 nombres y cambian con cada version del
motor. Una lista escrita a mano queda vieja en el primer bump y nadie se
entera — justo lo que este kit no hace. La politica es de una linea ("todas
apagadas salvo las de leer documentos") y la lista sale de la fuente.

DE DONDE SALEN LAS SKILLS DEL MOTOR. Viven en la IMAGEN, en /opt/hermes/skills,
y `skills_sync.py` las COPIA a data/skills/ en cada arranque del contenedor
(docker/stage2-hook.sh). O sea que data/skills/ mezcla tres origenes:

    de la imagen  → data/skills/<categoria>/<skill>/   y anotadas en .bundled_manifest
    del kit       → las nuestras (hoy tambien ahi; ver skills.external_dirs)
    del cliente   → las que el agente escribio para ESA empresa

Por eso el generador NUNCA lista data/skills/: apagaria skills del cliente. Las
dos fuentes validas son la imagen (`--imagen`, autoritativa para un tag, sirve
antes de instalar nada) y el .bundled_manifest de un agente ya armado
(`--agente`, offline y sin docker, dice lo que ESE agente tiene sembrado).

Las que quedan prendidas estan en compose/skills-permitidas.txt.
`agente-check.py` cierra el circulo: falla si un agente tiene una skill del
motor prendida fuera de esa lista.
"""
import argparse
import os
import re
import subprocess
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERMITIDAS_TXT = os.path.join(KIT, "compose", "skills-permitidas.txt")

# Donde el compose monta las skills del kit, de solo lectura. Va acá adentro y
# no en un bloque `skills:` aparte porque YAML no admite la misma clave dos
# veces: con dos `skills:` gana el ultimo y el otro se pierde SIN AVISO.
EXTERNAL_DIR = "/opt/kit/skills"

# El bloque generado vive entre estos dos marcadores, como el kit:base del
# SOUL: asi se puede reemplazar sin tocar el resto del config y se ve de dónde
# salio.
MARCA_INICIO = "# <<< generado por tools/perilla-skills.py — no editar a mano"
MARCA_FIN = "# >>> fin del bloque generado"

# Fallback si el archivo no está (una copia suelta del script). La fuente es
# el archivo; esto evita que el script mienta por silencio.
# OJO: tools/agente-check.py tiene el MISMO respaldo. Si tocás uno, tocá el
# otro — ya se separaron una vez (aquel tenía cuatro nombres y este tres).
PERMITIDAS_POR_DEFECTO = ("docx", "ocr-and-documents", "pdf", "xlsx")


def permitidas(ruta=PERMITIDAS_TXT):
    """Las skills del motor que quedan prendidas, de compose/skills-permitidas.txt."""
    try:
        with open(ruta, encoding="utf-8") as fh:
            nombres = {
                l.strip() for l in fh
                if l.strip() and not l.lstrip().startswith("#")
            }
        return nombres or set(PERMITIDAS_POR_DEFECTO)
    except OSError:
        return set(PERMITIDAS_POR_DEFECTO)


def desde_imagen(tag):
    """Los nombres de las skills que trae la imagen del motor.

    Un contenedor de un solo comando, sin volumen y sin red: lista los
    directorios que tienen SKILL.md bajo /opt/hermes/skills. No levanta nada.
    """
    cmd = [
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "sh", tag,
        "-c", 'find /opt/hermes/skills -name SKILL.md -printf "%h\\n" | sed "s|.*/||" | sort -u',
    ]
    try:
        salida = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        raise SystemExit(
            "no encontré docker. Si no lo tenés a mano, usá --agente <ruta>/data,\n"
            "que lee el .bundled_manifest de un agente ya armado."
        )
    if salida.returncode != 0:
        raise SystemExit(
            f"docker no pudo leer la imagen {tag}:\n{salida.stderr.strip()[:400]}\n"
            "¿está bajada? `docker pull " + tag + "`"
        )
    return {l.strip() for l in salida.stdout.splitlines() if l.strip()}


def desde_agente(data):
    """Los nombres que ESE agente tiene sembrados, del .bundled_manifest.

    Lo escribe el propio motor al copiar las skills de la imagen, con formato
    `nombre:hash`. Es lo que mira agente-check.py, porque no necesita docker.
    """
    ruta = os.path.join(data, "skills", ".bundled_manifest")
    if not os.path.isfile(ruta):
        raise SystemExit(
            f"no existe {ruta}.\n"
            "Ese archivo lo escribe el motor en el primer arranque: si el agente\n"
            "todavía no arrancó nunca, generá la lista desde la imagen con --imagen."
        )
    with open(ruta, encoding="utf-8") as fh:
        return {l.split(":", 1)[0].strip() for l in fh if l.strip()}


def bloque(nombres, fuente, permitidas_set):
    """El bloque `skills:` entero, listo para pegar en config.yaml.

    Sale la clave COMPLETA —`disabled` y `external_dirs`— a propósito: si el
    config tuviera dos `skills:`, YAML se queda con el último y el otro
    desaparece sin ruido.
    """
    apagadas = sorted(nombres - permitidas_set)
    quedan = sorted(nombres & permitidas_set)
    faltan = sorted(permitidas_set - nombres)

    lineas = [
        MARCA_INICIO,
        f"#   fuente: {fuente}",
        f"#   apagadas: {len(apagadas)} · prendidas: {', '.join(quedan) or 'ninguna'}",
        "#",
        "# Regenerar al subir de tag el motor:",
        "#   python3 tools/perilla-skills.py --imagen <tag> --aplicar compose/config.base.yaml",
        "#",
        "# Un agente de empresa no manda mails por su cuenta (himalaya), no postea",
        "# (xurl), no maneja la casa de nadie ni sabe operar su propio motor",
        "# (hermes-agent, computer-use, claude-code). Cada una de esas es superficie",
        "# que no pedimos, que no pasa por la guardia, y que ademas se paga en cada",
        "# llamada al modelo: el indice de skills son ~9 KB del prompt.",
        "#",
        "# Prender una para un cliente: sacarla de esta lista, anotar por que en el",
        "# repo de ESE agente, y agregarla a compose/skills-permitidas.txt SOLO si",
        "# la decision vale para todos.",
        "skills:",
        "  disabled:",
    ]
    lineas += [f"    - {n}" for n in apagadas]
    if faltan:
        lineas.append(
            "  # OJO: " + ", ".join(faltan) + " está en skills-permitidas.txt pero "
            "esta versión del motor no la trae."
        )
    lineas += [
        "  # Las skills del kit, montadas de solo lectura desde el compose. Viven",
        "  # afuera de data/skills/ para que el agente no pueda reescribirlas y para",
        "  # que el curator no las archive a los 90 dias sin uso.",
        "  external_dirs:",
        f"    - {EXTERNAL_DIR}",
        MARCA_FIN,
    ]
    return "\n".join(lineas)


def bloque_de_primer_nivel(texto, clave):
    """El bloque `clave:` de un YAML, con los comentarios que lo preceden.

    Los comentarios van incluidos porque en este repo son la evidencia: el de
    `platform_hints` explica qué texto del motor estamos reemplazando y dónde
    está en su código.
    """
    m = re.search(rf"^{re.escape(clave)}:[ \t]*$", texto, re.M)
    if not m:
        return ""
    resto = texto[m.end():]
    fin = re.search(r"^\S", resto, re.M)
    cuerpo = texto[m.start():] if fin is None else texto[m.start(): m.end() + fin.start()]
    # Hacia arriba: las líneas de comentario pegadas a la clave.
    inicio = m.start()
    lineas = texto[:inicio].splitlines(keepends=True)
    while lineas and lineas[-1].lstrip().startswith("#"):
        inicio -= len(lineas[-1])
        lineas.pop()
    return texto[inicio: m.start()] + cuerpo


def hint_del_kit():
    """El bloque `platform_hints:` del config canónico del kit."""
    base = os.path.join(KIT, "compose", "config.base.yaml")
    try:
        with open(base, encoding="utf-8") as fh:
            return bloque_de_primer_nivel(fh.read(), "platform_hints")
    except OSError:
        return ""


def aplicar(texto_bloque, ruta):
    """Reemplaza el bloque generado dentro de un config, o lo agrega al final.

    Y de paso deja puesto `platform_hints` si falta: son las dos perillas que
    van juntas, y un agente migrado a medias es el que despues aparece con el
    "assume plain text" del motor y nadie sabe por que.
    """
    with open(ruta, encoding="utf-8") as fh:
        actual = fh.read()
    if MARCA_INICIO in actual and MARCA_FIN in actual:
        antes = actual[: actual.index(MARCA_INICIO)]
        despues = actual[actual.index(MARCA_FIN) + len(MARCA_FIN):]
        nuevo = antes + texto_bloque + despues
        accion = "reemplazado"
    else:
        if "\nskills:" in actual or actual.startswith("skills:"):
            raise SystemExit(
                f"{ruta} ya tiene un bloque `skills:` sin marcadores. Sacalo a mano "
                "antes de aplicar: dos claves `skills:` en un YAML no dan error, "
                "gana la última y la otra se pierde en silencio."
            )
        nuevo = actual.rstrip("\n") + "\n\n" + texto_bloque + "\n"
        accion = "agregado"

    if re.search(r"^platform_hints:", nuevo, re.M):
        nota_hint = "platform_hints ya estaba, no lo toqué"
    else:
        hint = hint_del_kit()
        if hint:
            nuevo = nuevo.rstrip("\n") + "\n\n" + hint.rstrip("\n") + "\n"
            nota_hint = "platform_hints agregado (el preámbulo del portal)"
        else:
            nota_hint = ("OJO: no encontré platform_hints en compose/config.base.yaml — "
                         "pegalo a mano o el motor le dice 'assume plain text' al agente")

    with open(ruta, "w", encoding="utf-8") as fh:
        fh.write(nuevo)
    print(f"bloque de skills {accion} en {ruta}")
    print(f"  {nota_hint}")


def main():
    ap = argparse.ArgumentParser(
        description="Genera el bloque skills.disabled para config.yaml.",
        epilog="Sin argumentos usa la imagen del compose del kit.",
    )
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--imagen", metavar="TAG", help="tag de la imagen del motor")
    g.add_argument("--agente", metavar="DATA", help="ruta al data/ de un agente ya armado")
    ap.add_argument(
        "--aplicar", metavar="CONFIG",
        help="escribir el bloque dentro de ese config.yaml (en vez de imprimirlo)",
    )
    args = ap.parse_args()

    if args.agente:
        nombres = desde_agente(os.path.abspath(args.agente))
        fuente = f"{os.path.abspath(args.agente)}/skills/.bundled_manifest"
    else:
        tag = args.imagen or "nousresearch/hermes-agent:v2026.7.30"
        nombres = desde_imagen(tag)
        fuente = f"imagen {tag}"

    if not nombres:
        raise SystemExit(f"no encontré ninguna skill del motor en {fuente}")
    texto = bloque(nombres, fuente, permitidas())
    if args.aplicar:
        aplicar(texto, args.aplicar)
    else:
        print(texto)
    return 0


if __name__ == "__main__":
    sys.exit(main())
