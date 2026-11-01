# Delivery requirements — RDG GitLab (feature/deploy only)

When the ticket's product repository is on git.iflytek.com, ignore GitHub `gh pr merge --auto` paragraphs in the generic Delivery section. Deliver with **glab** against `$DSH_SUPERAGENT_GITLAB_PROJECT`.

Open the MR with target branch `feature/deploy` for research validation. Never open or merge toward `release/deploy`, and never push to gray/pre hosts.

After the MR is ready:

1. Prefer `scripts/gitlab-low-risk-merge.sh --project "$DSH_SUPERAGENT_GITLAB_PROJECT" --mr <iid>` when the change meets the low-risk gate (≤50 lines, ≤3 files, no auth/payment/CI/migration/lock paths, pipeline success, target `feature/deploy`).
2. If the script exits 2 (`HUMAN_GATE`), do **not** merge. Call `orchestrator_report` with state blocked/progress, send an i讯飞 decision card to the DEV owner (`xywang73@iflytek.com` / Policy allow-list), and leave the ticket on the panel for a human.
3. Never enable GitHub-style auto-merge as the agent account on GitLab; use the merge CLI named here (the glab wrapper) only for the low-risk path above, or wait for a person.

Credit reviewers with ordinary MR notes; do not rewrite Git history with `git filter-branch` on GitLab deliverables unless a human explicitly asks.
