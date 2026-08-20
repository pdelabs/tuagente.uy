#!/usr/bin/env python3
"""Check extracted invoice rows before they reach the client's spreadsheet.

What a model read off a photo cannot be verified in general. Three things about
a Uruguayan invoice CAN be verified with arithmetic, and they are exactly where a
misread hurts and where the eye never catches it:

  * the RUT check digit -- a modulus-11 check, so one wrong digit almost always
    fails it;
  * the total against subtotal + VAT;
  * the VAT against the rates that exist in Uruguay (22% and 10%).

THIS SCRIPT NEVER PROPOSES A CORRECTED VALUE, and that is the point. A RUT that
gets "fixed" or a total that gets "adjusted" is the plausible invented figure the
whole skill exists to prevent. It says what does not add up; correcting means
looking at the invoice again, and if it still does not add up, the field goes
back to empty-and-marked.

Reads one row or a list of rows as JSON on stdin. Exits 1 when there is a
problem, so it can gate.

    echo '{"rut":"211003420017","subtotal":"1.000,00","iva":"220,00","total":"1.220,00"}' \
        | python3 verificar_filas.py
"""

import json
import re
import sys

# The columns the skill promises. Missing ones are not an error -- they are the
# honesty contract working -- but they are reported so they reach the client.
COLUMNAS = ["fecha", "proveedor", "rut", "tipo", "serie_numero",
            "moneda", "subtotal", "iva", "total", "origen"]

# DGI's RUT check digit: the first eleven digits are multiplied by these weights
# and summed; the twelfth digit is (-sum) mod 11. Same algorithm as the `uy.rut`
# module of python-stdnum. When (-sum) mod 11 lands on 10 no single digit can
# match, so that number simply is not a valid RUT.
PESOS_RUT = (4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)

TASAS_IVA = (0.22, 0.10)      # basica y minima
TOLERANCIA_CENTAVOS = 0.02    # below this, the sum matches
TOLERANCIA_REDONDEO = 1.00    # up to a currency unit: the invoice's own rounding


def limpiar_rut(valor):
    """Twelve digits, however they were printed: 21.100342.0017, 21-100342-0017."""
    return re.sub(r"\D", "", str(valor))


def digito_rut(once):
    total = sum(int(d) * p for d, p in zip(once, PESOS_RUT))
    return -total % 11


def revisar_rut(valor):
    """None when it checks out; the reason when it does not."""
    rut = limpiar_rut(valor)
    if len(rut) != 12:
        return f"el RUT tiene {len(rut)} digitos y son 12: '{valor}'"
    if digito_rut(rut[:11]) != int(rut[11]):
        return (f"el digito verificador del RUT {rut} no cierra: "
                "hay un digito mal leido, mira el comprobante de nuevo")
    return None


def monto(valor):
    """A printed amount as a number. None when it cannot be read as one.

    Uruguayan format is dot for thousands and comma for decimals (1.234,56), but
    invoices printed by foreign software use the other one, so both are read: a
    comma anywhere means the comma is the decimal mark; otherwise a lone dot with
    exactly three digits behind it is a thousands separator (1.220 is 1220) and
    any other dot is a decimal point.
    """
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = re.sub(r"[^\d,.\-]", "", str(valor))
    if not texto or not re.search(r"\d", texto):
        return None
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+", texto):
        texto = texto.replace(".", "")
    try:
        return float(texto)
    except ValueError:
        return None


def revisar_fila(fila):
    problemas, revisar, notas = [], [], []

    sin_leer = [c for c in COLUMNAS
                if fila.get(c) in (None, "") or str(fila.get(c)).strip() == ""]

    if fila.get("rut"):
        fallo = revisar_rut(fila["rut"])
        if fallo:
            problemas.append(fallo)
        else:
            notas.append(f"RUT {limpiar_rut(fila['rut'])}: digito verificador ok")

    montos = {}
    for campo in ("subtotal", "iva", "total"):
        if fila.get(campo) not in (None, ""):
            valor = monto(fila[campo])
            if valor is None:
                problemas.append(f"no pude entender el {campo}: '{fila[campo]}'")
            else:
                montos[campo] = valor

    if len(montos) == 3:
        suma = montos["subtotal"] + montos["iva"]
        diferencia = suma - montos["total"]
        magnitud = abs(diferencia)
        if magnitud > TOLERANCIA_REDONDEO:
            de_mas = "sobran" if diferencia > 0 else "faltan"
            problemas.append(
                f"subtotal + IVA da {suma:.2f} y el total dice "
                f"{montos['total']:.2f}: {de_mas} {magnitud:.2f}")
        elif magnitud > TOLERANCIA_CENTAVOS:
            revisar.append(
                f"subtotal + IVA y el total difieren en {magnitud:.2f}: "
                "entra en el redondeo del comprobante, pero miralo")
        else:
            notas.append("subtotal + IVA = total")

    if "iva" in montos and "subtotal" in montos and montos["subtotal"] > 0:
        tasa = montos["iva"] / montos["subtotal"]
        if montos["iva"] == 0:
            revisar.append("el IVA es cero: exento o no gravado, confirmalo con el comprobante")
        elif any(abs(tasa - t) < 0.005 for t in TASAS_IVA):
            notas.append(f"IVA al {tasa * 100:.0f}%")
        else:
            revisar.append(
                f"el IVA da {tasa * 100:.1f}% del subtotal y en Uruguay las tasas son 22% y 10%: "
                "puede ser una factura con las dos tasas, o un monto mal leido")

    return {
        "origen": fila.get("origen"),
        "ok": not problemas,
        "problemas": problemas,
        "revisar": revisar,
        "sin_leer": sin_leer,
        "notas": notas,
    }


def main():
    try:
        datos = json.loads(sys.stdin.read())
    except ValueError as exc:
        print(json.dumps({"ok": False, "problemas": [f"la entrada no es JSON: {exc}"]},
                         ensure_ascii=False))
        return 1

    filas = datos if isinstance(datos, list) else [datos]
    if not all(isinstance(f, dict) for f in filas):
        print(json.dumps({"ok": False, "problemas": ["la entrada no son filas: cada una tiene que ser un objeto"]},
                         ensure_ascii=False))
        raise SystemExit(1)
    resultados = [revisar_fila(f) for f in filas]

    con_problemas = [r for r in resultados if r["problemas"]]
    con_huecos = [r for r in resultados if r["sin_leer"]]

    print(json.dumps({
        "ok": not con_problemas,
        "filas": resultados,
        "resumen": {
            "revisadas": len(resultados),
            "con_problemas": len(con_problemas),
            "con_huecos": len(con_huecos),
        },
    }, ensure_ascii=False, indent=2))
    return 1 if con_problemas else 0


if __name__ == "__main__":
    raise SystemExit(main())
