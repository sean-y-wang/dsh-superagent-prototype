/**
 * AGD-PATCH(0004) begin: public extension API for out-of-tree Source packages (packages/agd-*), exported as `dsh-superagent/sdk`.
 * Proposed upstream as PR⑤ (export the Source SDK); drop this patch once upstream ships an equivalent entry.
 */
export { key, liveTicket } from './core/index.ts'
export type { ChannelRef, Follow, OutboundMessage, Thread, ThreadFact, Ticket, Trigger } from './core/index.ts'
export { CliError, Commands, commandError, validItems } from './infra/commands.ts'
export type { Tally } from './infra/commands.ts'
export { escapeRegExp, sameName } from './infra/text.ts'
export { KV } from './kv.ts'
export { health, sourceContext } from './sources/host.ts'
export type { Health, SourceContext, SourceHost } from './sources/host.ts'
export type { ChannelLink, ChannelLinks, ContextMessage, FieldSpec, Localized, SourceInstance, SourceKind, ThreadContext, TriggerContext } from './sources/kind.ts'
export { cursorAt, pause, POLL_HORIZON_MS, pollThreads } from './sources/poll.ts'
export type { Deployment } from './deployment.ts'
// GitLab helpers that core still reads through the `gitlab/…` resource route (AGD-PATCH 0002, until a resource registry lands upstream).
export { GitlabApi, projectApiId } from './sources/gitlab-api.ts'
export type { GitlabTarget } from './sources/gitlab-api.ts'
export { gitlabThreadContext, pipelineCounts, pipelineFact, pipelineSummary, readGitlab, readPipeline } from './sources/gitlab-read.ts'
export {
  IssueSchema, MergeRequestSchema, NoteSchema, SOURCE, UserSchema, gitlabPage, isHumanUser, issueTrigger, mrPipelineTrigger, mrTrigger, noteTrigger,
  parseThreadId, pipelineTrigger, threadId,
} from './sources/gitlab-trigger.ts'
export type { GitlabKind, GitlabNote } from './sources/gitlab-trigger.ts'
// AGD-PATCH(0004) end
