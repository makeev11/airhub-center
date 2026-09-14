import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("profile_entry", Path(__file__).with_name("entrypoint.py"))
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class ProfileTests(unittest.TestCase):
    def test_missing_provider_never_uses_personal_config_implicitly(self):
        with self.assertRaisesRegex(ValueError, "Configure AIRHOP_HERMES_PROVIDER"):
            entry.profile_config({})

    def test_isolated_profile_forces_closed_tools_and_does_not_persist_keys(self):
        env = {"DEEPSEEK_API_KEY": "synthetic-test-only", "HERMES_HOME": "/personal", "HERMES_ACP_BUILTIN_TOOLSETS": "terminal", "HERMES_ACP_SKIP_CONFIGURED_MCP": "0"}
        config = entry.profile_config(env)
        with tempfile.TemporaryDirectory() as directory:
            workspace = entry.configure_profile(Path(directory), env, config)
            saved = Path(env["HERMES_HOME"]) / "config.yaml"
            self.assertEqual(workspace, Path(directory) / "workspace")
            self.assertEqual(env["HERMES_ACP_BUILTIN_TOOLSETS"], "")
            self.assertEqual(env["HERMES_ACP_SKIP_CONFIGURED_MCP"], "1")
            self.assertEqual(json.loads(saved.read_text())["memory"], {"memory_enabled": False, "user_profile_enabled": False})
            self.assertNotIn("synthetic-test-only", saved.read_text())
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)

    def test_explicit_provider_and_model_are_preserved(self):
        config = entry.profile_config({"AIRHOP_HERMES_PROVIDER": "anthropic", "BUZZ_ACP_MODEL": "configured-model", "DEEPSEEK_API_KEY": "synthetic"})
        self.assertEqual(config["model"], {"provider": "anthropic", "default": "configured-model"})


if __name__ == "__main__":
    unittest.main()
