# Airhop Hermes Parent Runtime

This image runs the hosted, always-on Hermes parent administrator behind the
Buzz ACP supervisor. It combines:

- the pinned upstream Hermes Agent ACP adapter for model execution and durable
  per-channel session history;
- `buzz-acp` for Buzz subscriptions, queueing, typing/presence and supervisor
  turn claims;
- the role-scoped `airhop-agent-mcp` as the only action surface.

The upstream `hermes-acp` preset normally includes shell, filesystem, browser,
code execution and subagent tools. A small fail-closed patch, pinned to the
exact upstream commit, allows this deployment to start with no built-in
toolsets. The ACP-provided Airhop MCP server is then added per session. Image
builds fail if the upstream source no longer matches the reviewed patch.
Python dependencies are installed with that commit's frozen `uv.lock` using
the digest-pinned upstream `uv` image. The final runtime contains neither
`git` nor `uv`.

Required runtime secrets:

```dotenv
AIRHOP_HERMES_RELAY_URL=wss://center.example.com
AIRHOP_HERMES_AGENT_SECRET_KEY=CHANGE_ME_64_HEX
DEEPSEEK_API_KEY=CHANGE_ME
```

The public relay URL is deliberate: its host selects the Center tenant and is
also the exact URL covered by NIP-98 authentication. The Hermes private key and
DeepSeek key exist only in this container.

The persistent volume contains Hermes session history. It must use encrypted
storage and must not be shared between organizations. Airhop family, booking
and knowledge data remain in Airhop and are retrieved through short-lived,
turn-scoped grants; they are not copied into the Hermes profile.
