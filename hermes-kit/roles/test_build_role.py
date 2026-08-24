#!/usr/bin/env python3
"""What a role's distribution says about the port it must not bind.

    python3 roles/test_build_role.py

THE BUG THIS EXISTS FOR. Distributions used to ship no `config.yaml` at all,
and that read as harmless: a profile with no config takes the engine's
defaults. It does not. The container's environment carries `API_SERVER_KEY`
(secrets.env is the env_file of both services) and the engine's loader puts env
vars above config.yaml, so every hired role came out with `api_server` enabled
-- a port-binding platform on a secondary profile, which under
`gateway.multiplex_profiles` is a config error. Both roles on the local agent
were skipped at every boot:

    WARNING gateway.run: Skipping secondary profile 'accounting' due to
    port-binding config error: ...

It hid for weeks because /p/<role>/ kept answering (the default profile's
listener serves the prefix, `profiles_to_serve` never asks whether the adapters
started), so the only visible symptom was a warning nobody could act on.

The pin is one line of YAML and the whole failure mode is invisible from the
build's output, which is exactly the shape of thing a test is for.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "roles"))
sys.path.insert(0, str(KIT / "tools"))

import build_role  # noqa: E402

# hermes:gateway/config.py PORT_BINDING_PLATFORM_VALUES -- the platforms that
# open a listener of their own. Copied, not imported: the engine lives in a
# container image and this test runs on a laptop. `tools/agent-check.py` keeps
# the same list, and the pair of them is the reason a rename upstream shows up
# as a failing check instead of as a role that silently stops being served.
PORT_BINDING = (
    "api_server", "webhook", "msgraph_webhook", "feishu", "wecom_callback",
    "bluebubbles", "sms", "whatsapp_cloud", "line",
)


def parsed_profile_config(role: str = "accounting") -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp)
        build_role.write_profile_config(role, dest)
        text = (dest / "config.yaml").read_text(encoding="utf-8")
    import yaml
    return yaml.safe_load(text) or {}


class TheProfileConfig(unittest.TestCase):
    def test_it_pins_api_server_off_explicitly(self):
        """`enabled: false` and not merely absent: absent loses to the env var."""
        cfg = parsed_profile_config()
        self.assertIs(cfg["platforms"]["api_server"]["enabled"], False)

    def test_no_port_binding_platform_is_left_enabled(self):
        cfg = parsed_profile_config()
        enabled = [
            name for name in PORT_BINDING
            if (cfg.get("platforms") or {}).get(name, {}).get("enabled")
            or (cfg.get(name) or {}).get("enabled")
        ]
        self.assertEqual(enabled, [], "the default profile owns the listener")

    def test_the_role_is_named_where_the_operator_will_read_it(self):
        """The /p/<role>/ in the header is what makes the file self-explaining."""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            build_role.write_profile_config("marketing", dest)
            text = (dest / "config.yaml").read_text(encoding="utf-8")
        self.assertIn("/p/marketing/", text)
        self.assertNotIn("{role}", text)


class TheManifest(unittest.TestCase):
    """The distribution has to CLAIM the file, not only carry it.

    `hermes profile update` decides what it may overwrite from
    `distribution_owned`; a config.yaml the manifest does not list is a file
    the next update leaves behind whatever the profile happens to have.
    """

    def manifest(self) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            build_role.write_manifest("accounting", {"version": "0.2.1"}, dest)
            return (dest / "distribution.yaml").read_text(encoding="utf-8")

    def test_config_yaml_is_distribution_owned(self):
        import yaml
        owned = yaml.safe_load(self.manifest())["distribution_owned"]
        self.assertIn("config.yaml", owned)
        self.assertIn("SOUL.md", owned)


class TheBuiltDistribution(unittest.TestCase):
    """End to end over a real role: the file lands next to the SOUL.

    Slower than the rest (it composes the SOUL block and runs the clone check),
    and worth it: the writer being correct proves nothing if `build()` forgets
    to call it -- which is the only way this regression can come back.
    """

    def test_building_accounting_leaves_a_config_that_disables_api_server(self):
        import yaml
        with tempfile.TemporaryDirectory() as tmp:
            dest = build_role.build("accounting", Path(tmp))
            cfg = yaml.safe_load((dest / "config.yaml").read_text(encoding="utf-8"))
            role = json.loads((dest / "role.json").read_text(encoding="utf-8"))
        self.assertIs(cfg["platforms"]["api_server"]["enabled"], False)
        self.assertEqual(role["id"], "accounting")


if __name__ == "__main__":
    unittest.main()
