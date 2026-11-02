#!/usr/bin/env bash
# POST one comment on the oldest published feedback ticket only. Never prints secrets.
set -euo pipefail
: "${AIHUB_INTERNAL_SECRET:?AIHUB_INTERNAL_SECRET required}"
base="${AIHUB_FEEDBACK_BASE_URL:-https://ai-pre.xf-yun.com}"
base="${base%/}"
user="${AIHUB_ADMIN_USER:-dsh-superagent}"
hdr=(-H "X-Internal-Secret: ${AIHUB_INTERNAL_SECRET}" -H "X-Admin-User: ${user}" -H "Content-Type: application/json" -H "Accept: application/json")

# Prefer known oldest id; otherwise pick oldest by createdAt from a small page scan.
ticket_id="${OLDEST_FEEDBACK_ID:-FB-f079316f050544ae963743a1217885bc}"
list=$(curl -sS "${hdr[@]}" "$base/aihub/api/v1/admin/feedback?status=published&page=1&limit=50")
picked=$(python3 - <<'PY' "$list" "$ticket_id"
import json,sys
raw, prefer = sys.argv[1], sys.argv[2]
try:
  data=json.loads(raw)
except Exception:
  print(prefer); raise SystemExit(0)
items=data.get('data') or data.get('list') or data.get('items') or []
if isinstance(data.get('data'), dict):
  items=data['data'].get('list') or data['data'].get('items') or items
flat=[]
for it in items:
  if isinstance(it, dict) and (it.get('id') or it.get('feedbackId')):
    flat.append(it)
if not flat:
  print(prefer); raise SystemExit(0)
def key(it):
  return it.get('createdAt') or it.get('created_at') or it.get('createTime') or ''
flat.sort(key=key)
oldest=flat[0]
oid=oldest.get('id') or oldest.get('feedbackId')
# If prefer exists in list, force it (ops pin).
ids={ (x.get('id') or x.get('feedbackId')) for x in flat }
print(prefer if prefer in ids else oid)
PY
)

req_id="cad-smoke-$(date +%Y%m%d%H%M%S)"
body=$(python3 - <<PY
import json
print(json.dumps({
  "requestId": "$req_id",
  "content": "[cloud-agent-dispatch] phase-1 gray writeback smoke ($req_id)",
  "nickname": "dsh-superagent",
}))
PY
)
code=$(curl -sS -o /tmp/fb-comment.out -w '%{http_code}' "${hdr[@]}" \
  -X POST "$base/aihub/api/v1/admin/feedback/${picked}/comments" \
  --data "$body")
# Print status + non-secret fields only
python3 - <<'PY' "$code" "$picked"
import json,sys
code, tid = sys.argv[1], sys.argv[2]
raw=open('/tmp/fb-comment.out').read()
try:
  d=json.loads(raw)
except Exception:
  d={"raw_len": len(raw)}
keep={}
if isinstance(d, dict):
  for k in ("code","message","msg","success","status"):
    if k in d: keep[k]=d[k]
  data=d.get("data")
  if isinstance(data, dict):
    keep["commentId"]=data.get("id") or data.get("commentId")
print(json.dumps({"http": int(code) if code.isdigit() else code, "ticket": tid, **keep}, ensure_ascii=False))
if not str(code).startswith("2"):
  raise SystemExit(1)
# business error codes
if isinstance(d, dict) and d.get("code") not in (None, 0, 200, "0", "200"):
  # aihub sometimes uses code 0 for ok; 20001 invalid secret
  if d.get("code") not in (0, 200):
    raise SystemExit(2)
PY
