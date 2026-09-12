#!/usr/bin/env python3
"""Plan/apply an image-only Center demo relay release; reject drift and other targets.

Runs on the registered Linux host. Plans contain hashes, never environment values.
This is not a database migrator, a multi-service deployer, or an HQ recovery tool.
"""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys


class Refused(Exception):
    """The observed deployment does not match the reviewed release boundary."""


def require(condition, message):
    if not condition:
        raise Refused(message)


def command(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=240)
    # Compose errors can include interpolated credentials. Do not echo them.
    require(result.returncode == 0, f"Command failed: {args[0]} (details suppressed)")
    return result.stdout.strip()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def inspect(name, image=False):
    args = ("docker", "image", "inspect") if image else ("docker", "inspect")
    return json.loads(command(*args, name))[0]


def validate_config(config, target):
    require(config.get("name") == target["project"], "Wrong Compose project")
    relay = config["services"]["relay"]
    require(relay.get("environment", {}).get("RELAY_URL") == "wss://" + target["host"],
            "Wrong relay hostname")
    networks = config.get("networks", {})
    require(networks.get("buzz-net", {}).get("name") == target["network"],
            "Wrong private network")
    require(networks.get("airhop-web", {}).get("name") == target["proxy_network"],
            "Wrong proxy network")
    aliases = relay.get("networks", {}).get("airhop-web", {}).get("aliases", [])
    require(target["proxy_alias"] in aliases and "airhop-hq-relay" not in aliases,
            "Wrong proxy alias")
    for key, name in target["volumes"].items():
        require(config.get("volumes", {}).get(key, {}).get("name") == name,
                f"Wrong volume: {key}")
    for service in config["services"].values():
        name = service.get("container_name", "")
        require(not name or name.startswith(target["project"] + "-"),
                "Cross-project container name")


def validate_delta(before, after):
    """Allow only the relay image and release labels to change."""
    normalized = copy.deepcopy(after)
    old = before["services"]["relay"]
    new = normalized["services"]["relay"]
    for key in ("image", "labels"):
        if key in old:
            new[key] = old[key]
        else:
            new.pop(key, None)
    require(normalized == before, "Release changes more than relay image/labels")
    old_labels = old.get("labels", {})
    new_labels = after["services"]["relay"].get("labels", {})
    for key in set(old_labels) | set(new_labels):
        if not key.startswith("ru.airhop."):
            require(old_labels.get(key) == new_labels.get(key),
                    "Release changes routing or infrastructure labels")


def compose_args(target, files):
    args = ["docker", "compose", "--project-name", target["project"],
            "--env-file", target["env_file"]]
    for filename in files:
        args.extend(["-f", filename])
    return args


def validate_reconciliation(output, target):
    """Require Compose itself to consider the baseline already converged.

    `config --hash` and the stored runtime hash can differ even when this pinned
    Compose version plans no replacement. Never interpret that comparison alone
    as proof of drift. Unknown dry-run output is rejected, not guessed.
    """
    actions = [line.strip() for line in output.splitlines() if "DRY-RUN MODE" in line]
    pattern = r"DRY-RUN MODE\s+-\s+Container\s+" + re.escape(target["container"]) + r"\s+Running"
    require(len(actions) == 1 and re.fullmatch(pattern, actions[0]) is not None,
            "Baseline dry-run would change resources or has unknown output; inspect drift")


def check_reconciliation(args, target):
    result = subprocess.run(
        [*args, "--ansi", "never", "--dry-run", "up", "-d", "--no-deps",
         "--no-build", "--pull", "never", "relay"],
        text=True, capture_output=True, timeout=60)
    require(result.returncode == 0, "Baseline dry-run failed (details suppressed)")
    validate_reconciliation(result.stdout + result.stderr, target)


def validate_live(config, current, target):
    """Catch config-file drift that predates creation of the review plan."""
    relay = config["services"]["relay"]
    live_env = dict(item.split("=", 1) for item in current["Config"].get("Env", [])
                    if "=" in item)
    for key, value in relay.get("environment", {}).items():
        require(live_env.get(key) == value, f"Live environment differs: {key}")
    for field, live_field in (("command", "Cmd"), ("entrypoint", "Entrypoint"),
                              ("user", "User"), ("working_dir", "WorkingDir")):
        if relay.get(field) is not None:
            expected = relay[field]
            if field in ("command", "entrypoint") and isinstance(expected, str):
                expected = shlex.split(expected)
            require(expected == current["Config"].get(live_field),
                    f"Live container differs: {field}")
    expected_mounts = {(m["target"], config["volumes"][m["source"]]["name"])
                       for m in relay.get("volumes", []) if m["type"] == "volume"}
    require(all(m["type"] == "volume" for m in relay.get("volumes", [])),
            "Bind mounts require a separate reviewed deployment")
    actual_mounts = {(m["Destination"], m.get("Name")) for m in current["Mounts"]}
    require(expected_mounts == actual_mounts, "Live mounts differ from configuration")
    require(set(current["NetworkSettings"]["Networks"]) ==
            {target["network"], target["proxy_network"]}, "Live networks differ")
    require(target["proxy_alias"] in current["NetworkSettings"]["Networks"][
        target["proxy_network"]].get("Aliases", []), "Live proxy alias is missing")
    for key, value in relay.get("labels", {}).items():
        require(current["Config"].get("Labels", {}).get(key) == value,
                f"Live label differs: {key}")


def protected_containers(target):
    ids = command("docker", "ps", "-aq").split()
    data = json.loads(command("docker", "inspect", *ids)) if ids else []
    return {c["Name"]: {"id": c["Id"], "image": c["Image"],
                       "started_at": c["State"]["StartedAt"],
                       "status": c["State"]["Status"],
                       "restart_policy": c["HostConfig"]["RestartPolicy"]["Name"]}
            for c in data if c["Name"] != "/" + target["container"]}


def validate_legacy_boundary(registry, current):
    """Preserve the audited quarantine; demo releases must not revive legacy HQ."""
    target = registry["targets"]["hq-legacy-relay"]
    require(target.get("lifecycle") == "quarantined", "Legacy lifecycle needs review")
    require(current["Id"] == target["quarantine_container_id"] and
            current["Image"] == target["quarantine_image_id"],
            "Legacy container identity changed; review the inventory")
    require(current["Config"].get("Labels", {}).get("com.docker.compose.project") == target["project"],
            "Legacy project identity changed")
    require(not current["State"]["Running"] and
            current["HostConfig"]["RestartPolicy"]["Name"] == "no",
            "Legacy relay is not in the audited quarantine; do not restart it for demo")


def make_plan(registry, release_file):
    target = registry["targets"]["center-demo"]
    require(command("docker", "info", "--format", "{{.ID}}") == registry["host"]["docker_id"],
            "Wrong Docker daemon")
    validate_legacy_boundary(registry, inspect(registry["targets"]["hq-legacy-relay"]["container"]))
    current = inspect(target["container"])
    labels = current["Config"].get("Labels") or {}
    require(labels.get("com.docker.compose.project") == target["project"],
            "Live container belongs to another project")
    require(current["State"].get("Health", {}).get("Status") == "healthy",
            "Demo relay must be healthy before planning")
    files = labels.get("com.docker.compose.project.config_files", "").split(",")
    require(files[:2] == [target["base_file"], target["host_file"]],
            "Unexpected base/host configuration chain")
    require(all(Path(f).is_file() for f in files), "Missing Compose input")
    release_file = str(Path(release_file).resolve(strict=True))
    require(release_file not in files, "Release is already in the active chain")
    base_args = compose_args(target, files)
    check_reconciliation(base_args, target)
    before = json.loads(command(*base_args, "config", "--format", "json"))
    after = json.loads(command(*compose_args(target, files + [release_file]),
                               "config", "--format", "json"))
    validate_config(before, target)
    validate_config(after, target)
    validate_delta(before, after)
    validate_live(before, current, target)
    old_image = before["services"]["relay"]["image"]
    new_image = after["services"]["relay"]["image"]
    require(old_image == current["Config"]["Image"], "Active image differs from Compose")
    require(inspect(old_image, image=True)["Id"] == current["Image"], "Predecessor tag moved")
    require(old_image != new_image and not new_image.endswith(":latest"),
            "Use a distinct immutable release tag")
    candidate = inspect(new_image, image=True)
    inputs = files + [release_file, target["env_file"]]
    return {
        "target": "center-demo", "docker_id": registry["host"]["docker_id"],
        "container_id": current["Id"], "image": old_image, "image_id": current["Image"],
        "next_image": new_image, "next_image_id": candidate["Id"],
        "release_file": release_file, "compose_files": files,
        "inputs": {f: hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in inputs},
        "base_config_sha256": digest(before), "next_config_sha256": digest(after),
        "protected": protected_containers(target),
    }


def apply_plan(registry, expected):
    import fcntl  # Deployment host is Linux; flock is shared with older scripts.

    target = registry["targets"]["center-demo"]
    with open(target["lock"], "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Refused("Another demo release holds the deployment lock") from exc
        actual = make_plan(registry, expected["release_file"])
        require(actual == expected, "Plan is stale; inspect and prepare a new plan")
        # The actual HQ runs on Cloudflare. Preserve the legacy relay quarantine.
        legacy = inspect(registry["targets"]["hq-legacy-relay"]["container"])
        validate_legacy_boundary(registry, legacy)
        # Pull/build/dependencies are explicitly disabled. Only the reviewed relay changes.
        args = compose_args(target, actual["compose_files"] + [actual["release_file"]])
        command(*args, "up", "-d", "--no-deps", "--no-build", "--pull", "never",
                "--wait", "--wait-timeout", "180", "relay")
        deployed = inspect(target["container"])
        require(deployed["Image"] == actual["next_image_id"], "Unexpected deployed image")
        require(deployed["State"].get("Health", {}).get("Status") == "healthy",
                "Deployed relay is not healthy")
        require(protected_containers(target) == actual["protected"],
                "A protected container changed; investigate before further action")
        print("Center demo relay is healthy. Verify public routes and record acceptance.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=Path(__file__).resolve().parent.parent
                        / "deploy/airhop/environments.json")
    sub = parser.add_subparsers(dest="mode", required=True)
    plan = sub.add_parser("plan", help="Read-only Docker preflight; write a local review plan")
    plan.add_argument("--release-file", required=True)
    plan.add_argument("--out", type=Path, required=True)
    apply = sub.add_parser("apply", help="Apply a reviewed plan under the demo lock")
    apply.add_argument("plan", type=Path)
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text())
    if args.mode == "plan":
        result = make_plan(registry, args.release_file)
        # Never overwrite another task's plan. Protect hashes of private inputs.
        fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(result, output, indent=2)
            output.write("\n")
        print(f"Review plan: {args.out}. No containers changed.")
    else:
        apply_plan(registry, json.loads(args.plan.read_text()))


if __name__ == "__main__":
    try:
        main()
    except (Refused, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        # OSError/JSON errors can include paths, but never print config/stdout.
        print(f"Release stopped: {error if isinstance(error, Refused) else type(error).__name__}",
              file=sys.stderr)
        sys.exit(1)
