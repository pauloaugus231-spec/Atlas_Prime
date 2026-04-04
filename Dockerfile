# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV APP_HOME=/app \
    WORKSPACE_DIR=/workspace \
    PLUGINS_DIR=/plugins \
    LOGS_DIR=/logs \
    AUTHORIZED_PROJECTS_DIR=/authorized-projects \
    HOME=/home/agente \
    NODE_ENV=development

RUN apt-get update -o Acquire::Retries=3 -o Acquire::http::Timeout=30 \
  && apt-get install -y --fix-missing --no-install-recommends bash ca-certificates curl git tini \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 agente \
  && useradd --system --uid 10001 --gid agente --create-home --home-dir /home/agente --shell /bin/bash agente

WORKDIR /app

COPY --chown=agente:agente app/package.json ./package.json
COPY --chown=agente:agente app/package-lock.json ./package-lock.json
COPY --chown=agente:agente app/tsconfig.json ./tsconfig.json
RUN npm ci --no-audit --no-fund

COPY --chown=agente:agente app/scripts ./scripts
COPY --chown=agente:agente app/src ./src
COPY --chown=agente:agente app/workspace ./workspace
COPY --chown=agente:agente app/logs ./logs

RUN chmod +x /app/scripts/docker/*.sh \
  && mkdir -p /workspace /plugins /logs /authorized-projects \
  && chown -R agente:agente /app /workspace /plugins /logs /authorized-projects /home/agente

USER agente:agente

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker/bootstrap.sh"]
CMD ["sleep", "infinity"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["/app/scripts/docker/healthcheck.sh"]
