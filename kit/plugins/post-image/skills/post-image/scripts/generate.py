#!/usr/bin/env python3
"""Generate one piece with OpenRouter's Images API.

NOT RUN BY THE AGENT. It needs OPENROUTER_API_KEY in the environment and the
agent's terminal does not have it: tested twice against the live agent, it
fails with "falta OPENROUTER_API_KEY". The skill tells it to use the engine's
`image_generate` tool instead, which runs inside the process that does have
the key.

This stays here for US to run (docker exec, with the container's environment),
and for the day Seedream comes in through the tool: this path costs US$0.045
against US$0.2266, and it takes aspect_ratio and references without translation.

NOT the engine's image_generate tool, and the difference matters: that plugin
talks to /chat/completions with `modalities`, which the image-first models reject
(Seedream answers 500 there, and gpt-image-class models ignore the aspect ratio
and hand back a square -- useless for a story).

The Images API takes `aspect_ratio` as a real parameter, so 9:16 comes out 9:16,
and it takes `input_references`, which is how the client's own style references
reach the model.

Measured 14/8/2026 on the same brief:
    seedream-5-0-pro  $0.045  117 s  9:16 correcto
    gpt-5.4-image-2   $0.227  103 s  cuadrada
"""

import argparse
import base64
import json
import mimetypes
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://openrouter.ai/api/v1/images"
DEFAULT_MODEL = "bytedance-seed/seedream-5-0-pro"
MAX_REFERENCES = 14          # API cap
MAX_REFERENCE_BYTES = 4 * 1024 * 1024

# The post's format decides the aspect ratio, and it is not negotiable: a
# square story does not work, and the model does not infer it from the
# prompt's text.
ASPECT = {"feed": "4:5", "carousel": "4:5", "story": "9:16", "reel": "9:16"}


def as_data_url(path):
    raw = Path(path).read_bytes()
    if len(raw) > MAX_REFERENCE_BYTES:
        return None
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def main():
    parser = argparse.ArgumentParser(description="Generate one piece from a brief.")
    parser.add_argument("--format", required=True, choices=sorted(ASPECT))
    parser.add_argument("--out", required=True)
    parser.add_argument("--prompt-file", default="", help="if not given, read from stdin")
    parser.add_argument("--references", nargs="*", default=[])
    parser.add_argument("--model", default=os.environ.get("OPENROUTER_IMAGE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--resolution", default="2K", choices=("1K", "2K"))
    parser.add_argument("--seed", type=int, default=0, help="0 = random")
    args = parser.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        print(json.dumps({"ok": False, "error": "missing OPENROUTER_API_KEY in the environment"},
                         ensure_ascii=False))
        return 1

    prompt = (Path(args.prompt_file).read_text("utf-8") if args.prompt_file
              else __import__("sys").stdin.read()).strip()
    if not prompt:
        print(json.dumps({"ok": False, "error": "the prompt came in empty"}, ensure_ascii=False))
        return 1

    body = {
        "model": args.model,
        "prompt": prompt,
        "n": 1,
        "aspect_ratio": ASPECT[args.format],
        "resolution": args.resolution,
    }
    if args.seed:
        body["seed"] = args.seed

    # The client's own style references. This is what makes pieces look alike;
    # without it every post looks like it came from a different planet.
    refs, discarded = [], []
    for path in args.references[:MAX_REFERENCES]:
        url = as_data_url(path)
        if url:
            refs.append({"type": "image_url", "image_url": {"url": url}})
        else:
            discarded.append(path)
    if refs:
        body["input_references"] = refs

    request = urllib.request.Request(
        API, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})

    started = time.time()
    try:
        response = json.load(urllib.request.urlopen(request, timeout=300))
    except urllib.error.HTTPError as error:
        detail = error.read()[:300].decode("utf-8", "replace")
        # 502 = failed upstream and is NOT charged; worth retrying. Nothing
        # else is.
        print(json.dumps({
            "ok": False, "http": error.code, "error": detail,
            "retryable": error.code in (429, 502),
        }, ensure_ascii=False))
        return 1
    except Exception as error:  # noqa: BLE001 - network or timeout
        print(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}",
                          "retryable": True}, ensure_ascii=False))
        return 1

    item = (response.get("data") or [{}])[0]
    raw = base64.b64decode(item.get("b64_json") or "")
    if not raw:
        print(json.dumps({"ok": False, "error": "the response did not bring back an image"}, ensure_ascii=False))
        return 1

    media = item.get("media_type") or "image/png"
    out = Path(args.out)
    if out.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        out = out.with_suffix("." + (media.split("/")[-1].replace("jpeg", "jpg")))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)

    print(json.dumps({
        "ok": True,
        "file": str(out),
        "bytes": len(raw),
        "aspect_ratio": ASPECT[args.format],
        "model": args.model,
        "seconds": round(time.time() - started, 1),
        "cost_usd": (response.get("usage") or {}).get("cost"),
        "references_used": len(refs),
        "references_discarded": discarded,
        "now_look_at_it": "open the file and check it against references/verify.md before showing it",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
