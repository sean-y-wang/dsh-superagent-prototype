#!/usr/bin/env bash
# Gray/dev entrypoint: health server + optional DSH rdg-portal start.
set -euo pipefail

PROFILE="${DSH_SUPERAGENT_PROFILE:-rdg-portal}"
STATE_DIR="${DSH_STATE_DIR:-/var/dsh/rdg-portal}"
HOST_CFG="${HOST_CONFIG_DIR:-/data1/aihub-platfrom-pre/configs/cloud-agent-dispatch}"
READY_FLAG="${HEALTH_READY_FLAG:-/tmp/cloud-agent-dispatch.ready}"
LOG_DIR="${LOG_DIR:-/app/log}"

mkdir -p "$STATE_DIR" "$LOG_DIR"
rm -f "$READY_FLAG"

# Prefer hostPath wrappers / DSH install when present.
if [ -d "$HOST_CFG/bin" ]; then
  export PATH="$HOST_CFG/bin:$PATH"
fi
if [ -f "$HOST_CFG/env" ]; then
  # shellcheck disable=SC1090
  set -a; . "$HOST_CFG/env"; set +a
fi

python3 /app/scripts/health-server.py >>"$LOG_DIR/health.log" 2>&1 &
HEALTH_PID=$!

cleanup() {
  kill "$HEALTH_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Mark ready for probes once health is up. Agent may still be bootstrapping.
touch "$READY_FLAG"

start_agent() {
  if command -v dsh >/dev/null 2>&1; then
    echo "starting dsh profile=$PROFILE stateDir=$STATE_DIR"
    if [ -x /app/scripts/dsh-superagent ]; then
      exec /app/scripts/dsh-superagent start --profile "$PROFILE" --foreground
    fi
    exec dsh start --profile "$PROFILE"
  fi
  if [ -x "$HOST_CFG/start.sh" ]; then
    echo "starting via hostPath start.sh"
    exec "$HOST_CFG/start.sh"
  fi
  echo "WARN: no dsh on PATH and no $HOST_CFG/start.sh — health only. Populate hostPath configs." >&2
  # Keep container alive for infra wiring / image rollout validation.
  while true; do sleep 3600; done
}

start_agent
