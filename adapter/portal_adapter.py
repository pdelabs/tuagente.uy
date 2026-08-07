#!/usr/bin/env python3
# Adapter del portal tuagente: sidecar stdlib-only sobre los datos de Hermes.
# Lecturas: sqlite con PRAGMA query_only + filesystem. Escrituras al kanban: SOLO via
# subprocess del CLI `hermes kanban ...` (jamas SQL de escritura).
# Artefactos: solo filesystem (workspace/artifacts), el HTML viaja en el JSON.
# Bearer auth con API_SERVER_KEY + CORS por PORTAL_CORS_ORIGINS.
import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

VERSION = "0.26.0"
# El gateway responde el stream de sesiones SIN cabeceras CORS (solo las manda
# en el preflight), asi que el browser descarta la respuesta. Lo proxeamos.
AGENT_BASE = os.environ.get("AGENT_API_BASE", "http://hermes:8642")
TOKEN = os.environ.get("API_SERVER_KEY", "")
ORIGINS = {o.strip() for o in os.environ.get("PORTAL_CORS_ORIGINS", "").split(",") if o.strip()}

DATA = Path("/opt/data")
KANBAN_DB = DATA / "kanban.db"
STATE_DB = DATA / "state.db"
CRON_JOBS = DATA / "cron" / "jobs.json"
CRON_EXEC_DB = DATA / "cron" / "executions.db"
WORKSPACE = DATA / "workspace"
ARTIFACTS = WORKSPACE / "artifacts"
CONFIG = DATA / "config.yaml"
# Nombre y pinta que el cliente le puso a su agente desde el portal. Vive en el
# volumen del agente, no en el browser: si entra desde otra maquina, su agente
# sigue siendo el suyo.
IDENTIDAD = DATA / "portal_identidad.json"
MAX_NOMBRE_LEN = 40
MAX_LOOK_EJES = 16
EJE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,19}$")
# El system prompt. Hermes lo relee al construir el prompt, asi que lo que
# escribamos agarra en la proxima sesion sin reiniciar el contenedor.
SOUL = DATA / "SOUL.md"
# El bautizo entra en un bloque acotado y reescribible: la prosa que armamos a
# mano en el alta no se toca NUNCA.
SOUL_INICIO = "<!-- portal:identidad -->"
SOUL_FIN = "<!-- /portal:identidad -->"

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Todo lo que sube el cliente cae acá: una sola puerta, confinada.
INBOX = WORKSPACE / "entrada"
TASK_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
# Mismo alfabeto que genera skills/artifact/create_artifact.py. OJO: ".." y "."
# tambien matchean, asi que el confinamiento real lo hace artifact_dir().
ART_ID_RE = re.compile(r"^[\w.-]+$")

# --- Autorias que usa el adapter (una por camino, y todas != la del agente) ---
# El agente firma sus comentarios con su profile (en este deploy: "default").
# HUMAN  -> lo que el humano del portal escribe a mano (POST .../comment).
# AUDIT  -> linea automatica que deja el adapter al aprobar/rechazar; se
#           mantiene distinta de HUMAN para que la auditoria no se confunda
#           con un comentario tipeado por la persona.
AUTHOR_HUMAN = "cliente"
AUTHOR_AUDIT = "portal"
MAX_AUTHOR_LEN = 60
# Perfil al que se le asignan los tickets creados desde el portal. Todos
# nuestros agentes corren un solo perfil; si alguno tuviera varios, se cambia
# por env sin tocar el codigo.
ASSIGNEE = os.environ.get("PORTAL_ASSIGNEE", "default").strip() or "default"


def ro(db):
    """Conexion de SOLO LECTURA, pero abierta en modo lectura-escritura.

    Parece contradictorio y no lo es. Con `mode=ro` sobre una base en WAL,
    SQLite crea el archivo auxiliar `-shm` SIN permiso de escritura, y mientras
    esa conexion vive, cualquier otro proceso que quiera escribir falla:
        "kanban.db is not writable: kanban.db-shm is read-only for this user"
    Lo vimos romper el stream del dashboard de Hermes de forma intermitente, al
    ritmo de nuestro polling (y es candidato a explicar escrituras fallidas del
    propio agente).

    La garantia de no escribir la da `PRAGMA query_only`, que hace que SQLite
    rechace cualquier INSERT/UPDATE/DELETE a nivel motor. Asi el `-shm` nace
    con permisos normales y nosotros seguimos sin poder tocar nada.
    """
    conn = sqlite3.connect(f"file:{db}", uri=True)
    conn.execute("PRAGMA query_only = ON")
    conn.row_factory = sqlite3.Row
    return conn


# ---------- manifest ----------

def _look_limpio(look):
    """Deja pasar solo ejes con nombre sano y valor entero chico.

    El adapter NO sabe que significa cada eje (eso es del portal): valida la
    forma, no el contenido, asi el portal puede sumar rasgos sin tocar esto.
    """
    if not isinstance(look, dict) or len(look) > MAX_LOOK_EJES:
        return None
    limpio = {}
    for eje, valor in look.items():
        if not isinstance(eje, str) or not EJE_RE.match(eje):
            return None
        # bool es subclase de int en Python: si no lo excluis, True pasa como 1.
        if isinstance(valor, bool) or not isinstance(valor, int) or not 0 <= valor < 100:
            return None
        limpio[eje] = valor
    return limpio


def identidad():
    """Como se llama y que pinta tiene el agente, segun lo eligio el cliente."""
    try:
        data = json.loads(IDENTIDAD.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    nombre = str(data.get("nombre") or "").strip()
    if nombre:
        out["nombre"] = nombre[:MAX_NOMBRE_LEN]
    look = _look_limpio(data.get("look"))
    if look:
        out["look"] = look
    return out


def _bloque_soul(nombre):
    # El bloque se delimita con comentarios HTML, asi que el nombre NO puede
    # traer `<` ni `>`: con ellos podria cerrarlo antes de tiempo y la proxima
    # reescritura se comeria un pedazo del SOUL. Se sanea aca —donde vive el
    # invariante— y no solo en la puerta de entrada.
    nombre = re.sub(r"\s+", " ", nombre).replace("<", "").replace(">", "").strip()
    return (
        f"{SOUL_INICIO}\n"
        "## Tu nombre\n"
        "\n"
        f"Tu cliente te bautizo **{nombre}** desde el portal. Ese es tu nombre:\n"
        "presentate asi cuando saludes, cuando te pregunten quien sos y en\n"
        "todos los canales. Si el resto de este documento te llama de otra\n"
        "forma, vale este.\n"
        f"{SOUL_FIN}"
    )


def escribir_nombre_en_soul(nombre):
    """Deja el nombre en el system prompt, para que el agente SE PRESENTE asi.

    Reemplaza solo lo que hay entre los marcadores (o agrega el bloque al final
    la primera vez): la prosa del alta —reglas de negocio, alcance, tono— queda
    intacta. Best-effort: si algo falla, el bautizo igual quedo guardado.
    """
    if not SOUL.is_file():
        return "sin SOUL.md"
    try:
        texto = SOUL.read_text(encoding="utf-8")
    except OSError as exc:
        return f"no pude leerlo: {exc}"
    bloque = _bloque_soul(nombre)
    ini, fin = texto.find(SOUL_INICIO), texto.find(SOUL_FIN)
    if ini != -1 and fin > ini:
        nuevo = texto[:ini] + bloque + texto[fin + len(SOUL_FIN):]
    else:
        nuevo = texto.rstrip() + "\n\n" + bloque + "\n"
    if nuevo == texto:
        return "sin cambios"
    try:
        SOUL.write_text(nuevo, encoding="utf-8")
    except OSError as exc:
        return f"no pude escribirlo: {exc}"
    return "ok"


def nombre_en_telegram(nombre):
    """Le pone el nombre elegido al bot de Telegram.

    La FOTO del bot NO se puede cambiar por la Bot API (no existe metodo): esa
    sigue siendo a mano por @BotFather en el alta. El nombre si, con setMyName.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return "sin bot"
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/setMyName",
        data=json.dumps({"name": nombre[:64]}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return f"no pude: {exc}"
    if data.get("ok"):
        return "ok"
    # Telegram limita los cambios de nombre seguidos: no es un error nuestro.
    return f"telegram dijo que no: {str(data.get('description', ''))[:120]}"


def agent_name():
    # Si el cliente lo bautizo desde el portal, ese nombre manda sobre todo.
    propio = identidad().get("nombre")
    if propio:
        return propio
    name = os.environ.get("AGENT_NAME", "").strip()
    if name:
        return name
    # Fallback: buscar un name bajo agent:/branding:/display: en config.yaml
    # (scan minimo, sin lib yaml; jamas hardcodear un nombre aca).
    try:
        section = None
        for line in CONFIG.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if not line.startswith((" ", "\t")):
                section = line.split(":", 1)[0].strip()
                continue
            m = re.match(r"\s+name:\s*(.+?)\s*$", line)
            if m and section in ("agent", "branding", "display"):
                return m.group(1).strip("\"'")
    except OSError:
        pass
    return "Agente"


def blocked_count():
    try:
        conn = ro(KANBAN_DB)
        n = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='blocked'").fetchone()[0]
        conn.close()
        return n
    except sqlite3.Error:
        return 0


def manifest():
    has_kanban = KANBAN_DB.exists()
    return {
        "agent": agent_name(),
        # La pinta que le eligio el cliente, para que el portal lo dibuje igual
        # desde cualquier maquina. None si nunca la eligio.
        "look": identidad().get("look"),
        # Ya lo bautizo el cliente: el portal no vuelve a pedirle el nombre
        # cuando entra desde otra maquina.
        "bautizado": bool(identidad().get("nombre")),
        "portal_plugin": f"adapter-{VERSION}",
        "modules": {
            "chat": True,  # el gateway (:8642) es parte del deploy Hermes
            "kanban": has_kanban,
            "approvals": has_kanban and blocked_count() > 0,
            "files": WORKSPACE.is_dir(),
            # true con que exista la carpeta (aunque este vacia): asi el cliente
            # ve la pestaña y su explicacion antes del primer artefacto.
            "artifacts": ARTIFACTS.is_dir(),
            "usage": STATE_DB.exists(),
            "activity": CRON_EXEC_DB.exists() or CRON_JOBS.exists(),
            "crons": CRON_JOBS.exists(),
            # La pestaña de conexiones solo si el kit dejo su catalogo.
            "connections": CONNECTIONS_CATALOG.is_file(),
            # No es una pestaña: le avisa al chat que puede adjuntar archivos.
            "upload": WORKSPACE.is_dir(),
        },
        # Conexiones que el flujo del cliente necesita y faltan: alimenta el
        # aviso del inicio y el puntito en el sidebar.
        "conexiones_pendientes": conexiones_pendientes(),
    }


# ---------- capacidades (que sabe hacer y a que esta conectado) ----------
# Fuentes: los SKILL.md del disco (las locales, siempre frescas), el snapshot
# que Hermes arma para el prompt (trae descripcion y categoria de las bundled),
# `plugins list --json` y `mcp list` (que no tiene --json, se parsea el texto).

SKILLS_DIR = DATA / "skills"
SKILLS_SNAPSHOT = DATA / ".skills_prompt_snapshot.json"


def _skill_meta(skill_md):
    """(resumen, titulo) de una skill, para mostrarle AL CLIENTE.

    Una skill tiene dos audiencias y el mismo archivo: `description` esta
    escrito para el AGENTE (cuando usarla, en imperativo, con jerga) y mostrado
    crudo en el portal es fuga de maquinaria. Por eso el frontmatter acepta dos
    campos nuestros opcionales, `para_cliente` (que hace, dicho al cliente) y
    `titulo` (nombre con tildes — el slug no puede inventarlas). Fallback:
    description, y si no hay frontmatter, la primera linea de prosa.
    """
    try:
        lines = skill_md.read_text(encoding="utf-8").splitlines()
    except OSError:
        return "", ""
    campos, i = {}, 0
    if lines and lines[0].strip() == "---":
        for j, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                i = j + 1
                break
            m = re.match(r'\s*(description|para_cliente|titulo):\s*["\']?(.+?)["\']?\s*$', line)
            if m:
                campos[m.group(1)] = m.group(2)[:200]
    resumen = campos.get("para_cliente") or campos.get("description") or ""
    if not resumen:
        for line in lines[i:]:
            line = line.strip()
            if not line or line.startswith(("#", "---", "```", "|", ">")):
                continue
            resumen = re.sub(r"[*`_]", "", line)[:200]
            break
    return resumen, campos.get("titulo", "")


def _bundled_names():
    """Skills que vienen con Hermes (para no venderlas como propias)."""
    try:
        return {
            l.split(":", 1)[0]
            for l in (SKILLS_DIR / ".bundled_manifest").read_text(encoding="utf-8").splitlines()
            if ":" in l
        }
    except OSError:
        return set()


def _kit_names():
    """Skills del PRODUCTO tuagente (el manifiesto lo deja install.sh).

    Son comunes a todos los clientes y sostienen pantallas del portal
    (entregable→Archivos, aprobacion→Aprobaciones, artifact→visualizaciones):
    no se presentan como "hechas para vos" ni se editan desde el portal.
    """
    try:
        return {
            l.strip() for l in
            (SKILLS_DIR / ".kit_manifest").read_text(encoding="utf-8").splitlines()
            if l.strip()
        }
    except OSError:
        return set()


SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _skill_editable(nombre):
    """Ruta del SKILL.md si la habilidad es NUESTRA (vive directo en data/skills).

    Las del motor no se editan desde el portal: viven en la imagen del
    contenedor y cualquier cambio volveria atras en el proximo arranque. El
    nombre se valida y la ruta se confina, como todo path que viene de afuera.
    """
    if not nombre or not SKILL_NAME_RE.match(nombre):
        return None
    if nombre in _bundled_names() or nombre in _kit_names():
        return None
    md = (SKILLS_DIR / nombre / "SKILL.md").resolve()
    try:
        md.relative_to(SKILLS_DIR.resolve())
    except ValueError:
        return None
    return md if md.is_file() else None


def capabilities():
    skills, vistos = [], set()
    bundled = _bundled_names()
    kit = _kit_names()
    if SKILLS_DIR.is_dir():
        for folder in sorted(SKILLS_DIR.iterdir()):
            if folder.name.startswith(".") or not folder.is_dir():
                continue
            md = folder / "SKILL.md"
            if md.exists():
                if folder.name in bundled:
                    origen = "de fábrica"
                elif folder.name in kit:
                    origen = "tuagente"
                else:
                    origen = "propia"
                resumen, titulo = _skill_meta(md)
                entrada = {"name": folder.name, "summary": resumen,
                           "origen": origen,
                           # Solo las de ESTE cliente se editan desde el
                           # portal: las del kit sostienen pantallas (romper
                           # `entregable` rompe Archivos) y las del motor
                           # viven en la imagen.
                           "editable": origen == "propia"}
                if titulo:
                    entrada["label"] = titulo
                skills.append(entrada)
                vistos.add(folder.name)
                continue
            # Categorias: carpetas que agrupan skills (ej. productivity/xlsx).
            for sub in sorted(folder.iterdir()):
                sub_md = sub / "SKILL.md"
                if sub.is_dir() and sub_md.exists() and sub.name not in vistos:
                    resumen, titulo = _skill_meta(sub_md)
                    entrada = {"name": sub.name, "summary": resumen,
                               "origen": "de fábrica" if sub.name in bundled else "propia",
                               "categoria": folder.name}
                    if titulo:
                        entrada["label"] = titulo
                    skills.append(entrada)
                    vistos.add(sub.name)
    try:
        snap = json.loads(SKILLS_SNAPSHOT.read_text(encoding="utf-8"))
        for s in snap.get("skills", []):
            nombre = s.get("skill_name") or s.get("frontmatter_name")
            if not nombre or nombre in vistos:
                continue
            skills.append({"name": nombre, "summary": s.get("description") or "",
                           "origen": "de fábrica", "categoria": s.get("category") or ""})
            vistos.add(nombre)
    except (OSError, ValueError):
        pass

    plugins = []
    try:
        raw = subprocess.run(["hermes", "plugins", "list", "--json"],
                             capture_output=True, text=True, timeout=30)
        data = json.loads(raw.stdout or "[]")
        items = data if isinstance(data, list) else data.get("plugins", [])
        for p in items:
            if str(p.get("status", "")).lower() == "enabled" or p.get("enabled"):
                plugins.append({"name": p.get("name"), "summary": p.get("description") or ""})
    except (OSError, ValueError, subprocess.SubprocessError):
        pass

    mcp = []
    try:
        raw = subprocess.run(["hermes", "mcp", "list"],
                             capture_output=True, text=True, timeout=30)
        for line in (raw.stdout or "").splitlines():
            line = line.strip()
            # Las filas utiles empiezan con el nombre; el vacio dice "No MCP...".
            if not line or line.startswith(("No MCP", "Add one", "hermes mcp", "-", "=")):
                continue
            mcp.append({"name": line.split()[0], "detalle": line})
    except (OSError, subprocess.SubprocessError):
        pass

    return {"skills": skills, "plugins": plugins, "mcp": mcp}


# ---------- conexiones (a que sistemas del cliente esta enchufado) ----------
# El catalogo es CURADO y viene del kit: connections/catalogo.json. Lo que se
# calcula aca es solo el ESTADO, y siempre por presencia — este endpoint no
# devuelve el valor de una credencial ni por error de tipeo.

CONNECTIONS_CATALOG = DATA / "connections" / "catalogo.json"
REQUERIDAS = DATA / "connections" / "requeridas.json"

# ---------- conexion Google self-service (flujo "google-oauth") ----------
# El cliente toca "Conectar" en el portal, entra a Google, acepta y pega la
# direccion final. El adapter genera la URL (PKCE) y canjea el codigo: el
# client secret y el token NUNCA pasan por el browser. Mismo flujo que
# tools/conectar-google.py del kit, portado aca para que no haga falta nadie
# de tuagente en el medio.
GOOGLE_CLIENT_SECRET = DATA / "google_client_secret.json"
GOOGLE_TOKEN = DATA / "google_token.json"
GOOGLE_OAUTH_PENDIENTE = DATA / "google_oauth_portal.json"
# Solo lectura de Drive por ahora: es lo que usan los flujos de entrada, y es
# el permiso menos invasivo que Google muestra en el consentimiento.
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
GOOGLE_REDIRECT = "http://localhost:1"


def google_auth_url():
    import base64
    import hashlib
    import secrets as _secrets
    from urllib.parse import urlencode
    cs = json.loads(GOOGLE_CLIENT_SECRET.read_text())["installed"]
    verifier = _secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    GOOGLE_OAUTH_PENDIENTE.write_text(json.dumps({"verifier": verifier}))
    q = {
        "response_type": "code",
        "client_id": cs["client_id"],
        "redirect_uri": GOOGLE_REDIRECT,
        "scope": " ".join(GOOGLE_SCOPES),
        "state": _secrets.token_urlsafe(16),
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTH}?{urlencode(q)}"


def google_auth_code(pegado):
    """Canjea lo que el cliente pego (URL de localhost:1 o el code pelado)."""
    from urllib.parse import parse_qs, urlencode, urlparse
    if not GOOGLE_OAUTH_PENDIENTE.is_file():
        return {"ok": False, "error": "no hay un pedido pendiente: toca Conectar de nuevo"}
    cs = json.loads(GOOGLE_CLIENT_SECRET.read_text())["installed"]
    pend = json.loads(GOOGLE_OAUTH_PENDIENTE.read_text())
    code = pegado.strip()
    if code.startswith("http"):
        code = parse_qs(urlparse(code).query).get("code", [""])[0]
    if not code:
        return {"ok": False, "error": "no encontre el codigo en lo que pegaste; copia la direccion entera"}
    cuerpo = urlencode({
        "code": code,
        "client_id": cs["client_id"],
        "client_secret": cs["client_secret"],
        "redirect_uri": GOOGLE_REDIRECT,
        "grant_type": "authorization_code",
        "code_verifier": pend["verifier"],
    }).encode()
    try:
        with urllib.request.urlopen(
                urllib.request.Request(GOOGLE_TOKEN_URI, data=cuerpo), timeout=30) as r:
            tk = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"Google respondio {e.code}; proba tocar Conectar de nuevo"}
    if "refresh_token" not in tk:
        return {"ok": False, "error": "el codigo ya se uso o vencio; toca Conectar de nuevo"}
    exp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + tk.get("expires_in", 3600)))
    # Formato authorized_user: el motor lo refresca solo.
    GOOGLE_TOKEN.write_text(json.dumps({
        "type": "authorized_user",
        "token": tk["access_token"],
        "refresh_token": tk["refresh_token"],
        "token_uri": GOOGLE_TOKEN_URI,
        "client_id": cs["client_id"],
        "client_secret": cs["client_secret"],
        "scopes": tk.get("scope", " ".join(GOOGLE_SCOPES)).split(),
        "universe_domain": "googleapis.com",
        "account": "",
        "expiry": exp,
    }, indent=2))
    GOOGLE_OAUTH_PENDIENTE.unlink(missing_ok=True)
    return {"ok": True}


def _config_texto():
    try:
        return CONFIG.read_text(encoding="utf-8")
    except OSError:
        return ""


def _falta_de(regla):
    """Que le falta a una conexion para estar viva. Lista vacia = esta puesta."""
    falta = []
    for var in regla.get("env", []):
        if not os.environ.get(var, "").strip():
            falta.append({"tipo": "credencial", "nombre": var})
    for archivo in regla.get("archivos", []):
        # Confinado a data/: el catalogo es nuestro, pero no lo dejamos salir.
        destino = (DATA / archivo).resolve()
        if not str(destino).startswith(str(DATA.resolve())) or not destino.is_file():
            falta.append({"tipo": "archivo", "nombre": archivo})
    for plugin in regla.get("plugin", []):
        if plugin not in _config_texto():
            falta.append({"tipo": "plugin", "nombre": plugin})
    return falta


def _requeridas():
    """Conexiones que el flujo de ESTE cliente necesita (las deja el alta).

    Con esto el portal puede decir "a tu agente le falta Google Drive para
    arrancar" en vez de esperar a que el cliente descubra la pestaña. Es
    conocimiento por-cliente, pero vive en su data como una lista de ids — el
    codigo sigue siendo generico.
    """
    try:
        ids = json.loads(REQUERIDAS.read_text(encoding="utf-8"))
        return {str(i) for i in ids} if isinstance(ids, list) else set()
    except (OSError, ValueError):
        return set()


def connections():
    try:
        catalogo = json.loads(CONNECTIONS_CATALOG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # Sin catalogo instalado no inventamos nada: la pestaña no se muestra.
        return {"disponible": False, "conexiones": []}

    requeridas = _requeridas()
    salida = []
    for c in catalogo.get("conexiones", []):
        falta = _falta_de(c.get("detecta", {}))
        # `requiere` es lo que tenemos que poner NOSOTROS antes de que el
        # cliente pueda siquiera intentarlo (ej: la app OAuth de tuagente).
        falta_previo = _falta_de(c.get("requiere", {}))
        salida.append({
            "id": c.get("id"),
            "label": c.get("label"),
            "grupo": c.get("grupo", "sistema"),
            "para_que": c.get("para_que", ""),
            "como": c.get("como", ""),
            "esfuerzo": c.get("esfuerzo"),
            "quien": c.get("quien"),
            "advertencia": c.get("advertencia"),
            "recomendado": c.get("recomendado", True),
            "estado": "conectado" if not falta else ("bloqueado" if falta_previo else "sin_conectar"),
            "falta": falta,
            "falta_previo": falta_previo,
            "requerida": c.get("id") in requeridas,
            # "google-oauth" = el portal la conecta solo, con su dialogo de
            # pasos; sin flujo, el boton cae a "Pedir que la conecten".
            "flujo": c.get("flujo"),
        })
    # Las que el flujo del cliente necesita y no estan, adelante de todo.
    salida.sort(key=lambda c: (not (c["requerida"] and c["estado"] != "conectado"),
                               c["estado"] != "conectado", c["grupo"] != "canal", c["label"] or ""))
    return {"disponible": True, "conexiones": salida}


def conexiones_pendientes():
    """Cuantas conexiones requeridas por el flujo del cliente faltan conectar."""
    requeridas = _requeridas()
    if not requeridas:
        return 0
    try:
        catalogo = json.loads(CONNECTIONS_CATALOG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    return sum(
        1 for c in catalogo.get("conexiones", [])
        if c.get("id") in requeridas and _falta_de(c.get("detecta", {}))
    )


# ---------- tableros ----------
# El board por defecto vive en /opt/data/kanban.db; los demas en
# /opt/data/kanban/boards/<slug>/kanban.db, cada uno con su board.json
# (verificado creando y borrando uno de prueba, 2026-08-04).

BOARDS_DIR = DATA / "kanban" / "boards"
BOARD_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")


def board_db(slug):
    """Ruta de la db de un board. None si el slug no existe."""
    if not slug or slug == "default":
        return KANBAN_DB
    if not BOARD_SLUG_RE.match(slug):
        return None
    db = BOARDS_DIR / slug / "kanban.db"
    return db if db.exists() else None


def boards():
    out = [{"slug": "default", "name": "Principal", "archived": False}]
    if BOARDS_DIR.is_dir():
        for folder in sorted(BOARDS_DIR.iterdir()):
            meta_file = folder / "board.json"
            if not (folder / "kanban.db").exists():
                continue
            meta = {}
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
            if meta.get("archived"):
                continue
            out.append({
                "slug": meta.get("slug") or folder.name,
                "name": meta.get("name") or folder.name,
                "archived": False,
                # Link opcional a un Project de Hermes (repos/carpetas).
                "project_id": meta.get("project_id"),
            })
    return out


# ---------- kanban (lectura) ----------

def tickets(db=None):
    conn = ro(db or KANBAN_DB)
    rows = conn.execute(
        "SELECT id, title, body, status, tenant, created_at FROM tasks "
        "WHERE status != 'archived' ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _summary(body, title):
    for line in (body or "").splitlines():
        if line.strip():
            return line.strip()
    return title


def approvals(db=None):
    conn = ro(db or KANBAN_DB)
    rows = conn.execute(
        "SELECT id, title, body, created_at FROM tasks "
        "WHERE status = 'blocked' ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "summary": _summary(r["body"], r["title"]),
            "body": r["body"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def task_status(task_id):
    conn = ro(KANBAN_DB)
    row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return row["status"] if row else None


def _ws_relative(path):
    """/opt/data/workspace/entregables/x.md -> entregables/x.md (como los sirve
    el modulo de archivos). Lo de afuera del workspace se descarta."""
    try:
        return str(Path(str(path)).resolve().relative_to(WORKSPACE.resolve()))
    except (ValueError, OSError, TypeError):
        return None


def event_detail(kind, payload):
    """Lo que un humano necesita de un evento; el resto del payload es interno.

    El motivo de cierre de un ticket vive ACA, no en un comentario: cuando el
    agente termina, Hermes guarda `summary` + `artifacts` en el evento
    `completed`. Si no lo devolvemos, el cliente ve un ticket que pasó de
    creado a cerrado sin ninguna explicación, aunque la explicación exista.
    """
    if not payload:
        return {}
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    texto = data.get("summary") or data.get("reason") or data.get("error")
    if isinstance(texto, str) and texto.strip():
        out["summary"] = texto.strip()[:2000]
    archivos = [
        rel
        for rel in (_ws_relative(a) for a in (data.get("artifacts") or []) if a)
        if rel
    ]
    if archivos:
        out["files"] = archivos[:20]
    # Por qué quedó bloqueado (needs_input, gave_up, ...) — el cliente lo lee
    # para saber si la pelota está de su lado.
    if kind in ("blocked", "unblocked") and isinstance(data.get("kind"), str):
        out["blocked_kind"] = data["kind"][:60]
    return out


def ticket_detail(task_id, db=None):
    conn = ro(db or KANBAN_DB)
    t = conn.execute(
        "SELECT id, title, body, status, tenant, created_at FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if t is None:
        conn.close()
        return None
    comments = conn.execute(
        "SELECT author, body, created_at FROM task_comments "
        "WHERE task_id = ? ORDER BY created_at LIMIT 200",
        (task_id,),
    ).fetchall()
    events = conn.execute(
        "SELECT kind, payload, created_at FROM task_events "
        "WHERE task_id = ? ORDER BY created_at DESC LIMIT 50",
        (task_id,),
    ).fetchall()
    conn.close()

    salida, desenlace = [], None
    for e in events:
        item = {"kind": e["kind"], "created_at": e["created_at"]}
        item.update(event_detail(e["kind"], e["payload"]))
        salida.append(item)
        # `events` viene del mas nuevo al mas viejo: el primero que cierre o
        # bloquee es el desenlace vigente del ticket.
        if desenlace is None and e["kind"] in ("completed", "blocked", "gave_up", "failed"):
            if item.get("summary") or item.get("files"):
                desenlace = {k: item[k] for k in ("kind", "summary", "files", "created_at") if k in item}

    return {
        "ticket": dict(t),
        # Por qué está como está, listo para mostrar arriba de todo. Sale del
        # evento, no de que el agente se haya acordado de comentar.
        "outcome": desenlace,
        "comments": [dict(c) for c in comments],
        "events": salida,
    }


# ---------- kanban (escritura via CLI, jamas SQL) ----------
#
# Convenciones de invocacion (importan mas de lo que parecen):
#   * opciones SIEMPRE en forma `--flag=valor`; con `--flag valor` argparse
#     rompe cuando el valor empieza con "-" (un titulo tipo "-30% de leads").
#   * un `--` antes de los posicionales, por el mismo motivo.

def hermes_cli(*args):
    """Corre `hermes kanban ...` y devuelve su stdout. Nunca toca SQL."""
    proc = subprocess.run(
        ["hermes", "kanban", *args],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise RuntimeError(f"hermes kanban {args[0]} fallo (rc={proc.returncode}): {detail}")
    return proc.stdout or ""


# Mapa status del portal -> subcomando del CLI. `ready` es "unblock" porque en
# Hermes volver a la cola es exactamente desbloquear (blocked/scheduled -> ready).
STATUS_CMD = {
    "done": "complete",
    "blocked": "block",
    "ready": "unblock",
    "archived": "archive",
}


def safe_author(raw, default):
    """Autor sanitizado, lo mas fiel posible a lo que mando la persona.

    Como pasamos `--author=<valor>` (forma inequivoca para argparse) no hay
    que censurar caracteres raros ni guiones iniciales: alcanza con sacar
    control chars / saltos de linea y acotar el largo. Un nombre tipo
    "Luis (cliente)" tiene que llegar entero al kanban.
    """
    author = re.sub(r"[\x00-\x1f\x7f]+", " ", str(raw or ""))
    author = re.sub(r"\s+", " ", author).strip()[:MAX_AUTHOR_LEN].strip()
    return author or default


def created_task_id(out):
    """Saca el id de la salida de `hermes kanban create`.

    Preferimos --json (imprime el task entero). Si eso falla, caemos al texto
    "Created t_xxxx  (ready, assignee=-)". Si tampoco sale, devolvemos None:
    el ticket YA se creo, asi que mentir un id seria peor que admitir que no
    lo sabemos.
    """
    try:
        data = json.loads(out)
        tid = data.get("id") if isinstance(data, dict) else None
        if isinstance(tid, str) and TASK_ID_RE.match(tid):
            return tid
    except ValueError:
        pass
    m = re.search(r"^Created\s+(\S+)", out or "", re.M)
    if m and TASK_ID_RE.match(m.group(1)):
        return m.group(1)
    return None


def create_ticket(title, body, tenant):
    """Crea el ticket YA ASIGNADO, o el agente nunca lo empieza.

    TRAMPA VERIFICADA (2026-08-04): el dispatcher solo reclama tickets que
    tienen assignee. Uno creado sin asignar se queda en `ready` para siempre —
    verificado con t_31dd4c85, que estuvo 32 minutos quieto hasta que alguien
    lo asignó a mano. Desde el portal eso es inaceptable: el cliente crea
    trabajo, lo ve "listo", y no pasa nada nunca sin ningún aviso.
    """
    args = ["create", "--json", f"--created-by={AUTHOR_HUMAN}", f"--assignee={ASSIGNEE}"]
    if body:
        args.append(f"--body={body}")
    if tenant:
        args.append(f"--tenant={tenant}")
    args += ["--", title]
    return created_task_id(hermes_cli(*args))


def comment_ticket(task_id, body, author):
    # TRAMPA CONOCIDA (no la disparamos, pero conviene tenerla escrita):
    # `hermes kanban comment` NO cambia el estado — solo inserta el comentario
    # y un evento 'commented'. Lo que promueve solo es el dispatcher: en su
    # pasada llama a recompute_ready(), que devuelve un ticket 'blocked' a
    # 'ready' salvo que el bloqueo sea "sticky" (= el ultimo evento
    # blocked/unblocked del ticket es 'blocked'). Un ticket que llego a blocked
    # SIN ese evento tipado —circuit breaker ('gave_up'), `create
    # --initial-status blocked`, o escritura directa a la db— se auto-promueve
    # en la proxima pasada, y como `hermes kanban list` tambien corre
    # recompute_ready(), basta con listar para dispararlo.
    # Por eso: este endpoint NUNCA llama a `list` ni a `unblock`, y el estado
    # lo leemos por SQL read-only. Comentar desde el portal deja el ticket
    # exactamente como estaba.
    # Verificado en 0.5.0: un ticket bloqueado con `hermes kanban block` (que
    # SI emite el evento) aguanta comentarios y pasadas del dispatcher sin
    # moverse; uno creado con `--initial-status blocked` se fue solo a 'ready'
    # antes siquiera de comentarlo. Nuestro create nunca usa esa opcion.
    hermes_cli("comment", f"--author={author}", "--", task_id, body)


# --- Avisarle al agente que el humano comento -------------------------------
# Hermes tiene `kanban notify-subscribe`, pero en un deploy sin demonio de
# kanban nadie consume esos eventos: el comentario queda ahi y el agente no se
# entera. Como el portal es el unico lugar donde el humano comenta, avisamos
# nosotros: una corrida corta del agente con el contexto del ticket.
#
# Se dispara SOLO desde este endpoint (o sea, solo cuando escribe una persona),
# nunca desde los comentarios que deja el propio agente: sin eso habria loop.
NOTIFY_ON_COMMENT = os.environ.get("NOTIFY_AGENT_ON_COMMENT", "1") != "0"
NOTIFY_SESSION_FILE = DATA / ".portal_notify_session"


def notify_session_id():
    """Una unica sesion para todos los avisos del portal.

    Con /v1/chat/completions cada aviso creaba una conversacion nueva y le
    ensuciaba la lista al cliente. Guardamos el id y lo reusamos; si la sesion
    fue borrada, se crea otra.
    """
    sid = ""
    try:
        sid = NOTIFY_SESSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    if sid:
        try:
            req = urllib.request.Request(
                f"{AGENT_BASE}/api/sessions/{sid}/messages",
                headers={"Authorization": f"Bearer {TOKEN}"})
            urllib.request.urlopen(req, timeout=20).read()
            return sid
        except Exception:  # noqa: BLE001 — no existe mas: creamos otra
            sid = ""
    # OJO: una sesion creada sin modelo nace con el placeholder "hermes-agent",
    # que el proveedor rechaza con 400. Le pasamos el modelo real del agente.
    payload = {}
    modelo = default_model()
    if modelo:
        payload["model"] = modelo
    try:
        req = urllib.request.Request(
            f"{AGENT_BASE}/api/sessions", data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {TOKEN}",
                     "Content-Type": "application/json"}, method="POST")
        data = json.loads(urllib.request.urlopen(req, timeout=30).read())
        sid = (data.get("session") or {}).get("id") or data.get("id") or ""
        if sid and modelo:
            NOTIFY_SESSION_FILE.write_text(sid, encoding="utf-8")
            return sid
        return ""  # sin modelo confiable, mejor el camino sin sesion
    except Exception:  # noqa: BLE001
        return ""


def default_model():
    """El modelo por defecto del agente, leido de su config.yaml."""
    try:
        dentro = False
        for line in CONFIG.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if not line.startswith((" ", "\t")):
                dentro = line.split(":", 1)[0].strip() == "model"
                continue
            if dentro:
                m = re.match(r"\s+default:\s*(.+?)\s*$", line)
                if m:
                    return m.group(1).strip("\"'")
    except OSError:
        pass
    return ""


def _texto_final_sse(raw):
    """Saca la respuesta del agente del stream nativo de Hermes."""
    partes, ultimo = [], ""
    evento = ""
    for linea in raw.decode("utf-8", "replace").splitlines():
        if linea.startswith("event: "):
            evento = linea[7:].strip()
        elif linea.startswith("data: "):
            try:
                d = json.loads(linea[6:])
            except ValueError:
                continue
            if evento == "assistant.delta" and isinstance(d.get("delta"), str):
                partes.append(d["delta"])
            elif evento == "assistant.completed" and isinstance(d.get("content"), str):
                ultimo = d["content"]
    return (ultimo or "".join(partes)).strip()


def notify_agent_of_comment(task_id, body, author):
    if not NOTIFY_ON_COMMENT:
        return
    # El contexto va ADENTRO del aviso. El agente no tiene herramienta nativa de
    # kanban y el binario esta vetado desde el gateway, asi que si le decimos
    # "leelo vos" se va media docena de tool calls peleando con el terminal
    # (verificado: dos corridas, una termino en SyntaxError). Nosotros ya
    # tenemos la db abierta: se la damos servida.
    ficha = ""
    try:
        detalle = ticket_detail(task_id)
        if detalle:
            t = detalle["ticket"]
            previos = [c for c in detalle["comments"] if c["body"] != body][-4:]
            # Las FECHAS son imprescindibles: sin ellas el agente no puede
            # razonar sobre "hoy"/"ayer" y termina adivinando (paso: dijo dos
            # fechas distintas, ninguna verificada, y cambio de version cuando
            # el cliente lo apreto en vez de cuando chequeo el dato).
            def cuando(ts):
                try:
                    return time.strftime("%Y-%m-%d %H:%M", time.localtime(float(ts)))
                except (TypeError, ValueError):
                    return "?"

            ficha = (
                f"\n\n--- Ficha del ticket (ya te la traigo, no la busques) ---\n"
                f"Ahora son las {time.strftime('%Y-%m-%d %H:%M')}.\n"
                f"Título: {t['title']}\nEstado: {t['status']}\n"
                f"Creado: {cuando(t.get('created_at'))}\n"
                + (f"Etiqueta: {t['tenant']}\n" if t.get("tenant") else "")
                + f"\nDescripción:\n{(t['body'] or '(sin descripción)')[:2000]}\n"
            )
            if previos:
                ficha += "\nComentarios anteriores (con su fecha):\n" + "\n".join(
                    f"- [{cuando(c.get('created_at'))}] {c['author']}: {c['body'][:300]}"
                    for c in previos
                )
    except sqlite3.Error:
        pass

    mensaje = (
        f"[Aviso del portal] {author} comentó en el ticket {task_id}:\n\n"
        f"{body}\n{ficha}\n\n"
        "Con esto ya tenés todo el contexto.\n\n"
        "**Tu respuesta se publica como comentario en ese mismo ticket**, así que "
        "escribila dirigida a quien comentó: corta, concreta y sin repetir lo que "
        "ya está en el ticket. Si el comentario pide algo, hacelo y contá qué "
        "hiciste; si es una pregunta, respondela; si no pide nada, alcanza con una "
        "línea. No cambies el estado del ticket salvo que te lo pidan, y no te "
        "desvíes a otra cosa: esto es solo un aviso de comentario."
    )

    def _enviar():
        try:
            sid = notify_session_id()
            if sid:
                # Una sola sesion para todos los avisos: si usaramos
                # /v1/chat/completions se crearia una conversacion nueva por
                # cada comentario y le ensuciariamos la lista al cliente.
                url = f"{AGENT_BASE}/api/sessions/{sid}/chat/stream"
                payload = {"message": mensaje}
            else:
                url = f"{AGENT_BASE}/v1/chat/completions"
                payload = {"messages": [{"role": "user", "content": mensaje}]}
            req = urllib.request.Request(
                url, data=json.dumps(payload).encode(),
                headers={"Authorization": f"Bearer {TOKEN}",
                         "Content-Type": "application/json"},
                method="POST",
            )
            raw = urllib.request.urlopen(req, timeout=600).read()

            # La respuesta va al ticket: si el humano comento ahi, ahi espera
            # la contestacion, no en una sesion que nunca ve. El agente pone
            # las palabras; el codigo se encarga de publicarlas.
            if sid:
                respuesta = _texto_final_sse(raw)
            else:
                try:
                    d = json.loads(raw)
                    respuesta = (d["choices"][0]["message"]["content"] or "").strip()
                except Exception:  # noqa: BLE001
                    respuesta = ""
            # El gateway a veces streamea sus propios errores como si fueran la
            # respuesta del agente ("HTTP 400: ... is not a valid model ID").
            # Publicar eso en el ticket le muestra al cliente una falla nuestra
            # con la firma del agente: mejor no comentar nada.
            if re.match(r"^HTTP \d{3}\b", respuesta) or "is not a valid model" in respuesta:
                respuesta = ""
            if respuesta and "[SILENT]" not in respuesta:
                # Firmado con el nombre del agente, distinto de `cliente` y de
                # `portal`: en el detalle se lee de un vistazo quien dijo que.
                comment_ticket(task_id, respuesta[:4000], safe_author(agent_name(), "agente"))
        except Exception:  # noqa: BLE001 — el aviso jamas puede tumbar el comentario
            pass

    # En hilo aparte: el cliente no espera a que el agente piense.
    threading.Thread(target=_enviar, daemon=True).start()


def set_ticket_status(task_id, status):
    # Sin --reason/--kind a proposito: `block <id> <reason>` y
    # `unblock --reason=...` agregan un comentario firmado por el profile del
    # CLI (el agente), y eso ensuciaria la autoria del portal.
    hermes_cli(STATUS_CMD[status], "--", task_id)


# ---------- activity ----------

def cron_jobs_raw():
    try:
        return json.loads(CRON_JOBS.read_text(encoding="utf-8")).get("jobs", [])
    except (OSError, ValueError):
        return []


def cron_detail(job_id):
    """Que hace esta tarea y como le fue: la pregunta real del cliente."""
    job = next((j for j in cron_jobs_raw() if j.get("id") == job_id), None)
    if job is None:
        return None
    runs = []
    if CRON_EXEC_DB.exists():
        try:
            conn = ro(CRON_EXEC_DB)
            runs = [
                dict(r) for r in conn.execute(
                    "SELECT id, status, claimed_at, started_at, finished_at, error "
                    "FROM executions WHERE job_id = ? "
                    "ORDER BY claimed_at DESC LIMIT 30",
                    (job_id,),
                ).fetchall()
            ]
            conn.close()
        except sqlite3.Error:
            pass
    return {
        "job": {
            "id": job.get("id"),
            "name": job.get("name"),
            # La consigna con la que corre: es lo que el cliente quiere leer
            # para entender que hace realmente la tarea.
            "prompt": job.get("prompt") or "",
            "script": job.get("script") or "",
            "schedule_display": job.get("schedule_display") or "",
            "enabled": job.get("enabled"),
            "state": job.get("state"),
            "model": job.get("model_snapshot") or job.get("model") or "",
            "deliver": job.get("deliver") or "",
            "last_status": job.get("last_status"),
            "last_error": job.get("last_error"),
            "next_run_at": job.get("next_run_at"),
        },
        "runs": runs,
    }


def activity():
    names = {}
    try:
        data = json.loads(CRON_JOBS.read_text(encoding="utf-8"))
        for job in data.get("jobs", []):
            names[job.get("id")] = job.get("name") or job.get("id")
    except (OSError, ValueError):
        pass
    events = []
    if CRON_EXEC_DB.exists():
        try:
            conn = ro(CRON_EXEC_DB)
            rows = conn.execute(
                "SELECT job_id, status, claimed_at, started_at, finished_at "
                "FROM executions ORDER BY claimed_at DESC LIMIT 50"
            ).fetchall()
            conn.close()
            for r in rows:
                events.append({
                    "ts": r["finished_at"] or r["started_at"] or r["claimed_at"],
                    "kind": "job_run",
                    "label": names.get(r["job_id"], r["job_id"]),
                    "status": r["status"],
                })
        except sqlite3.Error:
            pass
    # Vida del kanban (creaciones, promociones, comentarios...) mezclada con
    # las corridas de jobs; ts ISO local para ordenar parejo.
    if KANBAN_DB.exists():
        try:
            conn = ro(KANBAN_DB)
            rows = conn.execute(
                "SELECT e.kind, e.created_at, COALESCE(t.title, e.task_id) AS label "
                "FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id "
                "ORDER BY e.created_at DESC LIMIT 50"
            ).fetchall()
            conn.close()
            from datetime import datetime
            for r in rows:
                events.append({
                    "ts": datetime.fromtimestamp(r["created_at"]).astimezone().isoformat(),
                    "kind": "ticket",
                    "label": r["label"],
                    "status": r["kind"],
                })
        except sqlite3.Error:
            pass
    events.sort(key=lambda e: e["ts"] or "", reverse=True)
    return events[:80]


# ---------- files (confinado al workspace) ----------

def files_list():
    base = WORKSPACE.resolve()
    out = []
    for path in base.rglob("*"):
        rel = path.relative_to(base)
        if any(part.startswith(".") for part in rel.parts):
            continue
        # Los artefactos tienen su propia pestaña: listarlos aca los duplica.
        if rel.parts and rel.parts[0] == "artifacts":
            continue
        if not path.is_file():
            continue
        st = path.stat()
        out.append({
            "path": path.relative_to(base).as_posix(),
            "size": st.st_size,
            "mtime": int(st.st_mtime),
        })
        if len(out) >= 1000:
            break
    out.sort(key=lambda f: f["mtime"], reverse=True)
    return out


def file_resolve(rel):
    # Path-confined: resolve() + relative_to; nunca escapar del workspace.
    if not rel or rel.startswith("/") or "\x00" in rel:
        return None
    base = WORKSPACE.resolve()
    target = (base / rel).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target if target.is_file() else None


# ---------- artifacts ----------
# Los escribe skills/artifact/create_artifact.py en workspace/artifacts/<id>/
# (index.html + meta.json). El adapter solo lista, lee y borra. El HTML viaja
# DENTRO del JSON como string: el portal lo dibuja en un iframe aislado y el
# adapter jamas lo sirve como text/html (regla anti-XSS del proyecto).

def artifact_dir(art_id):
    # Path-confined, mismo patron que file_resolve() + una vuelta de tuerca:
    # exigimos que el padre sea exactamente la carpeta de artefactos. ".." y "."
    # pasan el regex de id, y sin este chequeo "." resolveria a la carpeta raiz
    # (un DELETE se llevaria puestos TODOS los artefactos).
    if not art_id or not ART_ID_RE.match(art_id):
        return None
    base = ARTIFACTS.resolve()
    target = (base / art_id).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    if target.parent != base:
        return None
    return target if target.is_dir() else None


def _art_ts(meta):
    try:
        return float(meta.get("created_at") or 0)
    except (TypeError, ValueError):
        return 0.0


def artifact_meta(folder):
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(meta, dict):
        return None
    meta.setdefault("id", folder.name)
    return meta


def artifacts_list():
    if not ARTIFACTS.is_dir():
        return []
    out = []
    for folder in ARTIFACTS.iterdir():
        if not folder.is_dir():
            continue
        meta = artifact_meta(folder)
        if meta is None:
            continue  # meta.json ausente o roto: salteamos, la lista no se cae
        out.append(meta)
    out.sort(key=_art_ts, reverse=True)
    return out


def artifact_detail(art_id):
    folder = artifact_dir(art_id)
    if folder is None:
        return None
    try:
        html = (folder / "index.html").read_text(encoding="utf-8")
    except OSError:
        return None  # sin index.html no hay artefacto que mostrar
    # meta best-effort: si esta roto igual devolvemos el HTML, con lo minimo.
    meta = artifact_meta(folder) or {"id": folder.name}
    return {**meta, "html": html}


def artifact_delete(art_id):
    folder = artifact_dir(art_id)
    if folder is None:
        return False
    shutil.rmtree(folder)
    return True


# ---------- usage ----------

def usage(days=30):
    if not STATE_DB.exists():
        return {"available": False}
    try:
        since = time.time() - days * 86400
        conn = ro(STATE_DB)
        row = conn.execute(
            "SELECT COUNT(*) AS sessions, "
            "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
            "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
            "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
            "FROM sessions WHERE started_at >= ?",
            (since,),
        ).fetchone()
        conn.close()
    except sqlite3.Error:
        return {"available": False}
    if not row or row["sessions"] == 0:
        return {"available": False}
    daily, by_channel, by_model = [], [], []
    try:
        conn = ro(STATE_DB)
        daily = [
            dict(r) for r in conn.execute(
                "SELECT date(started_at, 'unixepoch', 'localtime') AS date, "
                "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
                "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
                "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
                "FROM sessions WHERE started_at >= ? GROUP BY date ORDER BY date",
                (time.time() - 14 * 86400,),
            ).fetchall()
        ]
        # De donde vino el trabajo y con que modelo se pago: las dos preguntas
        # que se hace cualquiera que mira una factura.
        by_channel = [
            dict(r) for r in conn.execute(
                "SELECT source AS name, COUNT(*) AS sessions, "
                "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
                "FROM sessions WHERE started_at >= ? "
                "GROUP BY source ORDER BY cost_usd DESC",
                (since,),
            ).fetchall()
        ]
        by_model = [
            dict(r) for r in conn.execute(
                "SELECT COALESCE(model, 'sin dato') AS name, COUNT(*) AS sessions, "
                "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
                "FROM sessions WHERE started_at >= ? "
                "GROUP BY model ORDER BY cost_usd DESC LIMIT 8",
                (since,),
            ).fetchall()
        ]
        conn.close()
    except sqlite3.Error:
        pass
    return {
        "available": True,
        "sessions": row["sessions"],
        "input_tokens": row["input_tokens"],
        "output_tokens": row["output_tokens"],
        "total_tokens": row["input_tokens"] + row["output_tokens"],
        # Estimado del propio Hermes (estimated_cost_usd), no un calculo nuestro.
        "cost_usd": row["cost_usd"],
        "period": f"{days}d",
        "daily": daily,
        "by_channel": by_channel,
        "by_model": by_model,
    }


# ---------- http ----------

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, DELETE, OPTIONS")
        self.send_header("Vary", "Origin")

    def _send(self, code, payload):
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, code, data):
        # SIEMPRE text/plain (anti-XSS): jamas un content-type que ejecute
        # o dispare download.
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        auth = self.headers.get("Authorization", "")
        if not TOKEN or auth != f"Bearer {TOKEN}":
            self._send(401, {"error": "unauthorized"})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self._authed():
            return
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        # ?board=<slug> elige tablero; sin el parametro, el de siempre.
        slug = ""
        for chunk in parsed.query.split("&"):
            if chunk.startswith("board="):
                slug = unquote(chunk[len("board="):])
        db = board_db(slug)
        if db is None:
            return self._send(404, {"error": "board not found"})
        try:
            if path == "/portal/manifest":
                return self._send(200, manifest())
            if path == "/portal/capabilities":
                return self._send(200, capabilities())
            m = re.match(r"^/portal/skills/([^/]+)$", path)
            if m:
                ruta = _skill_editable(m.group(1))
                if ruta is None:
                    return self._send(404, {"error": "esa habilidad no existe o no es editable"})
                return self._send(200, {"name": m.group(1),
                                        "content": ruta.read_text(encoding="utf-8")})
            if path == "/portal/connections":
                return self._send(200, connections())
            if path == "/portal/boards":
                return self._send(200, {"boards": boards()})
            if path == "/portal/tickets":
                return self._send(200, {"tickets": tickets(db)})
            m = re.match(r"^/portal/tickets/([^/]+)$", path)
            if m:
                if not TASK_ID_RE.match(m.group(1)):
                    return self._send(400, {"error": "invalid ticket id"})
                detail = ticket_detail(m.group(1), db)
                if detail is None:
                    return self._send(404, {"error": "ticket not found"})
                return self._send(200, detail)
            if path == "/portal/approvals":
                return self._send(200, {"approvals": approvals(db)})
            m = re.match(r"^/portal/crons/([^/]+)$", path)
            if m:
                detail = cron_detail(m.group(1))
                if detail is None:
                    return self._send(404, {"error": "cron not found"})
                return self._send(200, detail)
            if path == "/portal/activity":
                return self._send(200, {"events": activity()})
            if path == "/portal/files":
                return self._send(200, {"files": files_list()})
            if path.startswith("/portal/files/"):
                target = file_resolve(path[len("/portal/files/"):])
                if target is None:
                    return self._send(404, {"error": "not found"})
                if target.stat().st_size > MAX_FILE_BYTES:
                    return self._send(413, {"error": "file too large"})
                return self._send_text(200, target.read_bytes())
            if path == "/portal/artifacts":
                return self._send(200, {"artifacts": artifacts_list()})
            m = re.match(r"^/portal/artifacts/([^/]+)$", path)
            if m:
                detail = artifact_detail(m.group(1))
                if detail is None:
                    return self._send(404, {"error": "artifact not found"})
                return self._send(200, detail)
            if path == "/portal/usage":
                return self._send(200, usage())
        except (sqlite3.Error, OSError) as exc:
            return self._send(500, {"error": str(exc)})
        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if not self._authed():
            return
        path = unquote(urlparse(self.path).path)
        m = re.match(r"^/portal/artifacts/([^/]+)$", path)
        if not m:
            return self._send(404, {"error": "not found"})
        try:
            if not artifact_delete(m.group(1)):
                return self._send(404, {"error": "artifact not found"})
        except OSError as exc:
            return self._send(500, {"error": str(exc)})
        return self._send(200, {"ok": True})

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def _proxy_chat_stream(self, session_id, body):
        # SSE linea a linea: readline() devuelve apenas llega cada evento
        # (read(n) bufferearia hasta completar n bytes y mataria el streaming).
        req = urllib.request.Request(
            f"{AGENT_BASE}/api/sessions/{session_id}/chat/stream",
            data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {TOKEN}",
                     "Content-Type": "application/json"},
            method="POST",
        )
        try:
            upstream = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as exc:
            return self._send(exc.code, {"error": exc.read().decode("utf-8", "replace")[:400]})
        except OSError as exc:
            return self._send(502, {"error": f"no pude hablar con el agente: {exc}"})
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            for line in upstream:
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # el cliente corto el stream (boton detener): normal
        finally:
            upstream.close()

    def _guardar_skill(self, nombre, body):
        """Escribe el SKILL.md de una habilidad NUESTRA desde el portal.

        Cambiar la skill es cambiar como trabaja el agente: la edicion es del
        cliente (o nuestra), asi que se acepta tal cual — con dos redes: tope
        de tamano, y frontmatter obligatorio, porque sin el la skill se indexa
        con descripcion vacia y el agente deja de usarla (regla verificada del
        kit, y una falla silenciosa que el cliente no puede diagnosticar).
        """
        ruta = _skill_editable(nombre)
        if ruta is None:
            return self._send(404, {"error": "esa habilidad no existe o no es editable"})
        contenido = body.get("content")
        if not isinstance(contenido, str) or not contenido.strip():
            return self._send(400, {"error": "content is required"})
        if len(contenido.encode("utf-8")) > 64 * 1024:
            return self._send(400, {"error": "la habilidad supera 64KB"})
        arranque = contenido.lstrip()
        partes = arranque.split("---")
        bien_formada = (arranque.startswith("---") and len(partes) >= 3
                        and "name" in partes[1] and "description" in partes[1])
        if not bien_formada:
            return self._send(400, {"error":
                "el archivo tiene que empezar con el encabezado --- name/description --- "
                "(sin eso el agente deja de usar la habilidad)"})
        ruta.write_text(contenido, encoding="utf-8")
        return self._send(200, {"ok": True})

    def _guardar_identidad(self, body):
        """Bautizo y pinta del agente, elegidos por el cliente en el portal.

        Se hace merge contra lo guardado: el portal puede mandar solo el nombre
        o solo el look sin borrar el otro.
        """
        previo = identidad()
        nuevo = dict(previo)
        if "nombre" in body:
            # Una sola linea: el nombre entra en el SOUL, y un salto ahi
            # rompería el bloque acotado.
            nombre = re.sub(r"\s+", " ", str(body.get("nombre") or "")).strip()
            if not nombre:
                return self._send(400, {"error": "nombre is required"})
            if len(nombre) > MAX_NOMBRE_LEN:
                return self._send(400, {
                    "error": f"el nombre no puede pasar de {MAX_NOMBRE_LEN} caracteres"})
            nuevo["nombre"] = nombre
        if "look" in body:
            look = _look_limpio(body.get("look"))
            if look is None:
                return self._send(400, {"error": "look invalido"})
            nuevo["look"] = look
        if not nuevo:
            return self._send(400, {"error": "nombre or look is required"})
        try:
            IDENTIDAD.write_text(json.dumps(nuevo, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:
            return self._send(500, {"error": f"no pude guardar la identidad: {exc}"})
        # Con el nombre nuevo, se lo contamos a los lados que podemos tocar. Es
        # best-effort a proposito: el bautizo ya quedo guardado, y que Telegram
        # nos limite o falte el SOUL no puede tumbar la respuesta.
        aplicado = {}
        if nuevo.get("nombre") and nuevo.get("nombre") != previo.get("nombre"):
            aplicado["soul"] = escribir_nombre_en_soul(nuevo["nombre"])
            aplicado["telegram"] = nombre_en_telegram(nuevo["nombre"])
        return self._send(200, {"ok": True, **nuevo, "aplicado": aplicado})

    def _upload(self, body):
        """Guarda un archivo que el cliente manda desde el portal.

        Llega en base64 dentro del JSON (no multipart: http.server no lo parsea
        y no vale la pena escribir un parser). Va SIEMPRE a workspace/entrada/,
        con el nombre saneado: nada de rutas, ni de escribir en otro lado.
        """
        import base64

        name = os.path.basename(str(body.get("name") or "")).strip()
        name = re.sub(r"[^\w.\- ]", "_", name)[:120]
        if not name or name.startswith("."):
            return self._send(400, {"error": "nombre de archivo invalido"})
        try:
            data = base64.b64decode(str(body.get("content_b64") or ""), validate=True)
        except (ValueError, TypeError):
            return self._send(400, {"error": "contenido invalido (se espera base64)"})
        if not data:
            return self._send(400, {"error": "el archivo vino vacio"})
        if len(data) > MAX_UPLOAD_BYTES:
            return self._send(413, {"error": "el archivo supera 10MB"})

        INBOX.mkdir(parents=True, exist_ok=True)
        target = (INBOX / name).resolve()
        try:
            target.relative_to(INBOX.resolve())
        except ValueError:
            return self._send(400, {"error": "nombre de archivo invalido"})
        if target.exists():  # no pisamos lo que ya subio antes
            stem, suffix = target.stem, target.suffix
            n = 2
            while (INBOX / f"{stem}-{n}{suffix}").exists():
                n += 1
            target = INBOX / f"{stem}-{n}{suffix}"
        target.write_bytes(data)
        rel = target.relative_to(WORKSPACE.resolve()).as_posix()
        return self._send(200, {"ok": True, "path": f"workspace/{rel}", "bytes": len(data)})

    def do_POST(self):
        if not self._authed():
            return
        path = unquote(urlparse(self.path).path)
        if path == "/portal/upload":
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            return self._upload(body)
        if path == "/portal/identity":
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            return self._guardar_identidad(body)
        m = re.match(r"^/portal/skills/([^/]+)$", path)
        if m:
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            return self._guardar_skill(m.group(1), body)

        # --- conexion Google self-service ---
        if path == "/portal/connections/google/auth-url":
            if not GOOGLE_CLIENT_SECRET.is_file():
                return self._send(409, {"error": "falta un paso nuestro para habilitar Google"})
            try:
                return self._send(200, {"auth_url": google_auth_url()})
            except (OSError, ValueError, KeyError):
                return self._send(500, {"error": "no pude armar el pedido a Google"})
        if path == "/portal/connections/google/auth-code":
            body = self._read_json_body()
            if body is None or not str(body.get("code") or "").strip():
                return self._send(400, {"error": "code is required"})
            res = google_auth_code(str(body["code"]))
            return self._send(200 if res.get("ok") else 400, res)
        m = re.match(r"^/portal/sessions/([^/]+)/chat/stream$", path)
        if m:
            body = self._read_json_body()
            if body is None or not str(body.get("message") or "").strip():
                return self._send(400, {"error": "message is required"})
            return self._proxy_chat_stream(m.group(1), body)

        # --- escrituras del kanban (todo por CLI, jamas SQL) ---
        if path == "/portal/tickets":
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            title = str(body.get("title") or "").strip()
            if not title:
                return self._send(400, {"error": "title is required"})
            try:
                task_id = create_ticket(
                    title,
                    str(body.get("body") or "").strip(),
                    str(body.get("tenant") or "").strip(),
                )
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                return self._send(502, {"error": str(exc)})
            return self._send(200, {"ok": True, "id": task_id})

        m = re.match(r"^/portal/tickets/([^/]+)/(comment|status)$", path)
        if m:
            task_id, action = m.group(1), m.group(2)
            if not TASK_ID_RE.match(task_id):
                return self._send(400, {"error": "invalid ticket id"})
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            # Validaciones de forma ANTES de tocar la db: un status invalido es
            # 400 aunque el ticket no exista.
            text = status = None
            if action == "comment":
                text = str(body.get("body") or "").strip()
                if not text:
                    return self._send(400, {"error": "body is required"})
            else:
                status = str(body.get("status") or "").strip()
                if status not in STATUS_CMD:
                    return self._send(400, {
                        "error": "invalid status",
                        "allowed": sorted(STATUS_CMD),
                    })
            try:
                if task_status(task_id) is None:
                    return self._send(404, {"error": "ticket not found"})
            except sqlite3.Error as exc:
                return self._send(500, {"error": str(exc)})
            try:
                if action == "comment":
                    # Default = el humano del portal; si el cliente manda
                    # `author`, lo respetamos (sanitizado).
                    autor = safe_author(body.get("author"), AUTHOR_HUMAN)
                    comment_ticket(task_id, text, autor)
                    # Y le avisamos al agente: si no, el comentario queda ahi
                    # y nadie se entera (ver notify_agent_of_comment).
                    notify_agent_of_comment(task_id, text, autor)
                else:
                    set_ticket_status(task_id, status)
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                return self._send(502, {"error": str(exc)})
            return self._send(200, {"ok": True})

        m = re.match(r"^/portal/approvals/([^/]+)/(approve|reject)$", path)
        if not m:
            return self._send(404, {"error": "not found"})
        task_id, action = m.group(1), m.group(2)
        if not TASK_ID_RE.match(task_id):
            return self._send(400, {"error": "invalid ticket id"})
        try:
            status = task_status(task_id)
        except sqlite3.Error as exc:
            return self._send(500, {"error": str(exc)})
        if status is None:
            return self._send(404, {"error": "ticket not found"})
        if status != "blocked":
            return self._send(409, {"error": f"ticket is not blocked (status={status})"})

        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "invalid JSON body"})
        # Autoria: approve/reject firman con AUTHOR_AUDIT ("portal"), distinto
        # del profile del agente ("default") y distinto de AUTHOR_HUMAN
        # ("cliente", el default de POST /portal/tickets/{id}/comment). Asi en
        # el detalle del ticket se lee de un vistazo quien dijo cada cosa:
        # agente / accion auditada del portal / persona escribiendo.
        try:
            if action == "approve":
                # Aprobar con correccion: el CLI no puede editar el body de un
                # ticket bloqueado (`kanban edit` solo backfillea tareas done),
                # asi que la version corregida entra como comentario del humano
                # ANTES de desbloquear. El agente debe usar esa version: es la
                # ultima palabra del cliente sobre que ejecutar.
                correction = str(body.get("correction") or "").strip()
                if correction:
                    hermes_cli("comment", f"--author={AUTHOR_HUMAN}", "--", task_id,
                               "Aprobado CON CORRECCIONES. Usa exactamente esta "
                               f"version, no la original:\n\n{correction}")
                    hermes_cli("comment", f"--author={AUTHOR_AUDIT}", "--", task_id,
                               "Aprobado desde el portal (con correcciones)")
                else:
                    hermes_cli("comment", f"--author={AUTHOR_AUDIT}", "--",
                               task_id, "Aprobado desde el portal")
                hermes_cli("unblock", "--", task_id)
            else:
                reason = str(body.get("reason") or "").strip()
                if not reason:
                    return self._send(400, {"error": "reason is required"})
                hermes_cli("comment", f"--author={AUTHOR_AUDIT}", "--",
                           task_id, f"Rechazado desde el portal: {reason}")
                # Reject NO desbloquea: el ticket queda blocked a la espera.
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            return self._send(502, {"error": str(exc)})
        return self._send(200, {"ok": True})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    # Threading: un stream SSE abierto no puede bloquear el resto del portal.
    ThreadingHTTPServer(("0.0.0.0", 8643), Handler).serve_forever()
