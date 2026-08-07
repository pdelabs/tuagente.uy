#!/usr/bin/env python3
"""Vigila carpetas de Google Drive y baja los videos/audios nuevos.

Pensado para correr desde un cron del agente: el script hace TODO el trabajo
mecanico (listar, comparar contra lo ya visto, bajar) y devuelve un JSON con
lo nuevo. Si no hay nada nuevo, el agente no tiene que pensar: `nuevos: []`.

- Token: el authorized_user de la conexion Google (drive.readonly alcanza).
- Estado: recuerda que archivos ya proceso en un JSON al lado del workspace,
  para no bajar dos veces la misma entrevista.
- Solo baja tipos de la lista blanca (video/audio): una carpeta compartida
  puede tener cualquier cosa adentro.

Uso:
    python3 vigilar.py --carpeta <folder_id> [--carpeta <otro_id>] \
        [--token /opt/data/google_token.json] \
        [--destino /opt/data/workspace/entrada] [--listar-solo]
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
MAX_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB: mas que eso no es una entrevista


def _token(ruta: Path) -> str:
    """Devuelve un access token vigente, refrescando si hace falta."""
    d = json.loads(ruta.read_text())
    exp = d.get("expiry", "1970-01-01T00:00:00Z")
    if time.strptime(exp, "%Y-%m-%dT%H:%M:%SZ") > time.gmtime(time.time() + 60):
        return d["token"]
    cuerpo = urllib.parse.urlencode({
        "client_id": d["client_id"],
        "client_secret": d["client_secret"],
        "refresh_token": d["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URI, data=cuerpo), timeout=30) as r:
        nuevo = json.loads(r.read().decode())
    d["token"] = nuevo["access_token"]
    d["expiry"] = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                time.gmtime(time.time() + nuevo.get("expires_in", 3600)))
    ruta.write_text(json.dumps(d, indent=2))
    return d["token"]


def _api(tk: str, path: str, **params) -> dict:
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tk}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _bajar(tk: str, file_id: str, destino: Path):
    req = urllib.request.Request(
        f"{API}/files/{file_id}?alt=media",
        headers={"Authorization": f"Bearer {tk}"},
    )
    # Entrevistas largas: la descarga puede tardar; el timeout es por socket
    # inactivo, no total.
    with urllib.request.urlopen(req, timeout=120) as r, destino.open("wb") as f:
        shutil.copyfileobj(r, f, length=1024 * 1024)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--carpeta", action="append", required=True, dest="carpetas")
    ap.add_argument("--token", default="/opt/data/google_token.json")
    ap.add_argument("--destino", default="/opt/data/workspace/entrada")
    ap.add_argument("--estado", default="",
                    help="default: <destino>/.drive-visto.json")
    ap.add_argument("--listar-solo", action="store_true")
    args = ap.parse_args()

    ruta_token = Path(args.token)
    if not ruta_token.is_file():
        print(json.dumps({"ok": False, "error":
                          "no hay token de Google: falta hacer la conexion"}, ensure_ascii=False))
        return 2
    destino = Path(args.destino)
    destino.mkdir(parents=True, exist_ok=True)
    estado_ruta = Path(args.estado) if args.estado else destino / ".drive-visto.json"
    vistos = json.loads(estado_ruta.read_text()) if estado_ruta.is_file() else {}

    try:
        tk = _token(ruta_token)
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError) as e:
        print(json.dumps({"ok": False, "error": f"no pude refrescar el token: {e}"},
                         ensure_ascii=False))
        return 2

    nuevos, errores = [], []
    for carpeta in args.carpetas:
        try:
            r = _api(tk, "files",
                     q=f"'{carpeta}' in parents and trashed=false",
                     fields="files(id,name,mimeType,size,modifiedTime)",
                     pageSize=100,
                     supportsAllDrives="true",
                     includeItemsFromAllDrives="true")
        except urllib.error.HTTPError as e:
            errores.append(f"carpeta {carpeta}: HTTP {e.code}")
            continue
        for f in r.get("files", []):
            if f["id"] in vistos or not f["mimeType"].startswith(MIMES):
                continue
            if int(f.get("size", 0)) > MAX_BYTES:
                errores.append(f"{f['name']}: demasiado grande, salteado")
                vistos[f["id"]] = f["name"]
                continue
            entrada = {"id": f["id"], "nombre": f["name"], "carpeta": carpeta,
                       "modificado": f.get("modifiedTime")}
            if not args.listar_solo:
                local = destino / f["name"].replace("/", "_")
                try:
                    _bajar(tk, f["id"], local)
                except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
                    errores.append(f"{f['name']}: fallo la descarga: {e}")
                    local.unlink(missing_ok=True)
                    continue
                entrada["archivo"] = str(local)
            vistos[f["id"]] = f["name"]
            nuevos.append(entrada)

    if not args.listar_solo:
        estado_ruta.write_text(json.dumps(vistos, ensure_ascii=False, indent=1))

    print(json.dumps({"ok": True, "nuevos": nuevos, "errores": errores,
                      "nota": "" if nuevos else "nada nuevo: no hay que hacer nada"},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
