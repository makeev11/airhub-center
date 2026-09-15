"""Offline artifact guard regressions; no Docker, SSH, network or live writes."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("chat_release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ArtifactGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "index.html").write_text("<html>chat</html>")
        (self.root / "chat-sw.js").write_text("// shell only")
        (self.root / "chat-centers.json").write_text(json.dumps([
            {"id": "center-demo", "name": "AirHop Center", "origin": "https://demo.airhop.ru"}
        ]))

    def test_exact_public_artifact(self):
        self.assertEqual(len(release.public_manifest(self.root)), 3)

    def test_rejects_control_file_in_public_root(self):
        (self.root / "plan.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "Unexpected public"):
            release.public_manifest(self.root)

    def test_rejects_symlink(self):
        (self.root / "chat.webmanifest").symlink_to(self.root / "index.html")
        with self.assertRaisesRegex(RuntimeError, "Symlink"):
            release.public_manifest(self.root)

    def test_rejects_demo_bootstrap(self):
        (self.root / "chat-sw.js").write_text('fetch("/__demo__/session")')
        with self.assertRaisesRegex(RuntimeError, "Demo bootstrap"):
            release.public_manifest(self.root)

    def test_rejects_unreviewed_center(self):
        (self.root / "chat-centers.json").write_text("[]")
        with self.assertRaisesRegex(RuntimeError, "Unreviewed Center"):
            release.public_manifest(self.root)


if __name__ == "__main__":
    unittest.main()
