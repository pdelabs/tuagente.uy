#!/usr/bin/env python3
"""Record how this company quotes and what it charges. The only writer of presupuestos/.

    save_setup.py --set validez_dias=15 --set iva.criterio=mas_iva
    save_setup.py --precios < lista.csv
    save_setup.py --precio "Flete Montevideo=1500" --codigo FLE-MVD --unidad viaje

WHY A SCRIPT AND NOT THE MODEL EDITING JSON. The quote format and the price list
are read by every later run: a file left half written, or written a different way
each time, is a wrong price on a document that goes to a customer. So the model
brings the CONTENT (what the client answered, the rows it read off their Excel)
and the script owns the FILES.

TWO NUMBER TRAPS ARE ENCODED HERE, and both are money:

  * `$` is pesos in Uruguay and `U$S` is dollars. Reading one as the other is a
    forty-fold error on a document somebody signs.
  * `1.250,50` is a thousand two hundred fifty, not one point twenty-five. The
    price list arrives written the way the client writes it, never normalised.

Filling a field clears its entry from `huecos`, so "what is still open" stays
true by construction instead of by someone remembering to update it.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

DATOS = Path(os.environ.get("PRESUPUESTOS_DIR", "/opt/data/workspace/presupuestos"))
COLUMNAS = ("codigo", "item", "unidad", "precio", "moneda", "iva", "nota")

# Lo que se puede llenar y todavia no esta. El texto despues del guion largo es
# la pregunta, en las palabras del cliente: se le muestra tal cual.
HUECOS = [
    "empresa.nombre — con qué nombre firma sus presupuestos",
    "moneda_por_defecto — si cotiza en pesos (UYU) o en dólares (USD)",
    "iva.criterio — si los precios de su lista son más IVA o con IVA incluido",
    "validez_dias — cuántos días vale el precio que manda",
    "condiciones — forma de pago, plazo de entrega y qué no incluye",
]

FORMATO_NUEVO = {
    "empresa": {"nombre": "", "contacto": "", "rut": ""},
    "moneda_por_defecto": "",
    # 22 es la tasa basica uruguaya; la minima (10) es de rubros puntuales y va
    # por fila en la lista, no aca.
    "iva": {"criterio": "", "tasa": 22},
    "validez_dias": None,
    "numeracion": {"prefijo": "P", "ancho": 4, "reinicia_por_anio": True, "desde": 0},
    "condiciones": [],
    "secciones": [],
    "cierre": "",
    "lista": {"actualizada": "", "filas": 0},
    "huecos": list(HUECOS),
}

# Claves que guardan una lista: el valor viene separado por " | ".
LISTAS = {"condiciones", "secciones"}
CRITERIOS = ("mas_iva", "incluido")

MONEDAS = {
    "$": "UYU", "$U": "UYU", "UY$": "UYU", "UYU": "UYU", "PESOS": "UYU", "PESO": "UYU",
    "U$S": "USD", "US$": "USD", "U$": "USD", "USD": "USD", "DOLARES": "USD", "DOLAR": "USD",
}

# Como viene escrita la misma columna en la planilla de un cliente real.
ALIAS = {
    "codigo": {"codigo", "cod", "sku", "referencia", "ref", "articulo"},
    "item": {"item", "detalle", "descripcion", "producto", "servicio", "concepto", "nombre"},
    "unidad": {"unidad", "un", "medida", "um"},
    "precio": {"precio", "preciounitario", "punitario", "pu", "valor", "importe", "monto"},
    "moneda": {"moneda", "mon", "divisa"},
    "iva": {"iva", "tasa", "tasaiva"},
    "nota": {"nota", "notas", "observacion", "observaciones", "comentario"},
}


def sin_acentos(texto):
    texto = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto).strip().lower()


def guardar(ruta, texto):
    """Escribe al lado y mueve: el archivo no puede quedar a medias.

    Estos archivos se leen en la corrida siguiente y a veces en la misma; un
    `open(w)` que se corta deja la lista de precios truncada, que es peor que
    no tenerla porque nadie se entera.
    """
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(ruta.suffix + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as fh:
            fh.write(texto)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, ruta)
    finally:
        if tmp.exists():
            tmp.unlink()


def salir(mensaje, extra=None):
    cuerpo = {"ok": False, "error": mensaje}
    if extra:
        cuerpo.update(extra)
    print(json.dumps(cuerpo, ensure_ascii=False))
    raise SystemExit(1)


def a_numero(texto):
    """'U$S 1.250,50' -> Decimal('1250.50'). None si no hay numero adentro."""
    limpio = re.sub(r"[^\d.,-]", "", str(texto or "")).strip()
    if not limpio:
        return None
    if "," in limpio and "." in limpio:
        # El separador decimal es el ultimo que aparece; el otro es de miles.
        decimal = "," if limpio.rfind(",") > limpio.rfind(".") else "."
        miles = "." if decimal == "," else ","
        limpio = limpio.replace(miles, "").replace(decimal, ".")
    elif "," in limpio:
        entero, _, resto = limpio.rpartition(",")
        # "1,50" es un decimal; "1,500" escrito por un uruguayo son mil quinientos.
        limpio = f"{entero}.{resto}" if len(resto) in (1, 2) else limpio.replace(",", "")
    elif limpio.count(".") == 1:
        entero, _, resto = limpio.partition(".")
        limpio = limpio if len(resto) in (1, 2) else entero + resto
    else:
        limpio = limpio.replace(".", "")
    try:
        return Decimal(limpio)
    except InvalidOperation:
        return None


def moneda_norm(texto):
    """'U$S 120' -> USD, '$ 390' -> UYU, '1.250' -> '' (no dice nada), 'eur' -> ''.

    Vacío no es un error: una fila sin moneda usa la del formato. Lo que sí es un
    error es una moneda escrita que no se entiende, y por eso no se adivina acá.
    """
    clave = re.sub(r"[^A-Z$]", "", sin_acentos(texto).upper())
    return MONEDAS.get(clave, "") if clave else ""


def leer_formato():
    ruta = DATOS / "formato.json"
    if not ruta.is_file():
        return json.loads(json.dumps(FORMATO_NUEVO))
    try:
        return json.loads(ruta.read_text("utf-8"))
    except ValueError as exc:
        salir(f"formato.json no se puede leer ({exc}). Arreglalo antes de escribirle encima.")


def escribir_formato(formato):
    guardar(DATOS / "formato.json", json.dumps(formato, ensure_ascii=False, indent=2) + "\n")


def poner(destino, ruta, valor):
    partes = ruta.split(".")
    for clave in partes[:-1]:
        nodo = destino.get(clave)
        if not isinstance(nodo, dict):
            nodo = {}
            destino[clave] = nodo
        destino = nodo
    destino[partes[-1]] = valor


def sacar_hueco(huecos, ruta):
    return [h for h in huecos if h.split(" — ")[0].strip() != ruta]


def valor_tipado(ruta, crudo):
    hoja = ruta.split(".")[-1]
    if hoja in LISTAS:
        return [p.strip() for p in crudo.split("|") if p.strip()]
    if re.fullmatch(r"-?\d+", crudo):
        return int(crudo)
    if re.fullmatch(r"-?\d+[.,]\d+", crudo):
        return float(crudo.replace(",", "."))
    if crudo.lower() in ("true", "false"):
        return crudo.lower() == "true"
    return crudo


def filas_actuales():
    ruta = DATOS / "lista-precios.csv"
    if not ruta.is_file():
        return []
    with open(ruta, encoding="utf-8", newline="") as fh:
        return [{c: (f.get(c) or "").strip() for c in COLUMNAS} for f in csv.DictReader(fh)]


def escribir_lista(filas, formato):
    salida = io.StringIO()
    escritor = csv.DictWriter(salida, fieldnames=COLUMNAS, lineterminator="\n")
    escritor.writeheader()
    escritor.writerows(filas)
    guardar(DATOS / "lista-precios.csv", salida.getvalue())
    formato.setdefault("lista", {})
    formato["lista"]["actualizada"] = date.today().isoformat()
    formato["lista"]["filas"] = len(filas)
    escribir_formato(formato)


def mapear_encabezado(campos):
    """La columna de la planilla del cliente -> la nuestra. None si no se reconoce."""
    mapa = {}
    for campo in campos or []:
        clave = re.sub(r"[^a-z0-9]", "", sin_acentos(campo))
        for nuestra, alias in ALIAS.items():
            if clave in alias and nuestra not in mapa.values():
                mapa[campo] = nuestra
                break
    return mapa


def cargar_precios(formato, texto):
    if not texto.strip():
        salir("la lista vino vacía")
    muestra = texto.splitlines()[0]
    delimitador = max(",;\t", key=muestra.count)
    lector = csv.DictReader(io.StringIO(texto), delimiter=delimitador)
    mapa = mapear_encabezado(lector.fieldnames)
    if "item" not in mapa.values() or "precio" not in mapa.values():
        salir(
            "no encontré las columnas del ítem y del precio",
            {"encabezado_leido": lector.fieldnames,
             "columnas_esperadas": list(COLUMNAS),
             "obligatorias": ["item", "precio"]},
        )

    filas, rechazadas, duplicados = [], [], []
    vistos = set()
    for n, cruda in enumerate(lector, start=2):
        fila = {c: "" for c in COLUMNAS}
        for origen, nuestra in mapa.items():
            fila[nuestra] = (cruda.get(origen) or "").strip()
        if not fila["item"]:
            rechazadas.append({"linea": n, "por_que": "sin ítem"})
            continue
        precio = a_numero(fila["precio"])
        if precio is None:
            rechazadas.append({"linea": n, "por_que": "el precio no es un número",
                               "decia": fila["precio"], "item": fila["item"]})
            continue
        # La moneda puede venir pegada al precio ("U$S 120") o en su columna.
        # Vacía queda vacía: la resuelve la del formato al cotizar. Escrita y no
        # entendida se rechaza — es el mismo error que un precio ilegible.
        moneda = moneda_norm(fila["moneda"] or fila["precio"])
        if not moneda and fila["moneda"]:
            rechazadas.append({"linea": n, "por_que": "no entendí la moneda",
                               "decia": fila["moneda"], "item": fila["item"]})
            continue
        fila["moneda"] = moneda
        fila["precio"] = f"{precio:.2f}"
        if fila["iva"]:
            tasa = a_numero(fila["iva"])
            fila["iva"] = "" if tasa is None else f"{tasa:g}"
        clave = fila["codigo"].lower() or sin_acentos(fila["item"])
        if clave in vistos:
            duplicados.append(fila["codigo"] or fila["item"])
        vistos.add(clave)
        filas.append(fila)

    if not filas:
        salir("ninguna fila tenía ítem y precio", {"rechazadas": rechazadas})
    escribir_lista(filas, formato)
    return {"filas": len(filas), "rechazadas": rechazadas, "duplicados": duplicados}


def un_precio(formato, texto, codigo, unidad, moneda, iva, nota):
    if "=" not in texto:
        salir('esperaba --precio "nombre del item=precio", vino: ' + texto)
    item, _, crudo = texto.partition("=")
    item, crudo = item.strip(), crudo.strip()
    precio = a_numero(crudo)
    if not item or precio is None:
        salir(f"'{texto}' no tiene un ítem y un precio que se puedan leer")

    fila = {
        "codigo": codigo.strip(),
        "item": item,
        "unidad": unidad.strip(),
        "precio": f"{precio:.2f}",
        "moneda": moneda_norm(moneda or crudo),
        "iva": iva.strip(),
        "nota": nota.strip(),
    }
    if moneda.strip() and not fila["moneda"]:
        salir(f"no entendí la moneda '{moneda}': es UYU o USD")
    clave = fila["codigo"].lower() or sin_acentos(fila["item"])
    # Correcting a price must not degrade the row: whatever flag did NOT come
    # keeps the old value. Measured before this: a bare --precio wiped unidad,
    # moneda, iva and nota of the row it corrected.
    for vieja in filas_actuales():
        if (vieja["codigo"].lower() or sin_acentos(vieja["item"])) == clave:
            for campo in ("codigo", "item", "unidad", "moneda", "iva", "nota"):
                if not fila[campo]:
                    fila[campo] = vieja[campo]
            break
    # Pisa TODAS las que tengan esa clave, no la primera: si la lista venia con
    # el mismo codigo dos veces (pasa, y `--precios` lo avisa), dejar la segunda
    # es dejar la ambiguedad —y al cotizar eso es un item que no se puede
    # resolver, para siempre.
    nuevas, accion = [], "agregado"
    for vieja in filas_actuales():
        if (vieja["codigo"].lower() or sin_acentos(vieja["item"])) != clave:
            nuevas.append(vieja)
            continue
        if accion == "agregado":
            nuevas.append(fila)
            accion = "actualizado"
    if accion == "agregado":
        nuevas.append(fila)
    escribir_lista(nuevas, formato)
    return {"accion": accion, "fila": fila, "filas": len(nuevas)}


def main():
    ap = argparse.ArgumentParser(description="Guarda el formato y la lista de precios del cliente.")
    ap.add_argument("--set", action="append", default=[], metavar="RUTA=VALOR",
                    # Sin porcentajes en este texto: argparse lo pasa por un
                    # formateo y un "%" suelto le revienta el parser entero.
                    help='por ejemplo: iva.criterio=mas_iva, o condiciones="Pago adelantado | Entrega: 5 días"')
    ap.add_argument("--precios", action="store_true", help="la lista entera, en CSV, por stdin")
    ap.add_argument("--precio", default="", metavar="ITEM=PRECIO",
                    help="agrega o corrige UNA línea de la lista")
    ap.add_argument("--codigo", default="")
    ap.add_argument("--unidad", default="")
    ap.add_argument("--moneda", default="")
    ap.add_argument("--iva", default="", help="tasa de esa línea si va distinta a la del formato")
    ap.add_argument("--nota", default="")
    ap.add_argument("--datos-dir", default="")
    args = ap.parse_args()

    global DATOS
    if args.datos_dir:
        DATOS = Path(args.datos_dir)
    if not (args.set or args.precios or args.precio):
        salir("no me dijiste qué guardar: --set, --precios o --precio")

    formato = leer_formato()
    formato.setdefault("huecos", list(HUECOS))
    llenados = []

    for par in args.set:
        if "=" not in par:
            salir(f"esperaba ruta=valor, vino: {par}")
        ruta, _, crudo = par.partition("=")
        ruta, crudo = ruta.strip(), crudo.strip()
        if not crudo:
            salir(f"'{ruta}' vino vacío. Un hueco sin respuesta se queda como hueco.")
        if ruta == "iva.criterio" and crudo not in CRITERIOS:
            salir(f"iva.criterio es {' o '.join(CRITERIOS)}, vino: {crudo}")
        if ruta == "moneda_por_defecto":
            crudo = moneda_norm(crudo)
            if not crudo:
                salir("moneda_por_defecto es UYU o USD")
        poner(formato, ruta, valor_tipado(ruta, crudo))
        formato["huecos"] = sacar_hueco(formato["huecos"], ruta)
        llenados.append(ruta)
    if llenados:
        escribir_formato(formato)

    respuesta = {"ok": True, "llenados": llenados, "huecos": formato["huecos"]}
    if args.precios:
        respuesta["lista"] = cargar_precios(formato, sys.stdin.read())
    if args.precio:
        respuesta["precio"] = un_precio(formato, args.precio, args.codigo, args.unidad,
                                        args.moneda, args.iva, args.nota)
    respuesta["donde"] = str(DATOS)
    print(json.dumps(respuesta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
