"""Exercise actual pinned ACP initialize/session/new without sending a model prompt."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile


async def check(executable):
    with tempfile.TemporaryDirectory(prefix="airhop-team-acp-") as directory:
        env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "SSL_CERT_FILE") if key in os.environ}
        env.update(AIRHOP_HERMES_RUNTIME_ROOT=directory, AIRHOP_HERMES_PROVIDER="deepseek", AIRHOP_HERMES_MODEL="deepseek-v4-flash", DEEPSEEK_API_KEY="synthetic-no-model-call")
        log = Path(directory) / "stderr.log"
        with log.open("wb") as stderr:
            process = await asyncio.create_subprocess_exec(executable, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=stderr, env=env)
            async def request(identifier, method, params):
                process.stdin.write((json.dumps({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params}) + "\n").encode())
                await process.stdin.drain()
                while True:
                    line = await asyncio.wait_for(process.stdout.readline(), 55)
                    if not line:
                        raise RuntimeError(f"ACP exited before {method}: {log.read_text()[-2000:]}")
                    response = json.loads(line)
                    if response.get("id") == identifier:
                        if "error" in response:
                            raise RuntimeError(response["error"])
                        return response["result"]
            try:
                initialized = await request(1, "initialize", {"protocolVersion": 1, "clientCapabilities": {}, "clientInfo": {"name": "airhop-contract-check", "version": "1"}})
                assert initialized["protocolVersion"] == 1
                session = await request(2, "session/new", {"cwd": str(Path(directory) / "workspace"), "mcpServers": []})
                assert session["sessionId"]
                config = json.loads((Path(directory) / "hermes" / "config.yaml").read_text())
                assert config["mcp_servers"] == {}
                assert not config["memory"]["memory_enabled"]
                print("Pinned Hermes ACP: initialize + session/new OK; isolated profile; no model prompt sent.")
            finally:
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), 5)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()


if __name__ == "__main__":
    asyncio.run(check(sys.argv[1]))
