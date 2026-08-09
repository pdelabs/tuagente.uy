#!/usr/bin/env python3
"""MCP de Mercado Pago, escrito para un dueño de PyME y no para un integrador.

POR QUE NO USAMOS EL OFICIAL
----------------------------
El MCP oficial (mercadolibre/mercadopago-mcp-server) resuelve otro problema:
buscar documentacion, crear aplicaciones, configurar webhooks, generar usuarios
de prueba, correr el medidor de calidad de la integracion. Todo eso es para el
que ESTA INTEGRANDO Mercado Pago. Nuestro cliente ya lo tiene integrado: quiere
saber quien no le pago.

QUE EXPONE
----------
Seis herramientas, en las palabras del cliente y no en las de la API. La
clasificacion lee/actua vive en ../tools.json y la aplica la guardia, no este
archivo: aca no hay ninguna decision de permisos, a proposito. Una sola puerta.

LA CREDENCIAL
-------------
Un Access Token de produccion, en MP_ACCESS_TOKEN. Nunca se loguea, nunca se
devuelve, y no se pide por el portal — el cliente no tiene que aprender a
repartir secretos. Va en el .env del agente, como el resto.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://api.mercadopago.com"
TOKEN = os.environ.get("MP_ACCESS_TOKEN", "")


def log(msg):
    print(f"[mercadopago] {msg}", file=sys.stderr, flush=True)


def _get(ruta, params=None):
    url = f"{API}{ruta}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _post(ruta, cuerpo=None):
    datos = json.dumps(cuerpo or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{ruta}", data=datos, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000%z") or dt.isoformat()


def _plata(v, moneda="UYU"):
    """Los montos se devuelven ya formateados: el modelo no tiene que hacer
    cuentas ni elegir separadores, y asi el cliente los lee igual siempre."""
    try:
        return f"$ {float(v):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    except (TypeError, ValueError):
        return str(v)


def _resumir(p):
    """Un pago, en lo que le importa a una persona."""
    return {
        "id": p.get("id"),
        "cuando": (p.get("date_approved") or p.get("date_created") or "")[:16].replace("T", " "),
        "monto": _plata(p.get("transaction_amount"), p.get("currency_id")),
        "estado": {
            "approved": "cobrado", "pending": "pendiente", "in_process": "en revisión",
            "rejected": "rechazado", "refunded": "devuelto", "cancelled": "cancelado",
            "charged_back": "contracargo",
        }.get(p.get("status"), p.get("status")),
        "medio": p.get("payment_method_id"),
        "de": (p.get("payer") or {}).get("email") or (p.get("payer") or {}).get("id"),
        "detalle": p.get("description"),
        "referencia": p.get("external_reference"),
    }


# ── las herramientas ────────────────────────────────────────────────────────

def cobros_del_periodo(desde=None, hasta=None):
    """Cuanto entro entre dos fechas, con el desglose por medio de pago."""
    fin = datetime.now(timezone.utc) if not hasta else datetime.fromisoformat(hasta)
    ini = (fin - timedelta(days=30)) if not desde else datetime.fromisoformat(desde)
    # La API acota a 365 dias por consulta y a los ultimos 12 meses.
    if (fin - ini).days > 365:
        return {"error": "el período no puede pasar de 365 días"}
    r = _get("/v1/payments/search", {
        "begin_date": _iso(ini), "end_date": _iso(fin),
        "status": "approved", "limit": 100, "sort": "date_approved", "criteria": "desc"})
    pagos = r.get("results", [])
    total = sum(float(p.get("transaction_amount") or 0) for p in pagos)
    por_medio = {}
    for p in pagos:
        k = p.get("payment_method_id") or "otro"
        por_medio[k] = por_medio.get(k, 0) + float(p.get("transaction_amount") or 0)
    return {
        "desde": ini.date().isoformat(), "hasta": fin.date().isoformat(),
        "cobros": len(pagos), "total": _plata(total),
        "por_medio_de_pago": {k: _plata(v) for k, v in sorted(por_medio.items(), key=lambda x: -x[1])},
        "nota": ("La API devuelve hasta 100 por consulta: si hay más, este total "
                 "es parcial y hay que acotar el período." if len(pagos) == 100 else None),
    }


def buscar_cobros(estado=None, desde=None, hasta=None, referencia=None, limite=25):
    """Busca pagos por estado, fecha o referencia."""
    params = {"limit": min(int(limite or 25), 50), "sort": "date_created", "criteria": "desc"}
    if estado:
        params["status"] = {"cobrado": "approved", "pendiente": "pending",
                            "rechazado": "rejected", "devuelto": "refunded"}.get(estado, estado)
    if referencia:
        params["external_reference"] = referencia
    if desde:
        params["begin_date"] = _iso(datetime.fromisoformat(desde))
    if hasta:
        params["end_date"] = _iso(datetime.fromisoformat(hasta))
    r = _get("/v1/payments/search", params)
    return {"encontrados": r.get("paging", {}).get("total"),
            "cobros": [_resumir(p) for p in r.get("results", [])]}


def ver_cobro(id):
    """El detalle de un cobro."""
    return _resumir(_get(f"/v1/payments/{id}"))


def cobros_pendientes(dias=30):
    """Lo que quedó pendiente o rechazado y todavía no entró."""
    fin = datetime.now(timezone.utc)
    ini = fin - timedelta(days=int(dias or 30))
    salida = []
    for estado in ("pending", "in_process", "rejected"):
        r = _get("/v1/payments/search", {
            "begin_date": _iso(ini), "end_date": _iso(fin),
            "status": estado, "limit": 50, "sort": "date_created", "criteria": "desc"})
        salida += [_resumir(p) for p in r.get("results", [])]
    return {"desde": ini.date().isoformat(), "pendientes": len(salida), "cobros": salida}


def crear_link_de_cobro(titulo, monto, moneda="UYU", referencia=None):
    """Genera un link para cobrarle a alguien."""
    pref = _post("/checkout/preferences", {
        "items": [{"title": titulo, "quantity": 1,
                   "unit_price": float(monto), "currency_id": moneda}],
        "external_reference": referencia,
    })
    return {"link": pref.get("init_point"), "id": pref.get("id"),
            "titulo": titulo, "monto": _plata(monto, moneda)}


def devolver_cobro(id, monto=None):
    """Devuelve un pago, total o parcialmente."""
    r = _post(f"/v1/payments/{id}/refunds", {"amount": float(monto)} if monto else {})
    return {"ok": True, "devolucion": r.get("id"), "monto": _plata(r.get("amount")),
            "sobre_el_cobro": id}


TOOLS = {
    "cobros_del_periodo": (cobros_del_periodo, "Cuánto entró entre dos fechas, con el desglose por medio de pago.",
        {"desde": "fecha ISO, opcional (por defecto: hace 30 días)", "hasta": "fecha ISO, opcional (por defecto: hoy)"}),
    "buscar_cobros": (buscar_cobros, "Busca pagos por estado, fecha o referencia.",
        {"estado": "cobrado | pendiente | rechazado | devuelto", "desde": "fecha ISO", "hasta": "fecha ISO",
         "referencia": "tu referencia externa", "limite": "hasta 50"}),
    "ver_cobro": (ver_cobro, "El detalle de un cobro.", {"id": "id del pago"}),
    "cobros_pendientes": (cobros_pendientes, "Lo que quedó pendiente o rechazado y todavía no entró.",
        {"dias": "cuántos días para atrás mirar (por defecto 30)"}),
    "crear_link_de_cobro": (crear_link_de_cobro, "Genera un link para cobrarle a alguien.",
        {"titulo": "qué se está cobrando", "monto": "número", "moneda": "UYU por defecto",
         "referencia": "tu referencia, opcional"}),
    "devolver_cobro": (devolver_cobro, "Devuelve un pago, total o parcialmente. Saca plata de la cuenta.",
        {"id": "id del pago", "monto": "opcional; sin esto devuelve todo"}),
}


def esquemas():
    return [{
        "name": n,
        "description": d,
        "inputSchema": {
            "type": "object",
            "properties": {k: {"type": "string", "description": v} for k, v in props.items()},
            "required": ["id"] if n in ("ver_cobro", "devolver_cobro")
                        else (["titulo", "monto"] if n == "crear_link_de_cobro" else []),
        },
    } for n, (_, d, props) in TOOLS.items()]


def main():
    if not TOKEN:
        log("falta MP_ACCESS_TOKEN")
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            msg = json.loads(linea)
        except ValueError:
            continue
        mid, metodo = msg.get("id"), msg.get("method")
        resp = {"jsonrpc": "2.0", "id": mid}

        if metodo == "initialize":
            resp["result"] = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                              "serverInfo": {"name": "mercadopago", "version": "1.0.0"}}
        elif metodo == "tools/list":
            resp["result"] = {"tools": esquemas()}
        elif metodo == "tools/call":
            p = msg.get("params") or {}
            fn = TOOLS.get(p.get("name", ""), (None,))[0]
            if fn is None:
                resp["result"] = {"content": [{"type": "text", "text": "no conozco esa herramienta"}],
                                  "isError": True}
            else:
                try:
                    salida = fn(**(p.get("arguments") or {}))
                    resp["result"] = {"content": [{"type": "text",
                                                   "text": json.dumps(salida, ensure_ascii=False, indent=2)}]}
                except urllib.error.HTTPError as e:
                    # El error de MP se pasa tal cual: "invalid access token" le
                    # dice al agente que la conexion esta rota, no que fallo el
                    # pedido del cliente. Son dos cosas distintas.
                    cuerpo = e.read().decode("utf-8", "replace")[:400]
                    resp["result"] = {"content": [{"type": "text",
                        "text": f"Mercado Pago devolvió {e.code}: {cuerpo}"}], "isError": True}
                except Exception as e:  # noqa: BLE001 — el server no se puede caer
                    resp["result"] = {"content": [{"type": "text", "text": f"error: {e}"}],
                                      "isError": True}
        elif metodo and metodo.startswith("notifications/"):
            continue
        else:
            resp["result"] = {}
        print(json.dumps(resp, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
