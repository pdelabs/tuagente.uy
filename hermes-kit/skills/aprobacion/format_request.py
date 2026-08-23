#!/usr/bin/env python3
"""Arma el cuerpo de una solicitud de aprobacion, con formato estable.

Que el humano vea SIEMPRE lo mismo (que se va a hacer, que pasa si aprueba, que
pasa si rechaza, y el contenido a revisar) no puede depender de que el modelo se
acuerde. El script imprime el markdown listo para pegar en la descripcion del
ticket; el agente solo aporta el contenido.

Uso:
    python3 format_request.py \\
      --que "Enviar el mail de respuesta a Acme" \\
      --si-apruebo "Se envia el mail tal cual esta abajo" \\
      --si-rechazo "No se envia nada y quedo esperando tu correccion" \\
      [--por-que "Es el primer contacto con la empresa"] \\
      [--riesgo "Sale desde la casilla comercial"] \\
      < contenido_a_revisar.md
"""
import argparse
import sys


TEMPLATE = """**Qué quiero hacer:** {que}

| | |
|---|---|
| Si aprobás | {si_apruebo} |
| Si rechazás | {si_rechazo} |
{extra}
---

{contenido}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--que", required=True)
    ap.add_argument("--si-apruebo", required=True, dest="si_apruebo")
    ap.add_argument("--si-rechazo", required=True, dest="si_rechazo")
    ap.add_argument("--por-que", default="", dest="por_que")
    ap.add_argument("--riesgo", default="")
    ap.add_argument("--content-file", default="")
    args = ap.parse_args()

    contenido = (
        open(args.content_file, encoding="utf-8").read()
        if args.content_file else sys.stdin.read()
    ).strip()
    if not contenido:
        print("ERROR: falta el contenido a revisar (por stdin o --content-file)",
              file=sys.stderr)
        return 2

    filas = []
    if args.por_que:
        filas.append(f"| Por qué | {args.por_que} |")
    if args.riesgo:
        filas.append(f"| A tener en cuenta | {args.riesgo} |")
    extra = ("\n".join(filas) + "\n") if filas else ""

    # Una sola linea por celda: un salto de linea dentro de una tabla markdown
    # la rompe, y el portal la renderiza como tabla de verdad.
    def flat(s):
        return " ".join(s.split())

    print(TEMPLATE.format(
        que=flat(args.que),
        si_apruebo=flat(args.si_apruebo),
        si_rechazo=flat(args.si_rechazo),
        extra=extra,
        contenido=contenido,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
