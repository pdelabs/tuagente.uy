#!/usr/bin/env python3
"""Mercado Pago MCP, written for a small-business owner, not an integrator.

WHY WE DON'T USE THE OFFICIAL ONE
----------------------------------
The official MCP (mercadolibre/mercadopago-mcp-server) solves a different
problem: searching docs, creating applications, configuring webhooks,
generating test users, running the integration's quality meter. All of that
is for whoever is INTEGRATING Mercado Pago. Our client already has it
integrated: they want to know who hasn't paid them.

WHAT IT EXPOSES
----------------
Six tools, in the client's own words rather than the API's. The read/act
classification lives in ../tools.json and is enforced by the guard, not this
file: there is no permission decision here, on purpose. One single door.

THE CREDENTIAL
--------------
A production Access Token, in MP_ACCESS_TOKEN. Never logged, never returned,
and never requested through the portal — the client doesn't have to learn to
hand out secrets. It goes in the agent's .env, like everything else.
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


def _get(path, params=None):
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _post(path, body=None, idempotency_key=None):
    """POST with X-Idempotency-Key.

    It is NOT optional: Mercado Pago made it mandatory on Payments and Refunds
    precisely because duplicates were happening. Without the header, a retry
    after a timeout can pay the money back TWICE — and a refund doesn't undo
    itself. We supply the key so a retry of the same operation is the same
    request, not a new one.
    """
    data = json.dumps(body or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{path}", data=data, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Content-Type": "application/json",
                 "X-Idempotency-Key": idempotency_key or str(uuid.uuid4())})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000%z") or dt.isoformat()


def _money(v, currency="UYU"):
    """Amounts come back already formatted: the model doesn't have to do the
    math or pick separators, so the client always reads them the same way."""
    try:
        return f"$ {float(v):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    except (TypeError, ValueError):
        return str(v)


def _summarize(p):
    """A payment, in the terms that matter to a person."""
    return {
        "id": p.get("id"),
        "when": (p.get("date_approved") or p.get("date_created") or "")[:16].replace("T", " "),
        "amount": _money(p.get("transaction_amount"), p.get("currency_id")),
        "status": {
            "approved": "cobrado", "pending": "pendiente", "in_process": "en revisión",
            "rejected": "rechazado", "refunded": "devuelto", "cancelled": "cancelado",
            "charged_back": "contracargo",
        }.get(p.get("status"), p.get("status")),
        "method": p.get("payment_method_id"),
        "from": (p.get("payer") or {}).get("email") or (p.get("payer") or {}).get("id"),
        "detail": p.get("description"),
        "reference": p.get("external_reference"),
    }


# ── the tools ────────────────────────────────────────────────────────────────

def payments_for_period(from_date=None, to_date=None):
    """How much came in between two dates, broken down by payment method."""
    end = datetime.now(timezone.utc) if not to_date else datetime.fromisoformat(to_date)
    start = (end - timedelta(days=30)) if not from_date else datetime.fromisoformat(from_date)
    # The API caps queries at 365 days and at the last 12 months.
    if (end - start).days > 365:
        return {"error": "el período no puede pasar de 365 días"}
    r = _get("/v1/payments/search", {
        "begin_date": _iso(start), "end_date": _iso(end),
        "status": "approved", "limit": 100, "sort": "date_approved", "criteria": "desc"})
    payments = r.get("results", [])
    total = sum(float(p.get("transaction_amount") or 0) for p in payments)
    by_method = {}
    for p in payments:
        k = p.get("payment_method_id") or "otro"
        by_method[k] = by_method.get(k, 0) + float(p.get("transaction_amount") or 0)
    return {
        "from_date": start.date().isoformat(), "to_date": end.date().isoformat(),
        "payments": len(payments), "total": _money(total),
        "by_payment_method": {k: _money(v) for k, v in sorted(by_method.items(), key=lambda x: -x[1])},
        "note": ("La API devuelve hasta 100 por consulta: si hay más, este total "
                 "es parcial y hay que acotar el período." if len(payments) == 100 else None),
    }


def search_payments(status=None, from_date=None, to_date=None, reference=None, limit=25):
    """Search payments by status, date or reference."""
    params = {"limit": min(int(limit or 25), 50), "sort": "date_created", "criteria": "desc"}
    if status:
        params["status"] = {"cobrado": "approved", "pendiente": "pending",
                            "rechazado": "rejected", "devuelto": "refunded"}.get(status, status)
    if reference:
        params["external_reference"] = reference
    if from_date:
        params["begin_date"] = _iso(datetime.fromisoformat(from_date))
    if to_date:
        params["end_date"] = _iso(datetime.fromisoformat(to_date))
    r = _get("/v1/payments/search", params)
    return {"found": r.get("paging", {}).get("total"),
            "payments": [_summarize(p) for p in r.get("results", [])]}


def get_payment(id):
    """The detail of one payment."""
    return _summarize(_get(f"/v1/payments/{id}"))


def pending_payments(days=30):
    """What's still pending or rejected and hasn't come in yet."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=int(days or 30))
    out = []
    for status in ("pending", "in_process", "rejected"):
        r = _get("/v1/payments/search", {
            "begin_date": _iso(start), "end_date": _iso(end),
            "status": status, "limit": 50, "sort": "date_created", "criteria": "desc"})
        out += [_summarize(p) for p in r.get("results", [])]
    return {"from_date": start.date().isoformat(), "pending": len(out), "payments": out}


def create_payment_link(title, amount, currency="UYU", reference=None):
    """Generates a link to charge someone."""
    pref = _post("/checkout/preferences", {
        "items": [{"title": title, "quantity": 1,
                   "unit_price": float(amount), "currency_id": currency}],
        "external_reference": reference,
    })
    return {"link": pref.get("init_point"), "id": pref.get("id"),
            "title": title, "amount": _money(amount, currency)}


def refund_payment(id, amount=None):
    """Refunds a payment, in full or in part.

    Without `amount` it refunds everything — that's how the API defines it:
    the field is optional and its absence means a full refund.

    The idempotency key is derived from the payment and the amount: if the
    agent retries the SAME refund, Mercado Pago recognizes it and doesn't
    duplicate it. To genuinely refund a partial amount twice, the amount has
    to change — which is exactly the friction we want.
    """
    # Check BEFORE refunding, don't rely on idempotency alone. Learned from
    # demoda's integration, which has been in production for years: a
    # payment that's already refunded gets answered without touching
    # anything. Idempotency protects against the identical retry; this
    # protects against the repeated order given by hand.
    current = _get(f"/v1/payments/{id}")
    if current.get("status") == "refunded":
        return {"ok": True, "already_refunded": True, "for_payment": id,
                "note": "Ese cobro ya figuraba devuelto: no hice nada."}

    key = f"tuagente-refund-{id}-{amount or 'total'}"
    r = _post(f"/v1/payments/{id}/refunds",
              {"amount": float(amount)} if amount else {},
              idempotency_key=key)
    return {"ok": True, "refund": r.get("id"), "amount": _money(r.get("amount")),
            "for_payment": id}


# ── Webhooks ──────────────────────────────────────────────────────────────────

def verify_signature(x_signature, x_request_id, data_id, secret):
    """Validates that the notification actually came from Mercado Pago.

    The header arrives as `ts=1704908010,v1=<hmac>`. The manifest that gets
    signed is `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` and the hash
    is HMAC-SHA256 with the application's secret key.

    Without this, anyone who knows the URL can tell you that you got paid.
    """
    if not (x_signature and secret):
        return False
    parts = dict(x.split("=", 1) for x in x_signature.split(",") if "=" in x)
    ts, v1 = parts.get("ts"), parts.get("v1")
    if not (ts and v1):
        return False
    manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
    expected = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


def process_notification(body, x_signature=None, x_request_id=None):
    """What to do when a webhook arrives.

    TWO RULES THAT AREN'T IN THE DOCS AND ARE IN DEMODA'S CODE:

    1. **The notification is NOT the data, it's the trigger.** It carries an
       id and nothing more trustworthy than that: the status gets fetched
       from the API. Trusting the webhook's `status` is trusting something a
       stranger sent you.
    2. **Filter explicitly** by action and type. What we don't recognize gets
       ignored, and says so, instead of trying to interpret it.

    And the third rule, from the docs: you have to answer 200 in under 22
    seconds or Mercado Pago retries every 15 minutes. That's why this does no
    heavy work: it looks up who paid and returns.
    """
    secret = os.environ.get("MP_WEBHOOK_SECRET", "")
    data_id = str(((body or {}).get("data") or {}).get("id") or "")
    if secret and not verify_signature(x_signature, x_request_id, data_id, secret):
        return {"ok": False, "error": "invalid signature: the notification is not from Mercado Pago"}
    if not secret:
        log("MP_WEBHOOK_SECRET is empty: cannot verify the signature")

    action, kind = (body or {}).get("action"), (body or {}).get("type")
    if kind != "payment" or action not in ("payment.created", "payment.updated"):
        return {"ok": True, "ignored": True, "reason": f"not processing it: type={kind} action={action}"}
    if not data_id:
        return {"ok": False, "error": "the notification carries no data.id"}
    return {"ok": True, "payment": _summarize(_get(f"/v1/payments/{data_id}"))}


TOOLS = {
    "payments_for_period": (payments_for_period, "How much came in between two dates, with the breakdown by payment method.",
        {"from_date": "ISO date, optional (defaults to 30 days ago)", "to_date": "ISO date, optional (defaults to today)"}),
    "search_payments": (search_payments, "Search payments by status, date or reference.",
        {"status": "cobrado | pendiente | rechazado | devuelto", "from_date": "ISO date", "to_date": "ISO date",
         "reference": "your external reference", "limit": "up to 50"}),
    "get_payment": (get_payment, "The detail of one payment.", {"id": "payment id"}),
    "pending_payments": (pending_payments, "What's still pending or rejected and hasn't come in yet.",
        {"days": "how many days back to look (default 30)"}),
    "create_payment_link": (create_payment_link, "Generates a link to charge someone.",
        {"title": "what's being charged for", "amount": "number", "currency": "UYU by default",
         "reference": "your reference, optional"}),
    "refund_payment": (refund_payment, "Refunds a payment, in full or in part. Takes money out of the account.",
        {"id": "payment id", "amount": "optional; without this it refunds everything"}),
}


def schemas():
    return [{
        "name": n,
        "description": d,
        "inputSchema": {
            "type": "object",
            "properties": {k: {"type": "string", "description": v} for k, v in props.items()},
            "required": ["id"] if n in ("get_payment", "refund_payment")
                        else (["title", "amount"] if n == "create_payment_link" else []),
        },
    } for n, (_, d, props) in TOOLS.items()]


def main():
    if not TOKEN:
        log("missing MP_ACCESS_TOKEN")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        resp = {"jsonrpc": "2.0", "id": mid}

        if method == "initialize":
            resp["result"] = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                              "serverInfo": {"name": "mercadopago", "version": "1.0.0"}}
        elif method == "tools/list":
            resp["result"] = {"tools": schemas()}
        elif method == "tools/call":
            p = msg.get("params") or {}
            fn = TOOLS.get(p.get("name", ""), (None,))[0]
            if fn is None:
                resp["result"] = {"content": [{"type": "text", "text": "no conozco esa herramienta"}],
                                  "isError": True}
            else:
                try:
                    out = fn(**(p.get("arguments") or {}))
                    resp["result"] = {"content": [{"type": "text",
                                                   "text": json.dumps(out, ensure_ascii=False, indent=2)}]}
                except urllib.error.HTTPError as e:
                    # MP's own error is passed through as-is: "invalid access token"
                    # tells the agent the connection is broken, not that the
                    # client's request failed. Those are two different things.
                    body = e.read().decode("utf-8", "replace")[:400]
                    resp["result"] = {"content": [{"type": "text",
                        "text": f"Mercado Pago devolvió {e.code}: {body}"}], "isError": True}
                except Exception as e:  # noqa: BLE001 — the server must never go down
                    resp["result"] = {"content": [{"type": "text", "text": f"error: {e}"}],
                                      "isError": True}
        elif method and method.startswith("notifications/"):
            continue
        else:
            resp["result"] = {}
        print(json.dumps(resp, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
