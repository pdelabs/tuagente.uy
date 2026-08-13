#!/usr/bin/env python3
"""Crea (o actualiza el gatillo de) un flujo del cliente.

EL SCRIPT ES DUENO DEL FORMATO: el agente pasa nombre, gatillo y piezas; el
script escribe el FLUJO.md con el frontmatter que el portal sabe leer, crea el
cron si el gatillo lo pide, y deja el job_id enlazado. Asi todos los flujos de
todos los clientes tienen la misma forma y el portal nunca encuentra uno roto.

Decisiones fijadas:
- El cron se crea con --deliver local: el aviso al cliente lo da EL AGENTE
  siguiendo el cuerpo del flujo (deliver=origin desde un cron entrega a la
  nada — trampa verificada).
- Frecuencia minima 5 minutos: un agente entusiasta no puede programarse
  despertares infinitos.
- El prompt del cron es siempre el mismo: "trabaja el flujo <slug>" — la
  logica vive en el FLUJO.md, que el cliente puede ver y el agente editar.

Uso:
    python3 crear_flujo.py --slug entrevistas-tv --nombre "Entrevistas → zócalos" \
        --para-cliente "Cada entrevista termina en..." \
        --gatillo drive --detalle "Mira tu Drive cada 15 minutos" \
        --cron "*/15 * * * *" --carpetas id1,id2 \
        --conexiones google-workspace,modelos-auxiliares \
        --skills entrada-drive,transcribir,frases-zocalo,entregable <<'MD'
    # Cómo trabajo este flujo
    1. ...
    MD
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FLUJOS = Path("/opt/data/flujos")

# EL BINARIO SE RESUELVE, NO SE INVOCA POR NOMBRE. La herramienta `terminal` del
# agente corre con un PATH saneado —/usr/local/bin:/usr/bin:/bin:/usr/local/games:
# /usr/games— que NO tiene /opt/hermes/bin, asi que `["hermes", ...]` moria con
# "[Errno 2] No such file or directory: 'hermes'" y NINGUN flujo se creaba.
# Verificado en la corrida de conducta del 12/8 y en produccion: el directorio
# flujos/ del agente no existia, la funcionalidad nunca habia andado.
CANDIDATOS_HERMES = (
    "/opt/hermes/bin/hermes",
    "/opt/hermes/.venv/bin/hermes",
)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")
GATILLOS = ("drive", "horario", "pedido")
MIN_MINUTOS = 5
# Topes del cuerpo VISIBLE (lo que el portal le muestra al cliente).
MAX_PASOS = 7
MAX_LARGO_PASO = 320


def fallo(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    return 2


def binario_hermes():
    """La ruta del CLI de Hermes, o None si de verdad no está.

    Se prueban todos los candidatos y recién al final el PATH: que el primero
    exista pero no se pueda ejecutar (permisos, montaje raro) no puede dejarnos
    sin CLI habiendo otro al lado.
    """
    for ruta in CANDIDATOS_HERMES:
        if os.access(ruta, os.X_OK):
            return ruta
    return shutil.which("hermes")


def cron(binario, *args, timeout=30):
    """Corre `hermes cron ...` y devuelve (salida, error)."""
    try:
        r = subprocess.run([binario, "cron", *args],
                           capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return "", str(e)
    return (r.stdout or ""), (r.stderr or "")


def _muy_frecuente(cron):
    """True si el cron corre mas seguido que cada MIN_MINUTOS."""
    m = re.match(r"^\*/(\d+) \* \* \* \*$", cron.strip())
    if m:
        return int(m.group(1)) < MIN_MINUTOS
    return cron.strip().startswith("* ")  # cada minuto


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--nombre", required=True)
    ap.add_argument("--para-cliente", required=True, dest="para_cliente",
                    help="que hace el flujo, dicho AL CLIENTE (sin jerga)")
    ap.add_argument("--gatillo", required=True, choices=GATILLOS)
    ap.add_argument("--detalle", required=True,
                    help='el gatillo en criollo: "Mira tu Drive cada 15 minutos"')
    ap.add_argument("--cron", default="", help="obligatorio si gatillo != pedido")
    ap.add_argument("--carpetas", default="", help="ids de Drive (gatillo drive)")
    # OBLIGATORIO, y a proposito. Omitirlo era gratis, y el agente lo omitia
    # incluso cuando el trabajo tocaba el correo: en vez de declarar que le
    # faltaba la conexion, achicaba el alcance en silencio ("solo preparo
    # borradores") y el flujo salia VERDE en el portal. El cliente nunca se
    # enteraba de que conectando el correo el trabajo se completaba. Ahora hay
    # que contestar, aunque la respuesta sea "ninguna".
    ap.add_argument("--conexiones", required=True,
                    help='ids del catalogo separados por coma, o "ninguna"')
    ap.add_argument("--skills", default="")
    args = ap.parse_args()

    if not SLUG_RE.match(args.slug):
        return fallo("slug invalido: minusculas, numeros y guiones")
    if args.gatillo != "pedido" and not args.cron:
        return fallo(f"gatillo {args.gatillo} necesita --cron")
    if args.cron and _muy_frecuente(args.cron):
        return fallo(f"frecuencia minima: cada {MIN_MINUTOS} minutos")

    cuerpo = sys.stdin.read().strip()

    # El cuerpo lo LEE EL CLIENTE en el portal ("Cómo lo trabaja tu agente").
    # Sin tope, sale un documento interno: el primer flujo de Instagram tenia
    # 13 pasos de parrafos de seis renglones y nadie iba a leer eso. Lo que
    # sobra no se tira: va a "## Notas tecnicas", que el portal recorta.
    visible = cuerpo.split("## Notas")[0]
    pasos = [l for l in visible.splitlines() if re.match(r"^\s*\d+[.)]\s", l)]
    if len(pasos) > MAX_PASOS:
        return fallo(f"el cuerpo visible tiene {len(pasos)} pasos y el maximo es "
                     f"{MAX_PASOS}: agrupa o move el detalle a '## Notas tecnicas'")
    largos = [i + 1 for i, l in enumerate(pasos) if len(l) > MAX_LARGO_PASO]
    if largos:
        return fallo(f"los pasos {largos} pasan de {MAX_LARGO_PASO} caracteres: "
                     "el cliente los tiene que poder leer de un vistazo; el "
                     "detalle va a '## Notas tecnicas'")
    if not cuerpo:
        return fallo("falta el cuerpo (las instrucciones de como trabajas el flujo)")

    carpeta = FLUJOS / args.slug
    if (carpeta / "FLUJO.md").exists():
        return fallo(f"el flujo {args.slug} ya existe: editalo en vez de recrearlo")

    job_id = ""
    if args.cron:
        binario = binario_hermes()
        if not binario:
            return fallo(
                "no encontré el CLI de Hermes (busqué en " + ", ".join(CANDIDATOS_HERMES)
                + " y en el PATH). Sin eso no puedo programar nada: NO cuentes que el "
                "flujo quedó andando"
            )
        prompt = (f"Trabaja el flujo {args.slug}: abri /opt/data/flujos/{args.slug}/FLUJO.md "
                  "y segui sus instrucciones tal cual. Si el gatillo no encuentra nada "
                  "nuevo, termina en silencio.")
        salida, error = cron(binario, "create", args.cron, prompt,
                             f"--name=flujo-{args.slug}", "--deliver=local")
        m = re.search(r"Created job:\s*([0-9a-f]+)", salida)
        if not m:
            return fallo(f"el cron no se creo: {(error or salida).strip()[:200]}")
        job_id = m.group(1)

        # Y AHORA SE VERIFICA QUE QUEDO. Que el create haya impreso un id no
        # alcanza: lo que le decimos al cliente es "esto va a correr solo", y eso
        # se afirma despues de verlo en la lista, no antes.
        # Se compara por ID, NO por nombre: si ya existía un `flujo-<slug>` de
        # antes y el nuevo no persistió, el nombre estaría igual y daríamos por
        # creado un job que no es el que acabamos de pedir.
        listado, err_listado = cron(binario, "list")
        if job_id not in listado:
            return fallo(
                f"el cron dijo que creó {job_id} pero ese id no aparece en "
                f"`hermes cron list` ({(err_listado or listado).strip()[:120]}) — "
                "no lo des por creado"
            )

    front = [
        "---",
        f"nombre: {args.nombre}",
        f'para_cliente: "{args.para_cliente}"',
        f"gatillo_tipo: {args.gatillo}",
        f"gatillo_detalle: {args.detalle}",
    ]
    if args.cron:
        front.append(f'gatillo_cron: "{args.cron}"')
    if args.carpetas:
        front.append(f"gatillo_carpetas: {args.carpetas}")
    if job_id:
        front.append(f"gatillo_job: {job_id}")
    if args.conexiones and args.conexiones.strip().lower() not in ("ninguna", "-"):
        front.append(f"conexiones: {args.conexiones}")
    if args.skills:
        front.append(f"skills: {args.skills}")
    front.append(f"resultados: entregables/{args.slug}")
    front.append("estado: activo")
    front.append("---")

    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / "FLUJO.md").write_text("\n".join(front) + f"\n\n{cuerpo}\n", "utf-8")
    (Path("/opt/data/workspace/entregables") / args.slug).mkdir(parents=True, exist_ok=True)

    print(json.dumps({
        "ok": True,
        "flujo": str(carpeta / "FLUJO.md"),
        "cron_job": job_id or None,
        "nota": "El cliente ya lo ve en su pestaña Flujos. Si le falta una conexion, "
                "el portal se lo pide solo.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
