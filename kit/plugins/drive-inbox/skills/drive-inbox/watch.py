#!/usr/bin/env python3
"""Watch Google Drive folders and download new videos/audios.

Meant to run from an agent cron: the script does ALL the mechanical work
(listing, comparing against what was already seen, downloading) and returns a
JSON with what's new. If there's nothing new, the agent has nothing to think
about: `new: []`.

- Token: the authorized_user of the Google connection (drive.readonly is enough).
- State: remembers which files it already processed in a JSON next to the
  workspace, so it never downloads the same interview twice.
- Only downloads allow-listed types (video/audio): a shared folder can have
  anything in it.

Usage:
    python3 watch.py --folder <folder_id> [--folder <other_id>] \
        [--token /opt/data/google_token.json] \
        [--dest /opt/data/workspace/entrada] [--list-only]
"""
import argparse
import json
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://www.googleapis.com/drive/v3"
TOKEN_URI = "https://oauth2.googleapis.com/token"
MIMES = ("video/", "audio/")
MAX_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB: more than that is not an interview


def _token(path: Path) -> str:
    """Return a valid access token, refreshing it if needed."""
    d = json.loads(path.read_text())
    exp = d.get("expiry", "1970-01-01T00:00:00Z")
    if time.strptime(exp, "%Y-%m-%dT%H:%M:%SZ") > time.gmtime(time.time() + 60):
        return d["token"]
    body = urllib.parse.urlencode({
        "client_id": d["client_id"],
        "client_secret": d["client_secret"],
        "refresh_token": d["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URI, data=body), timeout=30) as r:
        fresh = json.loads(r.read().decode())
    d["token"] = fresh["access_token"]
    d["expiry"] = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                time.gmtime(time.time() + fresh.get("expires_in", 3600)))
    path.write_text(json.dumps(d, indent=2))
    return d["token"]


def _api(tk: str, path: str, **params) -> dict:
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tk}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _download(tk: str, file_id: str, dest: Path):
    req = urllib.request.Request(
        f"{API}/files/{file_id}?alt=media",
        headers={"Authorization": f"Bearer {tk}"},
    )
    # Long interviews: the download can take a while; the timeout is per idle
    # socket, not total.
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f, length=1024 * 1024)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", action="append", required=True, dest="folders")
    ap.add_argument("--token", default="/opt/data/google_token.json")
    ap.add_argument("--dest", default="/opt/data/workspace/entrada")
    ap.add_argument("--state", default="",
                    help="default: <dest>/.drive-seen.json")
    ap.add_argument("--list-only", action="store_true")
    args = ap.parse_args()

    token_path = Path(args.token)
    if not token_path.is_file():
        print(json.dumps({"ok": False, "error":
                          "no hay token de Google: falta hacer la conexion"}, ensure_ascii=False))
        return 2
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    state_path = Path(args.state) if args.state else dest / ".drive-seen.json"
    seen = json.loads(state_path.read_text()) if state_path.is_file() else {}

    try:
        tk = _token(token_path)
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError) as e:
        print(json.dumps({"ok": False, "error": f"no pude refrescar el token: {e}"},
                         ensure_ascii=False))
        return 2

    new, errors = [], []
    for folder in args.folders:
        try:
            r = _api(tk, "files",
                     q=f"'{folder}' in parents and trashed=false",
                     fields="files(id,name,mimeType,size,modifiedTime)",
                     pageSize=100,
                     supportsAllDrives="true",
                     includeItemsFromAllDrives="true")
        except urllib.error.HTTPError as e:
            errors.append(f"carpeta {folder}: HTTP {e.code}")
            continue
        for f in r.get("files", []):
            if f["id"] in seen or not f["mimeType"].startswith(MIMES):
                continue
            if int(f.get("size", 0)) > MAX_BYTES:
                errors.append(f"{f['name']}: demasiado grande, salteado")
                seen[f["id"]] = f["name"]
                continue
            entry = {"id": f["id"], "name": f["name"], "folder": folder,
                     "modified": f.get("modifiedTime")}
            if not args.list_only:
                local = dest / f["name"].replace("/", "_")
                try:
                    _download(tk, f["id"], local)
                except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
                    errors.append(f"{f['name']}: fallo la descarga: {e}")
                    local.unlink(missing_ok=True)
                    continue
                entry["file"] = str(local)
            seen[f["id"]] = f["name"]
            new.append(entry)

    if not args.list_only:
        state_path.write_text(json.dumps(seen, ensure_ascii=False, indent=1))

    print(json.dumps({"ok": True, "new": new, "errors": errors,
                      "note": "" if new else "nada nuevo: no hay que hacer nada"},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
