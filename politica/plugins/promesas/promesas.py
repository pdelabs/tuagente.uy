#!/usr/bin/env python3
"""Contrasta lo que el agente DICE que dejó corriendo solo con lo que hay.

Este archivo no importa nada del motor a propósito: son funciones puras sobre
un texto y una carpeta `data/`. Así lo puede correr `tools/agente-check.py`
desde el host —con casos de prueba de verdad, incluida la frase exacta que le
costó la confianza a una clienta— sin levantar un agente.

QUE PROBLEMA RESUELVE. El 13/8/2026, en la prueba a ciegas de una inmobiliaria:
la clienta pidió el control semanal de contratos, el agente contestó "Queda
definido: viernes a las 9:30" con los dos bloques y todo, y NO llamó a
`crear_flujo.py` ni una vez. En la pestaña Flujos seguía diciendo "Todavía no
hay nada corriendo solo". Recién cuando ella le preguntó "¿entonces quedó
armado o no?" el agente lo creó y admitió el invento. Si no chequeaba, no se
enteraba: el viernes no le llegaba nada y el contrato se le renovaba solo.

EL CRITERIO. Una afirmación sobre algo que corre solo es verificable por
código: o hay un FLUJO.md activo con su gatillo vivo en el cron, o no lo hay.
Entonces no se le pide al modelo que se acuerde: se mira el disco y, si lo que
dijo no está, el texto sale con una corrección pegada que el cliente no puede
no ver.

Dos reglas, y las dos afirman HECHOS (nunca acusan al agente de mentir, porque
la detección de la frase es aproximada y el hecho no):

  R1  dice que algo quedó armado/programado, habla de algo que se repite, y no
      hay NINGUN flujo vivo.
  R2  en el mismo renglón dice que quedó armado y nombra día y hora, y ningún
      flujo vivo dispara ese día a esa hora. (Este es el que agarra la deriva:
      el flujo existe pero corre los jueves y el agente dice viernes.)

Fuera de alcance, dicho para que nadie lea más cobertura de la que hay: esto
solo sabe de flujos. "Le mandé el mail", "cerré el ticket" o "lo subí" no se
chequean acá — no hay un archivo que los contradiga.
"""
import json
import os
import re
import unicodedata

DIAS = {
    "domingo": 0, "domingos": 0,
    "lunes": 1,
    "martes": 2,
    "miercoles": 3,
    "jueves": 4,
    "viernes": 5,
    "sabado": 6, "sabados": 6,
}
NOMBRE_DIA = {0: "domingos", 1: "lunes", 2: "martes", 3: "miércoles",
              4: "jueves", 5: "viernes", 6: "sábados"}

# LA FRASE QUE CIERRA. No se persigue el verbo "hacer": se persiguen las
# formas con las que se le dice a alguien que una cosa YA ESTA. "Queda
# definido" está primera por algo — es la que pasó.
AFIRMACIONES = (
    "queda definido", "quedo definido", "queda definida", "quedo definida",
    "queda armado", "quedo armado", "queda armada", "quedo armada",
    "queda creado", "quedo creado", "queda creada", "quedo creada",
    "queda programado", "quedo programado", "queda programada", "quedo programada",
    "queda agendado", "quedo agendado", "queda agendada", "quedo agendada",
    "queda configurado", "quedo configurado",
    "queda activo", "quedo activo", "queda activa", "quedo activa",
    "queda andando", "quedo andando", "queda corriendo", "quedo corriendo",
    "queda listo", "quedo listo", "queda lista", "quedo lista",
    "queda cambiado", "quedo cambiado", "queda cambiada", "quedo cambiada",
    "queda hecho", "quedo hecho",
    "lo deje armado", "lo deje programado", "lo deje andando",
    "lo deje corriendo", "lo deje listo", "lo deje agendado",
    "lo programe", "lo agende", "lo cree", "ya lo cree", "ya esta creado",
    "sigue activo", "sigue activa", "sigue andando", "sigue corriendo",
    "esta programado", "esta programada", "esta agendado", "esta agendada",
    "esta activo", "esta activa", "esta andando", "esta corriendo",
    "va a correr", "corre solo", "arranca solo", "se hace solo",
    "empieza a correr", "listo:",
)

# LO QUE HACE QUE LA FRASE SEA SOBRE ALGO QUE SE REPITE. Sin esto, "el informe
# quedó listo" caia en la red y el cliente leia una correccion sobre flujos
# cuando habia pedido un informe suelto.
REPETICION = (
    "todos los", "todas las", "cada semana", "cada mes", "cada dia",
    "cada lunes", "cada martes", "cada miercoles", "cada jueves",
    "cada viernes", "cada sabado", "cada domingo",
    "semanal", "mensual", "diariamente", "periodic",
    "flujo", "programad", "agendad", "automatic",
    "corre solo", "correr solo", "corriendo solo", "andando",
    "sin que me lo pidas", "sin que se lo pidas", "de ahora en mas",
)

# Lo que da vuelta el sentido de la frase: "todavia NO quedo armado" no es una
# promesa, es la verdad.
NIEGA = re.compile(r"\b(no|nunca|ni|todavia|aun|sin)\b[^.;:]{0,24}$")

RE_HORA = re.compile(r"\b(\d{1,2})[:.](\d{2})\b")
RE_HORA_SUELTA = re.compile(r"\ba las (\d{1,2})\b(?![:.]\d)")

MARCA = "Chequeo automático del portal"


def plano(texto):
    """Minúsculas y sin tildes: el modelo escribe 'quedó' y 'quedo' indistinto."""
    sin = unicodedata.normalize("NFD", texto or "")
    sin = "".join(c for c in sin if unicodedata.category(c) != "Mn")
    return sin.lower()


# ---------------------------------------------------------------- el cron ---

def _campo(expr, valor):
    """True si `valor` cae en un campo de cron ('*', '5', '1-5', '*/2', '1,4')."""
    expr = expr.strip()
    if expr == "*":
        return True
    for parte in expr.split(","):
        parte = parte.strip()
        paso = 1
        if "/" in parte:
            parte, _, p = parte.partition("/")
            if not p.isdigit():
                return False
            paso = int(p)
            if parte == "*":
                parte = ""
        if parte == "":
            if valor % paso == 0:
                return True
            continue
        if "-" in parte:
            a, _, b = parte.partition("-")
            if not (a.isdigit() and b.isdigit()):
                continue
            if int(a) <= valor <= int(b) and (valor - int(a)) % paso == 0:
                return True
            continue
        if parte.isdigit() and int(parte) == valor:
            return True
    return False


def dispara(expr, dia=None, hora=None, minuto=None):
    """True si el cron `expr` puede disparar ese día de semana a esa hora.

    `dia` en convención cron (0 y 7 = domingo). Lo que viene en None no se
    exige: si el agente dijo "los viernes" sin hora, alcanza con que el flujo
    corra los viernes.
    """
    campos = (expr or "").split()
    if len(campos) < 5:
        return False
    m, h, _, _, d = campos[:5]
    if minuto is not None and not _campo(m, minuto):
        return False
    if hora is not None and not _campo(h, hora):
        return False
    if dia is not None:
        if not (_campo(d, dia) or (dia == 0 and _campo(d, 7))):
            return False
    return True


def cuando(expr):
    """El cron dicho en criollo, para poder contarle al cliente qué sí corre."""
    campos = (expr or "").split()
    if len(campos) < 5:
        return "cada tanto"
    m, h, _, _, d = campos[:5]
    dias = [NOMBRE_DIA[n] for n in range(7) if _campo(d, n) or (n == 0 and _campo(d, 7))]
    cuando_dia = "todos los días" if len(dias) == 7 else "los " + ", ".join(dias)
    if h.isdigit() and m.isdigit():
        return f"{cuando_dia} a las {int(h)}:{int(m):02d}"
    return cuando_dia


# --------------------------------------------------------------- el disco ---

def _frontmatter(ruta):
    campos = {}
    try:
        with open(ruta, encoding="utf-8", errors="replace") as fh:
            texto = fh.read()
    except OSError:
        return campos
    if not texto.startswith("---"):
        return campos
    cuerpo = texto.split("---", 2)
    if len(cuerpo) < 3:
        return campos
    for linea in cuerpo[1].splitlines():
        clave, sep, valor = linea.partition(":")
        if sep:
            campos[clave.strip()] = valor.strip().strip('"').strip("'")
    return campos


def flujos_vivos(data):
    """Los flujos que de verdad van a correr: activos y con su gatillo prendido.

    Un FLUJO.md sin gatillo vivo en `cron/jobs.json` NO cuenta, y ahí está la
    mitad del valor: es exactamente el estado en el que quedó el agente de
    producción el 8/8 —carpeta sí, cron no— y el que se lee como "está todo
    bien" desde afuera.
    """
    vivos = []
    raiz = os.path.join(data, "flujos")
    try:
        with open(os.path.join(data, "cron", "jobs.json"), encoding="utf-8") as fh:
            jobs = {j.get("id"): j for j in (json.load(fh).get("jobs") or [])}
    except (OSError, ValueError, AttributeError):
        jobs = {}
    try:
        slugs = sorted(os.listdir(raiz))
    except OSError:
        return vivos
    for slug in slugs:
        ruta = os.path.join(raiz, slug, "FLUJO.md")
        if not os.path.isfile(ruta):
            continue
        f = _frontmatter(ruta)
        if f.get("estado", "activo") != "activo":
            continue
        job = jobs.get(f.get("gatillo_job", ""))
        if f.get("gatillo_tipo") == "pedido":
            continue          # no corre solo: arranca cuando el cliente pide
        if not job or not job.get("enabled", True):
            continue
        expr = ((job.get("schedule") or {}).get("expr")
                or f.get("gatillo_cron", ""))
        vivos.append({"slug": slug,
                      "nombre": f.get("nombre", slug),
                      "cron": expr})
    return vivos


# ---------------------------------------------------------------- la regla --

def _renglon_afirma(renglon):
    """La afirmación de cierre que hay en ese renglón, si no está negada."""
    for frase in AFIRMACIONES:
        i = renglon.find(frase)
        while i != -1:
            if not NIEGA.search(renglon[:i]):
                return frase
            i = renglon.find(frase, i + 1)
    return None


def _dia_y_hora(renglon):
    dias = {n for nombre, n in DIAS.items() if re.search(rf"\b{nombre}\b", renglon)}
    hora = minuto = None
    m = RE_HORA.search(renglon)
    if m and int(m.group(1)) < 24 and int(m.group(2)) < 60:
        hora, minuto = int(m.group(1)), int(m.group(2))
    else:
        m = RE_HORA_SUELTA.search(renglon)
        if m and int(m.group(1)) < 24:
            hora = int(m.group(1))
    return dias, hora, minuto


def revisar(texto, data):
    """El aviso que hay que pegarle al mensaje, o None si lo que dijo es cierto.

    Falla para el lado de callarse: cualquier cosa rara —no hay carpeta, el
    JSON está roto, el texto no matchea— devuelve None. Este chequeo no puede
    ser el que rompa una respuesta.
    """
    if not texto or MARCA in texto:
        return None
    limpio = plano(texto)
    if not any(r in limpio for r in REPETICION):
        return None

    # Se corta por renglón y por punto seguido, NUNCA por ":" ni por ";": el
    # dos puntos es justo lo que introduce la promesa ("Queda definido: viernes
    # a las 9:30") y cortando ahí el día y la hora quedaban en otro pedazo que
    # la regla 2 ya no miraba.
    renglones = [r for r in re.split(r"\n+|(?<=\.)\s+", limpio) if r.strip()]
    afirma = next((r for r in renglones if _renglon_afirma(r)), None)
    if afirma is None:
        return None

    vivos = flujos_vivos(data)

    # R1 — no hay NADA corriendo solo.
    if not vivos:
        return (
            f"> **{MARCA}.** Miré lo que hay programado de verdad y **no hay "
            "ningún trabajo corriendo solo**. Si algo de este mensaje dice que "
            "quedó armado, programado o listo para repetirse, no quedó: no va "
            "a pasar nada solo. Lo que sí corre solo aparece en tu pestaña "
            "Flujos."
        )

    # R2 — hay flujos, pero ninguno dispara el día y la hora que prometió.
    dias, hora, minuto = _dia_y_hora(afirma)
    if not dias and hora is None:
        return None
    objetivos = sorted(dias) or [None]
    for d in objetivos:
        if any(dispara(f["cron"], d, hora, minuto) for f in vivos):
            return None
    dicho = " ni los ".join(NOMBRE_DIA[d] for d in objetivos if d is not None)
    if hora is not None:
        reloj = f" a las {hora}:{minuto:02d}" if minuto is not None else f" a las {hora}"
    else:
        reloj = ""
    cuando_dicho = (f"los {dicho}{reloj}" if dicho else reloj.strip())
    lista = "; ".join(f"«{f['nombre']}», {cuando(f['cron'])}" for f in vivos)
    return (
        f"> **{MARCA}.** No hay nada programado para {cuando_dicho}. Lo que "
        f"corre solo hoy es: {lista}. Si arriba dice otra cosa, vale esto."
    )


def con_aviso(texto, data):
    """El texto final: el del agente y, si hace falta, la corrección pegada."""
    aviso = revisar(texto, data)
    if not aviso:
        return None
    return f"{texto.rstrip()}\n\n{aviso}\n"
