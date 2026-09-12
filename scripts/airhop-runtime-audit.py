#!/usr/bin/env python3
"""Read-only, credential-free Docker inventory. Run on the deployment host."""

import datetime
import json
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    ids = run("docker", "ps", "-aq").split()
    containers = json.loads(run("docker", "inspect", *ids)) if ids else []
    rows = []
    for container in containers:
        config = container["Config"]
        labels = config.get("Labels") or {}
        project = labels.get("com.docker.compose.project", "")
        if not (project.startswith(("airhop", "buzz"))):
            continue
        rows.append({
            "container": container["Name"].lstrip("/"),
            "id": container["Id"],
            "project": project,
            "service": labels.get("com.docker.compose.service"),
            "image": config["Image"],
            "image_id": container["Image"],
            "status": container["State"]["Status"],
            "health": container["State"].get("Health", {}).get("Status"),
            "started_at": container["State"]["StartedAt"],
            "compose_files": labels.get(
                "com.docker.compose.project.config_files", ""
            ).split(","),
            "working_dir": labels.get("com.docker.compose.project.working_dir"),
            "mounts": [{"type": m["Type"], "name": m.get("Name"),
                        "source": m["Source"], "destination": m["Destination"],
                        "writable": m["RW"]} for m in container["Mounts"]],
            "networks": {name: {"aliases": value.get("Aliases") or []}
                         for name, value in container["NetworkSettings"]["Networks"].items()},
        })
    print(json.dumps({
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "hostname": run("hostname"),
        "docker_id": run("docker", "info", "--format", "{{.ID}}"),
        "containers": sorted(rows, key=lambda row: row["container"]),
    }, indent=2))


if __name__ == "__main__":
    main()
