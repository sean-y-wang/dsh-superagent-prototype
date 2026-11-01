---
name: dsh-superagent-portal-feedback
description: Handle portal page-feedback tickets and write progress as admin comments.
---

Workers receive Tickets started from published page feedback (`FB-…` ids) on portal, console, or docs. Environment hints:

- `$DSH_SUPERAGENT_PORTAL_FEEDBACK_ID` — feedback id
- `$DSH_SUPERAGENT_PORTAL_FEEDBACK_SOURCE` — `portal` | `console` | `docs`
- `$DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO` — product repo hint (`aihub-site`, `rdg-promotion-console`, or `aihub-doc`)
- `$DSH_SUPERAGENT_PORTAL_FEEDBACK_PAGE_URL` — page URL
- `$DSH_SUPERAGENT_PORTAL_FEEDBACK_TYPE` — `request` | `issue` | `suggestion`

Prefer changing the product repo named by `$DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO` (on the team GitLab). Delivery PRs still follow the active GitLab or GitHub Source.

Progress writeback: host replies on the feedback thread become **admin comments** on that feedback (Internal-Secret CLI). Call `orchestrator_ack` with the original trigger id before substantial work; use `orchestrator_report` with `state: progress` for milestones so the host can post updates.

Do not invent a processing-status field on the feedback API — none exists; comments are the writeback channel.
