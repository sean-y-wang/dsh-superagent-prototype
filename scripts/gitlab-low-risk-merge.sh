#!/usr/bin/env bash
# Merge a GitLab MR into feature/deploy when the change looks low-risk (DEV only).
# Never targets release/deploy / admin-pre / ai-pre.
set -euo pipefail

usage() {
  cat <<'U'
Usage: gitlab-low-risk-merge.sh --project <path|id> --mr <iid> [--cli glab] [--max-lines 50] [--max-files 3] [--dry-run]

Checks (all required unless --force-human-gate is unset and checks fail → exit 2):
  - target branch is feature/deploy (refuse release/deploy and protected prod names)
  - MR pipeline success (when GitLab reports status)
  - diff additions+deletions <= --max-lines (default 50)
  - changed files <= --max-files (default 3)
  - no path matches auth/payment/migration/ci/lock/dependency patterns

On success: glab mr merge <iid> --squash --remove-source-branch (or --dry-run).
U
}

PROJECT=""; MR=""; CLI="${DSH_SUPERAGENT_GITLAB_CLI:-glab}"
MAX_LINES=50; MAX_FILES=3; DRY=0; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT=$2; shift 2;;
    --mr) MR=$2; shift 2;;
    --cli) CLI=$2; shift 2;;
    --max-lines) MAX_LINES=$2; shift 2;;
    --max-files) MAX_FILES=$2; shift 2;;
    --dry-run) DRY=1; shift;;
    --force) FORCE=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "unknown arg: $1" >&2; usage; exit 2;;
  esac
done
[[ -n "$PROJECT" && -n "$MR" ]] || { usage; exit 2; }

export GITLAB_HOST="${GITLAB_HOST:-https://git.iflytek.com}"
api() { "$CLI" api --hostname "${GITLAB_HOST#https://}" "$@"; }

# Resolve project id
if [[ "$PROJECT" =~ ^[0-9]+$ ]]; then
  PID="$PROJECT"
else
  ENC=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PROJECT")
  PID=$(api "projects/$ENC" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
fi

MR_JSON=$(api "projects/$PID/merge_requests/$MR")
TARGET=$(printf '%s' "$MR_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("target_branch",""))')
SHA=$(printf '%s' "$MR_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sha") or "")')
STATE=$(printf '%s' "$MR_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("state",""))')
PIPE=$(printf '%s' "$MR_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); p=d.get("pipeline") or {}; print(p.get("status") or "")')

echo "mr=!$MR project=$PROJECT target=$TARGET state=$STATE pipeline=$PIPE sha=${SHA:0:8}"

if [[ "$TARGET" != "feature/deploy" ]]; then
  echo "REFUSE: target_branch=$TARGET (only feature/deploy allowed for low-risk auto-merge)" >&2
  exit 3
fi
if [[ "$STATE" != "opened" ]]; then
  echo "REFUSE: mr state=$STATE" >&2
  exit 3
fi
if [[ -n "$PIPE" && "$PIPE" != "success" && "$FORCE" -ne 1 ]]; then
  echo "REFUSE: pipeline status=$PIPE" >&2
  exit 3
fi

CHANGES=$(api "projects/$PID/merge_requests/$MR/changes")
python3 - "$CHANGES" "$MAX_LINES" "$MAX_FILES" <<'PY'
import json, re, sys
raw, max_lines, max_files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
data = json.loads(raw)
files = data.get("changes") or []
blocked = re.compile(
    r"(^|/)\.gitlab-ci\.yml$|(^|/)Dockerfile|(^|/)package-lock\.json$|(^|/)pnpm-lock\.yaml$|"
    r"(^|/)yarn\.lock$|(^|/)go\.sum$|migration|auth|payment|oauth|secret|k8s|helm|deploy",
    re.I,
)
adds = dels = 0
paths = []
for ch in files:
    path = ch.get("new_path") or ch.get("old_path") or ""
    paths.append(path)
    diff = ch.get("diff") or ""
    for line in diff.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            adds += 1
        elif line.startswith("-"):
            dels += 1
total = adds + dels
print(f"files={len(paths)} lines={total} (+{adds}/-{dels})")
for p in paths:
    print(f"  path={p}")
reasons = []
if len(paths) > max_files:
    reasons.append(f"files {len(paths)} > {max_files}")
if total > max_lines:
    reasons.append(f"lines {total} > {max_lines}")
for p in paths:
    if blocked.search(p):
        reasons.append(f"blocked path {p}")
if reasons:
    print("HUMAN_GATE: " + "; ".join(reasons))
    sys.exit(2)
print("LOW_RISK_OK")
PY
gate=$?
if [[ $gate -eq 2 ]]; then
  echo "Human decision required (Feishu/i讯飞 card + panel). Not merging." >&2
  exit 2
fi
[[ $gate -eq 0 ]] || exit "$gate"

if [[ "$DRY" -eq 1 ]]; then
  echo "DRY_RUN: would merge !$MR into feature/deploy"
  exit 0
fi

"$CLI" mr merge "$MR" --repo "$PROJECT" --squash --remove-source-branch --yes
echo "MERGED !$MR -> feature/deploy"
