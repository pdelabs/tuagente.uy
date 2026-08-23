"""Tests for migrate-agent-to-english.sh: the one-shot tool that converts a
deployed agent's on-disk layout from the kit's old Spanish names to the
current English ones.

Run from hermes-kit/tools:
    python3 -m unittest test_migrate_agent_to_english.py

Builds a fake pre-migration agent root carrying every old artifact the
script knows about, runs the script against it in --local mode (--dry-run
first, then for real, then a second time to prove idempotence), and checks
the new layout, the rewritten keys/values, that untouched content (SOUL
body, FLOW.md body, workspace folder names) survives byte for byte, and
that backups exist.
"""
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
SCRIPT = TOOLS / "migrate-agent-to-english.sh"


def write(root: Path, rel: str, content):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (dict, list)):
        path.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        path.write_text(content, encoding="utf-8")
    return path


def build_old_agent(root: Path):
    """A minimal but realistic pre-migration agent root: one of everything
    the script is supposed to touch, plus a couple of things it must leave
    alone (client-visible folder names, SOUL/FLOW prose, an unrelated skill
    shadow copy it only reports)."""
    write(root, "secretos.env", "API_SERVER_KEY=abc\nOPENROUTER_API_KEY=def\n")

    write(root, "politica/politica.json", {
        "correo": {"leer": True, "actuar": False},
        "whatsapp": {"leer": True, "actuar": True},
    })
    write(root, "politica/capacidades/catalogo.json", {"capabilities": [{"id": "vision"}]})
    write(root, "politica/capacidades/pedidos.jsonl",
          '{"fecha": "2026-08-01T10:00:00", "agente": "Mr.Wobble", "origen": "cliente", '
          '"id": "calculo-y-planillas", "texto": "necesito calcular planillas"}\n'
          '{"fecha": "2026-08-02T10:00:00", "agente": "Mr.Wobble", "origen": "mencion", '
          '"id": null, "texto": "algo raro"}\n')
    write(root, "politica/roles/catalogo.json", {"roles": [{"id": "marketing"}]})
    write(root, "politica/roles/identidades.json", {
        "ventas": {"nombre": "Juana", "pinta": {"tono": 2, "antena": 1},
                   "bautizado_en": "2026-08-10T10:00:00"},
    })
    write(root, "politica/roles/pedidos.jsonl",
          '{"evento": "pedido", "rol": "ventas", "nombre": "Juana", "pinta": {"tono": 2}, '
          '"pedido_en": "2026-08-09T10:00:00", "agente": "Mr.Wobble"}\n'
          '{"evento": "atendido", "rol": "ventas", "nombre": "Juana", '
          '"atendido_en": "2026-08-10T10:00:00", "agente": "Mr.Wobble"}\n')
    write(root, "politica/salas/general.jsonl", '{"ts": 1, "role": "client", "content": "hola"}\n')
    write(root, "politica/avisos/en-curso.json",
          {"task_id": "t_1", "hasta": 1755999999.0, "veda": "esperando aprobacion"})
    write(root, "politica/hooks/puerta.py", "#!/usr/bin/env python3\nprint('gate')\n")
    write(root, "politica/plugins/promesas/plugin.yaml", "name: promesas\n")
    write(root, "politica/plugins/promesas/promesas.py", "# plugin\n")
    write(root, "politica/guardia.py", "# guard\n")
    write(root, "politica/parche-pairing.py", "# patch\n")
    write(root, "politica/cont-init-parches.sh", "#!/bin/sh\necho patch\n")
    write(root, "politica/tools/whatsapp.json", {"tools": {}})
    write(root, "politica/mcp/mercadopago/server.py", "# mcp\n")

    write(root, ".kit-instalado", "data/scripts/x\tabc123\n")
    write(root, ".kit-instalado.nuevo", "data/scripts/x\tabc123\n")
    write(root, "skills-reemplazadas/entregable/SKILL.md", "old skill")
    write(root, "respaldos/agente-20260801.tgz", "fake tarball")

    write(root, "docker-compose.yml", """services:
  hermes:
    container_name: ${CLIENTE}-hermes
    volumes:
      - ./data:/opt/data
      - ./politica:/opt/policy:ro
      - ./politica/cont-init-parches.sh:/etc/cont-init.d/03-parches:ro
      - ./politica/plugins:/opt/data/plugins:ro
    env_file:
      - ./secretos.env
  portal-adapter:
    container_name: ${CLIENTE}-portal-adapter
    volumes:
      - ./politica:/opt/policy
    env_file:
      - ./secretos.env
""")

    write(root, ".env",
          "CLIENTE=east\nAGENT_NAME=Washi\n"
          "DOMINIO_API=east.agentes.tuagente.uy\nDOMINIO_PORTAL=east-portal.agentes.tuagente.uy\n"
          "PUERTO_GATEWAY=8642\nPUERTO_ADAPTER=8643\n"
          "MODELO_DEL_AGENTE=openai/gpt-5.6\nEMAIL_TLS=soporte@tuagente.uy\n")

    write(root, "Caddyfile", """{$DOMINIO_API} {
	log {
		output file /data/acceso-api.log
	}
}
{$DOMINIO_PORTAL} {
	log {
		output file /data/acceso-portal.log
	}
}
""")

    write(root, "data/portal_identidad.json", {
        "nombre": "Washi", "empresa": "Acme SA",
        "contacto": {"canal": "correo", "valor": "a@b.com"},
        "look": {"tono": 1, "antena": 0},
    })
    write(root, "data/connections/catalogo.json", {"connections": [{"id": "telegram"}]})
    write(root, "data/connections/requeridas.json", ["correo", "whatsapp", "modelos-auxiliares"])
    write(root, "data/google_oauth_portal.json", {"state": "abc"})
    write(root, "data/costos.jsonl",
          '{"ts": 1, "modelo": "gpt-5.6", "entrada": 100, "salida": 50, '
          '"costo_usd": 0.01, "origen": "chat"}\n')

    write(root, "data/flujos/reporte-semanal/FLUJO.md", """---
nombre: Reporte semanal
para_cliente: "Te mando un resumen todos los lunes"
gatillo_tipo: horario
gatillo_detalle: todos los lunes a las 9
gatillo_cron: "0 9 * * 1"
conexiones: correo, whatsapp
resultados: informes/
estado: activo
skills: entregable, flujo
---

## Notas técnicas

Cuerpo sin tocar.
""")

    write(root, "data/SOUL.md", """# Identidad

<!-- portal:identidad -->
## Quién sos
Bautizada Washi.
<!-- /portal:identidad -->

<!-- kit:base v12 -->
cuerpo del kit
<!-- /kit:base -->
""")

    write(root, "data/config.yaml", """api_server:
  enabled: true
agent:
  disabled_toolsets:
    - tts
    # kit:excepcion humanizer — escribe posteos sociales
hooks:
  pre_tool_call:
    - name: gate
      command: "/opt/politica/hooks/puerta.py"
plugins:
  enabled:
    - promesas
""")

    write(root, "data/workspace/entregables/reporte-semanal/2026-08-10-informe.md", """---
titulo: Informe semanal
tipo: informe
fecha: 2026-08-10 09:00
---

# Informe semanal

Contenido sin tocar.
""")

    write(root, "data/profiles/ventas/role.json",
          {"id": "ventas", "identity": {"name": "Juana", "look": {"tono": 2, "antena": 1}}})
    write(root, "data/profiles/ventas/.env", "API_SERVER_KEY=xyz\n")

    write(root, "data/skills/entregable/SKILL.md", "shadow copy")


def snapshot(root: Path):
    """{relative path: sha256} for every file under root."""
    out = {}
    for path in root.rglob("*"):
        if path.is_file():
            out[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def run_script(*args):
    return subprocess.run(
        ["bash", str(SCRIPT), *args], capture_output=True, text=True, check=True,
    )


class ScriptShapeTests(unittest.TestCase):
    def test_bash_syntax(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)

    def test_help_does_not_touch_anything(self):
        result = subprocess.run(
            ["bash", str(SCRIPT), "--help"], capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("migrate-agent-to-english.sh", result.stdout)


class DryRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "agente-acme"
        build_old_agent(self.root)
        self.before = snapshot(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_dry_run_changes_nothing(self):
        result = run_script("--local", str(self.root), "--dry-run")
        self.assertEqual(snapshot(self.root), self.before)
        self.assertIn("WHAT WOULD HAPPEN", result.stdout)
        # every planned action is a "would ..." line, not an actual mutation
        self.assertIn("[dry-run] would move secretos.env -> secrets.env", result.stdout)
        self.assertIn("[dry-run] would move+rewrite politica/politica.json", result.stdout)
        self.assertFalse((self.root / "secrets.env").exists())
        self.assertFalse((self.root / "backups").exists())


class MigrationTests(unittest.TestCase):
    """Runs the real migration once in setUp; each test checks one facet of
    the result, against the same migrated tree."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name) / "agente-acme"
        build_old_agent(cls.root)
        cls.before = snapshot(cls.root)
        cls.result = run_script("--local", str(cls.root))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def read_json(self, rel):
        return json.loads((self.root / rel).read_text(encoding="utf-8"))

    def read_jsonl(self, rel):
        lines = (self.root / rel).read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines if line.strip()]

    # -- old paths are gone, new ones exist --

    def test_old_top_level_paths_are_gone(self):
        for rel in ("secretos.env", "politica", ".kit-instalado", ".kit-instalado.nuevo",
                    "skills-reemplazadas"):
            self.assertFalse((self.root / rel).exists(), f"{rel} should be gone")

    def test_new_layout_exists(self):
        expected = [
            "secrets.env", ".kit-installed", ".kit-installed.new", "shadowed-skills",
            "backups", "policy/policy.json", "policy/capabilities/catalog.json",
            "policy/capabilities/requests.jsonl", "policy/roles/catalog.json",
            "policy/roles/identities.json", "policy/roles/requests.jsonl",
            "policy/rooms/general.jsonl", "policy/notices/in-progress.json",
            "policy/hooks/gate.py", "policy/plugins/promises/plugin.yaml",
            "policy/plugins/promises/promises.py", "policy/guard.py",
            "policy/pairing-patch.py", "policy/cont-init-patches.sh",
            "policy/tools/whatsapp.json", "policy/mcp/mercadopago/server.py",
            "data/portal_identity.json", "data/connections/catalog.json",
            "data/connections/required.json", "data/google_oauth_pending.json",
            "data/costs.jsonl", "data/flows/reporte-semanal/FLOW.md",
            "data/profiles/sales/role.json",
        ]
        for rel in expected:
            self.assertTrue((self.root / rel).exists(), f"{rel} should exist")

    def test_old_plugin_module_name_is_gone(self):
        self.assertFalse((self.root / "policy/plugins/promises/promesas.py").exists())

    # -- rewritten keys and values --

    def test_policy_json_keys_and_connection_id(self):
        policy = self.read_json("policy/policy.json")
        self.assertEqual(policy, {
            "email": {"read": True, "act": False},
            "whatsapp": {"read": True, "act": True},
        })

    def test_capabilities_requests_log(self):
        rows = self.read_jsonl("policy/capabilities/requests.jsonl")
        self.assertEqual(rows[0], {
            "date": "2026-08-01T10:00:00", "agent": "Mr.Wobble", "source": "client",
            "id": "calc-and-spreadsheets", "text": "necesito calcular planillas",
        })
        self.assertEqual(rows[1]["source"], "mention")
        self.assertIsNone(rows[1]["id"])

    def test_role_identities(self):
        identities = self.read_json("policy/roles/identities.json")
        self.assertNotIn("ventas", identities)
        self.assertEqual(identities["sales"], {
            "name": "Juana", "look": {"tone": 2, "antenna": 1},
            "named_at": "2026-08-10T10:00:00",
        })

    def test_role_requests_log(self):
        rows = self.read_jsonl("policy/roles/requests.jsonl")
        self.assertEqual(rows[0]["event"], "requested")
        self.assertEqual(rows[0]["role"], "sales")
        self.assertEqual(rows[0]["look"], {"tone": 2})
        self.assertEqual(rows[0]["requested_at"], "2026-08-09T10:00:00")
        self.assertEqual(rows[1]["event"], "hired")
        self.assertEqual(rows[1]["hired_at"], "2026-08-10T10:00:00")

    def test_in_progress_notice(self):
        notice = self.read_json("policy/notices/in-progress.json")
        self.assertEqual(notice, {
            "task_id": "t_1", "until": 1755999999.0, "restriction": "esperando aprobacion",
        })

    def test_portal_identity(self):
        identity = self.read_json("data/portal_identity.json")
        self.assertEqual(identity, {
            "name": "Washi", "company": "Acme SA",
            "contact": {"channel": "email", "value": "a@b.com"},
            "look": {"tone": 1, "antenna": 0},
        })

    def test_required_connections(self):
        required = self.read_json("data/connections/required.json")
        self.assertEqual(required, ["email", "whatsapp", "auxiliary-models"])

    def test_costs_log(self):
        rows = self.read_jsonl("data/costs.jsonl")
        self.assertEqual(rows[0], {
            "ts": 1, "model": "gpt-5.6", "input_tokens": 100, "output_tokens": 50,
            "cost_usd": 0.01, "source": "chat",
        })

    def test_flow_frontmatter(self):
        text = (self.root / "data/flows/reporte-semanal/FLOW.md").read_text(encoding="utf-8")
        head, body = text.split("---\n\n", 1)
        self.assertIn("name: Reporte semanal", head)
        self.assertIn('client_summary: "Te mando un resumen todos los lunes"', head)
        self.assertIn("trigger_type: schedule", head)
        self.assertIn("connections: email, whatsapp", head)
        self.assertIn("status: active", head)
        self.assertIn("skills: deliverable, flow", head)
        # the body is untouched, checked separately for byte-identity below

    def test_soul_marker_translated(self):
        text = (self.root / "data/SOUL.md").read_text(encoding="utf-8")
        self.assertIn("<!-- portal:identity -->", text)
        self.assertIn("<!-- /portal:identity -->", text)
        self.assertNotIn("portal:identidad", text)

    def test_config_yaml_rewrites(self):
        text = (self.root / "data/config.yaml").read_text(encoding="utf-8")
        self.assertIn('command: "/opt/policy/hooks/gate.py"', text)
        self.assertIn("- promises", text)
        self.assertIn("kit:exception humanizer", text)
        self.assertNotIn("/opt/politica", text)
        self.assertNotIn("kit:excepcion", text)

    def test_deliverable_frontmatter_keys_values_stay_spanish(self):
        text = (self.root / "data/workspace/entregables/reporte-semanal/2026-08-10-informe.md"
                ).read_text(encoding="utf-8")
        self.assertIn("title: Informe semanal", text)
        self.assertIn("kind: informe", text)
        self.assertIn("date: 2026-08-10 09:00", text)

    def test_docker_compose_rewrites(self):
        text = (self.root / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("./policy:/opt/policy:ro", text)
        self.assertIn("./policy/cont-init-patches.sh:/etc/cont-init.d/03-patches:ro", text)
        self.assertIn("./policy/plugins:/opt/data/plugins:ro", text)
        self.assertIn("./secrets.env", text)
        self.assertIn("${CLIENT}-hermes", text)
        self.assertNotIn("politica", text)
        self.assertNotIn("secretos.env", text)
        self.assertNotIn("CLIENTE", text)

    def test_env_file_rewrites(self):
        text = (self.root / ".env").read_text(encoding="utf-8")
        self.assertIn("CLIENT=east", text)
        self.assertIn("API_DOMAIN=east.agentes.tuagente.uy", text)
        self.assertIn("PORTAL_DOMAIN=east-portal.agentes.tuagente.uy", text)
        self.assertIn("GATEWAY_PORT=8642", text)
        self.assertIn("ADAPTER_PORT=8643", text)
        self.assertIn("AGENT_MODEL=openai/gpt-5.6", text)
        self.assertNotIn("CLIENTE=", text)
        self.assertNotIn("DOMINIO_", text)
        self.assertNotIn("PUERTO_", text)
        self.assertNotIn("MODELO_DEL_AGENTE", text)

    def test_caddyfile_rewrites(self):
        text = (self.root / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("{$API_DOMAIN}", text)
        self.assertIn("{$PORTAL_DOMAIN}", text)
        self.assertIn("access-api.log", text)
        self.assertIn("access-portal.log", text)
        self.assertNotIn("DOMINIO", text)
        self.assertNotIn("acceso-", text)

    def test_profile_directory_and_role_json(self):
        self.assertFalse((self.root / "data/profiles/ventas").exists())
        role = self.read_json("data/profiles/sales/role.json")
        self.assertEqual(role["id"], "sales")
        self.assertEqual(role["identity"]["look"], {"tone": 2, "antenna": 1})

    # -- untouched, byte for byte --

    def test_soul_kit_base_body_untouched(self):
        text = (self.root / "data/SOUL.md").read_text(encoding="utf-8")
        self.assertIn("<!-- kit:base v12 -->\ncuerpo del kit\n<!-- /kit:base -->", text)

    def test_flow_body_untouched(self):
        text = (self.root / "data/flows/reporte-semanal/FLOW.md").read_text(encoding="utf-8")
        self.assertTrue(text.rstrip("\n").endswith(
            "## Notas técnicas\n\nCuerpo sin tocar."))

    def test_workspace_folder_names_untouched(self):
        # "entregables" (and the flow slug inside it) are client-visible and
        # must never be renamed, only the frontmatter inside each file.
        self.assertTrue((self.root / "data/workspace/entregables").is_dir())
        self.assertTrue((self.root / "data/workspace/entregables/reporte-semanal").is_dir())

    def test_deliverable_body_untouched(self):
        text = (self.root / "data/workspace/entregables/reporte-semanal/2026-08-10-informe.md"
                ).read_text(encoding="utf-8")
        self.assertIn("# Informe semanal\n\nContenido sin tocar.", text)

    # -- reported, not deleted --

    def test_shadow_skill_reported_not_deleted(self):
        self.assertTrue((self.root / "data/skills/entregable/SKILL.md").exists())
        self.assertIn("data/skills/entregable", self.result.stdout)
        self.assertIn("not deleted", self.result.stdout)

    def test_profile_registry_reconciliation_reported(self):
        self.assertIn("hermes profile", self.result.stdout)
        self.assertIn("ventas->sales", self.result.stdout)

    # -- summary + backups --

    def test_summary_counts_present(self):
        self.assertIn("MIGRATION SUMMARY", self.result.stdout)
        self.assertIn("manual-steps", self.result.stdout)

    def test_backups_exist(self):
        backup_dirs = list((self.root / "backups").glob("migrate-to-english-*"))
        self.assertEqual(len(backup_dirs), 1)
        backup_dir = backup_dirs[0]
        self.assertTrue((backup_dir / "politica" / "politica.json").exists())
        self.assertTrue((backup_dir / "data" / "SOUL.md").exists())
        # the pre-migration backups/ (respaldos/) content merged in alongside
        self.assertTrue((self.root / "backups" / "agente-20260801.tgz").exists())

    def test_operator_next_steps_printed(self):
        self.assertIn("docker compose up -d", self.result.stdout)
        self.assertIn("SOUL v13", self.result.stdout)
        # install-soul.sh is ssh-only; in --local mode the printed recipe
        # goes through replace-block.py directly instead of a fictional
        # --local flag on install-soul.sh.
        self.assertIn("replace-block.py", self.result.stdout)
        self.assertIn("agent-check.py", self.result.stdout)
        self.assertIn("portal-check.py", self.result.stdout)


class IdempotenceTests(unittest.TestCase):
    def test_second_run_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "agente-acme"
            build_old_agent(root)
            run_script("--local", str(root))
            after_first = snapshot(root)

            second = run_script("--local", str(root))
            after_second = snapshot(root)

            self.assertEqual(after_first, after_second)
            self.assertIn("Nothing to migrate", second.stdout)
            self.assertNotIn("moved ", second.stdout)
            self.assertNotIn("rewrote ", second.stdout)


if __name__ == "__main__":
    unittest.main()
