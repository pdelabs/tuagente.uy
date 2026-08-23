#!/usr/bin/env python3
"""Build the body of an approval request, with a stable format.

The human seeing the SAME layout every time (what will be done, what happens
if approved, what happens if rejected, and the content to review) cannot
depend on the model remembering. The script prints the markdown ready to paste
into the ticket description; the agent only supplies the content.

Usage:
    python3 format_request.py \\
      --what "Enviar el mail de respuesta a Acme" \\
      --if-approved "Se envia el mail tal cual esta abajo" \\
      --if-rejected "No se envia nada y quedo esperando tu correccion" \\
      [--why "Es el primer contacto con la empresa"] \\
      [--risk "Sale desde la casilla comercial"] \\
      < contenido_a_revisar.md
"""
import argparse
import sys


TEMPLATE = """**Qué quiero hacer:** {what}

| | |
|---|---|
| Si aprobás | {if_approved} |
| Si rechazás | {if_rejected} |
{extra}
---

{content}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--what", required=True)
    ap.add_argument("--if-approved", required=True, dest="if_approved")
    ap.add_argument("--if-rejected", required=True, dest="if_rejected")
    ap.add_argument("--why", default="")
    ap.add_argument("--risk", default="")
    ap.add_argument("--content-file", default="")
    args = ap.parse_args()

    content = (
        open(args.content_file, encoding="utf-8").read()
        if args.content_file else sys.stdin.read()
    ).strip()
    if not content:
        print("ERROR: missing the content to review (via stdin or --content-file)",
              file=sys.stderr)
        return 2

    rows = []
    if args.why:
        rows.append(f"| Por qué | {args.why} |")
    if args.risk:
        rows.append(f"| A tener en cuenta | {args.risk} |")
    extra = ("\n".join(rows) + "\n") if rows else ""

    # One line per cell: a line break inside a markdown table breaks it, and
    # the portal renders it as a real table.
    def flat(s):
        return " ".join(s.split())

    print(TEMPLATE.format(
        what=flat(args.what),
        if_approved=flat(args.if_approved),
        if_rejected=flat(args.if_rejected),
        extra=extra,
        content=content,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
