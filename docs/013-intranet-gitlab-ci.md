# Intranet GitLab mirror and CI

## Mirror

- **GitHub (sync upstream / public fork):** `https://github.com/sean-y-wang/dsh-superagent-prototype`
- **Intranet GitLab (CI/CD):** `https://git.iflytek.com/rdg-ai-cloud/ai-hub/cloud-agent-dispatch`

Default branch on GitLab: `main`. Feature work lives on `feat/*`. Deploy trigger branches (aihub convention): `feature/deploy`, `release/deploy`.

To refresh from GitHub:

```sh
git remote add github https://github.com/sean-y-wang/dsh-superagent-prototype.git  # once
git fetch github
git push origin github/main:main
# or mirror selected feat/* branches
```

## Pipeline stages

Defined in `.gitlab-ci.yml`:

| Stage | Job | Purpose |
|-------|-----|---------|
| build | `build_npm` | `pnpm install` + `pnpm build`; keeps `lib/` artifacts |
| package | `package_image` | Docker build/push to `artifacts.iflytek.com/.../dsh-superagent` (needs `DOCKER_USERNAME` / `DOCKER_PASSWORD`) |
| deploy | `deploy_intranet_doc` | Placeholder that documents host rollout until k8s manifests exist |

This is intentionally thinner than `aihub-admin` (no `kubectl apply` yet). See `.build/README.md`.

## Auth for portal feedback (dual path; validate on **admin-dev / ai-dev only**)

Do **not** use gray/pre (`admin-pre`, `ai-pre`, `release/deploy`, `KUBECONFIG_PRE`) for phase-1 联调.

### A) Open readonly API (Kong HMAC) — smoke / optional poll

Documented shape in feedback-admin `agent-prompt.ts` (prompt text still names pre; **runtime target is admin-dev**):

- Base URL: `https://admin-dev.xf-yun.com`
- Paths: `GET /admin/api/open/feedback`, `GET /admin/api/open/feedback/{id}`, …
- Edge auth: **Kong HMAC-SHA256**. Signing string is three lines (`host`, `date`, request-line); headers `Date` + `Authorization: hmac …`.
- Scope: **read-only** — no comments via this surface.

CI/host env (values never in git):

- `AIHUB_ADMIN_OPEN_HMAC_KEY_ID` (key id name `aihub-admin-api-inner`)
- `AIHUB_ADMIN_OPEN_HMAC_SECRET`
- `AIHUB_ADMIN_OPEN_BASE_URL=https://admin-dev.xf-yun.com`

Smoke: `scripts/admin-open-hmac-smoke.py` (refuses pre hosts).

### B) Comment writeback (X-Internal-Secret) — Source channel

Portal-feedback Source uses `scripts/feedback-cli` → aihub-service admin API:

- Base: `https://ai-dev.xf-yun.com` (Source `baseUrl`)
- `POST /aihub/api/v1/admin/feedback/{id}/comments` with `{ requestId, content, nickname }`
- Auth: `X-Internal-Secret: $AIHUB_INTERNAL_SECRET` (+ optional `X-Admin-User`)
- Secret must match aihub-service `console.admin_secret` / admin `upstream.internal_secret` on **dev**

Open HMAC cannot write comments. SSO browser session is the other write path; Worker hosts should use Internal-Secret BFF instead.


**admin-dev status (2026-11-01):** `GET /admin/api/open/feedback` returns HTML 404 on `admin-dev.xf-yun.com` (open routes live in `aihub-admin-open` / Kong; not serving on current admin-dev). Readonly+writeback 联调 on研发 should use `scripts/feedback-cli` → `https://ai-dev.xf-yun.com` with `AIHUB_INTERNAL_SECRET`. Keep HMAC vars for when open edge is enabled on dev, and for smoke script once the route exists.

## Secret / variable names (values never in git)

| Name | Where used | Notes |
|------|------------|-------|
| `AIHUB_ADMIN_OPEN_HMAC_KEY_ID` | portal-feedback GET via Kong | From aihub-admin agent-prompt |
| `AIHUB_ADMIN_OPEN_HMAC_SECRET` | portal-feedback GET via Kong | From aihub-admin agent-prompt; CI/host only |
| `AIHUB_INTERNAL_SECRET` | optional direct upstream | `config.yaml` key `upstream.internal_secret`; not the open edge |
| `AIHUB_ADMIN_USER` | optional audit header | wrapper |
| `GITLAB_TOKEN` / glab login | GitLab Source wrapper | PAT with api + MR |
| `GITLAB_HOST` | wrapper | e.g. `https://git.iflytek.com` |
| `DOCKER_USERNAME` / `DOCKER_PASSWORD` | `package_image` job | artifacts registry |
| `KUBECONFIG_DEV` / `KUBECONFIG_PRE` | future k8s deploy | same pattern as aihub-admin |
| Feishu / Lark app secret | optional feishu-watch | lark-cli config dir |
| Model provider API key | DSH profile | DeepSeek or other |

Storage-gateway HMAC (`AIHUB_FEEDBACK_ACCESS_KEY` / `SECRET_KEY`) is for screenshot **upload** to the shelf gateway — not required for open feedback list/detail.

## Host rollout checklist

1. Intranet server with Node 22+, git, pnpm, DSH, glab, Python 3.
2. Five profiles / `stateDir`s per `docs/011-rdg-portal-ops.md`.
3. Wrappers on `PATH` injecting the variables above.
4. Cron for `scripts/rdg-portal-watchdog.py`.
5. Sync policy: keep GitHub fork for upstream pulls; GitLab for deploy.
