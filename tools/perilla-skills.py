#!/usr/bin/env python3
"""Genera las listas del config.yaml y lo deja con las perillas del kit puestas.

    python3 tools/perilla-skills.py --imagen nousresearch/hermes-agent:v2026.7.30
    python3 tools/perilla-skills.py --agente /ruta/al/agente/data
    python3 tools/perilla-skills.py --agente <data> --aplicar <config.yaml>
    python3 tools/perilla-skills.py --toolsets --imagen <tag>   ← la otra lista generada

`--aplicar` deja el config COMPLETO —skills, platform_hints,
display.file_mutation_verifier y las tres platform_toolsets—, cada bloque
idempotente y sin pisar lo que es de ese agente. Migrar un agente es ese
comando, no copiar bloques a mano desde compose/config.base.yaml.

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
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

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


# Los toolsets que NO queremos en la plataforma del portal, con el porqué. Se
# sacan por INCLUSIÓN (no listándolos) y no con `agent.disabled_toolsets`,
# porque esa clave resta el catálogo estático del toolset y el de `browser`
# incluye `web_search` — apagarlo por ahí se lleva puesta la búsqueda web.
TOOLSETS_FUERA = {
    "browser": "9 tools que en producción devuelven capturas en blanco",
}


def toolsets_de_la_plataforma(tag):
    """Los toolsets del api_server, resueltos POR EL MOTOR y sin los que sacamos.

    No se arma por intersección de catálogos —probé y sale mal: mete `cronjob`,
    `delegation` y `homeassistant`, que el bundle lista pero nosotros apagamos, y
    pierde `kanban`, que no está en el bundle y entra por el passthrough
    explícito—. Se le pide al motor que resuelva la plataforma con la forma
    HISTÓRICA (`hermes-api-server` + `kanban`) y a eso se le restan los toolsets
    que no queremos. Es la misma resolución que corre en producción.
    """
    referencia = (
        "toolsets:\n  - kanban\n"
        "agent:\n  disabled_toolsets:\n    - tts\n    - delegation\n    - cronjob\n"
        "platform_toolsets:\n  api_server:\n    - hermes-api-server\n    - kanban\n"
    )
    codigo = (
        "import json,sys,os; sys.path.insert(0,'/opt/hermes');"
        "from hermes_cli.config import load_config;"
        "from hermes_cli.tools_config import _get_platform_tools;"
        "print(json.dumps(sorted(_get_platform_tools(load_config(), 'api_server'))))"
    )
    tmp = tempfile.mkdtemp()
    try:
        with open(os.path.join(tmp, "config.yaml"), "w", encoding="utf-8") as fh:
            fh.write(referencia)
        cmd = ["docker", "run", "--rm", "--network", "none",
               "-v", f"{tmp}:/opt/data", "-e", "HERMES_HOME=/opt/data", "--user", "root",
               "--entrypoint", "/opt/hermes/.venv/bin/python", tag, "-c", codigo]
        try:
            salida = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        except FileNotFoundError:
            raise SystemExit("no encontré docker, y esta lista sale de la imagen del motor")
        if salida.returncode != 0:
            raise SystemExit(f"docker no pudo leer {tag}:\n{salida.stderr.strip()[:400]}")
        return json.loads(salida.stdout.strip().splitlines()[-1])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


PLATAFORMAS = ("api_server", "telegram", "cron")


def bloque_toolsets(nombres, tag):
    """El `platform_toolsets` de las TRES plataformas, listo para pegar.

    Las tres llevan la misma lista: es el mismo agente atendiendo el portal,
    Telegram y los flujos, y un browser que devuelve páginas en blanco falla
    igual en los tres.
    """
    quedan = [n for n in nombres if n not in TOOLSETS_FUERA]
    fuera = [n for n in nombres if n in TOOLSETS_FUERA]
    lineas = [
        "# GENERADO: la expansión del bundle del portal menos lo que sacamos, y la",
        "# misma lista para las tres plataformas.",
        f"#   fuente: imagen {tag}",
        "#   afuera: " + (", ".join(f"{n} ({TOOLSETS_FUERA[n]})" for n in fuera) or "nada"),
        "#",
        "# Va la lista expandida y no el nombre del bundle porque sacar un toolset",
        "# con `agent.disabled_toolsets` resta su catálogo estático, y el de",
        "# `browser` incluye `web_search`: se llevaría puesta la búsqueda web.",
        "# Y va toolset por toolset porque una lista que solo nombra bundles no",
        "# menciona ningún toolset configurable: el motor no entra en modo",
        "# explícito y cae al default, o sea todo prendido.",
        "platform_toolsets:",
    ]
    for plat in PLATAFORMAS:
        lineas.append(f"  {plat}:")
        lineas += [f"    - {n}" for n in quedan]
    return "\n".join(lineas)


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


def config_del_kit():
    """El config canónico del kit, de donde salen los bloques que no se generan."""
    base = os.path.join(KIT, "compose", "config.base.yaml")
    try:
        with open(base, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def valor_de_primer_nivel(texto, clave, subclave):
    """El valor escalar de `clave: subclave:`, buscado dentro de ESE bloque."""
    m = re.search(rf"^{re.escape(clave)}:[ \t]*$", texto, re.M)
    if not m:
        return ""
    resto = texto[m.end():]
    sig = re.search(r"^\S", resto, re.M)
    bloque = resto[: sig.start()] if sig else resto
    m2 = re.search(rf"^[ \t]+{re.escape(subclave)}:[ \t]*(.*)$", bloque, re.M)
    return m2.group(1).strip() if m2 else ""


def span_bloque(texto, clave):
    """(inicio, fin) del bloque `clave:` incluyendo sus comentarios de arriba."""
    m = re.search(rf"^{re.escape(clave)}:[ \t]*$", texto, re.M)
    if not m:
        return None
    resto = texto[m.end():]
    sig = re.search(r"^\S", resto, re.M)
    fin = m.end() + (sig.start() if sig else len(resto))
    inicio = m.start()
    lineas = texto[:inicio].splitlines(keepends=True)
    while lineas and lineas[-1].lstrip().startswith("#"):
        inicio -= len(lineas[-1])
        lineas.pop()
    return inicio, fin


def poner_bloque(texto, clave, nuevo):
    """Reemplaza el bloque `clave:` por `nuevo`, o lo agrega al final.

    Reemplazar y no agregar es el punto: dos claves iguales en un YAML no dan
    error, gana la última y la otra se pierde sin ruido.
    """
    nuevo = nuevo.rstrip("\n") + "\n"
    span = span_bloque(texto, clave)
    if span is None:
        return texto.rstrip("\n") + "\n\n" + nuevo, "agregado"
    ini, fin = span
    viejo = texto[ini:fin]
    cola = "\n\n" if texto[fin:].strip() else "\n"
    if viejo.strip() == nuevo.strip():
        # El contenido ya está; puede faltarle la línea en blanco de abajo, que
        # vive fuera de lo comparado (la comía la versión anterior de esto).
        if viejo == viejo.strip("\n") + cola:
            return texto, "ya estaba igual"
        return texto[:ini] + viejo.strip("\n") + cola + texto[fin:], "igual, espaciado normalizado"
    # Una línea en blanco antes de lo que siga, y solo una. El span llega hasta
    # el comentario del bloque siguiente, así que sin esto el reemplazo se come
    # la línea vacía que los separaba.
    return texto[:ini] + nuevo.rstrip("\n") + cola + texto[fin:], "reemplazado"


def una_sola_vez(texto, ruta, claves):
    """Se niega si alguna clave de primer nivel está repetida.

    Con dos `platform_toolsets:` reemplazaríamos el primero y dejaríamos el
    segundo, y YAML se queda con el ÚLTIMO: el config diría una cosa y el motor
    leería otra, con este script informando "reemplazado" y saliendo 0.
    """
    repetidas = [c for c in claves
                 if len(re.findall(rf"^{re.escape(c)}:", texto, re.M)) > 1]
    if repetidas:
        raise SystemExit(
            f"{ruta} tiene repetida(s) la(s) clave(s) de primer nivel: "
            + ", ".join(repetidas)
            + ". En YAML eso no da error —gana la última y la otra se pierde—, "
            "así que no toco nada: dejá una sola de cada una y volvé a correr."
        )


def yaml_valido(texto, ruta):
    """Parsea el config antes de tocarlo, si PyYAML está a mano.

    Todo lo demás acá es texto y regex, que no se entera de un YAML roto: sin
    esto, un config con la indentación cortada se reescribe igual y el script
    informa éxito. Si PyYAML no está (la máquina del operador puede no
    tenerlo), se sigue: es una verificación de más, no un requisito nuevo.
    """
    try:
        import yaml
    except ImportError:
        return "sin PyYAML: no lo pude parsear"
    try:
        yaml.safe_load(texto)
    except Exception as exc:
        raise SystemExit(
            f"{ruta} no es YAML válido y no lo voy a reescribir:\n  {exc}\n"
            "Arreglalo primero — si lo tocara, quedaría roto y encima con mis cambios."
        )
    return ""


def guardar(ruta, texto):
    """Escribe el config sin poder dejarlo a medias, y con copia del anterior.

    `open(ruta, "w")` trunca y después escribe: si el proceso se muere en el
    medio, el config de un agente VIVO queda cortado. Se escribe al lado y se
    mueve con `os.replace`, que es atómico —lo mismo que hace el motor en
    `atomic_config_write`—, y antes se deja una copia por si el contenido nuevo
    resultara ser el problema.
    """
    respaldo = ""
    if os.path.isfile(ruta):
        agente = os.path.basename(os.path.dirname(os.path.dirname(os.path.abspath(ruta))))
        destino = os.path.join(KIT, "respaldos-config")
        os.makedirs(destino, exist_ok=True)
        respaldo = os.path.join(
            destino, f"{agente}-{datetime.datetime.now():%Y%m%d-%H%M%S}.yaml")
        shutil.copy2(ruta, respaldo)
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(texto)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, ruta)
    return respaldo


def poner_subclave(texto, clave, subclave, valor):
    """Pone `clave: subclave: valor` sin tocar el resto del bloque.

    Para `display:`, que puede tener otras claves del agente (`inline_diffs`,
    avisos de créditos): reemplazar el bloque entero se las llevaría puestas.
    """
    span = span_bloque(texto, clave)
    linea = f"  {subclave}: {valor}"
    if span is None:
        return texto.rstrip("\n") + f"\n\n{clave}:\n{linea}\n", "agregado"
    ini, fin = span
    bloque = texto[ini:fin]
    m = re.search(rf"^([ \t]+){re.escape(subclave)}:[ \t]*(.*)$", bloque, re.M)
    if m:
        if m.group(2).strip() == valor:
            return texto, "ya estaba igual"
        nuevo_bloque = bloque[:m.start()] + f"{m.group(1)}{subclave}: {valor}" + bloque[m.end():]
        return texto[:ini] + nuevo_bloque + texto[fin:], "reemplazado"
    # La clave existe pero sin esa subclave: se agrega al final del bloque.
    nuevo_bloque = bloque.rstrip("\n") + "\n" + linea + "\n"
    return texto[:ini] + nuevo_bloque + texto[fin:], "agregado"


def platform_toolsets_del_kit(texto_agente):
    """El bloque `platform_toolsets` del kit, respetando plataformas ajenas.

    Las tres nuestras (api_server, telegram, cron) se pisan con la lista del
    kit. Si el agente declara alguna otra —una plataforma que este cliente usa y
    el kit no conoce— se conserva tal cual: migrar no es borrarle cosas.
    """
    kit = bloque_de_primer_nivel(config_del_kit(), "platform_toolsets")
    if not kit:
        return ""
    span = span_bloque(texto_agente, "platform_toolsets")
    if span is None:
        return kit
    bloque = texto_agente[span[0]: span[1]]
    ajenas = []
    for m in re.finditer(r"^  ([a-z_][a-z0-9_]*):[ \t]*$", bloque, re.M):
        if m.group(1) in PLATAFORMAS:
            continue
        resto = bloque[m.end():]
        sig = re.search(r"^  \S", resto, re.M)
        ajenas.append(bloque[m.start(): m.end() + (sig.start() if sig else len(resto))].rstrip("\n"))
    if not ajenas:
        return kit
    return kit.rstrip("\n") + "\n" + "\n".join(ajenas) + "\n"


def aplicar(texto_bloque, ruta):
    """Deja el config con TODAS las perillas del kit puestas, no con una.

    Son cuatro bloques y van juntos: un agente migrado a medias es el que
    después aparece con el "assume plain text" del motor, o con el browser
    prendido en Telegram, y nadie sabe por qué. Antes esto aplicaba dos y los
    otros dos había que copiarlos a mano desde compose/config.base.yaml.

    Cada bloque es idempotente: si ya está igual no se toca, si difiere se
    reemplaza (nunca se agrega al lado: dos claves iguales en un YAML no dan
    error, gana la última y la otra se pierde en silencio), y si no está se
    agrega. Nada de lo que es de ESE agente se pisa — `model.base_url` con un
    proxy propio, plataformas que el kit no conoce, otras claves de `display`.
    """
    with open(ruta, encoding="utf-8") as fh:
        texto = fh.read()
    # Antes de tocar nada: que sea YAML, y que no haya claves repetidas de las
    # que vamos a reemplazar.
    nota_yaml = yaml_valido(texto, ruta)
    una_sola_vez(texto, ruta,
                 ("skills", "platform_hints", "platform_toolsets", "display"))
    kit = config_del_kit()
    acciones = []

    # 1. skills (disabled + external_dirs), el único generado, entre marcadores.
    if MARCA_INICIO in texto and MARCA_FIN in texto:
        ini, fin = texto.index(MARCA_INICIO), texto.index(MARCA_FIN) + len(MARCA_FIN)
        viejo = texto[ini:fin]
        texto = texto[:ini] + texto_bloque + texto[fin:]
        acciones.append(("skills", "ya estaba igual" if viejo.strip() == texto_bloque.strip()
                         else "reemplazado"))
    else:
        if re.search(r"^skills:", texto, re.M):
            raise SystemExit(
                f"{ruta} ya tiene un bloque `skills:` sin marcadores. Sacalo a mano "
                "antes de aplicar: dos claves `skills:` en un YAML no dan error, "
                "gana la última y la otra se pierde en silencio."
            )
        texto = texto.rstrip("\n") + "\n\n" + texto_bloque.rstrip("\n") + "\n"
        acciones.append(("skills", "agregado"))

    # 2. platform_hints: el preámbulo del portal.
    hint = bloque_de_primer_nivel(kit, "platform_hints")
    if hint:
        texto, acc = poner_bloque(texto, "platform_hints", hint)
        acciones.append(("platform_hints", acc))
    else:
        acciones.append(("platform_hints", "OJO: no está en compose/config.base.yaml"))

    # 3. display.file_mutation_verifier: solo esa clave, sin tocar el resto.
    valor = valor_de_primer_nivel(kit, "display", "file_mutation_verifier") or "false"
    texto, acc = poner_subclave(texto, "display", "file_mutation_verifier", valor)
    acciones.append(("display.file_mutation_verifier", acc))

    # 4. platform_toolsets: las tres plataformas, conservando las ajenas.
    pts = platform_toolsets_del_kit(texto)
    if pts:
        texto, acc = poner_bloque(texto, "platform_toolsets", pts)
        acciones.append(("platform_toolsets", acc))
    else:
        acciones.append(("platform_toolsets", "OJO: no está en compose/config.base.yaml"))

    # La clave muerta: un `cron:` colgado de `platforms:` no lo lee nadie (los
    # toolsets van en `platform_toolsets`), y confunde al que la ve.
    span = span_bloque(texto, "platforms")
    if span:
        bloque = texto[span[0]: span[1]]
        m = re.search(r"^  cron:[ \t]*\n(    - .*\n)+", bloque, re.M)
        if m:
            texto = texto[:span[0]] + bloque[:m.start()] + bloque[m.end():] + texto[span[1]:]
            acciones.append(("platforms.cron (clave muerta)", "sacada"))

    if all(acc == "ya estaba igual" for _, acc in acciones):
        print(f"config ya estaba al día: {ruta}")
        for nombre, acc in acciones:
            print(f"  {nombre:34} {acc}")
        return

    yaml_valido(texto, ruta)          # y que lo que sale también parsee
    respaldo = guardar(ruta, texto)
    print(f"config actualizado: {ruta}")
    for nombre, acc in acciones:
        print(f"  {nombre:34} {acc}")
    if respaldo:
        print(f"  {'copia del anterior':34} {respaldo}")
    if nota_yaml:
        print(f"  ({nota_yaml})")


def main():
    ap = argparse.ArgumentParser(
        description="Genera la lista de skills apagadas y deja el config.yaml "
                    "con todas las perillas del kit puestas.",
        epilog="Sin argumentos usa la imagen del compose del kit.",
    )
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--imagen", metavar="TAG", help="tag de la imagen del motor")
    g.add_argument("--agente", metavar="DATA", help="ruta al data/ de un agente ya armado")
    ap.add_argument(
        "--aplicar", metavar="CONFIG",
        help="dejar ESE config.yaml completo: skills, platform_hints, "
             "display.file_mutation_verifier y las tres platform_toolsets",
    )
    ap.add_argument(
        "--toolsets", action="store_true",
        help="imprimir el platform_toolsets de las tres plataformas en vez de "
             "la lista de skills",
    )
    args = ap.parse_args()

    if args.toolsets:
        tag = args.imagen or "nousresearch/hermes-agent:v2026.7.30"
        print(bloque_toolsets(toolsets_de_la_plataforma(tag), tag))
        return 0

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
