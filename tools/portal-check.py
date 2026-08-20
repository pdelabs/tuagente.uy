#!/usr/bin/env python3
"""Chequeo de conformidad: ¿este agente Hermes está listo para el portal?

Se corre contra un agente ya desplegado y verifica el contrato completo, sin
escribir nada. Sirve para dar de alta un cliente nuevo sin sorpresas.

    python3 tools/portal-check.py --key <API_SERVER_KEY> \
        [--adapter http://localhost:8643] [--endpoint http://localhost:8642] \
        [--origin http://localhost:8090] [--intentos 3]

CADA CHEQUEO SE CORRE VARIAS VECES, y no es paranoia: el 12/8/2026, en el lab,
`GET /api/sessions` se puso a devolver 500 de forma intermitente —14 de 20
pedidos— y este chequeo, que pegaba UNA sola vez, daba verde 3 de cada 10
corridas. Un chequeo que es verde el 30% del tiempo es peor que no tenerlo:
certifica justo lo que no miró. Ahora un endpoint que falla aunque sea un
intento es FALLA, y el mensaje dice la tasa.

Exit 0 = cumple. Exit 1 = hay fallas (se listan al final).
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

OK, FAIL, WARN = "OK  ", "FALLA", "aviso"
results = []
INTENTOS = 3


def check(name, fn, required=True):
    """Corre una verificación N veces y registra el resultado.

    N veces y no una: ver la nota de arriba. La regla es tajante a propósito —
    un endpoint que anda 2 de cada 3 veces NO está listo para el portal, porque
    en la tercera el cliente ve "No pude hablar con tu agente" y manda a buscar
    el bug al portal, que no tiene nada que ver.

    Los intentos van seguidos y sin espera: el modo de falla que buscamos
    aparece bajo pedidos consecutivos, no después de una pausa. Con el agente
    caído esto no se vuelve eterno: el chequeo del manifiesto es el primero y,
    si no responde, main() corta ahí.
    """
    detalle, fallos = "", []
    for _ in range(INTENTOS):
        try:
            detalle = fn() or detalle
        except Exception as exc:  # noqa: BLE001 — queremos reportar cualquier falla
            # 300 y no 120: el corte se comía justo la parte útil —el comando
            # para arreglarlo va al final del mensaje—, y una falla que dice el
            # síntoma sin decir qué hacer manda a adivinar.
            fallos.append(str(exc)[:300])
    if not fallos:
        results.append((OK, name, detalle))
        return True
    if len(fallos) < INTENTOS:
        # Lo peor que puede pasar es que esto pase por un tropiezo y quede en
        # verde: se dice la tasa y el primer error, que es lo que hace falta
        # para saber si es la red o es el agente.
        tasa = f"INTERMITENTE — falló {len(fallos)} de {INTENTOS} intentos"
    else:
        tasa = f"falló los {INTENTOS} intentos"
    results.append((FAIL if required else WARN, name, f"{tasa}: {fallos[0]}"))
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
    global INTENTOS
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--adapter", default="http://localhost:8643")
    ap.add_argument("--endpoint", default="http://localhost:8642")
    ap.add_argument("--origin", default="http://localhost:8090")
    ap.add_argument(
        "--entrega", action="store_true",
        help="además del contrato, exige que el agente esté EN CERO: es el "
             "chequeo del último paso de un alta, antes de mandar el link")
    ap.add_argument(
        "--intentos", type=int, default=INTENTOS, metavar="N",
        help=f"veces que se corre CADA chequeo (por defecto {INTENTOS}). Subilo "
             "cuando sospeches algo intermitente: con 10 se ve la tasa real "
             "sin adivinar")
    args = ap.parse_args()
    if args.intentos < 1:
        ap.error("--intentos tiene que ser 1 o más")
    INTENTOS = args.intentos
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

    # El alias en español de la misma ruta. Es un aviso y no una falla: un
    # agente instalado antes del adapter 0.37 cumple el contrato igual —el
    # portal pide `/portal/manifest`—, pero quien depure a mano contra ese
    # agente se va a comer el `404 {"error":"not found"}` de `/portal/manifiesto`
    # y va a creer que el manifiesto no existe.
    check("Alias /portal/manifiesto", lambda: (
        jget(f"{A}/portal/manifiesto", K)[0].get("agent") == manifest.get("agent")
        or (_ for _ in ()).throw(AssertionError("responde otra cosa que /portal/manifest")),
        "el alias en español devuelve lo mismo")[1], required=False)

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

    # LAS DOS ESCRITURAS DEL LOOPBACK. Para el browser `http://localhost:8090` y
    # `http://127.0.0.1:8090` son orígenes DISTINTOS: si la lista trae uno solo,
    # este chequeo pasa con el que le pasaste y el cliente ve "No pude hablar con
    # tu agente" al abrir el otro. curl no lo agarra nunca —no manda `Origin`—,
    # así que es el "anda por curl y no anda en el navegador" clásico.
    # Solo aplica si el origen es loopback: contra un portal de verdad
    # (app.tuagente.uy) no hay gemelo que mirar y el chequeo no corre.
    gemelo = None
    if "//localhost:" in O:
        gemelo = O.replace("//localhost:", "//127.0.0.1:")
    elif "//127.0.0.1:" in O:
        gemelo = O.replace("//127.0.0.1:", "//localhost:")
    if gemelo:
        def _gemelo(url, quien):
            def fn():
                got = http(url, K, gemelo)[1].get("Access-Control-Allow-Origin")
                if got != gemelo:
                    raise AssertionError(
                        f"acepta {O} pero no {gemelo} — agregá los DOS a "
                        f"{quien} en el compose y reiniciá")
                return f"también refleja {gemelo}"
            return fn
        check("CORS del adapter (la otra escritura del loopback)",
              _gemelo(f"{A}/portal/manifest", "PORTAL_CORS_ORIGINS"))
        check("CORS del gateway (la otra escritura del loopback)",
              _gemelo(f"{E}/api/jobs?include_disabled=true", "API_SERVER_CORS_ORIGINS"))

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
    def _roles_ok(d, h):
        # The team is the product now: a declared roles module must serve the
        # offer, and every hired role must be reachable through the multiplex
        # with its own key -- which only the adapter can verify, so here we at
        # least assert the roster's shape and that hired roles carry identity.
        if not d.get("available"):
            raise AssertionError("declarado pero available=false")
        roles = d.get("roles") or []
        if not roles:
            raise AssertionError("el catálogo de la oferta está vacío")
        contratados = [r for r in roles if r.get("contratado") or r.get("hired")]
        sin_cara = [r["id"] for r in roles if not (r.get("name") and r.get("look"))]
        if sin_cara:
            raise AssertionError(f"roles sin identidad (name/look): {sin_cara}")
        pendientes = [r["id"] for r in roles if r.get("pedido") and r not in contratados]
        extra = f", {len(pendientes)} en camino" if pendientes else ""
        return f"{len(roles)} en oferta, {len(contratados)} contratados{extra}"
    modcheck("roles", f"{A}/portal/roles", _roles_ok)
    modcheck("activity", f"{A}/portal/activity",
             lambda d, h: f"{len(d['events'])} eventos")
    def _uso_ok(d, h):
        # Declarado y roto NO es "anda": si el manifiesto promete el modulo, el
        # numero tiene que venir. Y un total ausente se dice, no se inventa un 0.
        if not d.get("disponible"):
            raise AssertionError("declarado pero el proveedor no contesta: " + str(d.get("motivo")))
        total = d.get("total_usd")
        return ("USD — (el proveedor no informo el total)" if total is None
                else f"USD {total:.4f} cobrados a esta clave")
    modcheck("usage", f"{A}/portal/uso", _uso_ok)
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

    # --- el agente que se entrega arranca en cero ---
    #
    # No es cosmético: el primer día es cuando el cliente decide qué es esto.
    # Si abre su portal y encuentra una conversación nuestra —la de la
    # verificación—, lo primero que aprende es que su agente ya venía usado. Verificar ensucia por definición (el circuito
    # que vende el producto es hablarle, pedirle un artefacto y aprobarle algo),
    # así que lo que no puede depender de la memoria de nadie es LIMPIARLO
    # después: esto es lo que se planta si no se hizo, con el comando al lado.
    #
    # Solo con --entrega: contra un agente en producción, tener conversaciones
    # es exactamente lo que se espera.
    if args.entrega:
        def _en_cero():
            rastro = []
            sesiones = len(jget(f"{E}/api/sessions", K)[0]["data"])
            if sesiones:
                rastro.append(f"{sesiones} conversación(es)")
            if mods.get("kanban"):
                n = len(jget(f"{A}/portal/tickets", K)[0]["tickets"])
                if n:
                    rastro.append(f"{n} ticket(s) en el tablero")
            if mods.get("artifacts"):
                n = len(jget(f"{A}/portal/artifacts", K)[0]["artifacts"])
                if n:
                    rastro.append(f"{n} artefacto(s)")
            if mods.get("files"):
                n = len(jget(f"{A}/portal/files", K)[0]["files"])
                if n:
                    rastro.append(f"{n} archivo(s) en el workspace")
            # El gasto SALIO de este chequeo, y no por descuido: desde que el
            # número lo da OpenRouter (`/portal/uso`), es lo que lleva cobrado
            # LA CLAVE desde que existe, y eso no se puede volver a cero. Un
            # agente recién verificado quedaría marcado como "usado" para
            # siempre y el chequeo sería imposible de pasar. Lo que sí queda en
            # cero —conversaciones, tablero, artefactos, archivos— alcanza para
            # lo que esto cuida: que el cliente no encuentre trabajo ajeno
            # adentro de su portal el primer día.
            if manifest.get("bautizado"):
                rastro.append("ya está bautizado (el cliente no vería el onboarding)")
            if rastro:
                raise AssertionError(
                    "el agente llega con huella nuestra: " + " · ".join(rastro)
                    + " — dejalo en cero con  tools/resetear-agente.sh --local "
                      "<ruta> --entrega  (o --entrega por ssh) y volvé a correr esto")
            return "sin conversaciones, sin tablero, sin archivos y sin bautizar"

        check("Entrega: el agente está en cero", _en_cero)

    print(f"\nAgente: {manifest.get('agent')} — {manifest.get('portal_plugin')}\n")
    for estado, nombre, detalle in results:
        print(f"  [{estado}] {nombre}" + (f" — {detalle}" if detalle else ""))
    fallas = [r for r in results if r[0] == FAIL]
    avisos = [r for r in results if r[0] == WARN]
    veces = "1 vez" if INTENTOS == 1 else f"{INTENTOS} veces"
    print(f"\n{len(results) - len(fallas) - len(avisos)} ok · {len(avisos)} avisos · "
          f"{len(fallas)} fallas  (cada chequeo corrió {veces})")
    if fallas:
        print("\nNo está listo para el portal. Arreglar:")
        for _, nombre, detalle in fallas:
            print(f"  · {nombre}: {detalle}")
        return 1
    print("\nCumple el contrato del portal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
