# Delivery requirements — RDG GitLab (product MR → feature/deploy)

When the ticket's product repository is on git.iflytek.com, ignore GitHub `gh pr merge --auto` paragraphs in the generic Delivery section.

## Which project to deliver into

Prefer **`$DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT`** when set (portal-feedback tickets: full path from feedback `source`, e.g. `rdg-ai-cloud/ai-hub/aihub-site`). Otherwise use **`$DSH_SUPERAGENT_GITLAB_PROJECT`** (GitLab Source config — often a home/observe project on the single-instance deploy).

```bash
PROJECT="${DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT:-$DSH_SUPERAGENT_GITLAB_PROJECT}"
```

Open the MR with `glab -R "$PROJECT"` (or equivalent) and target branch `feature/deploy` for the **product** repo (low-risk gate). Do not auto-merge product MRs into that product's `release/deploy` unless a human explicitly asks. Separate note: the **cloud-agent-dispatch** service itself deploys to gray by pushing **its** `release/deploy` branch (CI `deploy_pre`); that is not a product-repo merge.

## After the MR is ready

1. Prefer `scripts/gitlab-low-risk-merge.sh --project "$PROJECT" --mr <iid>` when the change meets the low-risk gate (≤50 lines, ≤3 files, no auth/payment/CI/migration/lock paths, pipeline success, target `feature/deploy`).
2. If the script exits 2 (`HUMAN_GATE`), do **not** merge. Call `orchestrator_report` with state blocked/progress, send an i讯飞 decision card to the DEV owner (`xywang73@iflytek.com` / Policy allow-list), and leave the ticket on the panel for a human.
3. Never enable GitHub-style auto-merge as the agent account on GitLab; use the merge CLI named here (the glab wrapper) only for the low-risk path above, or wait for a person.

Credit reviewers with ordinary MR notes; do not rewrite Git history with `git filter-branch` on GitLab deliverables unless a human explicitly asks.

> Phase-1 cloud-agent-dispatch itself deploys on **release/deploy** (gray). Product MRs still target each product repo's deploy branch per team rules. Feedback verification: **oldest ticket only**.
