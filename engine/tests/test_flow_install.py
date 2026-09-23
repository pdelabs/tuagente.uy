#!/usr/bin/env python3
"""A plugin's curated flows reach the workspace. `python3 engine/tests/test_flow_install.py`.

Inside the container, with a plugin made of a folder in /tmp and a module made
of a namespace: no model, no network, a second. What is asserted is the
engine's loader (`core/plugins.py`'s `retire_flows` and `install_flows`), which
every plugin's `surfaces.flows` goes through.

  a. THE REAL ONES ARRIVED — on this lab's workspace, which starts empty, the
     flows of `mail` and `instagram` are there after boot, byte for byte.
  b. ABSENT IS COPIED — a curated flow that is not in the workspace lands.
  c. PRESENT IS NEVER OVERWRITTEN — a copy the client edited stays as it is,
     for a flow with no history.
  d. AN UNTOUCHED OLD VERSION IS UPGRADED — a copy that hashes to a version we
     shipped (`UPGRADED`) is replaced by today's.
  e. AN EDITED OLD VERSION STAYS — and so does any copy of a flow whose
     current version is already what is there.
  f. A FLOW WE NO LONGER SHIP IS RETIRED ONLY IF UNTOUCHED — `SUPERSEDED`
     deletes the copy that hashes to what we shipped, and its folder, and
     leaves an edited one.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`. It cleans up the slugs it wrote.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import hashlib, json, shutil, tempfile, types
from pathlib import Path

from core import config, flows, plugins

out = {}
SLUGS = ["prueba-nuevo", "prueba-editado", "prueba-viejo", "prueba-viejo-editado",
         "prueba-retirado", "prueba-retirado-editado"]


def body(name):
    return (f"---\nname: {name}\nclient_summary: x\ntrigger: request\n"
            f"trigger_detail: Cuando lo pedís\nstatus: active\nconnections: []\n---\n\n1. {name}\n")


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def clean():
    for slug in SLUGS:
        shutil.rmtree(flows.root() / slug, ignore_errors=True)


def put(slug, text):
    path = flows.file_of(slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def text(slug):
    path = flows.file_of(slug)
    return path.read_text() if path.is_file() else None


clean()
try:
    # (a) what the real plugins shipped, on a workspace that started empty.
    # Read off the manifests and not through `plugins.load()`: loading here
    # would install them again, and what is asserted is that the BOOT did.
    out["real"] = {}
    for plugin_id in config.PLUGINS:
        root = config.KIT_PLUGINS / plugin_id
        manifest = json.loads((root / "plugin.json").read_text())
        for folder in manifest["surfaces"].get("flows") or []:
            source = root / folder / flows.FLOW_FILE
            installed = flows.file_of(source.parent.name)
            out["real"][source.parent.name] = (
                installed.is_file() and installed.read_bytes() == source.read_bytes()
            )

    root = Path(tempfile.mkdtemp())
    shipped = ["prueba-nuevo", "prueba-editado", "prueba-viejo", "prueba-viejo-editado"]
    for slug in shipped:
        (root / "flows" / slug).mkdir(parents=True)
        (root / "flows" / slug / "FLOW.md").write_text(body(f"{slug} hoy"))
    module = types.SimpleNamespace(
        UPGRADED={"prueba-viejo": {sha(body("prueba-viejo ayer"))},
                  "prueba-viejo-editado": {sha(body("prueba-viejo-editado ayer"))}},
        SUPERSEDED={"prueba-retirado": sha(body("prueba-retirado")),
                    "prueba-retirado-editado": sha(body("prueba-retirado-editado"))},
    )
    manifest = {"surfaces": {"flows": [f"flows/{slug}" for slug in shipped]}}
    plugin = plugins.Plugin("prueba", root, manifest, module)

    put("prueba-editado", "lo que escribió ella")
    put("prueba-viejo", body("prueba-viejo ayer"))
    put("prueba-viejo-editado", body("prueba-viejo-editado ayer") + "\n2. lo que agregó ella\n")
    put("prueba-retirado", body("prueba-retirado"))
    put("prueba-retirado-editado", body("prueba-retirado-editado") + "\n2. suyo\n")

    plugins.retire_flows(plugin)
    plugins.install_flows(plugin)
    # A second load is a restart: nothing may move.
    after_one = {slug: text(slug) for slug in SLUGS}
    plugins.retire_flows(plugin)
    plugins.install_flows(plugin)
    out["idempotent"] = after_one == {slug: text(slug) for slug in SLUGS}

    out["new"] = text("prueba-nuevo") == body("prueba-nuevo hoy")
    out["edited"] = text("prueba-editado")
    out["old"] = text("prueba-viejo") == body("prueba-viejo hoy")
    out["old_edited"] = "lo que agregó ella" in (text("prueba-viejo-editado") or "")
    out["retired"] = not (flows.root() / "prueba-retirado").exists()
    out["retired_edited"] = "suyo" in (text("prueba-retirado-editado") or "")
    shutil.rmtree(root)
    print(json.dumps(out, ensure_ascii=False))
finally:
    clean()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE], capture_output=True, text=True
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("FLOW INSTALL: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = [f"{slug} is not the shipped copy" for slug, same in r["real"].items() if not same]
    if not {"bandeja-de-entrada", "instagram"} <= set(r["real"]):
        problems.append(f"the lab's plugins shipped {sorted(r['real'])}")
    failures += judge("a. the real ones arrived", problems)
    failures += judge("b. absent is copied", [] if r["new"] else ["it did not land"])
    failures += judge("c. present is never overwritten",
                      [] if r["edited"] == "lo que escribió ella" else [f"it became {r['edited']!r}"])
    failures += judge("d. an untouched old version is upgraded",
                      [] if r["old"] else ["the old copy is still there"])
    failures += judge("e. an edited old version stays",
                      [] if r["old_edited"] else ["her edit was overwritten"])
    problems = []
    if not r["retired"]:
        problems.append("the untouched copy is still there")
    if not r["retired_edited"]:
        problems.append("the edited copy was deleted")
    if not r["idempotent"]:
        problems.append("a second load moved something")
    failures += judge("f. a flow we no longer ship is retired only if untouched", problems)

    print("FLOW INSTALL: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
