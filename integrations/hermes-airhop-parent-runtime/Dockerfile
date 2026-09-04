# syntax=docker/dockerfile:1.7
FROM rust:1.95-alpine3.22@sha256:064dfc925d68d1a63f4fd2871bd7dc6e6ea56692989a487185855d62885d90aa AS sprig-builder

RUN apk add --no-cache \
      build-base \
      cmake \
      git \
      musl-dev \
      openssl-dev \
      openssl-libs-static \
      perl \
      pkgconf \
      protoc
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
COPY crates crates
COPY examples examples
RUN --mount=type=cache,id=airhop-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=airhop-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=airhop-sprig-target,target=/build/target \
    cargo build --locked --profile sprig -p sprig \
    && strip target/sprig/sprig \
    && cp target/sprig/sprig /tmp/sprig

FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie@sha256:b3c543b6c4f23a5f2df22866bd7857e5d304b67a564f4feab6ac22044dde719b AS uv-source

FROM python:3.12-slim-bookworm AS hermes-builder

# Annotated tag v2026.8.18 resolves to this immutable commit (Hermes Agent 0.20.4).
ARG HERMES_AGENT_COMMIT=e624e9fde561e1add9388384012b295fde669ade

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv-source --chmod=0755 /usr/local/bin/uv /usr/local/bin/uv

RUN git clone --filter=blob:none https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent \
    && git -C /opt/hermes-agent checkout --detach "${HERMES_AGENT_COMMIT}" \
    && test "$(git -C /opt/hermes-agent rev-parse HEAD)" = "${HERMES_AGENT_COMMIT}"

WORKDIR /opt/hermes-agent
RUN --mount=type=cache,id=airhop-uv-cache,target=/root/.cache/uv \
    uv sync --python /usr/local/bin/python3.12 --frozen --no-install-project --no-dev
RUN --mount=type=cache,id=airhop-uv-cache,target=/root/.cache/uv \
    uv sync --python /usr/local/bin/python3.12 --frozen --no-install-project --no-dev --extra acp --extra mcp

COPY integrations/hermes-airhop-parent-runtime/hermes-agent-acp-toolsets.patch /tmp/hermes-agent-acp-toolsets.patch
RUN git -C /opt/hermes-agent apply --check /tmp/hermes-agent-acp-toolsets.patch \
    && git -C /opt/hermes-agent apply /tmp/hermes-agent-acp-toolsets.patch \
    && uv pip install --no-cache-dir --no-deps --editable . \
    && rm -rf /opt/hermes-agent/.git /tmp/hermes-agent-acp-toolsets.patch

FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10002 airhop-hermes \
    && useradd --system --uid 10002 --gid 10002 \
        --home-dir /var/lib/airhop-hermes-runtime --create-home \
        --shell /usr/sbin/nologin airhop-hermes \
    && install -d -o airhop-hermes -g airhop-hermes \
        /var/lib/airhop-hermes-runtime/hermes \
        /var/lib/airhop-hermes-runtime/runtime \
        /var/lib/airhop-hermes-runtime/workspace \
    && install -d -o root -g root -m 0755 /opt/airhop-hermes

COPY --from=hermes-builder --chown=root:root /opt/hermes-agent /opt/hermes-agent
COPY --from=sprig-builder --chmod=0755 /tmp/sprig /usr/local/bin/sprig
RUN for name in buzz-acp airhop-agent-mcp buzz; do ln -s sprig "/usr/local/bin/$name"; done

COPY --chmod=0644 integrations/hermes-airhop-parent-runtime/config.yaml /opt/airhop-hermes/config.yaml
COPY --chmod=0644 integrations/hermes-airhop-parent-runtime/persona.md /opt/airhop-hermes/persona.md
COPY --chmod=0755 integrations/hermes-airhop-parent-runtime/entrypoint.sh /usr/local/bin/airhop-hermes-entrypoint

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/hermes-agent/.venv/bin:${PATH} \
    HERMES_HOME=/var/lib/airhop-hermes-runtime/hermes \
    AIRHOP_HERMES_RUNTIME_ROOT=/var/lib/airhop-hermes-runtime \
    BUZZ_AIRHOP_CONTEXT_GRANT_FILE=/var/lib/airhop-hermes-runtime/runtime/context-grant \
    HERMES_ACP_SKIP_CONFIGURED_MCP=1 \
    HERMES_ACP_BUILTIN_TOOLSETS=""

VOLUME ["/var/lib/airhop-hermes-runtime"]
USER airhop-hermes:airhop-hermes
ENTRYPOINT ["/usr/local/bin/airhop-hermes-entrypoint"]
