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
        | python3 verify_rows.py
"""

import json
import re
import sys

# The columns the skill promises. Missing ones are not an error -- they are the
# honesty contract working -- but they are reported so they reach the client.
# NOTE: these column names stay in Spanish -- they are literally the client's
# own spreadsheet headers (see SKILL.md), not an internal identifier.
COLUMNS = ["fecha", "proveedor", "rut", "tipo", "serie_numero",
           "moneda", "subtotal", "iva", "total", "origen"]

# DGI's RUT check digit: the first eleven digits are multiplied by these weights
# and summed; the twelfth digit is (-sum) mod 11. Same algorithm as the `uy.rut`
# module of python-stdnum. When (-sum) mod 11 lands on 10 no single digit can
# match, so that number simply is not a valid RUT.
RUT_WEIGHTS = (4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)

VAT_RATES = (0.22, 0.10)      # basic and minimum rate
CENTS_TOLERANCE = 0.02        # below this, the sum matches
ROUNDING_TOLERANCE = 1.00     # up to one currency unit: the invoice's own rounding


def clean_rut(value):
    """Twelve digits, however they were printed: 21.100342.0017, 21-100342-0017."""
    return re.sub(r"\D", "", str(value))


def rut_check_digit(eleven):
    total = sum(int(d) * w for d, w in zip(eleven, RUT_WEIGHTS))
    return -total % 11


def check_rut(value):
    """None when it checks out; the reason when it does not."""
    rut = clean_rut(value)
    if len(rut) != 12:
        return f"el RUT tiene {len(rut)} digitos y son 12: '{value}'"
    if rut_check_digit(rut[:11]) != int(rut[11]):
        return (f"el digito verificador del RUT {rut} no cierra: "
                "hay un digito mal leido, mira el comprobante de nuevo")
    return None


def parse_amount(value):
    """A printed amount as a number. None when it cannot be read as one.

    Uruguayan format is dot for thousands and comma for decimals (1.234,56), but
    invoices printed by foreign software use the other one, so both are read: a
    comma anywhere means the comma is the decimal mark; otherwise a lone dot with
    exactly three digits behind it is a thousands separator (1.220 is 1220) and
    any other dot is a decimal point.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[^\d,.\-]", "", str(value))
    if not text or not re.search(r"\d", text):
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+", text):
        text = text.replace(".", "")
    try:
        return float(text)
    except ValueError:
        return None


def check_row(row):
    problems, review, notes = [], [], []

    unread = [c for c in COLUMNS
              if row.get(c) in (None, "") or str(row.get(c)).strip() == ""]

    if row.get("rut"):
        failure = check_rut(row["rut"])
        if failure:
            problems.append(failure)
        else:
            notes.append(f"RUT {clean_rut(row['rut'])}: digito verificador ok")

    amounts = {}
    for field in ("subtotal", "iva", "total"):
        if row.get(field) not in (None, ""):
            value = parse_amount(row[field])
            if value is None:
                problems.append(f"no pude entender el {field}: '{row[field]}'")
            else:
                amounts[field] = value

    if len(amounts) == 3:
        total_sum = amounts["subtotal"] + amounts["iva"]
        difference = total_sum - amounts["total"]
        magnitude = abs(difference)
        if magnitude > ROUNDING_TOLERANCE:
            excess_or_missing = "sobran" if difference > 0 else "faltan"
            problems.append(
                f"subtotal + IVA da {total_sum:.2f} y el total dice "
                f"{amounts['total']:.2f}: {excess_or_missing} {magnitude:.2f}")
        elif magnitude > CENTS_TOLERANCE:
            review.append(
                f"subtotal + IVA y el total difieren en {magnitude:.2f}: "
                "entra en el redondeo del comprobante, pero miralo")
        else:
            notes.append("subtotal + IVA = total")

    if "iva" in amounts and "subtotal" in amounts and amounts["subtotal"] > 0:
        rate = amounts["iva"] / amounts["subtotal"]
        if amounts["iva"] == 0:
            review.append("el IVA es cero: exento o no gravado, confirmalo con el comprobante")
        elif any(abs(rate - t) < 0.005 for t in VAT_RATES):
            notes.append(f"IVA al {rate * 100:.0f}%")
        else:
            review.append(
                f"el IVA da {rate * 100:.1f}% del subtotal y en Uruguay las tasas son 22% y 10%: "
                "puede ser una factura con las dos tasas, o un monto mal leido")

    return {
        "origen": row.get("origen"),
        "ok": not problems,
        "problems": problems,
        "review": review,
        "unread": unread,
        "notes": notes,
    }


def main():
    try:
        data = json.loads(sys.stdin.read())
    except ValueError as exc:
        print(json.dumps({"ok": False, "problems": [f"la entrada no es JSON: {exc}"]},
                         ensure_ascii=False))
        return 1

    rows = data if isinstance(data, list) else [data]
    if not all(isinstance(f, dict) for f in rows):
        print(json.dumps({"ok": False, "problems": ["la entrada no son filas: cada una tiene que ser un objeto"]},
                         ensure_ascii=False))
        raise SystemExit(1)
    results = [check_row(f) for f in rows]

    with_problems = [r for r in results if r["problems"]]
    with_gaps = [r for r in results if r["unread"]]

    print(json.dumps({
        "ok": not with_problems,
        "rows": results,
        "summary": {
            "checked": len(results),
            "with_problems": len(with_problems),
            "with_gaps": len(with_gaps),
        },
    }, ensure_ascii=False, indent=2))
    return 1 if with_problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
