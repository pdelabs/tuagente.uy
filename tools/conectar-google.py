#!/usr/bin/env python3
"""Conecta la cuenta de Google de un cliente pidiendo SOLO los permisos justos.

Por que existe: el setup.py del motor (v2026.7.30) tiene los scopes
hardcodeados e incluye Gmail completo (leer/mandar/borrar). Mostrarle esa
pantalla a un cliente es regalarle un susto y pedirle permisos que no usamos.
Esta herramienta hace el mismo flujo (Desktop app + PKCE, redirect a
localhost:1) pero con los scopes que el alta pida, y escribe el token en el
formato authorized_user que el motor refresca solo. El --check del motor va a
decir "AUTHENTICATED (partial)": es lo esperado y esta bien.

Uso (operador, no el agente):
    # 1. Generar el link para el cliente
    python3 conectar-google.py --secret google_client_secret.json \
        --scopes drive.readonly --salida google_token.json --url

    # 2. El cliente entra, acepta, y el browser "falla" en localhost:1 —
    #    copiar la URL entera de la barra y volver con ella:
    python3 conectar-google.py --secret google_client_secret.json \
        --salida google_token.json --code "http://localhost:1/?code=..."
"""
import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

AUTH = "https://accounts.google.com/o/oauth2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
REDIRECT = "http://localhost:1"
BASE = "https://www.googleapis.com/auth/"


def fallo(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    return 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--secret", required=True)
    ap.add_argument("--salida", required=True, help="donde escribir google_token.json")
    ap.add_argument("--scopes", default="drive.readonly",
                    help="cortos separados por coma: drive.readonly,spreadsheets,calendar")
    ap.add_argument("--url", action="store_true")
    ap.add_argument("--code", default="")
    args = ap.parse_args()

    cs = json.loads(Path(args.secret).read_text())["installed"]
    salida = Path(args.salida)
    pendiente = salida.with_suffix(".pendiente.json")
    scopes = [s if s.startswith("http") else BASE + s.strip()
              for s in args.scopes.split(",") if s.strip()]

    if args.url:
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        q = {
            "response_type": "code",
            "client_id": cs["client_id"],
            "redirect_uri": REDIRECT,
            "scope": " ".join(scopes),
            "state": secrets.token_urlsafe(16),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
        }
        pendiente.write_text(json.dumps({"verifier": verifier, "scopes": scopes}))
        print(json.dumps({
            "ok": True,
            "auth_url": f"{AUTH}?{urllib.parse.urlencode(q)}",
            "nota": "El browser va a 'fallar' en localhost:1 despues de aceptar: "
                    "es lo esperado. Copiar la URL entera de la barra y correr --code.",
        }, ensure_ascii=False))
        return 0

    if args.code:
        if not pendiente.is_file():
            return fallo("no hay un pedido pendiente: corre --url primero")
        pend = json.loads(pendiente.read_text())
        code = args.code
        if code.startswith("http"):
            code = urllib.parse.parse_qs(urllib.parse.urlparse(code).query).get("code", [""])[0]
        if not code:
            return fallo("no encontre ?code= en lo que pegaste")

        cuerpo = urllib.parse.urlencode({
            "code": code,
            "client_id": cs["client_id"],
            "client_secret": cs["client_secret"],
            "redirect_uri": REDIRECT,
            "grant_type": "authorization_code",
            "code_verifier": pend["verifier"],
        }).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(TOKEN, data=cuerpo), timeout=30) as r:
                tk = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return fallo(f"Google respondio {e.code}: {e.read().decode()[:300]}")

        if "refresh_token" not in tk:
            return fallo("Google no devolvio refresh_token (¿código ya usado? corre --url de nuevo)")

        expiry = datetime.now(timezone.utc) + timedelta(seconds=tk.get("expires_in", 3600))
        # Formato authorized_user: es el que google-auth (y el setup.py del
        # motor) carga y refresca sin intervencion.
        salida.write_text(json.dumps({
            "type": "authorized_user",
            "token": tk["access_token"],
            "refresh_token": tk["refresh_token"],
            "token_uri": TOKEN,
            "client_id": cs["client_id"],
            "client_secret": cs["client_secret"],
            "scopes": tk.get("scope", " ".join(pend["scopes"])).split(),
            "universe_domain": "googleapis.com",
            "account": "",
            "expiry": expiry.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }, indent=2))
        pendiente.unlink(missing_ok=True)
        print(json.dumps({"ok": True, "token": str(salida),
                          "scopes": pend["scopes"]}, ensure_ascii=False))
        return 0

    return fallo("falta --url o --code")


if __name__ == "__main__":
    sys.exit(main())
