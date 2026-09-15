#!/usr/bin/env python3
"""Guarded static app release; run on the registered RU host. Never runs Compose."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time

ROOT = Path("/opt/airhop/demo-test/center-chat-app")
CONTROL = Path("/opt/airhop/site/chat-app-releases")
CONFIG = Path("/opt/airhop/site/source/deploy/beget/site/Caddyfile")
CONTAINER = "airhop-site-caddy-1"
IMPORT = "\n# AirHop Center browser application\nimport /srv/demo-test/center-chat-app/Caddyfile.fragment\n"
DAEMON = "dbfb14a9-8404-4f21-ad3e-3481b173ea9a"


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_new(path, data, mode=0o600):
    with open(path, "xb") as stream:
        os.chmod(path, mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def replace_in_place(path, data):
    # Preserve the inode of Caddy's verified file bind mount.
    with open(path, "r+b") as stream:
        stream.write(data)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())


def public_manifest(directory):
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("Symlink in public artifact")
        if path.is_file():
            name = path.relative_to(directory).as_posix()
            if not (name in {"index.html", "chat-centers.json", "chat.webmanifest", "chat-touch-icon.png", "chat-sw.js"} or name.startswith("chat-assets/")):
                raise RuntimeError(f"Unexpected public artifact: {name}")
            files[name] = sha(path.read_bytes())
    if not {"index.html", "chat-centers.json", "chat-sw.js"}.issubset(files):
        raise RuntimeError("Incomplete app artifact")
    for path in directory.rglob("*.js"):
        if b"/__demo__/session" in path.read_bytes():
            raise RuntimeError("Demo bootstrap in public artifact")
    centers = json.loads((directory / "chat-centers.json").read_text())
    if centers != [{"id": "center-demo", "name": "AirHop Center", "origin": "https://demo.airhop.ru"}]:
        raise RuntimeError("Unreviewed Center registry")
    return files


def inventory():
    ids = run("docker", "ps", "-aq").splitlines()
    items = json.loads(run("docker", "inspect", *ids))
    return {item["Name"].lstrip("/"): {
        "id": item["Id"], "image": item["Image"], "started": item["State"]["StartedAt"],
        "project": item["Config"].get("Labels", {}).get("com.docker.compose.project"),
        "compose": item["Config"].get("Labels", {}).get("com.docker.compose.project.config_files"),
    } for item in items}


def live_hash():
    raw = run("docker", "exec", CONTAINER, "wget", "-qO-", "http://127.0.0.1:2019/config/")
    return sha(json.dumps(json.loads(raw), sort_keys=True).encode())


def imports():
    # Current shared configuration contains one reviewed external fragment.
    result = {}
    for match in re.findall(r"^import (\S+)$", CONFIG.read_text(), re.M):
        if not match.startswith("/srv/demo-test/") or "*" in match:
            raise RuntimeError("Unreviewed Caddy import")
        host = Path(match.replace("/srv/demo-test/", "/opt/airhop/demo-test/", 1))
        digest = sha(host.read_bytes())
        mounted = run("docker", "exec", CONTAINER, "sha256sum", match).split()[0]
        if digest != mounted:
            raise RuntimeError("Imported fragment mount drift")
        result[str(host)] = digest
    return result


def identity():
    if socket.gethostname() != "airhop-prod" or run("docker", "info", "--format", "{{.ID}}") != DAEMON:
        raise RuntimeError("Wrong deployment host/daemon")
    if sha(CONFIG.read_bytes()) != run("docker", "exec", CONTAINER, "sha256sum", "/etc/caddy/Caddyfile").split()[0]:
        raise RuntimeError("Caddy file bind mount drift")


def reload_config():
    run("docker", "exec", CONTAINER, "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")


@contextlib.contextmanager
def locks():
    with contextlib.ExitStack() as stack:
        for path in ["/opt/airhop/site/deploy.lock", "/opt/airhop/buzz-demo/deploy.lock"]:
            handle = stack.enter_context(open(path, "a"))
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def snapshot():
    identity()
    return {"config": sha(CONFIG.read_bytes()), "imports": imports(), "live": live_hash(), "containers": inventory()}


def probe(path):
    return subprocess.check_output([
        "curl", "--silent", "--show-error", "--fail", "--max-time", "10",
        "--resolve", "app.airhop.ru:443:127.0.0.1", f"https://app.airhop.ru{path}"
    ], stderr=subprocess.PIPE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "apply", "rollback"])
    parser.add_argument("release_id")
    args = parser.parse_args()
    if not re.fullmatch(r"chat-app-[a-z0-9-]+", args.release_id):
        raise RuntimeError("Invalid release id")
    release = ROOT / "releases" / args.release_id
    public = release / "public"
    control = CONTROL / args.release_id
    plan_path = control / "plan.json"
    with locks():
        before = snapshot()
        manifest = public_manifest(public)
        fragment = (release / "Caddyfile.fragment").read_bytes()
        if args.action == "plan":
            if "app.airhop.ru" in CONFIG.read_text() or IMPORT.strip() in CONFIG.read_text():
                raise RuntimeError("First-release runner refuses to overwrite an existing app")
            if (ROOT / "current").exists() or (ROOT / "Caddyfile.fragment").exists():
                raise RuntimeError("App already staged/active; inspect predecessor")
            control.mkdir(parents=True, exist_ok=False, mode=0o700)
            candidate = CONFIG.read_bytes() + IMPORT.encode()
            # Validate an equivalent candidate with a sealed per-release fragment path.
            sealed = candidate.replace(b"/srv/demo-test/center-chat-app/Caddyfile.fragment", f"/srv/demo-test/center-chat-app/releases/{args.release_id}/Caddyfile.fragment".encode())
            write_new(release / "candidate.Caddyfile", sealed, 0o644)
            run("docker", "exec", CONTAINER, "caddy", "validate", "--config", f"/srv/demo-test/center-chat-app/releases/{args.release_id}/candidate.Caddyfile", "--adapter", "caddyfile")
            plan = {"release_id": args.release_id, "before": before, "files": manifest,
                    "fragment": sha(fragment), "candidate": sha(candidate), "runner": sha(Path(__file__).read_bytes())}
            write_new(control / "predecessor.Caddyfile", CONFIG.read_bytes())
            write_new(plan_path, (json.dumps(plan, indent=2) + "\n").encode())
            print(json.dumps({"planned": args.release_id, "plan": str(plan_path), "files": len(manifest), "before": before}, indent=2))
            return
        plan = json.loads(plan_path.read_text())
        if args.action == "rollback":
            receipt = json.loads((control / "receipt.json").read_text())
            if (before["config"] != receipt["config"] or before["live"] != receipt["live"]
                    or before["containers"] != plan["before"]["containers"]):
                raise RuntimeError("Published predecessor changed; refusing rollback")
            if sha((ROOT / "Caddyfile.fragment").read_bytes()) != plan["fragment"]:
                raise RuntimeError("App fragment changed; refusing rollback")
            for path, digest in plan["before"]["imports"].items():
                if sha(Path(path).read_bytes()) != digest:
                    raise RuntimeError("Shared import changed; refusing rollback")
            predecessor = (control / "predecessor.Caddyfile").read_bytes()
            if sha(predecessor) != plan["before"]["config"]:
                raise RuntimeError("Backup changed")
            replace_in_place(CONFIG, predecessor)
            reload_config()
            if live_hash() != plan["before"]["live"]:
                raise RuntimeError("Rollback runtime mismatch")
            write_new(control / "rollback.json", json.dumps({"rolled_back": args.release_id}).encode())
            print("App vhost rolled back. DNS, static release and backups retained.")
            return
        if before != plan["before"]:
            raise RuntimeError("Predecessor changed; refusing apply")
        if manifest != plan["files"] or sha(fragment) != plan["fragment"] or sha(Path(__file__).read_bytes()) != plan["runner"]:
            raise RuntimeError("Candidate/runner changed")
        addresses = {row[4][0] for row in socket.getaddrinfo("app.airhop.ru", 443)}
        if addresses != {"46.173.25.23"}:
            raise RuntimeError(f"DNS not ready: {addresses}")
        predecessor = (control / "predecessor.Caddyfile").read_bytes()
        candidate = predecessor + IMPORT.encode()
        if sha(candidate) != plan["candidate"] or sha(predecessor) != before["config"]:
            raise RuntimeError("Invalid plan material")
        changed = False
        try:
            os.symlink(f"releases/{args.release_id}", ROOT / "current")
            write_new(ROOT / "Caddyfile.fragment", fragment, 0o644)
            changed = True
            replace_in_place(CONFIG, candidate)
            identity()
            run("docker", "exec", CONTAINER, "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
            reload_config()
            for attempt in range(12):
                try:
                    if sha(probe("/chat")) != manifest["index.html"]:
                        raise RuntimeError("Unexpected public app HTML")
                    break
                except subprocess.CalledProcessError:
                    if attempt == 11:
                        raise
                    time.sleep(2)
            info = json.loads(probe("/centers/center-demo/"))
            if info.get("self") != "5e83f8d72f81a0c176127c6239be37902ffd023ebbfb6939883c7d013bc459f9":
                raise RuntimeError("Wrong relay behind app bridge")
            if inventory() != before["containers"]:
                raise RuntimeError("Neighbor container changed")
            receipt = {"release_id": args.release_id, "url": "https://app.airhop.ru/chat", "files": manifest,
                       "config": sha(candidate), "live": live_hash(), "center": "https://demo.airhop.ru", "containers_unchanged": True}
            write_new(control / "receipt.json", (json.dumps(receipt, indent=2) + "\n").encode())
            print(json.dumps(receipt, indent=2))
        except BaseException:
            if changed:
                replace_in_place(CONFIG, predecessor)
                reload_config()
                if live_hash() != before["live"]:
                    raise RuntimeError("Rollback runtime mismatch; manual inspection required")
                print("App activation rolled back; staged files retained for review.")
            raise


if __name__ == "__main__":
    main()
