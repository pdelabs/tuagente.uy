#!/usr/bin/env python3
"""Chequeo de conformidad OFFLINE: ¿el data/ de este agente está bien armado?

Hermano de `portal-check.py`. Aquel corre contra un agente **encendido** y
verifica el contrato HTTP; este mira los archivos y agarra los errores que se
cometen al dar de alta un cliente, antes de prender nada.

    python3 tools/agente-check.py /ruta/al/agente/data
    python3 tools/agente-check.py --revisar /ruta/a/un.md   ← un SOUL suelto

Exit 0 = cumple. Exit 1 = hay fallas (se listan al final).

El segundo modo existe para `instalar-soul.sh`, que lo corre sobre el bloque que
está por subir: huecos de plantilla y comentarios que el motor lee como
inyección, con la misma implementación que mira el SOUL de un agente instalado.

Por qué existe: la regla "toda SKILL.md necesita frontmatter" estaba escrita en
CLAUDE.md y aun así un agente en producción tenía una skill sin él — justo la que
manda mail a un lead. Se indexó con descripción vacía, así que el agente no podía
descubrirla nunca. Una regla que no chequea nadie no es una regla.
"""
import json
import os
import re
import sys

OK, FAIL, WARN = "OK  ", "FALLA", "aviso"
results = []

# Un hueco de plantilla es CUALQUIER <cosa entre corchetes angulares>, no solo
# <CLIENTE>: la REGLA DURA llegó una vez a producción diciendo literalmente
# "JAMÁS <la acción sensible: …>", y la lista de nombres conocidos no la agarraba.
# Los `<...>` legítimos del SOUL —`conexion:<id>`, `permisos:<id de la conexión>`—
# van SIEMPRE entre backticks, y las notas para quien lo compone van en
# comentarios HTML: los dos se sacan antes de buscar (ver huecos_de_plantilla).
HUECO = re.compile(r"<[^<>]{1,200}>", re.S)
AUTOLINK = re.compile(r"<(?:https?://|mailto:|[^@<>\s]+@)")

# Los marcadores que envuelven el bloque genérico. Traen versión desde v2; el
# marcador pelado `<!-- kit:base -->` es el v1, de antes del versionado.
KIT_ABRE = re.compile(r"<!--\s*kit:base(?:\s+(v\d+))?\s*-->")
KIT_CIERRA = re.compile(r"<!--\s*/kit:base\s*-->")
VERSION_VALIDA = re.compile(r"^v[0-9]+$")

# CINCO PALABRAS QUE NO PUEDEN ESTAR EN UN COMENTARIO HTML DEL SOUL. El motor
# escanea los archivos de contexto antes de armar el prompt, y uno de sus
# patrones —`html_comment_injection`, alcance "all", case-insensitive— matchea
# cualquier comentario que las contenga. Cuando matchea NO limpia el comentario:
# descarta el archivo entero y lo reemplaza por "[BLOCKED: SOUL.md contained
# potential prompt injection]". El agente se queda sin identidad y sin reglas,
# sigue contestando como si nada, y no avisa a nadie. Verificado contra el
# escáner del motor (`tools/threat_patterns.py`, `agent/prompt_builder.py`).
COMENTARIO_HTML = re.compile(r"<!--.*?-->", re.S)
VETADAS = re.compile(r"ignore|override|system|secret|hidden", re.I)

# Identidad: o la escribió el portal en el bautizo, o la escribió una persona a
# partir de `soul/00-identidad.md` — que es el único bloque con título de primer
# nivel ("# Sos …"); los genéricos abren todos en `##`.
PORTAL_IDENTIDAD = re.compile(
    r"<!--\s*portal:identidad\s*-->(.*?)<!--\s*/portal:identidad\s*-->", re.S
)
IDENTIDAD_H1 = re.compile(r"^#\s+\S", re.M)

# Las únicas skills del motor que quedan prendidas. La lista de verdad está en
# compose/skills-permitidas.txt; esto es el respaldo por si corren el script
# suelto, para que no apruebe por no encontrar la política.
PERMITIDAS_POR_DEFECTO = ("ocr-and-documents", "pdf", "xlsx")

# Lo que install.sh deja en el data/. Si falta, el kit no está instalado.
# Las skills que instala el kit: si una de ESTAS se indexa muda, es culpa nuestra.
DEL_KIT_SKILLS = {"artifact", "entregable", "aprobacion"}

DEL_KIT = [
    "scripts/portal_adapter.py",
    "skills/artifact/SKILL.md",
    "skills/entregable/SKILL.md",
    "skills/aprobacion/SKILL.md",
]


def check(name, fn, required=True):
    """Corre una verificación y registra el resultado sin cortar el chequeo."""
    try:
        detail = fn()
        results.append((OK, name, detail or ""))
        return True
    except Exception as exc:  # noqa: BLE001 — queremos reportar cualquier falla
        results.append((FAIL if required else WARN, name, str(exc)[:200]))
        return False


def frontmatter(path):
    """Devuelve el bloque YAML inicial como dict plano, o {} si no hay."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        texto = fh.read()
    if not texto.startswith("---"):
        return {}
    fin = texto.find("\n---", 3)
    if fin == -1:
        return {}
    campos = {}
    for linea in texto[3:fin].splitlines():
        if ":" in linea and not linea.startswith((" ", "\t", "#")):
            clave, _, valor = linea.partition(":")
            campos[clave.strip()] = valor.strip().strip("\"'")
    return campos


# Los ÚNICOS directorios que el motor saltea al indexar skills: copiado tal
# cual de EXCLUDED_SKILL_DIRS (hermes: agent/skill_utils.py:26-44), que es lo
# que usa `is_excluded_skill_path` sobre cada SKILL.md que encuentra.
#
# Ojo con la trampa que esto evita: NO alcanza con que el directorio empiece
# con punto. `.archive` está en la lista y `.reemplazadas-por-el-kit` no, así
# que "apartar" una skill a un dot-dir cualquiera adentro de data/skills/ la
# deja indexada y tapando a la del kit exactamente igual que antes.
EXCLUIDAS_DEL_INDICE = frozenset((
    ".git", ".github", ".hub", ".archive", ".venv", "venv", "node_modules",
    "site-packages", "__pycache__", ".tox", ".nox", ".pytest_cache",
    ".mypy_cache", ".ruff_cache",
))


def skills_indexadas(raiz):
    """(nombre, ruta) de cada SKILL.md que el motor indexaría bajo `raiz`.

    Reproduce el walker del motor en lo que importa acá: recorre todo el árbol
    y descarta lo que cae bajo un nombre de EXCLUDED_SKILL_DIRS. No reproduce
    la regla de los directorios de soporte (references/templates/assets/
    scripts), que el motor aplica SOLO cuando cuelgan directo de una skill: si
    hay un SKILL.md ahí adentro preferimos reportarlo de más y que alguien lo
    mire, porque el error que buscamos es una copia que tapa en silencio.
    """
    if not os.path.isdir(raiz):
        return
    for base, dirs, archivos in os.walk(raiz):
        dirs[:] = [d for d in dirs if d not in EXCLUIDAS_DEL_INDICE]
        if os.path.basename(base) in EXCLUIDAS_DEL_INDICE:
            continue
        if "SKILL.md" in archivos:
            yield os.path.basename(base), os.path.join(base, "SKILL.md")


def kit_skills_dir(data):
    """Donde el kit deja sus skills: <agente>/kit-skills, hermano de data/.

    El compose lo monta :ro en /opt/kit/skills y el config lo declara en
    `skills.external_dirs`. Un agente de antes de esa mudanza no lo tiene.
    """
    return os.path.join(os.path.dirname(data), "kit-skills")


def skills_en_disco(data):
    """Toda carpeta con un SKILL.md: las del data/ y las del kit montado afuera.

    Las dos entran al mismo índice del motor, así que las dos tienen que tener
    frontmatter utilizable — que es el chequeo que llama a esto.
    """
    for raiz in (os.path.join(data, "skills"), kit_skills_dir(data)):
        for base, _, archivos in os.walk(raiz):
            if "SKILL.md" in archivos:
                yield os.path.relpath(base, raiz), os.path.join(base, "SKILL.md")


def conf(data):
    """config.yaml como texto — alcanza para las pocas claves que miramos."""
    ruta = os.path.join(data, "config.yaml")
    if not os.path.isfile(ruta):
        raise AssertionError("no existe config.yaml")
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def lista_yaml(texto, clave, subclave):
    """Los items de `clave: subclave:` en un YAML, sin depender de PyYAML.

    Entiende las dos formas que escribimos: bloque con guiones y flow inline
    (`disabled: [a, b]`). Alcanza para listas de nombres, que es todo lo que
    miramos acá; no pretende ser un parser.
    """
    # Ojo con `\s`: incluye el salto de línea, así que un `\s*` después de los
    # dos puntos se come el primer item de la lista. Todo lo que va dentro de
    # una línea se matchea con [ \t].
    m = re.search(rf"^{re.escape(clave)}:[ \t]*$", texto, re.M)
    if not m:
        return []
    resto = texto[m.end():]
    fin = re.search(r"^\S", resto, re.M)          # la próxima clave de primer nivel
    bloque = resto[: fin.start()] if fin else resto
    m2 = re.search(rf"^[ \t]+{re.escape(subclave)}:[ \t]*(.*)$", bloque, re.M)
    if not m2:
        return []
    if m2.group(1).strip().startswith("["):        # flow: [a, b, c]
        dentro = m2.group(1).strip().strip("[]")
        return [x.strip().strip("\"'") for x in dentro.split(",") if x.strip()]
    items = []
    for linea in bloque[m2.end():].splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        s = linea.strip()
        if s.startswith("- "):
            items.append(s[2:].strip().strip("\"'"))
        else:
            break                                  # se terminó la lista
    return items


def skills_del_motor(data):
    """Las skills que el motor sembró en este agente, según su manifiesto.

    Lo escribe `skills_sync.py` al copiar las skills de la imagen a
    data/skills/ en cada arranque, con formato `nombre:hash`. Es la única
    lista confiable de qué es "del motor": data/skills/ mezcla eso con las del
    kit y con las que el agente escribió para este cliente.
    """
    ruta = os.path.join(data, "skills", ".bundled_manifest")
    if not os.path.isfile(ruta):
        return None                                # el agente nunca arrancó
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        return {l.split(":", 1)[0].strip() for l in fh if l.strip()}


def conf_del_kit():
    """El config canónico del kit (compose/config.base.yaml), o '' si no está.

    Sirve para chequear a un agente que todavía no arrancó: no tiene manifiesto
    del motor, pero su config salió de acá.
    """
    ruta = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "compose", "config.base.yaml"
    )
    try:
        with open(ruta, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def skills_permitidas():
    """Las del motor que dejamos prendidas, de compose/skills-permitidas.txt."""
    ruta = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "compose", "skills-permitidas.txt"
    )
    try:
        with open(ruta, encoding="utf-8") as fh:
            nombres = {l.strip() for l in fh
                       if l.strip() and not l.lstrip().startswith("#")}
        return nombres or set(PERMITIDAS_POR_DEFECTO)
    except OSError:
        return set(PERMITIDAS_POR_DEFECTO)


def skills_del_kit():
    """Los nombres de las skills que instala este kit (las carpetas de skills/)."""
    raiz = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills")
    try:
        return {d for d in os.listdir(raiz)
                if os.path.isfile(os.path.join(raiz, d, "SKILL.md"))}
    except OSError:
        return set()


def soul(data):
    """SOUL.md como texto. Lo miran cuatro chequeos distintos."""
    ruta = os.path.join(data, "SOUL.md")
    if not os.path.isfile(ruta):
        raise AssertionError("no existe SOUL.md — el agente no sabe quién es")
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def version_del_kit():
    """La versión del bloque genérico que instala ESTE repo, o '' si no se sabe.

    Devuelve lo que dice el archivo, tal cual, aunque sea basura: quién decide
    si sirve es `_kit_version`, y así el aviso dice el valor real.
    """
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "soul", "VERSION")
    try:
        with open(ruta, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""  # el chequeo sigue: reporta la versión instalada y nada más


def huecos_de_plantilla(texto):
    """Los `<huecos>` sin llenar de un SOUL, o de un bloque a punto de instalarse.

    Se sacan primero los dos lugares donde un `<...>` es legítimo:
    los comentarios HTML (notas para quien compone el SOUL, que el agente puede
    ignorar) y todo lo que va entre backticks (`conexion:<id>` y
    `permisos:<id de la conexión>` son menciones que el portal convierte en
    tarjetas). Lo que queda entre corchetes angulares no lo llenó nadie.
    """
    limpio = re.sub(r"<!--.*?-->", " ", texto, flags=re.S)
    limpio = re.sub(r"```.*?```", " ", limpio, flags=re.S)
    limpio = re.sub(r"`[^`\n]*`", " ", limpio)
    encontrados = []
    for m in HUECO.finditer(limpio):
        crudo = m.group(0)
        if "\n\n" in crudo:  # cruzó un párrafo entero: es un "<" suelto, no un hueco
            continue
        if AUTOLINK.match(crudo):  # <https://…> y <alguien@ejemplo.com> son markdown
            continue
        plano = " ".join(crudo.split())
        encontrados.append(plano if len(plano) <= 60 else plano[:57] + "…")
    return sorted(set(encontrados))


def comentarios_riesgosos(texto):
    """Los comentarios HTML que harían que el motor descarte el archivo entero.

    Devuelve una línea por comentario problemático, ya lista para imprimir. Es
    más estricta que el motor a propósito: él exige que las palabras estén a
    menos de 512 caracteres del `<!--` y sin ningún `>` en el medio, y esa
    frontera es demasiado fina como para construir encima. Acá, si la palabra
    está adentro de un comentario, se reporta.
    """
    sospechosos = []
    for m in COMENTARIO_HTML.finditer(texto):
        palabras = sorted({p.lower() for p in VETADAS.findall(m.group(0))})
        if palabras:
            resumen = " ".join(m.group(0).split())
            sospechosos.append(
                (resumen if len(resumen) <= 50 else resumen[:47] + "…")
                + " [" + ", ".join(palabras) + "]"
            )
    return sospechosos


def modo_revisar(ruta):
    """`--revisar <archivo>`: los dos chequeos de texto sobre un SOUL suelto.

    Huecos de plantilla y comentarios que el motor lee como inyección — los
    mismos que corren sobre el SOUL de un agente instalado, sobre un archivo
    que todavía no es de nadie. Lo usa `instalar-soul.sh` ANTES de subir nada,
    y ese es el punto: las dos fallas son silenciosas y se arreglan mucho más
    barato acá que en el prompt de un agente en producción. Devuelve 1 si hay
    algo que arreglar.
    """
    if not os.path.isfile(ruta):
        print(f"No existe {ruta}")
        return 2
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        texto = fh.read()
    huecos = huecos_de_plantilla(texto)
    comentarios = comentarios_riesgosos(texto)
    if huecos:
        print(f"{len(huecos)} hueco(s) de plantilla sin completar en {ruta}:")
        for h in huecos:
            print(f"  {h}")
    if comentarios:
        print(f"{len(comentarios)} comentario(s) HTML que el motor lee como inyección en {ruta}:")
        for c in comentarios:
            print(f"  {c}")
        print("  (con uno solo NO carga el archivo: lo reemplaza por [BLOCKED])")
    if huecos or comentarios:
        return 1
    print(f"sin huecos ni comentarios riesgosos: {ruta}")
    return 0


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--revisar":
        return modo_revisar(sys.argv[2])
    if len(sys.argv) != 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return 2
    data = os.path.abspath(sys.argv[1])
    if not os.path.isdir(data):
        print(f"No existe {data} — ¿es el data/ de un agente?")
        return 2

    print(f"Chequeando {data}\n")

    # --- el kit está instalado ---
    def _kit():
        # Las skills del kit pueden estar en los dos lados: adentro de data/
        # (agentes de antes) o en kit-skills/ montado :ro (los migrados). Para
        # este chequeo alcanza con que estén; que estén en el lugar bueno —y en
        # uno solo— lo mira "skills del kit: montaje externo".
        faltan = []
        for r in DEL_KIT:
            candidatas = [os.path.join(data, r)]
            if r.startswith("skills/"):
                candidatas.append(os.path.join(kit_skills_dir(data), r[len("skills/"):]))
            if not any(os.path.isfile(c) for c in candidatas):
                faltan.append(r)
        if faltan:
            raise AssertionError("faltan: " + ", ".join(faltan) + " — corré install.sh")
        return f"{len(DEL_KIT)} archivos del kit"

    check("kit instalado", _kit)

    # --- frontmatter: la regla que se coló ---
    def _frontmatter():
        mudas, sin_bloque = [], []
        total = 0
        for nombre, ruta in skills_en_disco(data):
            total += 1
            campos = frontmatter(ruta)
            if not campos:
                sin_bloque.append(nombre)
            elif not campos.get("description", "").strip():
                mudas.append(nombre)
        problemas = sin_bloque + mudas
        if problemas:
            raise AssertionError(
                f"{len(problemas)} skill(s) sin descripción utilizable: "
                + ", ".join(problemas)
                + " — se indexan mudas y el agente no las descubre nunca"
            )
        return f"{total} skills, todas con name + description"

    check("frontmatter de las skills", _frontmatter)

    # --- el índice vivo, que es lo que el agente realmente ve ---
    def _indice():
        ruta = os.path.join(data, ".skills_prompt_snapshot.json")
        if not os.path.isfile(ruta):
            raise AssertionError("todavía no hay índice (el agente no arrancó nunca)")
        with open(ruta, encoding="utf-8") as fh:
            skills = json.load(fh).get("skills", [])
        # Las apagadas por config no entran al índice del agente aunque estén
        # en el snapshot: avisar por una skill que el agente no ve es ruido.
        apagadas = set(lista_yaml(conf(data), "skills", "disabled"))
        mudas = [
            s.get("skill_name") for s in skills
            if not (s.get("description") or "").strip() and s.get("skill_name") not in apagadas
        ]
        if mudas:
            # Algunas mudas son del propio motor (apple-notes, imessage…): no las
            # podemos arreglar y a un agente de cliente no le hacen falta. Las
            # nuestras sí importan, y son las que están en skills/ del kit.
            propias = [m for m in mudas if (DEL_KIT_SKILLS & {m})]
            detalle = f"indexadas con descripción vacía: {', '.join(mudas)}"
            if propias:
                detalle += f" — de las nuestras: {', '.join(propias)}"
            else:
                detalle += " (todas del motor; el agente no las descubre, pero no son nuestras)"
            raise AssertionError(detalle + " · si recién tocaste el frontmatter, esperá la reindexación (~20 min)")
        return f"{len(skills)} skills indexadas, ninguna muda"

    check("índice de skills", _indice, required=False)

    # --- skills que le enseñan al agente a operar su propio motor ---
    def _skills_de_motor():
        """El agente de un cliente no tiene por qué saber sobre qué corre.

        No es sólo ruido de contexto: un agente que sabe instalarse skills y
        cambiar su configuración es un agente al que se lo puede convencer de
        que lo haga. Verificado el 5/8 en un agente real: cargó la skill
        `hermes-agent` (14 KB) y se fue al terminal a correr `hermes ...`, dos
        turnos seguidos, contra lo que dicen su SOUL y su memoria.
        """
        raiz = os.path.join(data, "skills", "autonomous-ai-agents")
        if not os.path.isdir(raiz):
            return "sin skills de operación del motor"
        apagadas = set(lista_yaml(conf(data), "skills", "disabled"))
        presentes = sorted(
            d for d in os.listdir(raiz)
            if os.path.isfile(os.path.join(raiz, d, "SKILL.md")) and d not in apagadas
        )
        if not presentes:
            # Están en el disco pero apagadas por config: el motor no las indexa
            # y `skill_view` las rechaza. Borrarlas también sirve y es
            # permanente —`skills_sync.py:19` respeta lo que el usuario borró,
            # no lo vuelve a sembrar—, pero con la config alcanza y es lo que
            # se puede revisar de un vistazo.
            return "las del motor están apagadas por config"
        raise AssertionError(
            "el agente tiene skills para operar su propio runtime y otros agentes ("
            + ", ".join(presentes)
            + ") — borrá skills/autonomous-ai-agents/; el marcador "
            ".no-bundled-skills evita que vuelvan"
        )

    check("skills del motor", _skills_de_motor, required=False)

    # --- el SOUL, que es el system prompt ---
    def _soul():
        # El umbral es 18 KB, no 6: los bloques genéricos del kit ya pesan ~14 KB
        # y cada regla que tienen está porque algo falló sin ella. Avisar por lo
        # normal entrena a ignorar los avisos. Lo que el umbral cuida es la parte
        # del cliente (identidad + lo sensible propio): si eso pasa de ~4 KB,
        # algo de ahí es una skill o un entregable de referencia, no prompt. Si
        # querés bajar contexto de verdad, el gasto grande son los esquemas de
        # herramientas (medilo con `hermes prompt-size`), no la prosa.
        kb = len(soul(data).encode()) / 1024
        return f"{kb:.1f} KB" + ("  (>18 KB: la parte del cliente se fue de escala)" if kb > 18 else "")

    def _soul_huecos():
        huecos = huecos_de_plantilla(soul(data))
        if huecos:
            raise AssertionError(
                f"{len(huecos)} hueco(s) de la plantilla sin completar: "
                + ", ".join(huecos)
                + " — el agente los lee tal cual, así que una regla con un hueco "
                "adentro no prohíbe nada"
            )
        return "ningún <hueco> sin llenar"

    def _soul_bloque():
        """Los marcadores que envuelven las reglas genéricas.

        Sin ellos no se sabe qué reglas tiene puesto un agente sin leerle el
        prompt entero, y `05-precedencia.md` queda hablando de un bloque que no
        se puede señalar.
        """
        texto = soul(data)
        abre = list(KIT_ABRE.finditer(texto))
        cierra = list(KIT_CIERRA.finditer(texto))
        if not abre and not cierra:
            raise AssertionError(
                "no hay marcadores kit:base — el SOUL se compuso a mano o es "
                "anterior a los marcadores; instalá el bloque con tools/instalar-soul.sh"
            )
        if len(abre) != 1 or len(cierra) != 1:
            raise AssertionError(
                f"marcadores desbalanceados: {len(abre)} de apertura y {len(cierra)} "
                "de cierre — con el bloque partido, la regla de precedencia no señala nada"
            )
        if abre[0].start() > cierra[0].start():
            raise AssertionError("el cierre de kit:base viene ANTES que la apertura")
        return "bloque genérico entre marcadores (" + (abre[0].group(1) or "sin versión") + ")"

    def _soul_version():
        """Qué versión del bloque tiene puesta, contra la que instala este kit."""
        abre = KIT_ABRE.search(soul(data))
        if not abre:
            raise AssertionError("sin marcador kit:base no hay versión que leer")
        puesta, kit = abre.group(1), version_del_kit()
        if not puesta:
            raise AssertionError(
                "el bloque no tiene versión (es anterior al versionado, o sea v1) y "
                f"este kit instala {kit or 'otra'} — reinstalalo para saber qué reglas corre"
            )
        # Contra una versión del kit que no tiene forma de versión no se compara:
        # diría "quedó atrás" cuando el problema es soul/VERSION (lo dice el
        # chequeo de abajo).
        if not VERSION_VALIDA.match(kit or ""):
            return f"{puesta} (no la puedo comparar: mirá el chequeo de soul/VERSION)"
        if puesta != kit:
            raise AssertionError(f"tiene {puesta} y este kit instala {kit} — quedó atrás")
        return f"{puesta}, al día con el kit"

    def _soul_comentarios():
        """Comentarios HTML que harían que el motor descarte el SOUL entero.

        No es una precaución teórica: el escáner del motor bloquea el archivo
        completo, el agente arranca sin identidad y sin reglas, y el único
        rastro es una línea de log. Un comentario `por-cliente` mal redactado
        —"ignorar los mails de X", "override de precios", "datos hidden"— es
        suficiente.
        """
        texto = soul(data)
        total = len(COMENTARIO_HTML.findall(texto))
        sospechosos = comentarios_riesgosos(texto)
        if sospechosos:
            raise AssertionError(
                "hay comentario(s) HTML con palabras que el motor lee como inyección: "
                + " · ".join(sospechosos)
                + " — con eso NO carga el SOUL: lo reemplaza por [BLOCKED] y el agente "
                "queda sin identidad ni reglas, sin avisar. Reescribí el comentario "
                "sin esas palabras (o sacalo)"
            )
        return f"{total} comentario(s), ninguno con palabra vetada"

    def _soul_identidad():
        """Un agente sin identidad no sale a producción.

        El hueco no queda vacío: lo llena el preámbulo del motor, y el agente se
        presenta como el asistente genérico de quien lo fabricó en vez del agente
        de la empresa que lo paga. Verificado con los agentes remotos, que
        corrían con 800 bytes de preámbulo y nada más.
        """
        texto = soul(data)
        portal = PORTAL_IDENTIDAD.search(texto)
        if portal and portal.group(1).strip():
            return "bloque portal:identidad (lo escribió el bautizo del portal)"
        # Lo propio se busca AFUERA del bloque genérico: adentro no hay títulos
        # de primer nivel, así que un "# …" ahí afuera es el bloque de identidad.
        abre, cierra = KIT_ABRE.search(texto), KIT_CIERRA.search(texto)
        afuera = texto
        if abre and cierra and cierra.end() > abre.start():
            afuera = texto[: abre.start()] + texto[cierra.end():]
        if IDENTIDAD_H1.search(afuera):
            return "bloque de identidad propio (00-identidad compuesto)"
        raise AssertionError(
            "el SOUL no dice quién es ni para quién trabaja: no hay bloque de "
            "identidad (un título de primer nivel, '# Sos …, el agente de …') ni "
            "bloque portal:identidad — se escribe a mano desde soul/00-identidad.md"
        )

    def _kit_version():
        """El soul/VERSION de este kit, si el kit está a mano.

        Un valor con otra forma —"2", "v2.1"— se estampa igual en el marcador y
        después el chequeo del bloque lo reporta como desbalanceado, que manda a
        buscar el problema a cualquier lado. `instalar-soul.sh` y
        `nuevo-agente.sh` se niegan a estampar con un valor así.
        """
        kit = version_del_kit()
        if not kit:
            raise AssertionError(
                "no encontré soul/VERSION al lado de este script — no puedo decir "
                "qué versión del bloque instala el kit"
            )
        if not VERSION_VALIDA.match(kit):
            raise AssertionError(
                f"soul/VERSION dice {kit!r} y tiene que ser vN (v1, v2, v3…) — "
                "arreglalo antes de instalar nada"
            )
        return kit

    check("SOUL compuesto", _soul)
    check("SOUL sin huecos de plantilla", _soul_huecos)
    check("SOUL: comentarios HTML", _soul_comentarios)
    check("SOUL: bloque del kit", _soul_bloque)
    check("SOUL: versión del bloque", _soul_version, required=False)
    check("SOUL: identidad", _soul_identidad)
    check("kit: soul/VERSION", _kit_version, required=False)

    # --- config: los tres olvidos clásicos del alta ---
    def _api():
        texto = conf(data)
        if "api_server:" not in texto:
            raise AssertionError("falta el bloque api_server — el portal no puede entrar")
        if not re.search(r"api_server:(?:.|\n)*?enabled:\s*true", texto):
            raise AssertionError("api_server.enabled no está en true")
        return "api_server encendido"

    def _modelo():
        texto = conf(data)
        m = re.search(r"^model:(?:.|\n)*?^\s+default:\s*(\S+)", texto, re.M)
        if not m:
            raise AssertionError(
                "model.default vacío — las sesiones que cree el adapter salen con "
                "el modelo placeholder y el proveedor las rechaza con 400"
            )
        return m.group(1)

    def _kanban():
        """Las tools nativas de kanban necesitan LAS DOS claves. Verificado."""
        texto = conf(data)
        faltan = []
        if not re.search(r"^toolsets:(?:\s*\n\s+-\s*.*)*?\n\s+-\s*kanban\b", texto, re.M) and not re.search(
            r"^toolsets:\s*\[[^\]]*\bkanban\b", texto, re.M
        ):
            faltan.append("toolsets: [kanban] (abre la compuerta del check_fn)")
        if not re.search(r"^platform_toolsets:(?:.|\n)*?\bkanban\b", texto, re.M):
            faltan.append("platform_toolsets con kanban por plataforma (pasa el filtro)")
        if faltan:
            raise AssertionError(
                "; ".join(faltan)
                + " — sin las dos el agente no ve ninguna tool de kanban y "
                "termina improvisando por terminal sobre su propio tablero"
            )
        return "toolsets + platform_toolsets"

    def _skills_del_motor_apagadas():
        """Ninguna skill del motor prendida fuera de las tres de documentos.

        Cierra el círculo de la blocklist: la lista de `skills.disabled` la
        genera tools/perilla-skills.py, y al subir de tag el motor puede traer
        skills nuevas que esa lista no nombra. Sin este chequeo, un upgrade
        vuelve a encender himalaya (mandar mails) o computer-use sin que nadie
        lo note. La comparación es contra el manifiesto que el propio motor
        escribe, así que no hay lista nuestra que se quede vieja.
        """
        sembradas = skills_del_motor(data)
        apagadas = set(lista_yaml(conf(data), "skills", "disabled"))
        permitidas = skills_permitidas()
        if sembradas is None:
            # Todavía no arrancó, así que no hay manifiesto contra qué comparar.
            # Igual se puede chequear lo que importa antes de prender: que el
            # config traiga la lista, y que no le falte ninguna de las que el
            # kit apaga. Cuando arranque, la comparación pasa a ser contra lo
            # que el motor sembró de verdad, que es más fuerte.
            del_kit = set(lista_yaml(conf_del_kit(), "skills", "disabled"))
            if not apagadas:
                raise AssertionError(
                    "config.yaml no apaga ninguna skill del motor — copiá el bloque "
                    "de compose/config.base.yaml o generalo con tools/perilla-skills.py"
                )
            # Sin lista canónica no hay con qué comparar, y un chequeo que no
            # compara nada no puede dar verde. Acá no hay respaldo posible como
            # el de skills_permitidas(): esa son tres nombres estables (la
            # política), esta son ~70 que cambian con cada versión del motor.
            if not del_kit:
                raise AssertionError(
                    "no pude leer la lista de skills apagadas de "
                    "compose/config.base.yaml, así que no tengo contra qué comparar "
                    "el config de este agente. Regenerala con "
                    "tools/perilla-skills.py --imagen <tag> --aplicar compose/config.base.yaml"
                )
            faltan = sorted(del_kit - apagadas - permitidas)
            if faltan:
                raise AssertionError(
                    f"al config le faltan {len(faltan)} skill(s) que el kit apaga: "
                    + ", ".join(faltan[:12]) + ("…" if len(faltan) > 12 else "")
                )
            return f"{len(apagadas)} apagadas por config (sin arrancar todavía)"
        prendidas = sorted(sembradas - apagadas - permitidas)
        if prendidas:
            raise AssertionError(
                f"{len(prendidas)} skill(s) del motor prendidas: "
                + ", ".join(prendidas[:12])
                + ("…" if len(prendidas) > 12 else "")
                + " — regenerá la lista: python3 tools/perilla-skills.py --agente "
                + f"{data} --aplicar <config.yaml>"
            )
        return f"{len(sembradas)} del motor · {len(sembradas & permitidas)} prendidas a propósito"

    def _skills_del_kit_externas():
        """Las del kit, montadas afuera y sin copia vieja que las tape.

        Si la misma skill está en data/skills/ y en el directorio externo, gana
        la de data/ —el motor resuelve local primero y el índice saltea el
        nombre repetido—, así que el agente sigue corriendo la copia vieja y
        `install.sh` deja de tener efecto, sin un solo error.
        """
        externas_dir = kit_skills_dir(data)
        declarados = lista_yaml(conf(data), "skills", "external_dirs")
        del_kit = skills_del_kit()
        presentes = set()
        if os.path.isdir(externas_dir):
            presentes = {d for d in os.listdir(externas_dir)
                         if os.path.isfile(os.path.join(externas_dir, d, "SKILL.md"))}
        # La pregunta no es "¿está en data/skills/<nombre>?" sino "¿queda alguna
        # copia en el árbol que el motor INDEXA?". Una copia en una subcarpeta,
        # o apartada a un dot-dir que no sea `.archive`, tapa igual.
        tapando = sorted({
            f"{nombre} ({os.path.relpath(os.path.dirname(ruta), data)})"
            for nombre, ruta in skills_indexadas(os.path.join(data, "skills"))
            if nombre in del_kit
        })
        if tapando:
            raise AssertionError(
                "el motor todavía indexa copias de skills del kit adentro de data/: "
                + ", ".join(tapando)
                + " — esas ganan sobre las externas y el agente sigue corriendo la "
                "vieja; corré install.sh, que las aparta afuera de data/skills/"
            )
        if not presentes:
            raise AssertionError(
                f"no hay skills del kit en {externas_dir} — este agente es de antes "
                "de la mudanza a skills.external_dirs; migralo con install.sh y "
                "agregá el montaje :ro al compose (ver notas/perillas-aplicadas.md)"
            )
        if not declarados:
            raise AssertionError(
                "kit-skills/ existe pero config.yaml no declara skills.external_dirs: "
                "el motor no las indexa y el agente no las ve"
            )
        faltan = sorted(del_kit - presentes)
        if faltan:
            raise AssertionError("faltan en kit-skills/: " + ", ".join(faltan) + " — corré install.sh")
        return f"{len(presentes)} skills del kit, montadas afuera de data/"

    def _hint_del_portal():
        """El preámbulo del api_server, reemplazado por el nuestro."""
        texto = conf(data)
        if not re.search(r"^platform_hints:", texto, re.M):
            raise AssertionError(
                "sin platform_hints.api_server.replace el motor le dice al agente "
                "'assume plain text, no markdown formatting' en cada sesión del "
                "portal — y el portal renderiza markdown completo"
            )
        if not re.search(r"^platform_hints:(?:.|\n)*?api_server:(?:.|\n)*?replace:", texto, re.M):
            raise AssertionError(
                "platform_hints está pero sin api_server.replace (con `append` el "
                "texto del motor se queda igual, al lado del nuestro)"
            )
        return "el preámbulo del portal es el nuestro"

    check("config: api_server", _api)
    check("config: modelo por defecto", _modelo)
    check("config: kanban nativo", _kanban)
    check("config: skills del motor apagadas", _skills_del_motor_apagadas)
    check("config: preámbulo del portal", _hint_del_portal)
    check("skills del kit: montaje externo", _skills_del_kit_externas)

    # --- lo que las skills dan por sentado ---
    def _workspace():
        faltan = [
            c
            for c in ("workspace/entregables", "workspace/artifacts", "workspace/entrada")
            if not os.path.isdir(os.path.join(data, c))
        ]
        if faltan:
            raise AssertionError("faltan carpetas: " + ", ".join(faltan))
        return "carpetas del workspace"

    def _env():
        ruta = os.path.join(data, ".env")
        if not os.path.isfile(ruta):
            raise AssertionError("no existe .env")
        with open(ruta, encoding="utf-8", errors="replace") as fh:
            claves = {l.split("=", 1)[0].strip() for l in fh if "=" in l and not l.startswith("#")}
        if "API_SERVER_KEY" not in claves:
            raise AssertionError("falta API_SERVER_KEY — el portal no tiene con qué autenticarse")
        return f"{len(claves)} variables"  # nunca imprimimos valores

    check("workspace", _workspace)
    check("credenciales", _env)

    # --- reporte ---
    print()
    for estado, nombre, detalle in results:
        print(f"  [{estado}] {nombre}" + (f" — {detalle}" if detalle else ""))
    fallas = [r for r in results if r[0] == FAIL]
    avisos = [r for r in results if r[0] == WARN]
    print(f"\n{len(results) - len(fallas) - len(avisos)} ok · {len(avisos)} avisos · {len(fallas)} fallas")
    if fallas:
        print("\nNo entregar así. Arreglá las fallas y volvé a correr.")
        return 1
    print("\nEl data/ del agente cumple. Prendelo y corré portal-check.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
