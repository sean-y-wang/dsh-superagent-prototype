# Intranet GitLab mirror and CI

## Mirror

- **GitHub (sync upstream / public fork):** `https://github.com/sean-y-wang/dsh-superagent-prototype`
- **Intranet GitLab (CI/CD):** `https://git.iflytek.com/rdg-ai-cloud/ai-hub/cloud-agent-dispatch` (project `51179`)

Default branch on GitLab: `main`. Feature work lives on `feat/*`. Deploy trigger branches follow **aihub-admin / aihub-service**:

| Branch | Pipeline effect |
|--------|-----------------|
| `feature/deploy` | Build image; optional `deploy_dev` (研发 `platform`) when `.build/deployment.yml` exists |
| **`release/deploy`** | Build image + **`deploy_pre`** → 灰度 namespace **`aihub-platform-pre`** (node `hf-10-104-102-73.ai.cn`) |

Phase-1 default deploy target is **gray via `release/deploy`** (user 2026-11-02). R&D remains available but is no longer the only allowed path.

## Pipeline stages

Defined in `.gitlab-ci.yml` (modeled on `aihub-admin`):

| Stage | Job | Purpose |
|-------|-----|---------|
| build | `build_npm` | `pnpm install` + `pnpm build` |
| package | `package_image` | Docker build/push `artifacts.iflytek.com/.../cloud-agent-dispatch` |
| deploy | **`deploy_pre`** | `kubectl apply` `.build/*pre.yml` with `KUBECONFIG_PRE` (only `release/deploy`) |
| deploy | `deploy_dev` | Optional R&D apply (`KUBECONFIG_DEV`); skips if no `deployment.yml` |
| build | `smoke_admin_open_hmac` | Readonly HMAC smoke; `allow_failure` |

Image repo: `artifacts.iflytek.com/docker-private/aipaas/cloud-agent-dispatch`  
Tag: `${CI_COMMIT_REF_SLUG}_build${CI_PIPELINE_IID}`

CI variables (group or project; never commit values):

| Name | Required for |
|------|----------------|
| `DOCKER_USERNAME` / `DOCKER_PASSWORD` | `package_image` |
| `KUBECONFIG_PRE` | **`deploy_pre`** (file variable; same as aihub-admin) |
| `KUBECONFIG_DEV` | optional `deploy_dev` |
| `DEV_NODE_NAME` | optional R&D nodeSelector |
| `AIHUB_ADMIN_OPEN_HMAC_KEY_ID` / `AIHUB_ADMIN_OPEN_HMAC_SECRET` | smoke / portal-feedback open GET |
| `AIHUB_ADMIN_OPEN_BASE_URL` | e.g. `https://admin-pre.xf-yun.com` on gray |
| `AIHUB_ADMIN_OPEN_ALLOW_PRE` | set `1` when smoking admin-pre |

## Packaging honesty (vs aihub-admin)

`aihub-admin` is a Next.js HTTP service: image CMD is the server; PolarIS loads business config.  
`cloud-agent-dispatch` is a **DSH agent bundle** (single `rdg-portal` instance, multi-repo routing). CI still:

1. Builds/pushes an image with watchdog + `/health` on `19310`.
2. Applies the same style of `deployment.pre.yml` (hostNetwork, gray node, hostPath configs/logs/state).
3. Starts `scripts/k8s-entrypoint.sh`, which runs health and then `dsh` / hostPath `start.sh` when present.

**Not automatic:** private DSH npm packages, GitLab PAT, i讯飞 bot secret, model keys, and glab/feedback wrappers must be provisioned under hostPath  
`/data1/aihub-platfrom-pre/configs/cloud-agent-dispatch` (or equivalent PolarIS later). Until then the Deployment can roll out healthy (health-only) without processing tickets.

## Feedback auth on gray

### A) Open readonly API (Kong HMAC)

- Base: `https://admin-pre.xf-yun.com` (gray) or `https://admin-dev.xf-yun.com` (R&D)
- Paths: `GET /admin/api/open/feedback`, `GET /admin/api/open/feedback/{id}`
- Edge: Kong HMAC-SHA256 (`host` + `date` + request-line)

### B) Comment writeback (X-Internal-Secret)

- Base: `https://ai-pre.xf-yun.com` (gray) / `https://ai-dev.xf-yun.com` (R&D)
- `POST /aihub/api/v1/admin/feedback/{id}/comments`
- Header: `X-Internal-Secret: $AIHUB_INTERNAL_SECRET`

### Validation scope (mandatory)

Only operate on the **oldest** feedback ticket for read/comment verification. Do not list-and-mutate other tickets.

Smoke: `AIHUB_ADMIN_OPEN_ALLOW_PRE=1 AIHUB_ADMIN_OPEN_BASE_URL=https://admin-pre.xf-yun.com python3 scripts/admin-open-hmac-smoke.py`

## Sync from GitHub

```sh
git remote add github https://github.com/sean-y-wang/dsh-superagent-prototype.git  # once
git fetch github
git push origin github/main:main
# Gray deploy: push the release line
git push origin github/<branch>:release/deploy
```
