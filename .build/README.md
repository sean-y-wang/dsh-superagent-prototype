# Intranet build / deploy (aihub-admin pattern)

Branch map (same as `aihub-admin` / `aihub-service`):

| Branch | Job | Target |
|--------|-----|--------|
| `feature/deploy` | `package_image` (+ optional `deploy_dev`) | 研发 `platform` |
| `release/deploy` | `package_image` + **`deploy_pre`** | 灰度 `aihub-platform-pre` on node `hf-10-104-102-73.ai.cn` |

Manifests:

- `namespace.pre.yml` / `configmap.pre.yml` / `deployment.pre.yml` — gray (required for phase-1)
- `deployment.yml` / `configmap.yml` — R&D (optional; `deploy_dev` skips if missing)

## What this is / is not

`cloud-agent-dispatch` is a long-running **DSH profile** (git worktrees + CLI wrappers), not a Next.js HTTP service like `aihub-admin`. CI still mirrors admin:

1. Build npm → Docker image → `kubectl apply` on `release/deploy`.
2. Container serves `/health` on `19310` and starts the **rdg-portal** single-instance profile when DSH + wrappers are available on hostPath.
3. Secrets (GitLab PAT, `AIHUB_INTERNAL_SECRET`, i讯飞 app secret, model keys) live in GitLab CI file variables and/or `/data1/aihub-platfrom-pre/configs/cloud-agent-dispatch` — never in git.

Full PolarIS/Companion parity for agent config is optional; hostPath boot is enough for phase-1 gray.

## Feedback validation (gray)

Only touch the **oldest** feedback ticket for read/comment smoke. Do not batch-scan or mutate other tickets.
