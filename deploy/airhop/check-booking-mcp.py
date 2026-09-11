#!/usr/bin/env python3
"""Read-only MCP discovery smoke. No backend call, model call or parent message."""

import json
import subprocess
import sys

expected = {
    "airhop_get_turn_context", "airhop_get_family", "airhop_list_booking_options",
    "airhop_search_knowledge", "airhop_manage_booking", "airhop_send_parent_reply",
    "airhop_save_booking_draft", "airhop_commit_booking_draft", "airhop_cancel_booking_draft",
    "airhop_assign_conversation_branch",
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
    assert set(commit["inputSchema"]["properties"]) == {"version", "confirmedReply"}
    assert commit["inputSchema"]["required"] == ["version"]
    # Discovery alone missed a production regression: Hermes replaced all nine
    # tools with search/describe/call bridges. Exercise its real assembler too.
    surface_check = r'''
import json, os, sys, yaml
sys.path.insert(0, "/opt/hermes-agent")
from tools.tool_search import ToolSearchConfig, assemble_tool_defs
from tools.registry import registry
tools = json.load(sys.stdin)
config_path = os.path.join(os.environ["HERMES_HOME"], "config.yaml") if sys.argv[1] == "live" else "/opt/airhop-hermes/config.yaml"
with open(config_path) as stream:
    config = yaml.safe_load(stream)
raw = config.get("tools", {}).get("tool_search")
assert ToolSearchConfig.from_raw(raw).enabled == "off", "parent tools must be directly visible"
assert config["memory"]["memory_enabled"] is False
assert config["memory"]["user_profile_enabled"] is False
defs = [{"type":"function", "function":{"name":t["name"], "description":t.get("description", ""), "parameters":t["inputSchema"]}} for t in tools]
for definition in defs:
    function = definition["function"]
    registry.register(name=function["name"], toolset="mcp-airhop-agent-mcp", schema=function, handler=lambda *args, **kwargs: None)
assembled = assemble_tool_defs(defs, config=ToolSearchConfig.from_raw(raw))
assert not assembled.activated and assembled.tool_defs == defs
regression = assemble_tool_defs(defs, config=ToolSearchConfig.from_raw(None))
assert regression.activated, "negative control must reproduce the upstream default regression"
assert len(regression.tool_defs) == 3
print(json.dumps({"directTools":len(assembled.tool_defs), "defaultRegressionReproduced":True}))
'''
    if sys.argv[1:] == ["--live"]:
        surface_command = ["docker", "exec", "-i", "buzz-demo-hermes-parent-runtime-1", "/opt/hermes-agent/.venv/bin/python", "-c", surface_check, "live"]
    else:
        surface_command = ["docker", "run", "--rm", "--network", "none", "--read-only", "-i", "--entrypoint", "/opt/hermes-agent/.venv/bin/python", image, "-c", surface_check, "image"]
    try:
        surface = subprocess.run(surface_command, input=json.dumps(result["tools"]), text=True, capture_output=True, check=True, timeout=30)
    except subprocess.CalledProcessError as error:
        sys.stderr.write(error.stderr)
        raise
    print(json.dumps({"status": "ok", "tools": sorted(actual), "modelSurface": json.loads(surface.stdout), "externalActions": 0}))
finally:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
