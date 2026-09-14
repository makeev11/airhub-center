"""Isolated product profile around the pinned Nous ACP runtime; no agent loop here."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile


def profile_config(env: dict[str, str]) -> dict:
    provider = env.get("AIRHOP_HERMES_PROVIDER") or env.get("BUZZ_AGENT_PROVIDER")
    model = env.get("AIRHOP_HERMES_MODEL") or env.get("BUZZ_ACP_MODEL")
    if not provider and env.get("DEEPSEEK_API_KEY"):
        provider = "deepseek"
    if provider == "deepseek" and not model:
        model = "deepseek-v4-flash"
    if not provider or not model:
        raise ValueError("Configure AIRHOP_HERMES_PROVIDER and AIRHOP_HERMES_MODEL, plus its provider credentials. DeepSeek uses DEEPSEEK_API_KEY and defaults to deepseek-v4-flash.")
    return {
        "model": {"provider": provider, "default": model},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "compression": {"enabled": True},
        "tools": {"tool_search": {"enabled": "off"}},
        "mcp_servers": {},
    }


def configure_profile(root: Path, env: dict[str, str], config: dict) -> Path:
    if not root.is_absolute():
        raise ValueError("AIRHOP_HERMES_RUNTIME_ROOT must be an absolute isolated path")
    os.umask(0o077)
    home, workspace = root / "hermes", root / "workspace"
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
    # JSON is valid YAML. The profile contains no keys, customer facts or copied personal config.
    temporary = home / "config.yaml.tmp"
    temporary.write_text(json.dumps(config), encoding="utf-8")
    temporary.replace(home / "config.yaml")
    env.update({
        "HERMES_HOME": str(home),
        "HERMES_ACP_BUILTIN_TOOLSETS": "",
        "HERMES_ACP_SKIP_CONFIGURED_MCP": "1",
        "HERMES_ACP_MAX_ITERATIONS": "16",
    })
    return workspace


def main() -> None:
    runtime = Path(__file__).resolve().parent / "runtime"
    executable = runtime / ".venv" / "bin" / "hermes-acp"
    if sys.argv[1:] == ["--check"]:
        with tempfile.TemporaryDirectory(prefix="airhop-hermes-check-") as temporary:
            env = dict(os.environ)
            config = profile_config({"AIRHOP_HERMES_PROVIDER": "deepseek", "AIRHOP_HERMES_MODEL": "deepseek-v4-flash"})
            workspace = configure_profile(Path(temporary), env, config)
            result = subprocess.run([str(executable), "--check"], env=env, cwd=workspace, check=False)
            sys.exit(result.returncode)
    raw_root = os.environ.get("AIRHOP_HERMES_RUNTIME_ROOT")
    if not raw_root:
        raise ValueError("Airhop Desktop must supply an isolated AIRHOP_HERMES_RUNTIME_ROOT")
    env = dict(os.environ)
    config = profile_config(env)
    workspace = configure_profile(Path(raw_root), env, config)
    os.chdir(workspace)
    os.execve(str(executable), [str(executable), *sys.argv[1:]], env)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"Airhop Hermes setup: {error}", file=sys.stderr)
        sys.exit(1)
