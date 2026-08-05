#!/usr/bin/env python3
"""Chequeo de conformidad: ¿este agente Hermes está listo para el portal?

Se corre contra un agente ya desplegado y verifica el contrato completo, sin
escribir nada. Sirve para dar de alta un cliente nuevo sin sorpresas.

    python3 tools/portal-check.py --key <API_SERVER_KEY> \
        [--adapter http://localhost:8643] [--endpoint http://localhost:8642] \
        [--origin http://localhost:8090]

Exit 0 = cumple. Exit 1 = hay fallas (se listan al final).
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

OK, FAIL, WARN = "OK  ", "FALLA", "aviso"
results = []


def check(name, fn, required=True):
    """Corre una verificación y registra el resultado sin cortar el chequeo."""
    try:
        detail = fn()
        results.append((OK, name, detail or ""))
        return True
    except Exception as exc:  # noqa: BLE001 — queremos reportar cualquier falla
        results.append((FAIL if required else WARN, name, str(exc)[:160]))
        return False


def http(url, key=None, origin=None, method="GET", expect=200):
    req = urllib.request.Request(url, method=method)
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    if origin:
        req.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            body, status, hdrs = res.read(), res.status, dict(res.headers)
    except urllib.error.HTTPError as exc:
        body, status, hdrs = exc.read(), exc.code, dict(exc.headers)
    if status != expect:
        raise AssertionError(f"esperaba {expect}, respondió {status}")
    return body, hdrs


def jget(url, key, origin=None):
    body, hdrs = http(url, key, origin)
    return json.loads(body), hdrs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--adapter", default="http://localhost:8643")
    ap.add_argument("--endpoint", default="http://localhost:8642")
    ap.add_argument("--origin", default="http://localhost:8090")
    args = ap.parse_args()
    A, E, K, O = args.adapter.rstrip("/"), args.endpoint.rstrip("/"), args.key, args.origin

    manifest = {}

    def _manifest():
        nonlocal manifest
        manifest, _ = jget(f"{A}/portal/manifest", K)
        faltan = [k for k in ("agent", "portal_plugin", "modules") if k not in manifest]
        if faltan:
            raise AssertionError(f"al manifiesto le faltan claves: {faltan}")
        if not str(manifest["agent"]).strip():
            raise AssertionError("el agente no tiene nombre (AGENT_NAME)")
        return f"{manifest['agent']} · {manifest['portal_plugin']}"

    check("Manifiesto", _manifest)
    if not manifest:
        print("No pude leer el manifiesto: sin eso el portal no arranca.")
        return 1
    mods = manifest.get("modules", {})

    # Auth y CORS: un portal sin esto no funciona en el browser aunque curl ande.
    check("Rechaza sin credenciales", lambda: (
        http(f"{A}/portal/manifest", None, expect=401), "401")[1])
    check("CORS del adapter", lambda: (
        jget(f"{A}/portal/manifest", K, O)[1].get("Access-Control-Allow-Origin") == O
        or (_ for _ in ()).throw(AssertionError(f"no refleja el origen {O}")),
        "refleja el origen")[1])
    check("CORS del gateway", lambda: (
        http(f"{E}/api/jobs?include_disabled=true", K, O)[1].get("Access-Control-Allow-Origin") == O
        or (_ for _ in ()).throw(AssertionError(f"no refleja el origen {O}")),
        "refleja el origen")[1])

    # Cada módulo declarado tiene que responder de verdad.
    def modcheck(nombre, url, valida):
        if not mods.get(nombre):
            results.append((WARN, f"Módulo {nombre}", "no declarado — la pestaña no se muestra"))
            return
        check(f"Módulo {nombre}", lambda: valida(*jget(url, K)))

    modcheck("kanban", f"{A}/portal/tickets",
             lambda d, h: f"{len(d['tickets'])} tickets")
    modcheck("approvals", f"{A}/portal/approvals",
             lambda d, h: f"{len(d['approvals'])} pendientes")
    modcheck("artifacts", f"{A}/portal/artifacts",
             lambda d, h: f"{len(d['artifacts'])} artefactos")
    modcheck("activity", f"{A}/portal/activity",
             lambda d, h: f"{len(d['events'])} eventos")
    modcheck("usage", f"{A}/portal/usage",
             lambda d, h: ("sin datos aún" if not d.get("available")
                           else f"USD {d.get('cost_usd', 0):.2f} en {d.get('period')}"))
    modcheck("crons", f"{E}/api/jobs?include_disabled=true",
             lambda d, h: f"{len(d['jobs'])} tareas (incluye pausadas)")

    # Archivos: además del listado, el contenido NUNCA debe servirse como html.
    if mods.get("files"):
        def _files():
            data, _ = jget(f"{A}/portal/files", K)
            files = data["files"]
            if files:
                _, hdrs = http(f"{A}/portal/files/{files[0]['path']}", K)
                ctype = hdrs.get("Content-Type", "")
                if "text/plain" not in ctype:
                    raise AssertionError(f"sirve archivos como {ctype!r}, tiene que ser text/plain")
            return f"{len(files)} archivos"
        check("Módulo files", _files)
    else:
        results.append((WARN, "Módulo files", "no declarado"))

    # El chat es el corazón: si el stream de sesiones no pasa por el adapter,
    # el browser lo descarta por CORS (el gateway no manda la cabecera).
    check("Proxy de chat en el adapter", lambda: (
        http(f"{A}/portal/sessions/no-existe/chat/stream", K, method="POST", expect=400),
        "responde (valida el cuerpo)")[1], required=False)
    check("Sesiones del agente", lambda: (
        f"{len(jget(f'{E}/api/sessions', K)[0]['data'])} conversaciones"))

    # Convenciones del workspace que hacen usable la pestaña Archivos.
    def _entregables():
        """En un agente nuevo esto no es un sintoma: todavia no produjo nada.

        El listado devuelve archivos, no carpetas, asi que una carpeta vacia no
        aparece. Antes esto avisaba "¿el agente tiene la skill entregable?" en
        cada alta, que es una falsa alarma y entrena a ignorar los avisos.
        """
        archivos = jget(f"{A}/portal/files", K)[0]["files"]
        if any(f["path"].startswith("entregables/") for f in archivos):
            return "entregables/ presente"
        if not archivos:
            return "agente nuevo: todavia no escribio nada (esperable)"
        raise AssertionError(
            "hay archivos pero ninguno en entregables/ — ¿el agente esta usando "
            "la skill entregable o elige rutas por su cuenta?"
        )

    check("Convención de entregables", _entregables, required=False)

    print(f"\nAgente: {manifest.get('agent')} — {manifest.get('portal_plugin')}\n")
    for estado, nombre, detalle in results:
        print(f"  [{estado}] {nombre}" + (f" — {detalle}" if detalle else ""))
    fallas = [r for r in results if r[0] == FAIL]
    avisos = [r for r in results if r[0] == WARN]
    print(f"\n{len(results) - len(fallas) - len(avisos)} ok · {len(avisos)} avisos · {len(fallas)} fallas")
    if fallas:
        print("\nNo está listo para el portal. Arreglar:")
        for _, nombre, detalle in fallas:
            print(f"  · {nombre}: {detalle}")
        return 1
    print("\nCumple el contrato del portal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
