#!/usr/bin/env python3
"""Chequeo de conformidad OFFLINE: ¿el data/ de este agente está bien armado?

Hermano de `portal-check.py`. Aquel corre contra un agente **encendido** y
verifica el contrato HTTP; este mira los archivos y agarra los errores que se
cometen al dar de alta un cliente, antes de prender nada.

    python3 tools/agente-check.py /ruta/al/agente/data

Exit 0 = cumple. Exit 1 = hay fallas (se listan al final).

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

# Los bloques de soul/ vienen con estos huecos; si sobreviven, nadie escribió el SOUL.
PLACEHOLDER = re.compile(r"<(?:CLIENTE|RESPONSABLE|NOMBRE|EMPRESA)>")

# Lo que install.sh deja en el data/. Si falta, el kit no está instalado.
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


def main():
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
            raise AssertionError(
                f"indexadas con descripción vacía: {', '.join(mudas)} "
                "(si ya arreglaste el frontmatter, esperá la reindexación, ~20 min)"
            )
        return f"{len(skills)} skills indexadas, ninguna muda"

    check("índice de skills", _indice, required=False)

    # --- el SOUL, que es el system prompt ---
    def _soul():
        ruta = os.path.join(data, "SOUL.md")
        if not os.path.isfile(ruta):
            raise AssertionError("no existe SOUL.md — el agente no sabe quién es")
        with open(ruta, encoding="utf-8", errors="replace") as fh:
            texto = fh.read()
        huecos = sorted(set(PLACEHOLDER.findall(texto)))
        if huecos:
            raise AssertionError(
                "quedaron huecos de la plantilla sin completar: " + ", ".join(huecos)
            )
        kb = len(texto.encode()) / 1024
        return f"{kb:.1f} KB" + ("  (>6 KB: algo de acá debería ser una skill)" if kb > 6 else "")

    check("SOUL compuesto", _soul)

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

    def _plugin():
        texto = conf(data)
        if "kanban_tools" not in texto:
            raise AssertionError(
                "kanban_tools no está en plugins.enabled — el agente improvisa "
                "con scripts de Python sobre su propio tablero"
            )
        return "kanban_tools habilitado"

    check("config: api_server", _api)
    check("config: modelo por defecto", _modelo)
    check("config: plugin de kanban", _plugin)

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
