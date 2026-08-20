#!/usr/bin/env python3
"""¿Dos roles del roster son el mismo texto con otro nombre? ¿Dos skills?

Correlo **al escribir una identity o una skill nueva** (y antes de sumarla al
catálogo): `python3 tools/chequear-clones.py`.

    python3 tools/chequear-clones.py                 todo el corpus, tabla + exit 0/1
    python3 tools/chequear-clones.py --umbral 25     mueve el umbral de FALLA
    python3 tools/chequear-clones.py --par a.md b.md un par, con los calcos a la vista
    python3 tools/chequear-clones.py --raiz /otro    otra copia del kit

Exit 0 = nadie pasa el umbral de FALLA. Exit 1 = hay al menos un par que sí.
Los AVISOS no rompen: son para mirar, no para bloquear.

Por qué existe: el roster se vende como equipo. Cinco roles que dicen lo mismo
con otro nombre no son cinco roles, son uno cobrado cinco veces — y el calco es
fácil de meter sin querer, porque copiar la identity de al lado y cambiarle el
oficio pasa cualquier review: el archivo queda bien formado y suena bien. Lo
mismo con las skills del kit. Por eso la comparación **neutraliza las entidades
antes de medir**: los nombres del roster, las etiquetas de las capacidades, los
nombres de las skills y cualquier palabra Capitalizada en medio de una frase se
reemplazan por un comodín, así un buscar-y-reemplazar no puede esconder la copia.

Cómo mide: shingles de 8 palabras sobre el texto neutralizado, y el solapamiento
es `|shingles compartidos| / |shingles del archivo más chico|`. El denominador
es el más chico a propósito: un calco al que le agregaron dos secciones abajo
sigue siendo un calco, y un Jaccard clásico lo diluiría.

Dos bolsas separadas —identities contra identities, skills contra skills— porque
una identity y una skill no comparten prosa ni deberían: cruzarlas solo agrega
ruido.

Portado (la idea, no el bash) de `scripts/check-agent-originality.sh` del repo
agency-agents, MIT. Allá el corpus daba mediana 0% y peor par ~1.5%, con
AVISO 20 / FALLA 40; acá el corpus es otro y los umbrales se recalibraron contra
la medición de este repo (ver UMBRAL_*).
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from itertools import combinations
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]

# The two pools. Never crossed: an identity and a SKILL.md share no prose.
BOLSAS = (
    ("roles", "roles/*/identity.md"),
    ("skills", "skills/*/SKILL.md"),
)

VENTANA = 8   # shingle length, in words

# --- thresholds -------------------------------------------------------------
# Calibrated against the measured baseline of THIS repo (2026-08-20, 5
# identities + 14 skills, 101 pairs):
#   roles:  worst pair 0.9%, median 0.0%
#   skills: worst pair 3.8% (sin-busqueda-web <-> sin-imagenes), median 0.0%
# The 3.8% is real and correct: those two skills are siblings — both say "you
# don't have this, offer the capacity" — and they share the sentence that
# explains the note disappears on its own. That is overlap worth seeing, not a
# clone, so it stays measured instead of whitelisted.
# The other end of the ruler: a real find-replace clone (an identity copied with
# the role names swapped) measures ~98% here. So the honest corpus lives under
# 5% and a clone lives over 95%; there is nothing in between to split hairs
# about. WARN at 15% is ~4x today's worst honest pair, FAIL at 30% means "a
# third of the smaller file is verbatim the other one", which no two roles can
# defend. Both are set for zero false positives, not for catching more.
# The half-clone case, measured the same way: copy an identity and rewrite half
# of it -> 53% (FAIL); rewrite three quarters -> 22% (WARN); nine tenths -> 9%
# (ok). Which is the behaviour we want — the further you get from the original,
# the less the check has to say about you.
UMBRAL_FALLA = 30.0
UMBRAL_AVISO = 15.0

# --- what is legitimately shared -------------------------------------------
# Empirical, not theoretical: this list was filled AFTER running the tool on the
# corpus and reading the shared shingles of the worst pairs with `--par`.
# Everything here is house boilerplate that every file of its kind repeats on
# purpose; leaving it in would charge every new role a few points of overlap it
# did not earn. Anything NOT on this list counts, including similar-sounding
# prose — that is the signal we want.
CALCOS_LEGITIMOS = (
    # The anti-punt rule. roles/README.md says it out loud: "cada identity.md
    # termina con la misma advertencia, y no es adorno". A rule every role is
    # REQUIRED to repeat verbatim cannot count as evidence that two roles are
    # the same role. Without this, it alone put ~4 points on every pair.
    r"decilo una vez y segu[ií](?: con\s+lo que s[ií] pod[eé]s hacer)?",
    r"\*\*Pero nunca patees lo que pod[eé]s hacer\.\*\*",
    # Same story with the rule about company facts belonging to the shared file
    # instead of to one role's memory: house rule, repeated on purpose.
    r"va al archivo compartido",
    r"el resto del equipo sigue diciendo lo viejo",
    # Section headings. Also prescribed: an identity is "qué hace, qué no hace
    # nunca, con qué otros roles se cruza" (roles/README.md), so the skeleton is
    # the template's, not the author's. What hangs UNDER each heading is the
    # author's, and that is still fully measured.
    r"^#+ .*$",
)
_CALCOS = re.compile("|".join(CALCOS_LEGITIMOS), re.IGNORECASE | re.MULTILINE)

COMODIN = " ¶ "   # placeholder that survives tokenization as a word

PALABRA_CAP = re.compile(r"\b[A-ZÁÉÍÓÚÜÑ][\wÀ-ſ]*")
# Chars that mean "a sentence starts right after me". A capitalized word right
# after one of these is just Spanish orthography, not a proper noun, so it stays.
ARRANQUE = set(".!?:;\n")
# Markdown decoration to see through when looking backwards for the real char.
DECORADO = " \t*_`#>-–—•|\"'([«"


def sin_frontmatter(texto):
    """Drop the YAML frontmatter — it is metadata, not prose."""
    if texto.startswith("---"):
        partes = texto.split("---", 2)
        if len(partes) >= 3:
            return partes[2]
    return texto


def entidades(raiz):
    """Names a find-replace clone would swap: roster, capacities, skills.

    Read from the catalogs rather than hardcoded so this check cannot drift out
    of sync with the roster the way a copied literal silently would.
    """
    terminos = set()

    catalogo_roles = raiz / "roles" / "catalogo.json"
    if catalogo_roles.is_file():
        datos = json.loads(catalogo_roles.read_text(encoding="utf-8"))
        for rol in datos.get("roles", []):
            for clave in ("id", "label"):
                if rol.get(clave):
                    terminos.add(str(rol[clave]))
            nombre = (rol.get("identity") or {}).get("name")
            if nombre:
                terminos.add(str(nombre))

    catalogo_caps = raiz / "capacidades" / "catalogo.json"
    if catalogo_caps.is_file():
        datos = json.loads(catalogo_caps.read_text(encoding="utf-8"))
        for cap in datos.get("capacidades", []):
            for clave in ("id", "label"):
                if cap.get(clave):
                    terminos.add(str(cap[clave]))

    for skill in sorted((raiz / "skills").glob("*/SKILL.md")):
        terminos.add(skill.parent.name)

    # Longest first: "Cargar facturas" must be replaced before "facturas".
    return sorted(terminos, key=len, reverse=True)


def _regex_entidades(terminos):
    # `-` -> `[- ]` so the id (`sin-busqueda-web`) also catches the prose form
    # ("sin busqueda web"). Terms of 1-2 chars are dropped: they are not names,
    # they are noise that would blank out half the text.
    partes = [re.escape(t).replace("-", "[- ]") for t in terminos if len(t) > 2]
    if not partes:
        return re.compile(r"(?!x)x")   # matches nothing, never the empty string
    return re.compile(r"(?<![\w])(?:" + "|".join(partes) + r")(?![\w])", re.IGNORECASE)


def _neutralizar_capitalizadas(texto):
    """Blank out Capitalized words that are NOT starting a sentence.

    The source script neutralized a hardcoded list of markets and platforms; the
    generalization is that any proper noun mid-sentence is an entity — a client,
    a tool, a country, a role name we forgot to put in a catalog — and a clone
    that only swapped those must still score as a clone. Sentence-initial
    capitals are kept because in Spanish every sentence starts with one and
    blanking them would erase real prose.
    """
    salida = []
    fin = 0
    for m in PALABRA_CAP.finditer(texto):
        anterior = texto[:m.start()].rstrip(DECORADO)
        inicial = (not anterior) or anterior[-1] in ARRANQUE
        if inicial:
            continue
        salida.append(texto[fin:m.start()])
        salida.append(COMODIN)
        fin = m.end()
    salida.append(texto[fin:])
    return "".join(salida)


def _normalizar(trozo, re_entidades):
    trozo = re_entidades.sub(COMODIN, trozo)
    trozo = _neutralizar_capitalizadas(trozo)
    trozo = trozo.lower()
    trozo = unicodedata.normalize("NFD", trozo)
    trozo = "".join(c for c in trozo if not unicodedata.combining(c))
    trozo = re.sub(r"[^a-z0-9¶ ]", " ", trozo)
    return trozo.split()


def palabras(texto, re_entidades):
    """Text -> comparable segments: no frontmatter, no boilerplate, no entities.

    Segments, not one flat list, because the boilerplate is CUT OUT rather than
    blanked: if a shingle could span the hole, deleting a shared heading would
    weld the paragraph above to the paragraph below and invent an overlap that
    is not in either file. Nothing crosses a cut.
    """
    texto = sin_frontmatter(texto)
    return [ws for ws in (_normalizar(t, re_entidades) for t in _CALCOS.split(texto)) if ws]


def shingles(segmentos, k=VENTANA):
    salida = set()
    for ws in segmentos:
        salida.update(" ".join(ws[i:i + k]) for i in range(max(0, len(ws) - k + 1)))
    return salida


def solape(a, b):
    """|shared| / |smaller|, as a percentage. Containment, not plain Jaccard."""
    if not a or not b:
        return 0.0
    return 100.0 * len(a & b) / min(len(a), len(b))


def corpus(raiz, patron, re_entidades):
    salida = {}
    for ruta in sorted(raiz.glob(patron)):
        texto = ruta.read_text(encoding="utf-8", errors="replace")
        salida[ruta] = shingles(palabras(texto, re_entidades))
    return salida


def rel(ruta, raiz):
    try:
        return str(Path(ruta).resolve().relative_to(raiz))
    except ValueError:
        return str(ruta)


def etiqueta(pct):
    if pct >= UMBRAL_FALLA:
        return "FALLA"
    if pct >= UMBRAL_AVISO:
        return "AVISO"
    return "ok   "


def pares(archivos):
    """Every pair in a pool, worst first.

    Sanity check for the numbers this returns: a real identity copied with its
    role names find-replaced scores ~98%, while the two most alike real files
    score under 5%. There is no middle ground in practice.
    """
    puntajes = []
    for a, b in combinations(sorted(archivos), 2):
        puntajes.append((solape(archivos[a], archivos[b]), a, b))
    puntajes.sort(key=lambda t: -t[0])
    return puntajes


def modo_par(ruta_a, ruta_b, raiz):
    """`--par a b`: the two files, the score, and the shingles they share."""
    re_entidades = _regex_entidades(entidades(raiz))
    juegos = []
    for r in (ruta_a, ruta_b):
        p = Path(r)
        if not p.is_file():
            print(f"No existe {r}")
            return 2
        juegos.append((p, shingles(palabras(p.read_text(encoding="utf-8", errors="replace"), re_entidades))))
    (pa, sa), (pb, sb) = juegos
    pct = solape(sa, sb)
    compartidos = sorted(sa & sb)

    print(f"  A: {pa}  ({len(sa)} shingles)")
    print(f"  B: {pb}  ({len(sb)} shingles)")
    print()
    print(f"  solape {pct:.1f}%  [{etiqueta(pct).strip()}]  "
          f"— {len(compartidos)} shingles compartidos sobre {min(len(sa), len(sb))}")
    if compartidos:
        print()
        print("  lo que comparten (texto ya neutralizado):")
        for s in compartidos[:40]:
            print(f"    {s}")
        if len(compartidos) > 40:
            print(f"    … y {len(compartidos) - 40} más")
    print()
    print(f"  Umbrales: AVISO >= {UMBRAL_AVISO:.0f}%, FALLA >= {UMBRAL_FALLA:.0f}%")
    return 1 if pct >= UMBRAL_FALLA else 0


def modo_corpus(raiz, top):
    re_entidades = _regex_entidades(entidades(raiz))
    print(f"Chequeando clones en {raiz}\n")

    fallas = []
    avisos = []
    peor_global = (0.0, None, None)
    vacio = True

    for nombre, patron in BOLSAS:
        archivos = corpus(raiz, patron, re_entidades)
        if len(archivos) < 2:
            print(f"{patron} — {len(archivos)} archivo(s), nada que comparar\n")
            continue
        vacio = False
        puntajes = pares(archivos)
        n = len(puntajes)
        medio = puntajes[n // 2][0]
        print(f"{patron} — {len(archivos)} archivos, {n} pares")
        for pct, a, b in puntajes[:top]:
            print(f"  [{etiqueta(pct)}] {pct:5.1f}%  {rel(a, raiz)}  <->  {rel(b, raiz)}")
            if pct >= UMBRAL_FALLA:
                fallas.append((pct, rel(a, raiz), rel(b, raiz)))
            elif pct >= UMBRAL_AVISO:
                avisos.append((pct, rel(a, raiz), rel(b, raiz)))
        if n > top:
            print(f"  … y {n - top} pares más, ninguno por encima de {puntajes[top - 1][0]:.1f}%")
        print(f"  peor par {puntajes[0][0]:.1f}%  ·  mediana {medio:.1f}%\n")
        if puntajes[0][0] > peor_global[0]:
            peor_global = (puntajes[0][0], rel(puntajes[0][1], raiz), rel(puntajes[0][2], raiz))

    if vacio:
        print("No hay corpus que chequear.")
        return 0

    print(f"Umbrales: AVISO >= {UMBRAL_AVISO:.0f}%, FALLA >= {UMBRAL_FALLA:.0f}%  "
          f"(peor par del corpus: {peor_global[0]:.1f}%)")

    if fallas:
        print()
        print(f"FALLA: {len(fallas)} par(es) son el mismo texto con otro nombre:")
        for pct, a, b in fallas:
            print(f"  - {a}  ~{pct:.0f}% igual a  {b}")
        print()
        print("Un rol nuevo se vende como alguien más en el equipo. Si dice lo mismo")
        print("que otro con las palabras cambiadas, no es un rol nuevo: es el mismo")
        print("cobrado dos veces. Reescribí el oficio, los límites y los cruces, no")
        print("el nombre. Para ver qué comparten: --par <a> <b>.")
        return 1

    if avisos:
        print(f"\n{len(avisos)} aviso(s) para mirar. No bloquean.")
    print("\nPASA")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="Que dos identities (o dos skills) no sean el mismo texto con otro nombre.",
        epilog="Sin argumentos chequea todo el corpus del kit.")
    ap.add_argument("--umbral", type=float, metavar="N",
                    help="reemplaza el umbral de FALLA; el de AVISO queda en la mitad")
    ap.add_argument("--par", nargs=2, metavar=("A", "B"),
                    help="mira un par puntual y muestra los shingles compartidos")
    ap.add_argument("--raiz", metavar="DIR", default=str(RAIZ),
                    help="otra copia del kit (por defecto, la de este tools/)")
    ap.add_argument("--top", type=int, default=10, metavar="N",
                    help="cuántos pares mostrar por bolsa (default 10)")
    args = ap.parse_args()

    global UMBRAL_FALLA, UMBRAL_AVISO
    if args.umbral is not None:
        UMBRAL_FALLA = args.umbral
        UMBRAL_AVISO = args.umbral / 2

    raiz = Path(os.path.abspath(args.raiz))
    if not raiz.is_dir():
        print(f"No existe {raiz}")
        return 2

    if args.par:
        return modo_par(args.par[0], args.par[1], raiz)
    return modo_corpus(raiz, max(1, args.top))


if __name__ == "__main__":
    sys.exit(main())
