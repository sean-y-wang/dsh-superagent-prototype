#!/usr/bin/env python3
"""Readonly Kong HMAC smoke against admin open feedback API. Defaults to admin-dev."""
from __future__ import annotations
import base64, hashlib, hmac, json, os, sys, time, urllib.error, urllib.request

def main() -> int:
    key_id = os.environ.get("AIHUB_ADMIN_OPEN_HMAC_KEY_ID", "").strip()
    secret = os.environ.get("AIHUB_ADMIN_OPEN_HMAC_SECRET", "").strip()
    base = os.environ.get("AIHUB_ADMIN_OPEN_BASE_URL", "https://admin-dev.xf-yun.com").rstrip("/")
    if "admin-pre" in base or "ai-pre" in base:
        print("REFUSE: gray/pre host not allowed for this smoke; use admin-dev", file=sys.stderr)
        return 2
    if not key_id or not secret:
        print("missing AIHUB_ADMIN_OPEN_HMAC_KEY_ID / AIHUB_ADMIN_OPEN_HMAC_SECRET", file=sys.stderr)
        return 2
    host = base.split("://", 1)[-1].split("/", 1)[0]
    path = "/admin/api/open/feedback?page=1&limit=1"
    method = "GET"
    date = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime())
    signing = "\n".join([f"host: {host}", f"date: {date}", f"{method} {path} HTTP/1.1"])
    sig = base64.b64encode(hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()).decode()
    auth = (
        f'hmac api_key="{key_id}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{sig}"'
    )
    req = urllib.request.Request(
        f"{base}{path}",
        headers={"Date": date, "Authorization": auth, "Accept": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        print(f"FAIL http={e.code} body={body!r}")
        return 1
    except Exception as e:
        print(f"FAIL {type(e).__name__}: {e}")
        return 1
    if data.get("code") != 0:
        print(f"FAIL api_code={data.get('code')} message={data.get('message')!r}")
        return 1
    total = (data.get("data") or {}).get("total")
    items = (data.get("data") or {}).get("items") or []
    print(f"PASS host={host} code=0 total={total} items={len(items)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
