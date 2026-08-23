#!/usr/bin/env python3
"""La puerta: un servidor MCP que envuelve a otro y aplica la politica.

POR QUE EXISTE
--------------
Un servidor MCP de terceros expone herramientas que actuan sobre el mundo del
cliente —mandar un WhatsApp, mover plata— con SUS credenciales. La puerta de
aprobacion cubre acciones puntuales; lo que faltaba es la politica permanente:
"a WhatsApp puede leer pero no escribir".

Se eligio UNA puerta en vez de forkear cada servidor. Quince forks son quince
repos que hay que seguir upstream, con quince oportunidades de que un merge
devuelva el permiso que sacamos — y la politica quedaria desparramada en
quince lugares, asi que nadie podria contestar "que puede hacer este agente"
sin leer quince repos.

COMO SE PARA
------------
    hermes -> guardia (esto) -> servidor real -> el mundo

Hermes conoce UN solo servidor MCP: este. El de terceros no es alcanzable por
el agente: vive en la red interna del compose, sin puerto publicado, y solo la
guardia llega. Aunque el modelo quisiera saltearla, no tiene ruta.

DOS INVARIANTES, Y NINGUNO ES UNA PROMESA
-----------------------------------------
1. La politica se LEE de /opt/politica, que en el contenedor del agente esta
   montado :ro. El agente no la puede editar aunque razone que le conviene —y
   razona asi: cuando le falto el correo, no pregunto, se acomodo solo.
2. Lo prohibido NO SE ANUNCIA. `tools/list` devuelve unicamente lo permitido,
   asi el modelo no gasta contexto en esquemas que no puede usar (medido: los
   esquemas pesan 60 KB, casi el doble que el system prompt entero) y no se
   tienta con lo que no va.

Si igual llega un `tools/call` de algo bloqueado —por una lista cacheada, por
ejemplo— se responde con un rechazo CON ESTRUCTURA: que conexion, que accion y
donde se cambia. El agente tiene que poder decir "no puedo mandar WhatsApps
porque lo tenes apagado", no un "error" pelado.
"""
import json
import os
import subprocess
import sys
import threading

POLITICA = os.environ.get("GUARDIA_POLITICA", "/opt/politica/politica.json")
CONEXION = os.environ.get("GUARDIA_CONEXION", "")
COMANDO = os.environ.get("GUARDIA_COMANDO", "")


def log(msg):
    """A stderr: stdout es el canal del protocolo y no se ensucia."""
    print(f"[guardia:{CONEXION}] {msg}", file=sys.stderr, flush=True)


def politica():
    """Que puede hacer esta conexion. Ante la duda, lo mas restrictivo.

    Un archivo ilegible NO abre la puerta: si no sabemos que esta permitido,
    no esta permitido nada. Es la unica lectura segura de una falla.
    """
    try:
        with open(POLITICA, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        log(f"sin politica legible ({e}): todo cerrado")
        return {"leer": False, "actuar": False, "tools": {}}
    c = (data.get(CONEXION) or {}) if isinstance(data, dict) else {}
    return {
        "leer": bool(c.get("leer", True)),
        "actuar": bool(c.get("actuar", False)),
        "tools": c.get("tools") or {},
    }


def clases():
    """Que hace cada herramienta, segun la curaduria del kit."""
    ruta = os.environ.get("GUARDIA_TOOLS", f"/opt/politica/tools/{CONEXION}.json")
    try:
        with open(ruta, encoding="utf-8") as f:
            return {k: v.get("clase", "actua")
                    for k, v in (json.load(f).get("tools") or {}).items()}
    except (OSError, ValueError):
        # Sin clasificacion no adivinamos: todo cuenta como que actua.
        log(f"sin clasificacion en {ruta}: todo se trata como 'actua'")
        return {}


def permitida(nombre, pol, cls):
    """True si esta herramienta puede pasar."""
    # Un permiso explicito por herramienta gana sobre la clase.
    if nombre in pol["tools"]:
        return bool(pol["tools"][nombre])
    clase = cls.get(nombre, "actua")   # desconocida = actua = cerrada por defecto
    return pol["leer"] if clase == "lee" else pol["actuar"]


def rechazo(nombre, clase):
    """El 'no' que el agente puede convertir en una frase util."""
    accion = "leer" if clase == "lee" else "escribir o mandar"
    return {
        "content": [{
            "type": "text",
            "text": (
                f"BLOQUEADO POR EL CLIENTE. No puedo usar `{nombre}`: tu cliente "
                f"tiene apagado el permiso de {accion} en la conexion "
                f"'{CONEXION}'.\n\n"
                f"No lo puedas cambiar vos ni por archivo ni por terminal — lo "
                f"cambia el cliente desde el portal. Deciselo y ofrecele el "
                f"control escribiendo `permisos:{CONEXION}` en tu respuesta, que "
                f"el chat lo convierte en los interruptores."
            ),
        }],
        "isError": True,
    }


class Downstream:
    """El servidor real, hablado por stdio con JSON-RPC por lineas."""

    def __init__(self, comando):
        self.proc = subprocess.Popen(
            comando, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=sys.stderr, text=True, bufsize=1)
        self.lock = threading.Lock()

    def pedir(self, mensaje):
        """Manda y ESPERA respuesta. Solo para mensajes con id."""
        with self.lock:
            self.proc.stdin.write(json.dumps(mensaje) + "\n")
            self.proc.stdin.flush()
            linea = self.proc.stdout.readline()
        if not linea:
            raise RuntimeError("el servidor de abajo se murio")
        return json.loads(linea)

    def avisar(self, mensaje):
        """Manda y NO espera nada.

        Las notificaciones de MCP (sin `id`) no se responden NUNCA. Si se las
        manda por `pedir`, el readline se queda colgado para siempre y la
        conexion entera muere en el handshake: todo cliente real manda
        `notifications/initialized` apenas termina el `initialize`.
        """
        with self.lock:
            self.proc.stdin.write(json.dumps(mensaje) + "\n")
            self.proc.stdin.flush()


def main():
    if not COMANDO:
        log("falta GUARDIA_COMANDO (como se levanta el servidor real)")
        return 2
    abajo = Downstream(COMANDO)
    cls = clases()
    log(f"en pie · politica={POLITICA} · {len(cls)} herramientas clasificadas")

    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            msg = json.loads(linea)
        except ValueError:
            continue

        metodo = msg.get("method")
        pol = politica()   # se relee en cada mensaje: un cambio en el portal
                           # tiene efecto en la vuelta siguiente, sin reiniciar.

        # NOTIFICACIONES (sin id): se pasan y no se espera nada. Va PRIMERO,
        # antes que cualquier otra rama, porque esperar respuesta a algo que
        # no la lleva cuelga la conexion entera. Es lo que impedia registrar
        # la guardia: `hermes mcp add` moria en "Failed to connect" y el
        # motivo estaba tres lineas mas abajo, en el `pedir` del final.
        if msg.get("id") is None:
            try:
                abajo.avisar(msg)
            except (OSError, ValueError) as e:
                log(f"no pude pasar la notificacion {metodo}: {e}")
            continue

        # tools/list: se devuelve SOLO lo permitido.
        if metodo == "tools/list":
            resp = abajo.pedir(msg)
            todas = ((resp.get("result") or {}).get("tools") or [])
            deja = [t for t in todas if permitida(t.get("name", ""), pol, cls)]
            if len(deja) != len(todas):
                log(f"tools/list: {len(deja)}/{len(todas)} permitidas")
            resp.setdefault("result", {})["tools"] = deja
            print(json.dumps(resp), flush=True)
            continue

        # tools/call: se corta ACA si no corresponde.
        if metodo == "tools/call":
            nombre = (msg.get("params") or {}).get("name", "")
            if not permitida(nombre, pol, cls):
                log(f"BLOQUEADA {nombre}")
                print(json.dumps({
                    "jsonrpc": "2.0", "id": msg.get("id"),
                    "result": rechazo(nombre, cls.get(nombre, "actua")),
                }), flush=True)
                continue

        # Todo lo demas (initialize, ping, resources...) pasa tal cual.
        try:
            print(json.dumps(abajo.pedir(msg)), flush=True)
        except (RuntimeError, ValueError) as e:
            log(f"error hablando con el servidor de abajo: {e}")
            if msg.get("id") is not None:
                print(json.dumps({
                    "jsonrpc": "2.0", "id": msg["id"],
                    "error": {"code": -32603, "message": str(e)},
                }), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
