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


def skills_en_disco(data):
    """Toda carpeta con un SKILL.md, a cualquier profundidad (hay categorías)."""
    raiz = os.path.join(data, "skills")
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
        faltan = [r for r in DEL_KIT if not os.path.isfile(os.path.join(data, r))]
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
        mudas = [s.get("skill_name") for s in skills if not (s.get("description") or "").strip()]
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
        presentes = sorted(
            d for d in os.listdir(raiz)
            if os.path.isfile(os.path.join(raiz, d, "SKILL.md"))
        )
        if not presentes:
            return "sin skills de operación del motor"
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

    check("config: api_server", _api)
    check("config: modelo por defecto", _modelo)
    check("config: kanban nativo", _kanban)

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
