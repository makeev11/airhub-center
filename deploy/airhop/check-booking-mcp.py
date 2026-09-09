#!/usr/bin/env python3
"""Read-only MCP discovery smoke. No backend call, model call or parent message."""

import json
import subprocess
import sys

expected = {
    "airhop_get_turn_context", "airhop_get_family", "airhop_list_booking_options",
    "airhop_search_knowledge", "airhop_manage_booking", "airhop_send_parent_reply",
    "airhop_save_booking_draft", "airhop_commit_booking_draft", "airhop_cancel_booking_draft",
}
if sys.argv[1:] == ["--live"]:
    command = ["docker", "exec", "-i", "buzz-demo-hermes-parent-runtime-1", "airhop-agent-mcp"]
else:
    image = sys.argv[1]
    command = [
        "docker", "run", "--rm", "--network", "none", "--read-only", "-i",
        "--entrypoint", "airhop-agent-mcp",
        "-e", "BUZZ_AIRHOP_ROLE=parent_administrator",
        "-e", "BUZZ_RELAY_URL=http://127.0.0.1:1",
        # Public test key, never an account or deployment credential.
        "-e", "BUZZ_PRIVATE_KEY=" + "0" * 63 + "1",
        "-e", "BUZZ_AIRHOP_CONTEXT_GRANT_FILE=/dev/null", image,
    ]
process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)


def send(payload):
    process.stdin.write(json.dumps(payload) + "\n")
    process.stdin.flush()


def receive(request_id):
    while True:
        line = process.stdout.readline()
        if not line:
            raise RuntimeError("MCP closed before replying")
        value = json.loads(line)
        if value.get("id") == request_id:
            assert "error" not in value, value
            return value["result"]


try:
    send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {},
        "clientInfo": {"name": "airhop-booking-readonly-preflight", "version": "1"},
    }})
    receive(1)
    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    result = receive(2)
    actual = {tool["name"] for tool in result["tools"]}
    assert actual == expected, {"missing": sorted(expected - actual), "unexpected": sorted(actual - expected)}
    commit = next(tool for tool in result["tools"] if tool["name"] == "airhop_commit_booking_draft")
    assert set(commit["inputSchema"]["properties"]) == {"version"}
    print(json.dumps({"status": "ok", "tools": sorted(actual), "externalActions": 0}))
finally:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
