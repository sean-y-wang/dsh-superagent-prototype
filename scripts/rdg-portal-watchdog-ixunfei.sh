#!/usr/bin/env bash
# Read watchdog JSON from stdin or --file and IM the DEV decision owner via i讯飞 bot.
# Default recipient: xywang73@iflytek.com (override with IXUNFEI_DECISION_EMAIL).
# Requires a bot wrapper like scripts/lark-bot-ixunfei.example on PATH as lark-bot-ixunfei.
set -euo pipefail
CLI="${LARK_BOT_CLI:-lark-bot-ixunfei}"
EMAIL="${IXUNFEI_DECISION_EMAIL:-xywang73@iflytek.com}"
FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE=$2; shift 2;;
    --cli) CLI=$2; shift 2;;
    --email) EMAIL=$2; shift 2;;
    *) echo "usage: $0 [--file report.json] [--cli lark-bot-ixunfei] [--email addr]" >&2; exit 2;;
  esac
done
if [[ -n "$FILE" ]]; then RAW=$(cat "$FILE"); else RAW=$(cat); fi

TMP=$(mktemp)
printf '%s' "$RAW" >"$TMP"
COUNT=$(python3 - "$TMP" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
findings = data.get("findings") if isinstance(data, dict) else data
if not isinstance(findings, list):
    findings = []
print(len(findings))
PY
)
if [[ "$COUNT" == "0" ]]; then
  echo "no findings; skip notify"
  rm -f "$TMP"
  exit 0
fi
TEXT=$(python3 - "$TMP" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
findings = data.get("findings") if isinstance(data, dict) else data
lines = ["[dsh watchdog] stalled tickets (DEV only)"]
for f in (findings or [])[:20]:
    if isinstance(f, dict):
        lines.append(
            f"- {f.get('kind')}: {f.get('id')} {f.get('title')} stale={f.get('stale_hours')}h"
        )
    else:
        lines.append(f"- {f}")
print("\n".join(lines))
PY
)
rm -f "$TMP"
BODY=$(python3 -c 'import json,sys; print(json.dumps({"receive_id":sys.argv[1],"msg_type":"text","content":json.dumps({"text":sys.argv[2]}, ensure_ascii=False)}))' "$EMAIL" "$TEXT")

if "$CLI" api POST /open-apis/im/v1/messages --params '{"receive_id_type":"email"}' --data "$BODY" \
  >/tmp/dsh-watchdog-ixunfei.out 2>/tmp/dsh-watchdog-ixunfei.err; then
  echo "notified $EMAIL findings=$COUNT"
  exit 0
fi
if "$CLI" im messages send --email "$EMAIL" --text "$TEXT" \
  >/tmp/dsh-watchdog-ixunfei.out 2>/tmp/dsh-watchdog-ixunfei.err; then
  echo "notified $EMAIL findings=$COUNT (im messages send)"
  exit 0
fi
echo "FAIL notify" >&2
cat /tmp/dsh-watchdog-ixunfei.err >&2 || true
exit 1
