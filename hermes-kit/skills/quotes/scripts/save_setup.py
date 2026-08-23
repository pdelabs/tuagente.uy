#!/usr/bin/env python3
"""Record how this company quotes and what it charges. The only writer of presupuestos/.

    save_setup.py --set validez_dias=15 --set iva.criterio=mas_iva
    save_setup.py --prices < lista.csv
    save_setup.py --price "Flete Montevideo=1500" --code FLE-MVD --unit viaje

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

Filling a field clears its entry from `gaps`, so "what is still open" stays
true by construction instead of by someone remembering to update it.

NOTE: `formato.json` / `lista-precios.csv` keep their Spanish field names on
disk (they mirror the client's own Uruguayan invoicing vocabulary -- iva, rut,
moneda -- the same way the invoices-to-data spreadsheet columns do). Only
this script's own identifiers, CLI flags and JSON response are in English.
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

DATA = Path(os.environ.get("QUOTES_DIR", "/opt/data/workspace/presupuestos"))
COLUMNS = ("codigo", "item", "unidad", "precio", "moneda", "iva", "nota")

# What can be filled in and still isn't. The text after the em dash is the
# question, in the client's own words: it is shown to them verbatim.
GAPS = [
    "empresa.nombre — con qué nombre firma sus presupuestos",
    "moneda_por_defecto — si cotiza en pesos (UYU) o en dólares (USD)",
    "iva.criterio — si los precios de su lista son más IVA o con IVA incluido",
    "validez_dias — cuántos días vale el precio que manda",
    "condiciones — forma de pago, plazo de entrega y qué no incluye",
]

NEW_FORMAT = {
    "empresa": {"nombre": "", "contacto": "", "rut": ""},
    "moneda_por_defecto": "",
    # 22 is the basic Uruguayan rate; the minimum (10) is for specific trades
    # and goes per row in the price list, not here.
    "iva": {"criterio": "", "tasa": 22},
    "validez_dias": None,
    "numeracion": {"prefijo": "P", "ancho": 4, "reinicia_por_anio": True, "desde": 0},
    "condiciones": [],
    "secciones": [],
    "cierre": "",
    "lista": {"actualizada": "", "filas": 0},
    "huecos": list(GAPS),
}

# Keys that hold a list: the value comes separated by " | ".
LIST_FIELDS = {"condiciones", "secciones"}
CRITERIA = ("mas_iva", "incluido")

CURRENCIES = {
    "$": "UYU", "$U": "UYU", "UY$": "UYU", "UYU": "UYU", "PESOS": "UYU", "PESO": "UYU",
    "U$S": "USD", "US$": "USD", "U$": "USD", "USD": "USD", "DOLARES": "USD", "DOLAR": "USD",
}

# How a real client's spreadsheet spells the same column.
ALIASES = {
    "codigo": {"codigo", "cod", "sku", "referencia", "ref", "articulo"},
    "item": {"item", "detalle", "descripcion", "producto", "servicio", "concepto", "nombre"},
    "unidad": {"unidad", "un", "medida", "um"},
    "precio": {"precio", "preciounitario", "punitario", "pu", "valor", "importe", "monto"},
    "moneda": {"moneda", "mon", "divisa"},
    "iva": {"iva", "tasa", "tasaiva"},
    "nota": {"nota", "notas", "observacion", "observaciones", "comentario"},
}


def strip_accents(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower()


def save_atomic(path, text):
    """Write next to the target and rename over it: the file can never be left half-written.

    These files get read on the next run, sometimes on this same one; an
    `open(w)` that gets cut leaves the price list truncated, which is worse
    than not having it because nobody notices.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def exit_with_error(message, extra=None):
    body = {"ok": False, "error": message}
    if extra:
        body.update(extra)
    print(json.dumps(body, ensure_ascii=False))
    raise SystemExit(1)


def parse_amount(text):
    """'U$S 1.250,50' -> Decimal('1250.50'). None if there is no number inside."""
    clean = re.sub(r"[^\d.,-]", "", str(text or "")).strip()
    if not clean:
        return None
    if "," in clean and "." in clean:
        # The decimal separator is whichever comes last; the other is thousands.
        decimal = "," if clean.rfind(",") > clean.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        clean = clean.replace(thousands, "").replace(decimal, ".")
    elif "," in clean:
        whole, _, rest = clean.rpartition(",")
        # "1,50" is a decimal; "1,500" written by a Uruguayan is one thousand
        # five hundred.
        clean = f"{whole}.{rest}" if len(rest) in (1, 2) else clean.replace(",", "")
    elif clean.count(".") == 1:
        whole, _, rest = clean.partition(".")
        clean = clean if len(rest) in (1, 2) else whole + rest
    else:
        clean = clean.replace(".", "")
    try:
        return Decimal(clean)
    except InvalidOperation:
        return None


def normalize_currency(text):
    """'U$S 120' -> USD, '$ 390' -> UYU, '1.250' -> '' (says nothing), 'eur' -> ''.

    Empty is not an error: a row with no currency uses the format's default.
    What IS an error is a currency written in a way that is not understood,
    and that is why it is not guessed here.
    """
    key = re.sub(r"[^A-Z$]", "", strip_accents(text).upper())
    return CURRENCIES.get(key, "") if key else ""


def read_format():
    path = DATA / "formato.json"
    if not path.is_file():
        return json.loads(json.dumps(NEW_FORMAT))
    try:
        return json.loads(path.read_text("utf-8"))
    except ValueError as exc:
        exit_with_error(f"formato.json no se puede leer ({exc}). Arreglalo antes de escribirle encima.")


def write_format(cfg):
    save_atomic(DATA / "formato.json", json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")


def set_path(target, path, value):
    parts = path.split(".")
    for key in parts[:-1]:
        node = target.get(key)
        if not isinstance(node, dict):
            node = {}
            target[key] = node
        target = node
    target[parts[-1]] = value


def clear_gap(gaps, path):
    return [g for g in gaps if g.split(" — ")[0].strip() != path]


def typed_value(path, raw):
    leaf = path.split(".")[-1]
    if leaf in LIST_FIELDS:
        return [p.strip() for p in raw.split("|") if p.strip()]
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if re.fullmatch(r"-?\d+[.,]\d+", raw):
        return float(raw.replace(",", "."))
    if raw.lower() in ("true", "false"):
        return raw.lower() == "true"
    return raw


def current_rows():
    path = DATA / "lista-precios.csv"
    if not path.is_file():
        return []
    with open(path, encoding="utf-8", newline="") as fh:
        return [{c: (f.get(c) or "").strip() for c in COLUMNS} for f in csv.DictReader(fh)]


def write_price_list(rows, cfg):
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    save_atomic(DATA / "lista-precios.csv", out.getvalue())
    cfg.setdefault("lista", {})
    cfg["lista"]["actualizada"] = date.today().isoformat()
    cfg["lista"]["filas"] = len(rows)
    write_format(cfg)


def map_header(fields):
    """The client spreadsheet's column -> ours. None when it is not recognised."""
    mapping = {}
    for field in fields or []:
        key = re.sub(r"[^a-z0-9]", "", strip_accents(field))
        for ours, aliases in ALIASES.items():
            if key in aliases and ours not in mapping.values():
                mapping[field] = ours
                break
    return mapping


def load_prices(cfg, text):
    if not text.strip():
        exit_with_error("la lista vino vacía")
    sample = text.splitlines()[0]
    delimiter = max(",;\t", key=sample.count)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    mapping = map_header(reader.fieldnames)
    if "item" not in mapping.values() or "precio" not in mapping.values():
        exit_with_error(
            "no encontré las columnas del ítem y del precio",
            {"encabezado_leido": reader.fieldnames,
             "columnas_esperadas": list(COLUMNS),
             "obligatorias": ["item", "precio"]},
        )

    rows, rejected, duplicates = [], [], []
    seen = set()
    for n, raw_row in enumerate(reader, start=2):
        row = {c: "" for c in COLUMNS}
        for source, ours in mapping.items():
            row[ours] = (raw_row.get(source) or "").strip()
        if not row["item"]:
            rejected.append({"linea": n, "por_que": "sin ítem"})
            continue
        price = parse_amount(row["precio"])
        if price is None:
            rejected.append({"linea": n, "por_que": "el precio no es un número",
                             "decia": row["precio"], "item": row["item"]})
            continue
        # The currency can arrive stuck to the price ("U$S 120") or in its own
        # column. Empty stays empty: the format's default resolves it at quote
        # time. Written and not understood gets rejected -- same failure as
        # an unreadable price.
        currency = normalize_currency(row["moneda"] or row["precio"])
        if not currency and row["moneda"]:
            rejected.append({"linea": n, "por_que": "no entendí la moneda",
                             "decia": row["moneda"], "item": row["item"]})
            continue
        row["moneda"] = currency
        row["precio"] = f"{price:.2f}"
        if row["iva"]:
            rate = parse_amount(row["iva"])
            row["iva"] = "" if rate is None else f"{rate:g}"
        key = row["codigo"].lower() or strip_accents(row["item"])
        if key in seen:
            duplicates.append(row["codigo"] or row["item"])
        seen.add(key)
        rows.append(row)

    if not rows:
        exit_with_error("ninguna fila tenía ítem y precio", {"rechazadas": rejected})
    write_price_list(rows, cfg)
    return {"filas": len(rows), "rechazadas": rejected, "duplicados": duplicates}


def one_price(cfg, text, code, unit, currency, vat, note):
    if "=" not in text:
        exit_with_error('esperaba --price "nombre del item=precio", vino: ' + text)
    item, _, raw = text.partition("=")
    item, raw = item.strip(), raw.strip()
    price = parse_amount(raw)
    if not item or price is None:
        exit_with_error(f"'{text}' no tiene un ítem y un precio que se puedan leer")

    row = {
        "codigo": code.strip(),
        "item": item,
        "unidad": unit.strip(),
        "precio": f"{price:.2f}",
        "moneda": normalize_currency(currency or raw),
        "iva": vat.strip(),
        "nota": note.strip(),
    }
    if currency.strip() and not row["moneda"]:
        exit_with_error(f"no entendí la moneda '{currency}': es UYU o USD")
    key = row["codigo"].lower() or strip_accents(row["item"])
    # Correcting a price must not degrade the row: whatever flag did NOT come
    # keeps the old value. Measured before this: a bare --price wiped unidad,
    # moneda, iva and nota of the row it corrected.
    for old in current_rows():
        if (old["codigo"].lower() or strip_accents(old["item"])) == key:
            for field in ("codigo", "item", "unidad", "moneda", "iva", "nota"):
                if not row[field]:
                    row[field] = old[field]
            break
    # Overwrites ALL rows with that key, not the first: if the list came with
    # the same code twice (happens, and `--prices` warns about it), leaving
    # the second one keeps the ambiguity -- and at quote time that is an item
    # that can never be resolved.
    new_rows, action = [], "agregado"
    for old in current_rows():
        if (old["codigo"].lower() or strip_accents(old["item"])) != key:
            new_rows.append(old)
            continue
        if action == "agregado":
            new_rows.append(row)
            action = "actualizado"
    if action == "agregado":
        new_rows.append(row)
    write_price_list(new_rows, cfg)
    return {"accion": action, "fila": row, "filas": len(new_rows)}


def main():
    ap = argparse.ArgumentParser(description="Guarda el formato y la lista de precios del cliente.")
    ap.add_argument("--set", action="append", default=[], metavar="RUTA=VALOR",
                    # No percent signs in this text: argparse runs it through
                    # a formatter and a bare "%" blows up the whole parser.
                    help='por ejemplo: iva.criterio=mas_iva, o condiciones="Pago adelantado | Entrega: 5 días"')
    ap.add_argument("--prices", action="store_true", help="la lista entera, en CSV, por stdin")
    ap.add_argument("--price", default="", metavar="ITEM=PRECIO",
                    help="agrega o corrige UNA línea de la lista")
    ap.add_argument("--code", default="")
    ap.add_argument("--unit", default="")
    ap.add_argument("--currency", default="")
    ap.add_argument("--vat", default="", help="tasa de esa línea si va distinta a la del formato")
    ap.add_argument("--note", default="")
    ap.add_argument("--data-dir", default="")
    args = ap.parse_args()

    global DATA
    if args.data_dir:
        DATA = Path(args.data_dir)
    if not (args.set or args.prices or args.price):
        exit_with_error("no me dijiste qué guardar: --set, --prices o --price")

    cfg = read_format()
    cfg.setdefault("huecos", list(GAPS))
    filled = []

    for pair in args.set:
        if "=" not in pair:
            exit_with_error(f"esperaba ruta=valor, vino: {pair}")
        path, _, raw = pair.partition("=")
        path, raw = path.strip(), raw.strip()
        if not raw:
            exit_with_error(f"'{path}' vino vacío. Un hueco sin respuesta se queda como hueco.")
        if path == "iva.criterio" and raw not in CRITERIA:
            exit_with_error(f"iva.criterio es {' o '.join(CRITERIA)}, vino: {raw}")
        if path == "moneda_por_defecto":
            raw = normalize_currency(raw)
            if not raw:
                exit_with_error("moneda_por_defecto es UYU o USD")
        set_path(cfg, path, typed_value(path, raw))
        cfg["huecos"] = clear_gap(cfg["huecos"], path)
        filled.append(path)
    if filled:
        write_format(cfg)

    response = {"ok": True, "filled": filled, "gaps": cfg["huecos"]}
    if args.prices:
        response["price_list"] = load_prices(cfg, sys.stdin.read())
    if args.price:
        response["price"] = one_price(cfg, args.price, args.code, args.unit,
                                       args.currency, args.vat, args.note)
    response["where"] = str(DATA)
    print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
