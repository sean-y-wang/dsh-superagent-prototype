/** Merge request binding, lifecycle observation, and terminal IM notification helpers for the GitLab Source. */
import { GitlabApi, MergeRequestSchema, SOURCE, UserSchema, gitlabPage, key, liveTicket, sameName, threadId } from 'dsh-superagent/sdk'
import type { Follow, GitlabTarget, OutboundMessage, SourceContext, Ticket } from 'dsh-superagent/sdk'
import { z } from 'zod'

const MrSchema = MergeRequestSchema.extend({
  author: UserSchema,
})
export type MergeRequest = z.infer<typeof MrSchema> & { number: number }
export async function readMr(ctx: SourceContext, target: GitlabTarget, iid: number, signal?: AbortSignal): Promise<MergeRequest> {
  const api = new GitlabApi(ctx.commands, target).withSignal(signal)
  const mr = await api.api(MrSchema, `merge_requests/${iid}`)
  return { ...mr, number: iid }
}
/** Thread keys are `gitlab:mr:<iid>`; Follow.thread stores the full key. */
const mrIid = (thread: string): number | undefined => {
  if (!thread.startsWith(`${SOURCE}:`)) return undefined
  const id = thread.slice(SOURCE.length + 1)
  const match = /^mr:([1-9]\d*)$/.exec(id)
  return match ? Number(match[1]) : undefined
}
export const mrsOf = (ticket: Pick<Ticket, 'follows'>, open = false): number[] =>
  (ticket.follows ?? []).filter(item => !open || !item.closed).flatMap(item => mrIid(item.thread) ?? [])
export const mrOf = (ticket: Pick<Ticket, 'follows'>): number | undefined => mrsOf(ticket, true).at(-1) ?? mrsOf(ticket).at(-1)
/** True when the MR was opened by the agent account on a branch whose last segment is the ticket name. */
export const agentMr = (mr: { author: { username: string }; source_branch: string }, agent: string, ticketName: string | undefined): boolean =>
  sameName(mr.author.username, agent) && !!ticketName && mr.source_branch.split('/').at(-1) === ticketName
export const ticketBranch = (ticket: Pick<Ticket, 'execution'>, ref: string): boolean =>
  !!ticket.execution?.name && ref.split('/').at(-1) === ticket.execution.name

/**
 * Binds an open MR to a ticket when it is the ticket's origin MR or an agent-authored MR on the ticket's branch.
 * Returns an error message when binding is rejected.
 */
export function claimMr(ctx: SourceContext, ticketId: string, mr: MergeRequest, agent: string): string | undefined {
  const ticket = ctx.tickets.get(ticketId)
  if (!ticket || !liveTicket(ticket)) return 'Ticket ended because its MR was closed'
  const source = ctx.triggers.get(ticket.origin.triggerId)
  const started = source?.source === SOURCE && source.meta.kind === 'mr' && source.meta.iid === mr.number
  const opened = agentMr(mr, agent, ticket.execution?.name)
  if (!started && !opened) {
    return `MR does not belong to this ticket: use the source MR or a MR by ${agent} from a branch whose last path segment is DSH_SUPERAGENT_NAME; omit mr_iid when no MR exists`
  }
  const owner = ctx.tickets.open().find(item => mrsOf(item, true).includes(mr.number))
  if (owner && owner.id !== ticketId) return 'MR already belongs to another active ticket'
  const follow = ticket.follows?.find(item => item.thread === `${SOURCE}:${threadId('mr', mr.number)}`)
  const open = mr.state === 'opened' || mr.state === 'open'
  if (open && (!follow || follow.closed || (opened && !follow.own))) bind(ctx, ticketId, mr, opened)
  return undefined
}
/** Reconciles a polled MR's open/merged/closed state with any bound or branch-matching ticket. */
export async function observeMr(ctx: SourceContext, mr: MergeRequest, agent: string): Promise<boolean> {
  const ended = mr.state === 'merged' || mr.state === 'closed' || !!mr.merged_at
  if (ended) closeMr(ctx, mr)
  else {
    const candidates = ctx.tickets.open().filter(ticket => agentMr(mr, agent, ticket.execution?.name))
    const ticket = candidates.length === 1 ? candidates[0]! : undefined
    const reopened = ticket?.follows?.some(item => item.thread === `${SOURCE}:${threadId('mr', mr.number)}` && item.closed)
    if (ticket && (reopened || mrsOf(ticket, true).every(number => number === mr.number))) claimMr(ctx, ticket.id, mr, agent)
  }
  return ended
}
function bind(ctx: SourceContext, ticketId: string, mr: MergeRequest, own: boolean): void {
  ctx.atomic(() => {
    ctx.tickets.bindThread(ticketId, { source: SOURCE, id: threadId('mr', mr.number) }, own)
    ctx.threads.patch(`${SOURCE}:${threadId('mr', mr.number)}`, {
      kind: 'mr', iid: mr.number, url: mr.web_url, mrAuthor: mr.author.username, title: mr.title,
    })
  })
}
function closeMr(ctx: SourceContext, mr: MergeRequest): void {
  if (!ctx.tickets.open().some(ticket => mrsOf(ticket, true).includes(mr.number))) return
  const at = mr.merged_at ?? mr.closed_at ?? new Date().toISOString()
  const outcome = mr.state === 'merged' || mr.merged_at ? 'merged' : 'closed'
  ctx.tickets.threadClosed({ source: SOURCE, id: threadId('mr', mr.number) }, outcome, at)
}
/** Idempotent IM notices when a ticket ends with its GitLab MR. */
export function mrEndNotices(ticket: Ticket, request: string, baseUrl: string, project: string): OutboundMessage[] {
  const outcome = ticket.ended?.outcome
  const follows = (ticket.follows ?? []).filter(item => item.closed && mrIid(item.thread) !== undefined)
  const latest = (items: Follow[]) => items.sort((a, b) => b.closed!.at.localeCompare(a.closed!.at))[0]
  const follow = latest(follows.filter(item => item.own)) ?? latest(follows)
  if ((outcome !== 'merged' && outcome !== 'closed') || !follow) return []
  const iid = mrIid(follow.thread)!
  const url = gitlabPage(baseUrl, project, 'mr', iid)
  const chinese = /\p{Script=Han}/u.test(request) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(request)
  const text = chinese
    ? outcome === 'merged' ? `[MR !${iid}](${url}) 已合并。` : `[MR !${iid}](${url}) 已关闭，未合并。`
    : outcome === 'merged' ? `[MR !${iid}](${url}) has merged.` : `[MR !${iid}](${url}) was closed without merging.`
  return ticket.channels.filter(channel => channel.source !== SOURCE).map(channel => ({
    id: key('mr-terminal', String(iid), channel.source, JSON.stringify(channel.address), outcome), channel, text, kind: 'notice', ticketId: ticket.id }))
}
