#!/usr/bin/env bash
# Gray/dev entrypoint: health server + DSH rdg-portal (image-baked or hostPath).
set -euo pipefail

PROFILE="${DSH_SUPERAGENT_PROFILE:-rdg-portal}"
STATE_DIR="${DSH_STATE_DIR:-/var/dsh/rdg-portal}"
HOST_CFG="${HOST_CONFIG_DIR:-/data1/aihub-platfrom-pre/configs/cloud-agent-dispatch}"
READY_FLAG="${HEALTH_READY_FLAG:-/tmp/cloud-agent-dispatch.ready}"
LOG_DIR="${LOG_DIR:-/app/log}"

mkdir -p "$STATE_DIR" "$LOG_DIR" "$HOST_CFG/bin"
rm -f "$READY_FLAG"

# Prefer hostPath wrappers when present; image /usr/local/bin/dsh is fallback.
export PATH="$HOST_CFG/bin:/usr/local/bin:$PATH"
if [ -f "$HOST_CFG/env" ]; then
  # shellcheck disable=SC1090
  set -a; . "$HOST_CFG/env"; set +a
fi

# Persist non-secret + secret env into hostPath for feedback-cli wrappers (no echo of values).
python3 - <<'PY'
from pathlib import Path
import os
cfg = Path(os.environ.get("HOST_CONFIG_DIR", "/data1/aihub-platfrom-pre/configs/cloud-agent-dispatch"))
cfg.mkdir(parents=True, exist_ok=True)
keys = [
  "DSH_SUPERAGENT_PROFILE",
  "HEALTH_PORT",
  "GITLAB_HOST",
  "AIHUB_FEEDBACK_BASE_URL",
  "AIHUB_ADMIN_BASE_URL",
  "AIHUB_ADMIN_USER",
  "AIHUB_INTERNAL_SECRET",
  "AIHUB_ADMIN_OPEN_BASE_URL",
  "AIHUB_ADMIN_OPEN_HMAC_KEY_ID",
  "AIHUB_ADMIN_OPEN_HMAC_SECRET",
]
path = cfg / "env"
existing = {}
if path.exists():
  for line in path.read_text().splitlines():
    if not line or line.strip().startswith("#") or "=" not in line:
      continue
    k, _, v = line.partition("=")
    existing[k] = v
for k in keys:
  if os.environ.get(k):
    existing[k] = os.environ[k]
# defaults for gray
existing.setdefault("DSH_SUPERAGENT_PROFILE", "rdg-portal")
existing.setdefault("HEALTH_PORT", "19310")
existing.setdefault("GITLAB_HOST", "https://git.iflytek.com")
existing.setdefault("AIHUB_FEEDBACK_BASE_URL", "https://ai-pre.xf-yun.com")
existing.setdefault("AIHUB_ADMIN_BASE_URL", "https://ai-pre.xf-yun.com")
existing.setdefault("AIHUB_ADMIN_USER", "dsh-superagent")
lines = [f"{k}={existing[k]}" for k in sorted(existing)]
path.write_text("\n".join(lines) + "\n")
bin_dir = cfg / "bin"
bin_dir.mkdir(parents=True, exist_ok=True)
fb = bin_dir / "feedback-cli"
if not fb.exists():
  fb.symlink_to("/app/scripts/feedback-cli")
print("hostPath env synced (keys only):", ",".join(sorted(existing)))
PY

python3 /app/scripts/health-server.py >>"$LOG_DIR/health.log" 2>&1 &
HEALTH_PID=$!

cleanup() {
  kill "$HEALTH_PID" 2>/dev/null || true
}
trap cleanup EXIT

touch "$READY_FLAG"

start_agent() {
  if command -v dsh >/dev/null 2>&1; then
    # CrashLoop root cause (pipeline #940275): scripts/dsh-superagent has no --foreground,
    # and its `start` action uses tmux then exits — wrong for a container PID 1 child.
    # Correct foreground boot is `dsh --profile <name>` (see dsh --help). Prefer --no-open.
    echo "starting dsh profile=$PROFILE stateDir=$STATE_DIR dsh=$(command -v dsh)"
    export DSH_HOME="${DSH_HOME:-$STATE_DIR/dsh-home}"
    mkdir -p "$DSH_HOME/profiles"
    # Bootstrap profile once: web template + link this bundle + overlay (idempotent).
    # Overlay only on first create so later hostPath / panel edits are not wiped.
    if [ ! -f "$DSH_HOME/profiles/$PROFILE/package.json" ]; then
      echo "bootstrapping DSH profile $PROFILE under $DSH_HOME"
      dsh --profile "$PROFILE" --from-default-profile web --dump-config >/dev/null || true
      (cd /app && dsh plugin --profile "$PROFILE" add "link:/app") || true
      overlay="/app/iflytek/aiyun/profiles/rdg-portal-single.cordis.patch.yml"
      [ -f "$overlay" ] || overlay="/app/examples/rdg-portal-single.cordis.patch.yml"
      if [ -f "$overlay" ]; then
        cp "$overlay" "$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
      fi
    fi
    exec dsh --profile "$PROFILE" --no-open
  fi
  if [ -x "$HOST_CFG/start.sh" ]; then
    echo "starting via hostPath start.sh"
    exec "$HOST_CFG/start.sh"
  fi
  echo "WARN: no dsh on PATH and no $HOST_CFG/start.sh — health only." >&2
  while true; do sleep 3600; done
}

start_agent
