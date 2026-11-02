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
# Bake DSH CLI so gray pods are not health-only when hostPath npm is empty.
RUN npm install --omit=dev --prefix /opt/dsh @deepseek-ai/dsh@0.2.1-rc.5 \
  && ln -sfn /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh-bin.js \
  && printf '%s\n' '#!/usr/bin/env bash' 'exec node /usr/local/bin/dsh-bin.js "$@"' > /usr/local/bin/dsh \
  && chmod +x /usr/local/bin/dsh /app/scripts/k8s-entrypoint.sh /app/scripts/health-server.py /app/scripts/feedback-cli \
  && mkdir -p /var/dsh/rdg-portal /app/log \
  && dsh -V || dsh --version || true

EXPOSE 19310
# K8s wraps with watchdog; local docker run can use entrypoint directly.
CMD ["/app/scripts/k8s-entrypoint.sh"]
