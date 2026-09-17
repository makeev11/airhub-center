#!/usr/bin/env python3
"""Build the exact Hermes reminder relay commit on the bounded AirHop builder."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tarfile
import time


ROOT = Path("/opt/airhop-infra/builds/center-hermes-return-reminders-20260917-v1")
BUILDER = "airhop-center-ticket-20260916-v1"
BUILDER_CONTAINER = "buildx_buildkit_" + BUILDER + "0"
EXPORT = "airhop-hermes-return-reminders-export-20260917-v1"
IMAGE = "airhop-hermes-return-reminders-binary:20260917-v1"
COMMIT = "a51571b81e6f9d3e245f1e05e4ddab23d67d2dfd"
DAEMON = "ecd7ebd1-362b-4a1a-86bb-69dd3cb138eb"


def run(*args: str, timeout: int = 60) -> str:
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def inspect(name: str, image: bool = False) -> dict:
    command = ("docker", "image", "inspect") if image else ("docker", "inspect")
    return json.loads(run(*command, name))[0]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def tree_hashes(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): sha256(path)
        for path in root.rglob("*")
        if path.is_file()
    }


def record(name: str, value: object) -> None:
    with (ROOT / name).open("x") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")


def neighbors() -> dict:
    result = {}
    for identifier in run("docker", "ps", "-aq").split():
        item = inspect(identifier)
        name = item["Name"].lstrip("/")
        if name in (BUILDER_CONTAINER, EXPORT):
            continue
        result[name] = {
            "id": item["Id"],
            "image": item["Image"],
            "started": item["State"]["StartedAt"],
            "status": item["State"]["Status"],
            "restarts": item["RestartCount"],
        }
    return result


def guard() -> None:
    if socket.gethostname() != "srv1610606":
        raise RuntimeError("Wrong build host")
    if run("docker", "info", "--format", "{{.ID}}") != DAEMON:
        raise RuntimeError("Wrong build daemon")
    if ROOT.exists() and neighbors() != json.loads((ROOT / "predecessor.json").read_text()):
        raise RuntimeError("Build-host containers changed; review required")


def prepare(archive: Path, archive_digest: str, dockerfile: Path, dockerfile_digest: str) -> None:
    if ROOT.exists():
        raise RuntimeError("Release directory already exists")
    if shutil.disk_usage("/opt").free < 15 * 1024**3:
        raise RuntimeError("Insufficient build-host disk headroom")
    try:
        inspect(IMAGE, image=True)
    except subprocess.CalledProcessError:
        pass
    else:
        raise RuntimeError("Candidate build image already exists")
    if not archive.is_file() or sha256(archive) != archive_digest:
        raise RuntimeError("Source archive hash mismatch")
    if not dockerfile.is_file() or sha256(dockerfile) != dockerfile_digest:
        raise RuntimeError("Dockerfile hash mismatch")

    before = neighbors()
    ROOT.mkdir(parents=True, exist_ok=False)
    record("predecessor.json", before)
    source = ROOT / "source"
    source.mkdir()
    with tarfile.open(archive) as bundle:
        members = []
        for member in bundle.getmembers():
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError("Unsafe source archive path")
            # Repository convenience/toolchain links point outside the checkout.
            # The Linux builder supplies its own Rust toolchain, and none of these
            # links belongs to the relay source or Cargo inputs.
            if member.issym() or member.islnk():
                continue
            members.append(member)
        bundle.extractall(source, members=members, filter="data")
    shutil.copyfile(dockerfile, ROOT / "Dockerfile")
    record(
        "inputs.json",
        {
            "commit": COMMIT,
            "archive_sha256": archive_digest,
            "dockerfile_sha256": dockerfile_digest,
            "source_files": tree_hashes(source),
        },
    )


def build() -> None:
    if (ROOT / "build-receipt.json").exists():
        raise RuntimeError("Build already completed")
    inputs = json.loads((ROOT / "inputs.json").read_text())
    if sha256(ROOT / "Dockerfile") != inputs["dockerfile_sha256"]:
        raise RuntimeError("Prepared Dockerfile changed")
    if tree_hashes(ROOT / "source") != inputs["source_files"]:
        raise RuntimeError("Prepared source changed")
    try:
        run("docker", "buildx", "inspect", "--builder", BUILDER, "--bootstrap", timeout=180)
        limits = inspect(BUILDER_CONTAINER)["HostConfig"]
        expected = {
            "Memory": 3 * 1024**3,
            "MemorySwap": 3 * 1024**3,
            "CpuQuota": 100000,
            "CpuPeriod": 100000,
            "PidsLimit": 256,
        }
        if any(limits[key] != value for key, value in expected.items()):
            raise RuntimeError("Builder resource limits changed")
        with (ROOT / "build.log").open("x") as log:
            subprocess.run(
                [
                    "docker", "buildx", "build", "--builder", BUILDER,
                    "--platform", "linux/amd64", "--load", "--progress", "plain",
                    "-f", str(ROOT / "Dockerfile"), "-t", IMAGE, str(ROOT / "source"),
                ],
                check=True,
                timeout=5400,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
    finally:
        run("docker", "buildx", "stop", BUILDER, timeout=90)

    image = inspect(IMAGE, image=True)
    if image["Architecture"] != "amd64":
        raise RuntimeError("Wrong candidate architecture")
    if (image["Config"].get("Labels") or {}).get("org.opencontainers.image.revision") != COMMIT:
        raise RuntimeError("Candidate commit label mismatch")
    run("docker", "create", "--name", EXPORT, IMAGE)
    try:
        run("docker", "cp", EXPORT + ":/out/buzz-relay", str(ROOT / "buzz-relay"))
        os.chmod(ROOT / "buzz-relay", 0o555)
    finally:
        run("docker", "rm", EXPORT)
    if not (ROOT / "buzz-relay").read_bytes().startswith(b"\x7fELF"):
        raise RuntimeError("Exported artifact is not ELF")
    guard()
    record(
        "build-receipt.json",
        {
            "commit": COMMIT,
            "image": IMAGE,
            "image_id": image["Id"],
            "binary_sha256": sha256(ROOT / "buzz-relay"),
            "daemon": DAEMON,
            "completed_at": time.time(),
        },
    )


def main() -> None:
    with open("/opt/airhop-infra/deploy.lock", "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        guard()
        action = sys.argv[1]
        if action == "prepare":
            prepare(Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), sys.argv[5])
        elif action == "build":
            build()
        else:
            raise RuntimeError("Unknown action")
        guard()
        print(f"Completed {action}; build-host product containers unchanged")


if __name__ == "__main__":
    main()
