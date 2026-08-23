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
import hashlib
import hmac
import json
import os
import sys
import uuid
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


def _post(ruta, cuerpo=None, idempotencia=None):
    """POST con X-Idempotency-Key.

    NO es opcional: Mercado Pago lo hizo obligatorio en Pagos y Devoluciones
    justamente porque se estaban duplicando. Sin el header, un reintento por
    timeout puede devolver la plata DOS VECES — y una devolucion no se
    deshace. La clave la damos nosotros para que el reintento de la misma
    operacion sea el mismo pedido, no uno nuevo.
    """
    datos = json.dumps(cuerpo or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{ruta}", data=datos, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Content-Type": "application/json",
                 "X-Idempotency-Key": idempotencia or str(uuid.uuid4())})
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
    """Devuelve un pago, total o parcialmente.

    Sin `monto` devuelve todo — asi lo define la API: el campo es opcional y
    su ausencia significa devolucion total.

    La clave de idempotencia se deriva del pago y del monto: si el agente
    reintenta la MISMA devolucion, Mercado Pago la reconoce y no la duplica.
    Si de verdad se quiere devolver dos veces un parcial, hay que cambiar el
    monto — que es exactamente la friccion que queremos.
    """
    # Chequear ANTES de devolver, y no confiar solo en la idempotencia.
    # Sacado de la integracion de demoda, que lleva anos en produccion: un
    # pago ya devuelto se responde sin tocar nada. La idempotencia protege del
    # reintento identico; esto protege de la orden repetida a mano.
    actual = _get(f"/v1/payments/{id}")
    if actual.get("status") == "refunded":
        return {"ok": True, "ya_estaba_devuelto": True, "sobre_el_cobro": id,
                "nota": "Ese cobro ya figuraba devuelto: no hice nada."}

    clave = f"tuagente-refund-{id}-{monto or 'total'}"
    r = _post(f"/v1/payments/{id}/refunds",
              {"amount": float(monto)} if monto else {},
              idempotencia=clave)
    return {"ok": True, "devolucion": r.get("id"), "monto": _plata(r.get("amount")),
            "sobre_el_cobro": id}


# ── Webhooks ────────────────────────────────────────────────────────────────

def verificar_firma(x_signature, x_request_id, data_id, secreto):
    """Valida que la notificacion venga de Mercado Pago.

    El header llega como `ts=1704908010,v1=<hmac>`. El manifiesto que se firma
    es `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y el hash es
    HMAC-SHA256 con la clave secreta de la aplicacion.

    Sin esto, cualquiera que sepa la URL puede avisarte que te pagaron.
    """
    if not (x_signature and secreto):
        return False
    partes = dict(x.split("=", 1) for x in x_signature.split(",") if "=" in x)
    ts, v1 = partes.get("ts"), partes.get("v1")
    if not (ts and v1):
        return False
    manifiesto = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
    esperado = hmac.new(secreto.encode(), manifiesto.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, v1)


def procesar_notificacion(cuerpo, x_signature=None, x_request_id=None):
    """Lo que hay que hacer cuando llega un webhook.

    DOS REGLAS QUE NO ESTAN EN LA DOC Y SI EN EL CODIGO DE DEMODA:

    1. **La notificacion NO es el dato, es el disparador.** Trae un id y nada
       mas confiable que eso: el estado se le pide a la API. Creerle el
       `status` al webhook es creerle a algo que te mando un desconocido.
    2. **Filtrar explicitamente** por accion y tipo. Lo que no reconocemos se
       ignora y se dice, en vez de intentar interpretarlo.

    Y la tercera, de la doc: hay que contestar 200 en menos de 22 segundos o
    Mercado Pago reintenta cada 15 minutos. Por eso esto no hace trabajo
    pesado: mira quien pago y devuelve.
    """
    secreto = os.environ.get("MP_WEBHOOK_SECRET", "")
    data_id = str(((cuerpo or {}).get("data") or {}).get("id") or "")
    if secreto and not verificar_firma(x_signature, x_request_id, data_id, secreto):
        return {"ok": False, "error": "firma invalida: la notificacion no es de Mercado Pago"}
    if not secreto:
        log("MP_WEBHOOK_SECRET vacio: no puedo verificar la firma")

    accion, tipo = (cuerpo or {}).get("action"), (cuerpo or {}).get("type")
    if tipo != "payment" or accion not in ("payment.created", "payment.updated"):
        return {"ok": True, "ignorada": True, "por_que": f"no la proceso: type={tipo} action={accion}"}
    if not data_id:
        return {"ok": False, "error": "la notificacion no trae data.id"}
    return {"ok": True, "cobro": _resumir(_get(f"/v1/payments/{data_id}"))}


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
