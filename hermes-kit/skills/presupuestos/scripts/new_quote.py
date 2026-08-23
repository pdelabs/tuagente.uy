#!/usr/bin/env python3
"""Price one quote against the client's own list. Nothing here comes from memory.

    new_quote.py --cliente "Ferretería del Este" --item "CEP-01:35" --item "flete:1"
    new_quote.py --item "CEP-01:35" --numerar

WHAT THE SCRIPT GUARANTEES, and why it is a script. Every line it returns points
at a row of `lista-precios.csv`. What it cannot find does not get a price: it
comes back in `faltantes`, to be asked. A made-up price does not arrive late, it
gets charged -- and the model is exactly where that mistake is cheap to make and
impossible to see afterwards.

Three more things it refuses to invent, for the same reason:

  * an exchange rate. Two currencies in one quote come back as two totals.
  * the IVA rule. `mas_iva` and `incluido` are different documents, and which one
    this company uses is asked once and stored, never guessed.
  * a quote number. It is consecutive, it lives on disk, and it is only spent
    (`--numerar`) when nothing is missing -- a numbered quote is one that went
    out.

The words of the quote are the model's job and it does them well. The arithmetic,
the numbering and "is this price really in the list" are not language jobs.
"""

import argparse
import csv
import json
import os
import re
import unicodedata
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

DATOS = Path(os.environ.get("PRESUPUESTOS_DIR", "/opt/data/workspace/presupuestos"))
CENTAVO = Decimal("0.01")
VIEJA_DESDE = 90          # días sin actualizar la lista antes de avisar

FALTA_TODO = (
    "Para armarte los presupuestos necesito dos cosas tuyas, una sola vez: "
    "uno que hayas mandado antes —el PDF, una foto, lo que tengas— así los míos "
    "salen iguales a los tuyos, y tu lista de precios como la tengas (un Excel, "
    "una planilla, una foto del cuaderno). Con eso el próximo sale en minutos."
)
FALTA_FORMATO = (
    "¿Me pasás un presupuesto que hayas mandado antes? El PDF, una foto o un mail "
    "viejo sirve igual: lo quiero para copiarte el formato y las condiciones, así "
    "los que arme salen iguales a los tuyos."
)
FALTA_LISTA = (
    "Me falta tu lista de precios. Pasámela como la tengas —un Excel, una planilla, "
    "una foto— y con eso te armo el presupuesto."
)
PREGUNTAS = {
    "moneda_por_defecto": "¿Cotizás en pesos o en dólares?",
    "iva.criterio": "¿Los precios de tu lista son más IVA, o ya lo tienen incluido?",
    "validez_dias": "¿Cuántos días querés que valga el presupuesto? Lo más común es 15 o 30.",
}


def sin_acentos(texto):
    texto = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto).strip().lower()


def plata(valor):
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def contestar(cuerpo, codigo=0):
    print(json.dumps(cuerpo, ensure_ascii=False, indent=2))
    raise SystemExit(codigo)


def leer_json(ruta):
    try:
        return json.loads(ruta.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def leer_lista():
    ruta = DATOS / "lista-precios.csv"
    if not ruta.is_file():
        return []
    with open(ruta, encoding="utf-8", newline="") as fh:
        return [f for f in csv.DictReader(fh) if (f.get("item") or "").strip()]


def resolver(ref, filas):
    """(fila, cómo se encontró) o (None, candidatos) si no hay una sola."""
    objetivo = sin_acentos(ref)
    por_codigo = [f for f in filas if objetivo and sin_acentos(f.get("codigo")) == objetivo]
    if len(por_codigo) == 1:
        return por_codigo[0], "código"
    por_nombre = [f for f in filas if sin_acentos(f.get("item")) == objetivo]
    if len(por_nombre) == 1:
        return por_nombre[0], "nombre"
    palabras = objetivo.split()
    parcial = [f for f in filas
               if palabras and all(p in sin_acentos(f.get("item")) or p in sin_acentos(f.get("codigo"))
                                   for p in palabras)]
    if len(parcial) == 1:
        return parcial[0], "texto"
    return None, parcial


def cantidad_de(crudo):
    try:
        return Decimal(crudo.replace(",", "."))
    except InvalidOperation:
        return None


def numero(formato, consumir, dado):
    """El consecutivo. Se lee siempre; se gasta solo con --numerar."""
    if dado:
        return dado, None
    num = formato.get("numeracion") or {}
    prefijo = num.get("prefijo") or "P"
    ancho = int(num.get("ancho") or 4)
    por_anio = num.get("reinicia_por_anio", True)
    anio = date.today().year
    clave = str(anio) if por_anio else "todos"
    ruta = DATOS / "contador.json"
    cont = leer_json(ruta) or {}
    try:
        ultimo = max(int(cont.get(clave, 0)), int(num.get("desde") or 0))
    except (TypeError, ValueError):
        ultimo = int(cont.get(clave, 0) or 0)
    siguiente = ultimo + 1
    partes = [prefijo, str(anio), f"{siguiente:0{ancho}d}"] if por_anio else [prefijo, f"{siguiente:0{ancho}d}"]
    texto = "-".join(partes)
    if not consumir:
        return None, texto      # lo que SERÍA, para que se pueda mirar sin gastarlo
    cont[clave] = siguiente
    tmp = ruta.with_suffix(".json.tmp")
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(cont, ensure_ascii=False, indent=2) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, ruta)
    return texto, None


def main():
    ap = argparse.ArgumentParser(description="Arma las líneas y las cuentas de un presupuesto.")
    ap.add_argument("--item", action="append", default=[], metavar="REF[:CANTIDAD]",
                    help="código o nombre del ítem tal como está en la lista, y cuánto")
    ap.add_argument("--cliente", default="", help="a quién va dirigido")
    ap.add_argument("--numerar", action="store_true", help="gasta el número consecutivo")
    ap.add_argument("--numero", default="", help="reusa un número: es una corrección de uno ya mandado")
    ap.add_argument("--descuento", default="", metavar="MONTO|N%",
                    help="descuento AUTORIZADO POR EL CLIENTE, como línea visible")
    ap.add_argument("--motivo", default="", help="por qué hay descuento; obligatorio con --descuento")
    ap.add_argument("--datos-dir", default="")
    args = ap.parse_args()

    global DATOS
    if args.datos_dir:
        DATOS = Path(args.datos_dir)
    if not args.item:
        contestar({"ok": False, "error": "no me dijiste qué cotizar: al menos un --item"}, 1)

    formato = leer_json(DATOS / "formato.json")
    filas = leer_lista()
    if formato is None or not filas:
        falta = ([] if formato else ["formato"]) + ([] if filas else ["lista"])
        pregunta = FALTA_TODO if len(falta) == 2 else (FALTA_FORMATO if formato is None else FALTA_LISTA)
        contestar({
            "ok": False,
            "falta": falta,
            "pregunta": pregunta,
            "como_seguir": "cuando conteste, guardalo con save_setup.py (--set y --precios). "
                           "Sin formato y sin lista no se cotiza: un precio puesto por vos se cobra.",
        }, 2)

    # Dos respuestas cambian lo que significa cada número del documento. Sin
    # ellas no se arma: un presupuesto que no dice moneda ni IVA es una discusión
    # el día que se factura.
    criterio = ((formato.get("iva") or {}).get("criterio") or "").strip()
    moneda_base = (formato.get("moneda_por_defecto") or "").strip()
    sin_definir = [c for c, v in (("moneda_por_defecto", moneda_base), ("iva.criterio", criterio)) if not v]
    if sin_definir:
        contestar({
            "ok": False,
            "falta": sin_definir,
            "pregunta": " ".join(PREGUNTAS[c] for c in sin_definir),
            "como_seguir": "guardá la respuesta con save_setup.py --set (una sola vez, queda en formato.json)",
        }, 2)

    tasa_base = Decimal(str((formato.get("iva") or {}).get("tasa") or 22))
    lineas, faltantes = [], []
    for crudo in args.item:
        ref, cantidad = crudo, Decimal(1)
        if ":" in crudo:
            posible, _, cola = crudo.rpartition(":")
            leida = cantidad_de(cola)
            if posible.strip() and leida is not None:
                ref, cantidad = posible.strip(), leida
        if cantidad <= 0:
            contestar({"ok": False,
                       "error": f"'{crudo}': la cantidad tiene que ser mayor a cero. "
                                "Un descuento no entra como cantidad negativa: va con --descuento."}, 1)
        fila, como = resolver(ref, filas)
        if fila is None:
            # Cuando no hay una sola, `como` trae las filas que podían ser.
            candidatos = [{"codigo": c.get("codigo", ""), "item": c.get("item", "")} for c in como[:6]]
            faltantes.append({
                "pedido": ref,
                "cantidad": str(cantidad),
                "por_que": "hay más de uno que puede ser" if candidatos else "no está en la lista",
                "candidatos": candidatos,
                "pregunta": (f"«{ref}» no está en tu lista: ¿cuánto cobrás?"
                             if not candidatos else
                             f"«{ref}» me da varias opciones de tu lista: ¿cuál va?"),
            })
            continue

        try:
            precio = Decimal((fila.get("precio") or "").strip())
            tasa = Decimal(fila["iva"].strip()) if (fila.get("iva") or "").strip() else tasa_base
        except InvalidOperation:
            # Una fila rota no se redondea a cero: se pregunta, como cualquier
            # otra cosa que no tiene precio.
            faltantes.append({
                "pedido": ref,
                "cantidad": str(cantidad),
                "por_que": "la fila está en la lista pero su precio no se puede leer",
                "decia": fila.get("precio", ""),
                "candidatos": [],
                "pregunta": f"tengo «{fila.get('item', ref)}» en la lista pero el precio quedó "
                            "mal escrito: ¿cuánto es?",
            })
            continue
        bruto = plata(cantidad * precio)
        if criterio == "incluido":
            neto = plata(bruto / (1 + tasa / 100))
            iva = bruto - neto
        else:
            neto = bruto
            iva = plata(bruto * tasa / 100)
        lineas.append({
            "codigo": fila.get("codigo", ""),
            "item": fila.get("item", ""),
            "unidad": fila.get("unidad", ""),
            "cantidad": str(cantidad),
            "precio_unitario": f"{precio:.2f}",
            "moneda": (fila.get("moneda") or "").strip() or moneda_base,
            "iva_tasa": f"{tasa:g}",
            "subtotal": f"{neto:.2f}",
            "iva": f"{iva:.2f}",
            "total": f"{neto + iva:.2f}",
            "nota": (fila.get("nota") or "").strip(),
            "encontrado_por": como,
        })

    if faltantes and args.numerar:
        contestar({
            "ok": False,
            "error": f"{len(faltantes)} ítem(s) sin precio en la lista: no numero un presupuesto incompleto",
            "faltantes": faltantes,
            "como_seguir": "preguntá cuánto cobra por eso, guardalo con save_setup.py --precio "
                           "y volvé a correr. Lo que no está en la lista no se inventa.",
        }, 1)

    totales = {}
    for linea in lineas:
        acumulado = totales.setdefault(linea["moneda"], [Decimal(0), Decimal(0)])
        acumulado[0] += Decimal(linea["subtotal"])
        acumulado[1] += Decimal(linea["iva"])

    # The one arithmetic the model was still doing by hand, and the one that
    # touches the final price. Only the CLIENT authorizes a discount; this
    # script only makes it visible and does the subtraction right. A percent
    # needs one currency (a discount over two totals is two discounts).
    descuento = None
    if args.descuento.strip():
        if not args.motivo.strip():
            contestar({"ok": False,
                       "error": "un descuento sin motivo es un precio inventado: decí quién "
                                "lo autorizó o por qué (--motivo)"}, 1)
        crudo = args.descuento.strip()
        if crudo.endswith("%"):
            porc = cantidad_de(crudo[:-1])
            if porc is None or porc <= 0 or porc >= 100:
                contestar({"ok": False, "error": f"'{crudo}' no es un porcentaje entre 0 y 100"}, 1)
            if len(totales) != 1:
                contestar({"ok": False,
                           "error": "un porcentaje sobre dos monedas son dos descuentos: "
                                    "hacelo por monto, o un presupuesto por moneda"}, 1)
            moneda_desc, (sub, iva_tot) = next(iter(totales.items()))
            monto = plata((sub + iva_tot) * porc / 100)
        else:
            porc = None
            monto = cantidad_de(crudo)
            if monto is None or monto <= 0:
                contestar({"ok": False, "error": f"'{crudo}' no es un monto de descuento legible"}, 1)
            monto = plata(monto)
            moneda_desc = moneda_base if len(totales) != 1 else next(iter(totales))
        descuento = {"monto": f"{monto:.2f}", "moneda": moneda_desc,
                     "porcentaje": (f"{porc:g}%" if porc is not None else None),
                     "motivo": args.motivo.strip()}

    asignado, proximo = numero(formato, args.numerar, args.numero.strip())
    hoy = date.today()
    validez = formato.get("validez_dias")
    vence = (hoy + timedelta(days=int(validez))).isoformat() if validez else None

    avisos = []
    if faltantes:
        avisos.append(f"{len(faltantes)} ítem(s) no están en la lista: preguntá el precio, "
                      "no lo pongas vos. Hasta resolverlo no se numera ni se manda.")
    if len(totales) > 1:
        avisos.append("hay dos monedas en el mismo presupuesto y no convierto tipo de cambio: "
                      "van los dos totales, o preguntás en cuál lo quiere.")
    if not validez:
        avisos.append(PREGUNTAS["validez_dias"])
    actualizada = ((formato.get("lista") or {}).get("actualizada") or "").strip()
    if actualizada:
        try:
            dias = (hoy - date.fromisoformat(actualizada)).days
            if dias >= VIEJA_DESDE:
                avisos.append(f"la lista de precios no se actualiza hace {dias} días: "
                              "confirmá los precios antes de mandarlo.")
        except ValueError:
            pass

    contestar({
        "ok": True,
        "numero": asignado,
        "proximo_numero": proximo,
        "cliente": args.cliente,
        "fecha": hoy.isoformat(),
        "validez_dias": validez,
        "vence": vence,
        "iva": {"criterio": criterio, "tasa_por_defecto": f"{tasa_base:g}"},
        "moneda_por_defecto": moneda_base,
        "lineas": lineas,
        "faltantes": faltantes,
        "descuento": descuento,
        "totales": {m: {"subtotal": f"{s:.2f}", "iva": f"{i:.2f}", "total": f"{s + i:.2f}",
                        **({"total_con_descuento": f"{s + i - Decimal(descuento['monto']):.2f}"}
                           if descuento and descuento["moneda"] == m else {})}
                    for m, (s, i) in totales.items()},
        "empresa": formato.get("empresa") or {},
        "secciones": formato.get("secciones") or [],
        "condiciones": formato.get("condiciones") or [],
        "cierre": formato.get("cierre") or "",
        "lista": {"actualizada": actualizada, "filas": len(filas)},
        "avisos": avisos,
        "despues": "escribí el presupuesto con el orden de `secciones` y dejalo con la skill "
                   "entregable. Mandarlo es decisión de tu cliente, no tuya.",
    })


if __name__ == "__main__":
    main()
