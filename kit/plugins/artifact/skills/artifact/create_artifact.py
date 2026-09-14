#!/usr/bin/env python3
"""Create an HTML artifact viewable in the tuagente portal.

The script OWNS THE FORMAT: it receives only the content (the <body>) and
takes care of the shell, the brand CSS, the id, the path and the metadata.
That way every artifact of every agent looks the same and the portal finds
them.

Usage:
    python3 create_artifact.py --title "Leads por mes" [--kind chart]
                               [--summary "una linea"] [--id art_xxx]
                               < cuerpo.html

Prints a JSON with the id and the reference to cite in the chat.
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

ARTIFACTS = Path(os.environ.get("ARTIFACTS_DIR", "/opt/data/workspace/artifacts"))
KINDS = ("chart", "table", "report", "dashboard", "diagram", "other")
MAX_BYTES = 2 * 1024 * 1024

# External resources: the portal draws artifacts inside an isolated iframe
# with no guaranteed network, so a <script src=cdn> renders blank. We warn.
EXTERNAL_RE = re.compile(
    r"""<(?:script|link|img|iframe)[^>]+(?:src|href)\s*=\s*["']https?://""",
    re.I,
)

SHELL = """<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{
    --primary:#5B4BE8; --primary-dark:#4536C7; --surface:#FBFAFF; --ink:#14131F;
    --ink-soft:#5B5870; --line:rgba(0,0,0,0.08);
    --violet:#EAE6FF; --green:#CFF3E4; --coral:#FFDFD6; --amber:#FBEECB;
  }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; padding:24px; background:var(--surface); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:14px; line-height:1.55; -webkit-font-smoothing:antialiased;
  }}
  h1 {{ font-size:20px; font-weight:700; letter-spacing:-0.01em; margin:0 0 4px; }}
  h2 {{ font-size:15px; font-weight:700; margin:20px 0 8px; }}
  p {{ margin:8px 0; }}
  .sub {{ color:var(--ink-soft); font-size:13px; margin:0 0 20px; }}
  table {{ border-collapse:collapse; width:100%; font-size:13px; }}
  th, td {{ text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }}
  th {{ background:rgba(0,0,0,0.03); font-weight:600; }}
  tbody tr:hover {{ background:rgba(91,75,232,0.04); }}
  .num {{ font-variant-numeric:tabular-nums; text-align:right; }}
  .card {{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; }}
  .grid {{ display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }}
  .kpi {{ font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; }}
  .kpi-label {{ font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-soft); }}
  .chip {{ display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }}
  .chip-v {{ background:var(--violet); color:#2A1E86; }}
  .chip-g {{ background:var(--green); color:#0B5B3F; }}
  .chip-c {{ background:var(--coral); color:#8A2F1B; }}
  .chip-a {{ background:var(--amber); color:#6B4E06; }}
  .bar {{ background:var(--primary); border-radius:4px 4px 0 0; }}
  svg {{ max-width:100%; height:auto; }}
  footer {{ margin-top:28px; padding-top:12px; border-top:1px solid var(--line);
            color:var(--ink-soft); font-size:11px; }}
</style>
<h1>{title}</h1>
<p class="sub">{summary}</p>
{body}
<footer>Generado por {agent} · {stamp}</footer>
</html>
"""


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_-]+", "-", text)[:48] or "artifact"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--kind", default="other", choices=KINDS)
    ap.add_argument("--summary", default="")
    ap.add_argument("--id", default="", help="para reemplazar uno existente")
    ap.add_argument("--body-file", default="", help="si no, se lee de stdin")
    args = ap.parse_args()

    body = Path(args.body_file).read_text("utf-8") if args.body_file else sys.stdin.read()
    body = body.strip()
    if not body:
        print(json.dumps({"ok": False, "error": "the artifact body came in empty"}))
        return 2
    if len(body.encode()) > MAX_BYTES:
        print(json.dumps({"ok": False, "error": "the artifact is over 2MB"}))
        return 2

    warnings = []
    if EXTERNAL_RE.search(body):
        warnings.append(
            "there are external (http) resources that will probably not load: "
            "use inline SVG/CSS and embedded data instead"
        )

    now = int(time.time())
    art_id = args.id or f"art_{now}_{slugify(args.title)}"
    if not re.fullmatch(r"[\w.-]+", art_id):
        print(json.dumps({"ok": False, "error": "invalid id"}))
        return 2

    agent = os.environ.get("AGENT_NAME", "tu agente")
    stamp = time.strftime("%d/%m/%Y %H:%M", time.localtime(now))
    html = SHELL.format(
        title=args.title, summary=args.summary, body=body, agent=agent, stamp=stamp
    )

    folder = ARTIFACTS / art_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.html").write_text(html, "utf-8")
    meta = {
        "id": art_id,
        "title": args.title,
        "kind": args.kind,
        "summary": args.summary,
        "created_at": now,
        "bytes": len(html.encode()),
    }
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), "utf-8")

    print(json.dumps({
        "ok": True,
        "id": art_id,
        "path": str(folder / "index.html"),
        "reference": art_id,
        "warnings": warnings,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
