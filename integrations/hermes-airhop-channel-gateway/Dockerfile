# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie@sha256:b3c543b6c4f23a5f2df22866bd7857e5d304b67a564f4feab6ac22044dde719b AS uv-source

FROM python:3.12-slim-bookworm AS gateway-builder

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
# Install the frozen Hermes core plus only Telegram's two packages. The broad
# `messaging` extra also pulls Discord/Slack and is intentionally avoided.
RUN --mount=type=cache,id=airhop-uv-cache,target=/root/.cache/uv \
    uv sync --python /usr/local/bin/python3.12 --frozen --no-install-project --no-dev
RUN --mount=type=cache,id=airhop-uv-cache,target=/root/.cache/uv \
    uv pip install --no-deps --editable . \
    && uv pip install --no-deps \
        "coincurve==21.0.0" \
        "python-telegram-bot==22.8" \
        "tornado==6.5.7" \
    && rm -rf /opt/hermes-agent/.git

COPY integrations/hermes-airhop-channel-gateway /opt/airhop-channel-gateway
RUN rm -rf /opt/airhop-channel-gateway/tests/__pycache__

FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 airhop-gateway \
    && useradd --system --uid 10001 --gid 10001 \
        --home-dir /var/lib/airhop-channel-gateway --create-home \
        --shell /usr/sbin/nologin airhop-gateway \
    && mkdir -p /var/lib/airhop-channel-gateway/hermes \
    && chmod 0700 /var/lib/airhop-channel-gateway \
    && chown -R airhop-gateway:airhop-gateway /var/lib/airhop-channel-gateway

COPY --from=gateway-builder --chown=root:root /opt/hermes-agent /opt/hermes-agent
COPY --from=gateway-builder --chown=root:root /opt/airhop-channel-gateway /opt/airhop-channel-gateway

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/hermes-agent/.venv/bin:${PATH} \
    PYTHONPATH=/opt/airhop-channel-gateway/src \
    HERMES_HOME=/var/lib/airhop-channel-gateway/hermes \
    AIRHOP_GATEWAY_STATE_PATH=/var/lib/airhop-channel-gateway/state.sqlite3

EXPOSE 8443
VOLUME ["/var/lib/airhop-channel-gateway"]
USER airhop-gateway:airhop-gateway

ENTRYPOINT ["python", "-m", "airhop_hermes_gateway.main"]
