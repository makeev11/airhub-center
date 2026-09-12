"""Regression tests for cross-project deployment and concurrent release drift."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("release", ROOT / "scripts/airhop-demo-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
REGISTRY = json.loads((ROOT / "deploy/airhop/environments.json").read_text())
TARGET = REGISTRY["targets"]["center-demo"]
QUARANTINE_REGISTRY = copy.deepcopy(REGISTRY)
QUARANTINE_REGISTRY["targets"]["hq-legacy-relay"]["lifecycle"] = "quarantined"


def config():
    return {
        "name": "buzz-demo",
        "services": {
            "relay": {"image": "relay:old", "labels": {"ru.airhop.release": "old"},
                      "environment": {"RELAY_URL": "wss://demo.airhop.ru"},
                      "networks": {"buzz-net": {}, "airhop-web": {
                          "aliases": ["airhop-demo-relay"]}},
                      "volumes": [{"type": "volume", "source": "buzz-git-data",
                                   "target": "/data/git"}]},
            "postgres": {"image": "postgres:17-alpine"},
        },
        "networks": {"buzz-net": {"name": TARGET["network"]},
                     "airhop-web": {"name": "airhop-web"}},
        "volumes": {key: {"name": value} for key, value in TARGET["volumes"].items()},
    }


def live():
    return {"Config": {"Env": ["RELAY_URL=wss://demo.airhop.ru"],
                       "Labels": {"ru.airhop.release": "old"}},
            "Mounts": [{"Destination": "/data/git", "Name": "buzz-demo-git-data"}],
            "NetworkSettings": {"Networks": {TARGET["network"]: {},
                "airhop-web": {"Aliases": ["airhop-demo-relay"]}}}}


def quarantined():
    target = REGISTRY["targets"]["hq-legacy-relay"]
    return {"Id": target["quarantine_container_id"], "Image": target["quarantine_image_id"],
            "State": {"Running": False}, "HostConfig": {"RestartPolicy": {"Name": "no"}},
            "Config": {"Labels": {"com.docker.compose.project": "buzz-prod"}}}


class BoundaryTests(unittest.TestCase):
    def test_correct_config_and_live_state(self):
        release.validate_config(config(), TARGET)
        release.validate_live(config(), live(), TARGET)

    def test_default_buzz_prod_project_is_rejected(self):
        candidate = config()
        candidate["name"] = "buzz-prod"
        with self.assertRaisesRegex(release.Refused, "project"):
            release.validate_config(candidate, TARGET)

    def test_hq_volume_host_network_and_alias_are_rejected(self):
        for mutation in ("volume", "host", "network", "alias", "container"):
            with self.subTest(mutation=mutation):
                candidate = config()
                relay = candidate["services"]["relay"]
                if mutation == "volume":
                    candidate["volumes"]["buzz-git-data"]["name"] = "buzz-prod_buzz-git-data"
                elif mutation == "host":
                    relay["environment"]["RELAY_URL"] = "wss://hq.airhop.ru"
                elif mutation == "network":
                    candidate["networks"]["buzz-net"]["name"] = "buzz-prod_buzz-net"
                elif mutation == "alias":
                    relay["networks"]["airhop-web"]["aliases"].append("airhop-hq-relay")
                else:
                    relay["container_name"] = "buzz-prod-relay-1"
                with self.assertRaises(release.Refused):
                    release.validate_config(candidate, TARGET)

    def test_image_and_release_labels_allowed(self):
        before = config()
        after = copy.deepcopy(before)
        after["services"]["relay"]["image"] = "relay:new"
        after["services"]["relay"]["labels"]["ru.airhop.release"] = "new"
        release.validate_delta(before, after)

    def test_overlays_cannot_change_other_services_or_runtime(self):
        for mutation in ("postgres", "env", "route", "entrypoint", "mount"):
            with self.subTest(mutation=mutation):
                before = config()
                after = copy.deepcopy(before)
                relay = after["services"]["relay"]
                if mutation == "postgres":
                    after["services"]["postgres"]["image"] = "postgres:18-alpine"
                elif mutation == "env":
                    relay["environment"]["BUZZ_AUTO_MIGRATE"] = "true"
                elif mutation == "route":
                    relay["labels"]["traefik.http.routers.hq.rule"] = "Host(`demo.airhop.ru`)"
                elif mutation == "entrypoint":
                    relay["entrypoint"] = ["sh"]
                else:
                    relay["volumes"][0]["source"] = "buzz-postgres-data"
                with self.assertRaises(release.Refused):
                    release.validate_delta(before, after)

    def test_live_drift_is_not_blessed_as_new_baseline(self):
        for mutation in ("env", "mount", "network", "label"):
            with self.subTest(mutation=mutation):
                current = live()
                if mutation == "env":
                    current["Config"]["Env"] = ["RELAY_URL=wss://hq.airhop.ru"]
                elif mutation == "mount":
                    current["Mounts"][0]["Name"] = "buzz-prod_buzz-git-data"
                elif mutation == "network":
                    current["NetworkSettings"]["Networks"]["other"] = {}
                else:
                    current["Config"]["Labels"]["ru.airhop.release"] = "different"
                with self.assertRaises(release.Refused):
                    release.validate_live(config(), current, TARGET)

    def test_every_compose_command_pins_project(self):
        args = release.compose_args(TARGET, ["/base.yml", "/overlay.yml"])
        self.assertEqual(args[2:4], ["--project-name", "buzz-demo"])
        self.assertEqual(args[-4:], ["-f", "/base.yml", "-f", "/overlay.yml"])

    def test_wrong_daemon_stops_before_container_inspection(self):
        with patch.object(release, "command", return_value="another-host"), \
                patch.object(release, "inspect") as inspect:
            with self.assertRaisesRegex(release.Refused, "daemon"):
                release.make_plan(REGISTRY, "/irrelevant.yml")
            inspect.assert_not_called()

    def test_converged_baseline_is_accepted(self):
        release.validate_reconciliation(
            " DRY-RUN MODE -  Container buzz-demo-relay-1  Running\n", TARGET)

    def test_recreation_wrong_target_and_unknown_output_are_rejected(self):
        for output in (
            "DRY-RUN MODE - Container buzz-demo-relay-1 Recreate",
            "DRY-RUN MODE - Container buzz-prod-relay-1 Running",
            "DRY-RUN MODE - Container buzz-demo-relay-1 Running\nDRY-RUN MODE - Volume foreign Creating",
            "", "unknown new Compose output",
        ):
            with self.subTest(output=output), self.assertRaises(release.Refused):
                release.validate_reconciliation(output, TARGET)

    def test_baseline_check_is_strictly_dry_run(self):
        response = subprocess.CompletedProcess([], 0, "", "DRY-RUN MODE - Container buzz-demo-relay-1 Running\n")
        with patch.object(release.subprocess, "run", return_value=response) as run:
            release.check_reconciliation(release.compose_args(TARGET, ["/base.yml"]), TARGET)
            args = run.call_args.args[0]
            self.assertIn("--dry-run", args)
            self.assertIn("--no-deps", args)
            self.assertIn("--no-build", args)
            self.assertEqual(args[args.index("--pull") + 1], "never")

    def test_stale_plan_never_executes_up(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = copy.deepcopy(REGISTRY)
            registry["targets"]["center-demo"]["lock"] = str(Path(directory) / "lock")
            expected = {"release_file": "/candidate.yml", "container_id": "old"}
            with patch.object(release, "make_plan", return_value={**expected, "container_id": "new"}), \
                    patch.object(release, "command") as command:
                with self.assertRaisesRegex(release.Refused, "stale"):
                    release.apply_plan(registry, expected)
                command.assert_not_called()

    def test_unexpected_legacy_restart_blocks_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = copy.deepcopy(QUARANTINE_REGISTRY)
            registry["targets"]["center-demo"]["lock"] = str(Path(directory) / "lock")
            plan = {"release_file": "/candidate.yml"}
            legacy = quarantined()
            legacy["State"]["Running"] = True
            with patch.object(release, "make_plan", return_value=plan), \
                    patch.object(release, "inspect", return_value=legacy), \
                    patch.object(release, "command") as command:
                with self.assertRaisesRegex(release.Refused, "quarantine"):
                    release.apply_plan(registry, plan)
                command.assert_not_called()

    def test_apply_updates_only_reviewed_relay(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = copy.deepcopy(REGISTRY)
            registry["targets"]["center-demo"]["lock"] = str(Path(directory) / "lock")
            plan = {"release_file": "/candidate.yml", "compose_files": ["/base.yml"],
                    "next_image_id": "sha256:reviewed", "protected": {}}
            deployed = {"Image": "sha256:reviewed", "State": {"Health": {"Status": "healthy"}}}
            with patch.object(release, "make_plan", return_value=plan), \
                    patch.object(release, "check_legacy_boundary") as boundary, \
                    patch.object(release, "inspect", return_value=deployed), \
                    patch.object(release, "protected_containers", return_value={}), \
                    patch.object(release, "command") as command, patch("builtins.print"):
                release.apply_plan(registry, plan)
                boundary.assert_called_once_with(registry)
                args = command.call_args.args
                self.assertEqual(args[2:4], ("--project-name", "buzz-demo"))
                self.assertEqual(args[-10:], ("up", "-d", "--no-deps", "--no-build", "--pull",
                                              "never", "--wait", "--wait-timeout", "180", "relay"))

    def test_legacy_quarantine_cannot_silently_change_identity_or_restart_policy(self):
        release.validate_legacy_boundary(QUARANTINE_REGISTRY, quarantined())
        for field in ("id", "image", "restart", "project"):
            with self.subTest(field=field):
                legacy = quarantined()
                if field == "id": legacy["Id"] = "another-container"
                elif field == "image": legacy["Image"] = "another-image"
                elif field == "restart": legacy["HostConfig"]["RestartPolicy"]["Name"] = "always"
                else: legacy["Config"]["Labels"]["com.docker.compose.project"] = "buzz-demo"
                with self.assertRaises(release.Refused):
                    release.validate_legacy_boundary(QUARANTINE_REGISTRY, legacy)

    def test_retired_inventory_allows_demo_and_shared_resources(self):
        current = {"Name": "/buzz-demo-relay-1", "Config": {"Labels": {
            "com.docker.compose.project": "buzz-demo"}}}
        release.validate_retired_boundary(REGISTRY, [current],
            list(TARGET["volumes"].values()) + ["airhop-site_caddy_data"],
            ["buzz-demo_buzz-net", "airhop-web"])

    def test_retired_resource_reappearance_blocks_release(self):
        resources = REGISTRY["targets"]["hq-legacy-relay"]["removed_resources"]
        for name in resources["containers"]:
            with self.subTest(container=name), self.assertRaises(release.Refused):
                release.validate_retired_boundary(REGISTRY,
                    [{"Name": "/" + name, "Config": {"Labels": {}}}], [], [])
        for kind in ("volumes", "networks"):
            for name in resources[kind]:
                with self.subTest(resource=name), self.assertRaises(release.Refused):
                    release.validate_retired_boundary(REGISTRY, [],
                        [name] if kind == "volumes" else [],
                        [name] if kind == "networks" else [])

    def test_renamed_legacy_container_and_proxy_alias_are_rejected(self):
        for mutation in ("project", "alias"):
            current = {"Name": "/renamed", "Config": {"Labels": {}}}
            if mutation == "project":
                current["Config"]["Labels"]["com.docker.compose.project"] = "buzz-prod"
            else:
                current["NetworkSettings"] = {"Networks": {"airhop-web": {
                    "Aliases": ["airhop-hq-relay"]}}}
            with self.subTest(mutation=mutation), self.assertRaises(release.Refused):
                release.validate_retired_boundary(REGISTRY, [current], [], [])

    def test_retired_check_does_not_inspect_missing_container_or_mutate(self):
        with patch.object(release, "command", side_effect=["", "buzz-demo-git-data", "airhop-web"]) as command, \
                patch.object(release, "inspect") as inspect:
            release.check_legacy_boundary(REGISTRY)
            inspect.assert_not_called()
            self.assertEqual([call.args for call in command.call_args_list], [
                ("docker", "ps", "-aq"),
                ("docker", "volume", "ls", "--format", "{{.Name}}"),
                ("docker", "network", "ls", "--format", "{{.Name}}")])

    def test_reappeared_legacy_blocks_apply_before_up(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = copy.deepcopy(REGISTRY)
            registry["targets"]["center-demo"]["lock"] = str(Path(directory) / "lock")
            plan = {"release_file": "/candidate.yml"}
            with patch.object(release, "make_plan", return_value=plan), \
                    patch.object(release, "check_legacy_boundary", side_effect=release.Refused("reappeared")), \
                    patch.object(release, "command") as command:
                with self.assertRaisesRegex(release.Refused, "reappeared"):
                    release.apply_plan(registry, plan)
                command.assert_not_called()

    def test_pilot_helpers_reject_missing_and_legacy_project_before_docker(self):
        for script in ("bootstrap-airhop-hermes.sh", "check-airhop-hermes-pilot.sh", "seed-airhop-demo.sh"):
            for project in ("", "buzz-prod"):
                with self.subTest(script=script, project=project), tempfile.TemporaryDirectory() as directory:
                    env_file = Path(directory) / ".env"
                    env_file.write_text("RELAY_URL=wss://demo.airhop.ru\n")
                    environment = {**os.environ, "AIRHOP_ENV_FILE": str(env_file),
                                   "AIRHOP_COMPOSE_PROJECT_NAME": project}
                    result = subprocess.run(["bash", str(ROOT / "scripts" / script)],
                                            env=environment, text=True, capture_output=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("explicit Center", result.stderr)

    def test_busy_environment_does_not_reach_preflight(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            registry = copy.deepcopy(REGISTRY)
            filename = str(Path(directory) / "lock")
            registry["targets"]["center-demo"]["lock"] = filename
            with open(filename, "a") as lock, patch.object(release, "make_plan") as plan:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(release.Refused, "lock"):
                    release.apply_plan(registry, {"release_file": "/candidate.yml"})
                plan.assert_not_called()


if __name__ == "__main__":
    unittest.main()
