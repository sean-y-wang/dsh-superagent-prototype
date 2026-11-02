#!/usr/bin/env python3
"""Readonly Kong HMAC smoke against admin open feedback API.

Default: admin-dev. For gray, set AIHUB_ADMIN_OPEN_BASE_URL=https://admin-pre.xf-yun.com
and AIHUB_ADMIN_OPEN_ALLOW_PRE=1.

Validation policy: only inspect the oldest ticket (sort ascending / limit 1).
Never batch-mutate feedback.
"""
from __future__ import annotations
import base64, hashlib, hmac, json, os, sys, time, urllib.error, urllib.parse, urllib.request

def main() -> int:
    key_id = os.environ.get("AIHUB_ADMIN_OPEN_HMAC_KEY_ID", "").strip()
    secret = os.environ.get("AIHUB_ADMIN_OPEN_HMAC_SECRET", "").strip()
    base = os.environ.get("AIHUB_ADMIN_OPEN_BASE_URL", "https://admin-dev.xf-yun.com").rstrip("/")
    allow_pre = os.environ.get("AIHUB_ADMIN_OPEN_ALLOW_PRE", "").strip() in ("1", "true", "yes")
    if ("admin-pre" in base or "ai-pre" in base) and not allow_pre:
        print("REFUSE: gray/pre host requires AIHUB_ADMIN_OPEN_ALLOW_PRE=1", file=sys.stderr)
        return 2
    if not key_id or not secret:
        print("missing AIHUB_ADMIN_OPEN_HMAC_KEY_ID / AIHUB_ADMIN_OPEN_HMAC_SECRET", file=sys.stderr)
        return 2
    host = base.split("://", 1)[-1].split("/", 1)[0]
    qs = urllib.parse.urlencode({"page": 1, "limit": 100, "sort": "created_at", "order": "asc"})
    path = f"/admin/api/open/feedback?{qs}"
    method = "GET"
    date = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime())
    signing = "\n".join([f"host: {host}", f"date: {date}", f"{method} {path} HTTP/1.1"])
    sig = base64.b64encode(hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()).decode()
    auth = (
        f"hmac api_key=\"{key_id}\", algorithm=\"hmac-sha256\", "
        f"headers=\"host date request-line\", signature=\"{sig}\""
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
        print("FAIL api_code=%s message=%r" % (data.get("code"), data.get("message")))
        return 1
    payload = data.get("data") or {}
    total = payload.get("total")
    items = list(payload.get("items") or [])
    def created(it):
        return it.get("createdAt") or it.get("created_at") or it.get("submittedAt") or ""
    # Open API sort params are unreliable; pick true oldest client-side.
    oldest = min(items, key=created) if items else None
    oid = (oldest or {}).get("id") or (oldest or {}).get("feedbackId")
    print(
        f"PASS host={host} code=0 total={total} oldest_id={oid!r} "
        f"created={created(oldest)!r} (validation must use only this ticket)"
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
