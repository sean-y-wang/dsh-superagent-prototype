# 010 Portal-feedback Source (fork)

Polls the **aihub-service admin feedback API** (admin-dev / research env) for published page feedback and turns each item into a Trigger / Ticket. Progress writeback posts an **admin comment** on the same feedback. This is a fork customization; upstream dsh has no portal-feedback Source.

Survey reference: `aihub-service` `docs/page-feedback.md`, `internal/api/feedback.go`, `internal/feedback/model.go`.

## API surface

| Method | Path | Role |
| --- | --- | --- |
| GET | `/aihub/api/v1/admin/feedback` | List (query: `source`, `type`, `status`, `from`, `to`, `page`, `limit`, …) |
| GET | `/aihub/api/v1/admin/feedback/:id` | Detail |
| POST | `/aihub/api/v1/admin/feedback/:id/comments` | Admin comment writeback |

Auth header: **`X-Internal-Secret`** (`InternalAuth`). Optional **`X-Admin-User`** names the admin account for comment audit (`admin:<account>`).

**Not** the storage-gateway HMAC (`AIHUB_FEEDBACK_ACCESS_KEY` / `SECRET_KEY`). That HMAC only signs screenshot uploads to the shelf storage gateway. This Source never needs those keys.

Response envelope: `{ code: 0, message: "success", data }`. Entry fields include `id` (`FB-…`), `source` (`portal`\|`console`\|`docs`), `type` (`request`\|`issue`\|`suggestion`), `content`, `pageUrl`, `status` (`published`\|`draft`\|`deleted`\|…), timestamps.

## Configuration

Source settings (no secrets):

- `baseUrl` — origin that serves `/aihub/api/v1/admin/feedback` (e.g. `https://ai-dev.xf-yun.com`)
- `cli` — wrapper command (see below)
- `sources` — which of portal / console / docs to poll
- `adminNickname` — nickname on writeback comments (default `dsh-superagent`)
- `pollSeconds`, `failuresBeforeError`

Secrets live only in the **CLI wrapper** environment (same pattern as GitLab `glab`).

## CLI wrapper contract

```text
feedback-cli api GET  <absolute-or-path URL>
feedback-cli api POST <absolute-or-path URL> --body '<json>'
```

The wrapper must:

1. Ensure the request hits `baseUrl` (the Source passes absolute URLs).
2. Add `X-Internal-Secret: $AIHUB_INTERNAL_SECRET` (name is conventional; pick any env your ops use).
3. Optionally add `X-Admin-User: $AIHUB_ADMIN_USER` (default something like `dsh-superagent`).
4. Print the JSON response body on stdout.

Example sketch (do **not** commit real secrets):

```sh
#!/usr/bin/env bash
set -euo pipefail
method=$1; shift
: "${1:?path}"; path=$1; shift
: "${AIHUB_INTERNAL_SECRET:?set AIHUB_INTERNAL_SECRET}"
hdr=(-H "X-Internal-Secret: ${AIHUB_INTERNAL_SECRET}" -H "X-Admin-User: ${AIHUB_ADMIN_USER:-dsh-superagent}" -H "Content-Type: application/json")
if [[ $method == api ]]; then
  verb=$path; path=$1; shift
  if [[ $verb == GET ]]; then
    exec curl -fsS "${hdr[@]}" "$path"
  fi
  body=
  while [[ $# -gt 0 ]]; do
    case $1 in --body) body=$2; shift 2;; *) shift;; esac
  done
  exec curl -fsS "${hdr[@]}" -X POST --data "$body" "$path"
fi
echo "usage: $0 api GET|POST …" >&2; exit 2
```

## Intake rules (fast path)

- Only `status === published`
- Skip soft-deleted (`deletedAt`) and empty `content`
- First enable of a source seeds the poll cursor **without** ingesting history
- Trigger id = hash(`portal-feedback`, feedback id) so re-polls are safe duplicates

## Product routing

| `source` | Worker env `DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO` |
| --- | --- |
| portal | `aihub-site` |
| console | `rdg-promotion-console` |
| docs | `aihub-doc` |

## Channel writeback

Implemented: `POST …/admin/feedback/:id/comments` with `{ requestId, content, nickname }`. `requestId` is the outbound message id (idempotent on the server).

There is **no** separate processing-status field on feedback; comments are the supported writeback.

## Cordis

Enable plugin `dsh-superagent-portal-feedback` (`dsh-superagent/portal-feedback-watch`). Disabled by default in `cordis.patch.yml`.

## Related modules

`src/sources/portal-feedback.ts`, `portal-feedback-api.ts`, `portal-feedback-trigger.ts`, `portal-feedback-channel.ts`; skill `skills/dsh-superagent-portal-feedback`.

## Remaining / live deploy

- Live `AIHUB_INTERNAL_SECRET` (or equivalent) on the deploy host; wrapper on `PATH`
- Confirm `baseUrl` routing to aihub-service for the target env (dev; do not use pre for phase-1 validation)
- Optional: webhook or push from admin instead of poll
- Optional: screenshot fetch (admin GET `/:id/screenshot`) for richer context — not in day-1

## Ops

Multi-instance deploy, deploy-branch merge policy, and watchdog: [011 RDG portal ops](011-rdg-portal-ops.md).
