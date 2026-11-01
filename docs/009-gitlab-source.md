# 009 GitLab Source (fork customization)

Upstream [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) supports **github.com only**. This fork adds a `gitlab` Source for self-hosted GitLab (for example `https://git.iflytek.com`), parallel to the GitHub Source.

Keep the GitHub Source installed; disable or ignore it when the agent works only on GitLab projects. Setup accepts **GitLab-only** profiles (see below).

## Concepts

| Domain | GitLab mapping |
| --- | --- |
| Trigger | One Issue/MR body, one note, or one pipeline transition |
| Thread | `issue:<iid>` or `mr:<iid>` (IIDs are **separate** sequences), or `pipeline:<branch>` |
| Actor | GitLab username |
| Channel | Note on that Issue or MR |
| Delivery | Open an MR with `glab` from a branch ending in `DSH_SUPERAGENT_NAME` |

## Configure

1. Create a dedicated **Agent** GitLab user (not a personal account shared with humans).
2. Create a **Personal Access Token** for that user with at least: `api`, `read_api`, `read_repository`, `write_repository`. Prefer a project access token if your instance supports it and the Agent only needs one project.
3. Install [glab](https://gitlab.com/gitlab-org/cli) and write a wrapper script that sets the host and authenticates **without** putting the token in dsh settings:

```bash
#!/usr/bin/env bash
# /usr/local/bin/glab-agent  — example only; keep the token out of git
export GITLAB_HOST=https://git.iflytek.com
export GITLAB_TOKEN=…   # from a root-only file, secret store, or `glab auth login`
exec glab "$@"
```

4. In the panel (or Management API), enable the `gitlab` Source and set:

| Field | Example |
| --- | --- |
| `baseUrl` | `https://git.iflytek.com` |
| `project` | `rdg-ai-cloud/aihub-site` or numeric project id |
| `cli` | `/usr/local/bin/glab-agent` |
| Observe switches | Start with mentions only; turn on “new Issues / MRs / notes / pipelines” when admission rules are ready |

5. Under **Eval → On each Source → GitLab**, list GitLab usernames allowed to originate work.

6. Enable the plugin in the profile if it is still disabled:

```yaml
- id: dsh-superagent-gitlab
  name: dsh-superagent/gitlab-watch
  disabled: false
```

7. Rebuild and restart. Health entry `gitlab` should become `ready` after the first successful poll (`glab api user` must succeed).

## Event intake

Phase 1 uses **polling** only (Issues, MRs, subscribed-thread notes, default-branch and ticket-MR pipelines). Webhooks are not wired yet; see Remaining work.

## Opening merge requests

Workers should:

```bash
glab mr create --source-branch "agent/$DSH_SUPERAGENT_NAME" --target-branch <default> --title "…" --description "…"
```

Use `$DSH_SUPERAGENT_GITLAB_PROJECT` and `$DSH_SUPERAGENT_GITLAB_BASE_URL` from the execution environment. Report progress with `orchestrator_report` after the MR exists so the Source can bind it.

## Resources

`orchestrator_read` paths: `gitlab/issues/<iid>`, `gitlab/merge_requests/<iid>`, `…/notes/<page>`, `gitlab/merge_requests/<iid>/pipelines`. Panel deep links use `baseUrl` + project path (`/-/issues/<iid>` or `/-/merge_requests/<iid>`).

## Remaining work

- **Webhooks:** replace or complement poll with project hooks (Issues, MRs, notes, pipelines).
- **Multi-project:** one Source instance = one project; run multiple dsh instances or extend config for several projects.
- **Diff discussions:** reply-in-thread for resolvable discussions (currently top-level notes).
- **Upstream sync:** keep `upstream` remote; avoid editing GitHub Source modules when pulling.

## GitLab-only profiles

Setup succeeds when either the GitHub Source (repository + CLI) **or** the GitLab Source (`baseUrl` + `project` + `cli`) is fully set. With only GitLab configured, `configured()` is true, the GitHub Source stays paused, and worker `gh` shims refuse with a clear error. You may also configure both.

## Related modules

`src/sources/gitlab.ts`, `gitlab-trigger.ts`, `gitlab-channel.ts`, `gitlab-read.ts`, `gitlab-mr.ts`, `gitlab-api.ts`; skill `skills/dsh-superagent-gitlab`; export `./gitlab-watch`.

## Related fork Sources

Portal page-feedback intake is a separate Source (documented in 010 Portal-feedback Source).
