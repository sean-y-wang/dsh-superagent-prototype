---
name: dsh-superagent-gitlab
description: Read GitLab issues, merge requests, notes and pipelines using glab.
---

Workers use orchestrator_read for repository context when needed: gitlab/issues/<iid> or gitlab/merge_requests/<iid> for the description; gitlab/issues/<iid>/notes/1 or gitlab/merge_requests/<iid>/notes/1 for conversation notes; gitlab/merge_requests/<iid>/pipelines for the latest pipeline on the MR head. A page holds 20 notes and names next_resource while another may follow. A note is `{ id, from, at, text, path?, line?, url }`: `id` is GitLab's note id, `path` and `line` a diff note's file and line, and `bot: true` marks a bot, whose words never authorize work. Follow next_offset to finish the current response; offset 0 reads afresh, later offsets the same snapshot. Reading does not create tickets or send replies.

GitLab Issues and merge requests use **separate IID sequences** in one project (`#12` is not `!12`). Thread keys are `gitlab:issue:<iid>` and `gitlab:mr:<iid>`. Prefer `#<iid>` for Issues and `!<iid>` for MRs when searching.

Before substantial work on a new human request or note, call `orchestrator_ack` with its original trigger ID and a brief request-specific `text`, even within an existing ticket; the host replies once in that source thread. Do not acknowledge bots or pipelines.

Open merge requests with the agent GitLab CLI (`glab`) against `$DSH_SUPERAGENT_GITLAB_PROJECT` on `$DSH_SUPERAGENT_GITLAB_BASE_URL`. Use a source branch whose last path segment is `$DSH_SUPERAGENT_NAME` so the host can bind the MR to the ticket. Immediately after creating or adopting a ticket MR, call `orchestrator_report` with `state: progress` and include the MR iid in the report text; do not wait for pipelines or handoff.

The host delivers subscribed Issue/MR notes and pipeline changes directly to the bound worker. Other activity is available on demand through orchestrator_read and the CLI instructions included in this skill.
