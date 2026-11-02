# 014 Phase-1 close notes (RDG portal / cloud-agent-dispatch)

## Deploy target (updated 2026-11-02)

- **Default:** gray / pre via GitLab branch **`release/deploy`** → CI `deploy_pre` → ns `aihub-platform-pre` (same pattern as aihub-admin).
- **Topology:** single instance `rdg-portal` (multi-repo by feedback `source`), not five systemd units.
- **R&D** (`feature/deploy`, admin-dev / ai-dev) remains a secondary path.
- **Feedback validation:** only the **oldest** ticket — no batch scans or writes to other tickets.

## Checklist

| Item | Status |
|------|--------|
| Single-instance multi-repo code (PR #7) | Done on GitHub feat branch |
| `.gitlab-ci.yml` `deploy_pre` + `.build/*pre.yml` | This change set |
| Image `cloud-agent-dispatch` + `/health` | This change set |
| HostPath DSH + wrappers on gray node | **Ops pending** |
| Kong HMAC on **admin-pre** open feedback | **Ops pending** (admin-dev previously 401 missing gateway identity) |
| `AIHUB_INTERNAL_SECRET` for **ai-pre** comment writeback | **Ops pending** (confirm pre secret ≠ or = dev) |
| 星辰测试 receive events + bot strict-mode | Pending |
| Real small MR via low-risk merge → product `feature/deploy` or `release/deploy` | Pending |

## Related

- [011 ops](011-rdg-portal-ops.md) — single-instance runbook
- [013 CI](013-intranet-gitlab-ci.md) — branch map and variables
- [012 i讯飞](012-ixunfei-bot.md)
