#!/usr/bin/env bash
# Readonly Internal-Secret smoke against ai-dev admin feedback list. Refuses pre hosts.
set -euo pipefail
base=${AIHUB_ADMIN_BASE_URL:-https://ai-dev.xf-yun.com}
case $base in *ai-pre*|*admin-pre*) echo "REFUSE: pre host not allowed: $base" >&2; exit 2;; esac
: "${AIHUB_INTERNAL_SECRET:?set AIHUB_INTERNAL_SECRET}"
export AIHUB_ADMIN_BASE_URL=$base
root=$(cd "$(dirname "$0")/.." && pwd)
out=$("$root/scripts/feedback-cli" api GET "$base/aihub/api/v1/admin/feedback?status=published&page=1&limit=1")
python3 - <<'PY' <<<"$out"
import json,sys
data=json.load(sys.stdin)
assert data.get('code')==0, data
d=data.get('data') or {}
print(f"PASS base_list code=0 total={d.get('total')} items={len(d.get('items') or [])}")
PY
