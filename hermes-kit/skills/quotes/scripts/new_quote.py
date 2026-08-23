#!/usr/bin/env python3
"""Price one quote against the client's own list. Nothing here comes from memory.

    new_quote.py --client "Ferretería del Este" --item "CEP-01:35" --item "flete:1"
    new_quote.py --item "CEP-01:35" --issue

WHAT THE SCRIPT GUARANTEES, and why it is a script. Every line it returns points
at a row of `lista-precios.csv`. What it cannot find does not get a price: it
comes back in `missing`, to be asked. A made-up price does not arrive late, it
gets charged -- and the model is exactly where that mistake is cheap to make and
impossible to see afterwards.

Three more things it refuses to invent, for the same reason:

  * an exchange rate. Two currencies in one quote come back as two totals.
  * the IVA rule. `mas_iva` and `incluido` are different documents, and which one
    this company uses is asked once and stored, never guessed.
  * a quote number. It is consecutive, it lives on disk, and it is only spent
    (`--issue`) when nothing is missing -- a numbered quote is one that went
    out.

The words of the quote are the model's job and it does them well. The arithmetic,
the numbering and "is this price really in the list" are not language jobs.

NOTE: `formato.json` / `lista-precios.csv` / `contador.json` keep their
Spanish field names on disk (they mirror the client's own Uruguayan invoicing
vocabulary -- iva, rut, moneda -- the same way the invoices-to-data
spreadsheet columns do). Only this script's own identifiers, CLI flags and
JSON response are in English.
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

DATA = Path(os.environ.get("QUOTES_DIR", "/opt/data/workspace/presupuestos"))
CENT = Decimal("0.01")
STALE_AFTER_DAYS = 90     # dias sin actualizar la lista antes de avisar

MISSING_ALL = (
    "Para armarte los presupuestos necesito dos cosas tuyas, una sola vez: "
    "uno que hayas mandado antes —el PDF, una foto, lo que tengas— así los míos "
    "salen iguales a los tuyos, y tu lista de precios como la tengas (un Excel, "
    "una planilla, una foto del cuaderno). Con eso el próximo sale en minutos."
)
MISSING_FORMAT = (
    "¿Me pasás un presupuesto que hayas mandado antes? El PDF, una foto o un mail "
    "viejo sirve igual: lo quiero para copiarte el formato y las condiciones, así "
    "los que arme salen iguales a los tuyos."
)
MISSING_PRICE_LIST = (
    "Me falta tu lista de precios. Pasámela como la tengas —un Excel, una planilla, "
    "una foto— y con eso te armo el presupuesto."
)
QUESTIONS = {
    "moneda_por_defecto": "¿Cotizás en pesos o en dólares?",
    "iva.criterio": "¿Los precios de tu lista son más IVA, o ya lo tienen incluido?",
    "validez_dias": "¿Cuántos días querés que valga el presupuesto? Lo más común es 15 o 30.",
}


def strip_accents(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower()


def round_money(value):
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def respond(body, code=0):
    print(json.dumps(body, ensure_ascii=False, indent=2))
    raise SystemExit(code)


def read_json(path):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def read_price_list():
    path = DATA / "lista-precios.csv"
    if not path.is_file():
        return []
    with open(path, encoding="utf-8", newline="") as fh:
        return [f for f in csv.DictReader(fh) if (f.get("item") or "").strip()]


def resolve_item(ref, rows):
    """(row, how it was found) or (None, candidates) when there isn't exactly one."""
    target = strip_accents(ref)
    by_code = [f for f in rows if target and strip_accents(f.get("codigo")) == target]
    if len(by_code) == 1:
        return by_code[0], "código"
    by_name = [f for f in rows if strip_accents(f.get("item")) == target]
    if len(by_name) == 1:
        return by_name[0], "nombre"
    words = target.split()
    partial = [f for f in rows
               if words and all(w in strip_accents(f.get("item")) or w in strip_accents(f.get("codigo"))
                                for w in words)]
    if len(partial) == 1:
        return partial[0], "texto"
    return None, partial


def parse_quantity(raw):
    try:
        return Decimal(raw.replace(",", "."))
    except InvalidOperation:
        return None


def quote_number(cfg, consume, given):
    """The consecutive number. Always read; only spent with --issue."""
    if given:
        return given, None
    numbering = cfg.get("numeracion") or {}
    prefix = numbering.get("prefijo") or "P"
    width = int(numbering.get("ancho") or 4)
    per_year = numbering.get("reinicia_por_anio", True)
    year = date.today().year
    key = str(year) if per_year else "todos"
    path = DATA / "contador.json"
    counter = read_json(path) or {}
    try:
        last = max(int(counter.get(key, 0)), int(numbering.get("desde") or 0))
    except (TypeError, ValueError):
        last = int(counter.get(key, 0) or 0)
    next_number = last + 1
    parts = [prefix, str(year), f"{next_number:0{width}d}"] if per_year else [prefix, f"{next_number:0{width}d}"]
    text = "-".join(parts)
    if not consume:
        return None, text      # what it WOULD be, so it can be previewed without spending it
    counter[key] = next_number
    tmp = path.with_suffix(".json.tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(counter, ensure_ascii=False, indent=2) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return text, None


def main():
    ap = argparse.ArgumentParser(description="Arma las líneas y las cuentas de un presupuesto.")
    ap.add_argument("--item", action="append", default=[], metavar="REF[:QTY]",
                    help="código o nombre del ítem tal como está en la lista, y cuánto")
    ap.add_argument("--client", default="", help="a quién va dirigido")
    ap.add_argument("--issue", action="store_true", help="gasta el número consecutivo")
    ap.add_argument("--number", default="", help="reusa un número: es una corrección de uno ya mandado")
    ap.add_argument("--discount", default="", metavar="MONTO|N%",
                    help="descuento AUTORIZADO POR EL CLIENTE, como línea visible")
    ap.add_argument("--reason", default="", help="por qué hay descuento; obligatorio con --discount")
    ap.add_argument("--data-dir", default="")
    args = ap.parse_args()

    global DATA
    if args.data_dir:
        DATA = Path(args.data_dir)
    if not args.item:
        respond({"ok": False, "error": "no me dijiste qué cotizar: al menos un --item"}, 1)

    cfg = read_json(DATA / "formato.json")
    rows = read_price_list()
    if cfg is None or not rows:
        missing = ([] if cfg else ["formato"]) + ([] if rows else ["lista"])
        question = MISSING_ALL if len(missing) == 2 else (MISSING_FORMAT if cfg is None else MISSING_PRICE_LIST)
        respond({
            "ok": False,
            "missing": missing,
            "question": question,
            "how_to_proceed": "cuando conteste, guardalo con save_setup.py (--set y --prices). "
                              "Sin formato y sin lista no se cotiza: un precio puesto por vos se cobra.",
        }, 2)

    # Two answers change what every number in the document means. Without
    # them nothing gets built: a quote that states neither currency nor VAT is
    # an argument waiting to happen the day it gets invoiced.
    vat_criterion = ((cfg.get("iva") or {}).get("criterio") or "").strip()
    default_currency = (cfg.get("moneda_por_defecto") or "").strip()
    undefined = [c for c, v in (("moneda_por_defecto", default_currency), ("iva.criterio", vat_criterion)) if not v]
    if undefined:
        respond({
            "ok": False,
            "missing": undefined,
            "question": " ".join(QUESTIONS[c] for c in undefined),
            "how_to_proceed": "guardá la respuesta con save_setup.py --set (una sola vez, queda en formato.json)",
        }, 2)

    base_vat_rate = Decimal(str((cfg.get("iva") or {}).get("tasa") or 22))
    lines, missing_items = [], []
    for raw in args.item:
        ref, qty = raw, Decimal(1)
        if ":" in raw:
            candidate, _, tail = raw.rpartition(":")
            parsed = parse_quantity(tail)
            if candidate.strip() and parsed is not None:
                ref, qty = candidate.strip(), parsed
        if qty <= 0:
            respond({"ok": False,
                     "error": f"'{raw}': la cantidad tiene que ser mayor a cero. "
                              "Un descuento no entra como cantidad negativa: va con --discount."}, 1)
        row, matched_by = resolve_item(ref, rows)
        if row is None:
            # When there isn't exactly one, `matched_by` carries the rows that could be it.
            candidates = [{"codigo": c.get("codigo", ""), "item": c.get("item", "")} for c in matched_by[:6]]
            missing_items.append({
                "requested": ref,
                "qty": str(qty),
                "reason": "hay más de uno que puede ser" if candidates else "no está en la lista",
                "candidates": candidates,
                "question": (f"«{ref}» no está en tu lista: ¿cuánto cobrás?"
                             if not candidates else
                             f"«{ref}» me da varias opciones de tu lista: ¿cuál va?"),
            })
            continue

        try:
            price = Decimal((row.get("precio") or "").strip())
            rate = Decimal(row["iva"].strip()) if (row.get("iva") or "").strip() else base_vat_rate
        except InvalidOperation:
            # A broken row is not rounded down to zero: it gets asked, like
            # anything else that has no price.
            missing_items.append({
                "requested": ref,
                "qty": str(qty),
                "reason": "la fila está en la lista pero su precio no se puede leer",
                "read_as": row.get("precio", ""),
                "candidates": [],
                "question": f"tengo «{row.get('item', ref)}» en la lista pero el precio quedó "
                            "mal escrito: ¿cuánto es?",
            })
            continue
        gross = round_money(qty * price)
        if vat_criterion == "incluido":
            net = round_money(gross / (1 + rate / 100))
            vat = gross - net
        else:
            net = gross
            vat = round_money(gross * rate / 100)
        lines.append({
            "code": row.get("codigo", ""),
            "item": row.get("item", ""),
            "unit": row.get("unidad", ""),
            "qty": str(qty),
            "unit_price": f"{price:.2f}",
            "currency": (row.get("moneda") or "").strip() or default_currency,
            "vat_rate": f"{rate:g}",
            "subtotal": f"{net:.2f}",
            "vat": f"{vat:.2f}",
            "total": f"{net + vat:.2f}",
            "note": (row.get("nota") or "").strip(),
            "matched_by": matched_by,
        })

    if missing_items and args.issue:
        respond({
            "ok": False,
            "error": f"{len(missing_items)} ítem(s) sin precio en la lista: no numero un presupuesto incompleto",
            "missing": missing_items,
            "how_to_proceed": "preguntá cuánto cobra por eso, guardalo con save_setup.py --price "
                              "y volvé a correr. Lo que no está en la lista no se inventa.",
        }, 1)

    totals = {}
    for line in lines:
        accumulated = totals.setdefault(line["currency"], [Decimal(0), Decimal(0)])
        accumulated[0] += Decimal(line["subtotal"])
        accumulated[1] += Decimal(line["vat"])

    # The one arithmetic the model was still doing by hand, and the one that
    # touches the final price. Only the CLIENT authorizes a discount; this
    # script only makes it visible and does the subtraction right. A percent
    # needs one currency (a discount over two totals is two discounts).
    discount = None
    if args.discount.strip():
        if not args.reason.strip():
            respond({"ok": False,
                     "error": "un descuento sin motivo es un precio inventado: decí quién "
                              "lo autorizó o por qué (--reason)"}, 1)
        raw = args.discount.strip()
        if raw.endswith("%"):
            percent = parse_quantity(raw[:-1])
            if percent is None or percent <= 0 or percent >= 100:
                respond({"ok": False, "error": f"'{raw}' no es un porcentaje entre 0 y 100"}, 1)
            if len(totals) != 1:
                respond({"ok": False,
                         "error": "un porcentaje sobre dos monedas son dos descuentos: "
                                  "hacelo por monto, o un presupuesto por moneda"}, 1)
            discount_currency, (sub, vat_total) = next(iter(totals.items()))
            amount = round_money((sub + vat_total) * percent / 100)
        else:
            percent = None
            amount = parse_quantity(raw)
            if amount is None or amount <= 0:
                respond({"ok": False, "error": f"'{raw}' no es un monto de descuento legible"}, 1)
            amount = round_money(amount)
            discount_currency = default_currency if len(totals) != 1 else next(iter(totals))
        discount = {"amount": f"{amount:.2f}", "currency": discount_currency,
                    "percent": (f"{percent:g}%" if percent is not None else None),
                    "reason": args.reason.strip()}

    assigned, upcoming = quote_number(cfg, args.issue, args.number.strip())
    today = date.today()
    validity_days = cfg.get("validez_dias")
    expires = (today + timedelta(days=int(validity_days))).isoformat() if validity_days else None

    notices = []
    if missing_items:
        notices.append(f"{len(missing_items)} ítem(s) no están en la lista: preguntá el precio, "
                       "no lo pongas vos. Hasta resolverlo no se numera ni se manda.")
    if len(totals) > 1:
        notices.append("hay dos monedas en el mismo presupuesto y no convierto tipo de cambio: "
                       "van los dos totales, o preguntás en cuál lo quiere.")
    if not validity_days:
        notices.append(QUESTIONS["validez_dias"])
    updated_at = ((cfg.get("lista") or {}).get("actualizada") or "").strip()
    if updated_at:
        try:
            days = (today - date.fromisoformat(updated_at)).days
            if days >= STALE_AFTER_DAYS:
                notices.append(f"la lista de precios no se actualiza hace {days} días: "
                               "confirmá los precios antes de mandarlo.")
        except ValueError:
            pass

    respond({
        "ok": True,
        "number": assigned,
        "next_number": upcoming,
        "client": args.client,
        "date": today.isoformat(),
        "validity_days": validity_days,
        "expires": expires,
        "vat": {"criterion": vat_criterion, "default_rate": f"{base_vat_rate:g}"},
        "default_currency": default_currency,
        "lines": lines,
        "missing": missing_items,
        "discount": discount,
        "totals": {m: {"subtotal": f"{s:.2f}", "vat": f"{i:.2f}", "total": f"{s + i:.2f}",
                       **({"total_with_discount": f"{s + i - Decimal(discount['amount']):.2f}"}
                          if discount and discount["currency"] == m else {})}
                   for m, (s, i) in totals.items()},
        "company": cfg.get("empresa") or {},
        "sections": cfg.get("secciones") or [],
        "terms": cfg.get("condiciones") or [],
        "closing": cfg.get("cierre") or "",
        "price_list": {"updated_at": updated_at, "rows": len(rows)},
        "notices": notices,
        "next_steps": "escribí el presupuesto con el orden de `sections` y dejalo con la skill "
                      "deliverable. Mandarlo es decisión de tu cliente, no tuya.",
    })


if __name__ == "__main__":
    main()
