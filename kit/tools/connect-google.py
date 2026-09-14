#!/usr/bin/env python3
"""Connects a client's Google account, asking for ONLY the exact permissions needed.

Why it exists: the engine's setup.py (v2026.7.30) has its scopes hardcoded and
includes full Gmail (read/send/delete). Showing that screen to a client is
handing them a scare and asking for permissions we don't use. This tool does
the same flow (Desktop app + PKCE, redirect to localhost:1) but with the
scopes the onboarding asks for, and writes the token in the authorized_user
format the engine refreshes on its own. The engine's --check is going to say
"AUTHENTICATED (partial)": that's expected and fine.

Usage (operator, not the agent):
    # 1. Generate the link for the client
    python3 connect-google.py --secret google_client_secret.json \
        --scopes drive.readonly --output google_token.json --url

    # 2. The client goes in, accepts, and the browser "fails" at localhost:1 —
    #    copy the whole URL from the address bar and come back with it:
    python3 connect-google.py --secret google_client_secret.json \
        --output google_token.json --code "http://localhost:1/?code=..."
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


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    return 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--secret", required=True)
    ap.add_argument("--output", required=True, help="where to write google_token.json")
    ap.add_argument("--scopes", default="drive.readonly",
                    help="short names, comma-separated: drive.readonly,spreadsheets,calendar")
    ap.add_argument("--url", action="store_true")
    ap.add_argument("--code", default="")
    args = ap.parse_args()

    cs = json.loads(Path(args.secret).read_text())["installed"]
    output = Path(args.output)
    pending = output.with_suffix(".pending.json")
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
        pending.write_text(json.dumps({"verifier": verifier, "scopes": scopes}))
        print(json.dumps({
            "ok": True,
            "auth_url": f"{AUTH}?{urllib.parse.urlencode(q)}",
            "note": "The browser is going to 'fail' at localhost:1 after accepting: "
                    "that's expected. Copy the whole URL from the address bar and run --code.",
        }, ensure_ascii=False))
        return 0

    if args.code:
        if not pending.is_file():
            return fail("no pending request: run --url first")
        pend = json.loads(pending.read_text())
        code = args.code
        if code.startswith("http"):
            code = urllib.parse.parse_qs(urllib.parse.urlparse(code).query).get("code", [""])[0]
        if not code:
            return fail("couldn't find ?code= in what you pasted")

        body = urllib.parse.urlencode({
            "code": code,
            "client_id": cs["client_id"],
            "client_secret": cs["client_secret"],
            "redirect_uri": REDIRECT,
            "grant_type": "authorization_code",
            "code_verifier": pend["verifier"],
        }).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(TOKEN, data=body), timeout=30) as r:
                tk = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return fail(f"Google answered {e.code}: {e.read().decode()[:300]}")

        if "refresh_token" not in tk:
            return fail("Google didn't return a refresh_token (code already used? run --url again)")

        expiry = datetime.now(timezone.utc) + timedelta(seconds=tk.get("expires_in", 3600))
        # authorized_user format: it's the one google-auth (and the engine's
        # setup.py) loads and refreshes with no intervention.
        output.write_text(json.dumps({
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
        pending.unlink(missing_ok=True)
        print(json.dumps({"ok": True, "token": str(output),
                          "scopes": pend["scopes"]}, ensure_ascii=False))
        return 0

    return fail("missing --url or --code")


if __name__ == "__main__":
    sys.exit(main())
