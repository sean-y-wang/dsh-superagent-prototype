# cloud-agent-dispatch gray/dev image.
# Mirrors aihub-admin multi-stage layout (Node build + watchdog) as closely as a
# DSH agent bundle allows. Full agent loop still needs DSH CLI + wrappers on
# PATH or under /data1/.../configs/cloud-agent-dispatch (hostPath).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG WATCHDOG_IMAGE=artifacts.iflytek.com/hub-docker-repo/aiaas/base_env/golang:1.23.2-watchdog

FROM ${NODE_IMAGE} AS builder
WORKDIR /src
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
  && (pnpm install --frozen-lockfile || pnpm install)
COPY . .
RUN pnpm build

FROM ${WATCHDOG_IMAGE} AS watchdog
RUN mkdir -p /out && \
    (cp "$(command -v watchdog)" /out/watchdog \
      || cp /usr/local/bin/watchdog /out/watchdog \
      || cp /watchdog /out/watchdog)

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    HEALTH_PORT=19310 \
    DSH_SUPERAGENT_PROFILE=rdg-portal \
    DSH_STATE_DIR=/var/dsh/rdg-portal

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git curl python3 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9 --activate

COPY --from=watchdog /out/watchdog /usr/local/bin/watchdog
COPY --from=builder /src /app
RUN chmod +x /app/scripts/k8s-entrypoint.sh /app/scripts/health-server.py \
  && mkdir -p /var/dsh/rdg-portal /app/log

EXPOSE 19310
# K8s wraps with watchdog; local docker run can use entrypoint directly.
CMD ["/app/scripts/k8s-entrypoint.sh"]
