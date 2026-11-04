/** GitLab outbound channel: posts Issue/MR notes under the agent account with an idempotency marker. */
import { CliError, GitlabApi, gitlabPage, sameName } from 'dsh-superagent/sdk'
import type { ChannelLink, ChannelLinks, GitlabKind, GitlabTarget, OutboundMessage, SourceContext } from 'dsh-superagent/sdk'
import { z } from 'zod'

const NoteSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), author: z.looseObject({ username: z.string() }).nullish(),
})
const gone = (error: unknown): boolean => error instanceof CliError
  && (error.code === 404 || error.code === 410 || (error.code === 403 && /locked|forbidden/i.test(error.message)))
/**
 * Posts a note on an Issue or MR. Retries look for an HTML marker so a successful-but-failed-client write is not duplicated.
 * Callers pass the GitLab target from Source config; the shared Commands instance supplies the subprocess runner.
 */
export async function sendGitlab(host: Pick<SourceContext, 'commands'>, message: OutboundMessage,
  target: GitlabTarget, agentUsername: string): Promise<'sent' | 'gone'> {
  const kind = message.channel.address.kind as GitlabKind | undefined
  const iid = Number(message.channel.address.iid)
  if ((kind !== 'issue' && kind !== 'mr') || !iid) throw new Error('Missing GitLab reply target')
  const api = new GitlabApi(host.commands, target)
  const path = kind === 'mr' ? `merge_requests/${iid}/notes` : `issues/${iid}/notes`
  const marker = `<!-- dsh-superagent:${message.id} -->`
  try {
    const notes = await api.pages(NoteSchema, `${path}?per_page=100`)
    const mine = (note: z.infer<typeof NoteSchema>) => sameName(note.author?.username ?? '', agentUsername)
      && (note.body ?? '').includes(marker)
    if (notes.some(mine)) return 'sent'
    await api.api(z.unknown(), path, '--method', 'POST', '-f', `body=${message.text}\n\n${marker}`)
    return 'sent'
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
}
export function gitlabLink(address: Record<string, string>, links: ChannelLinks & { gitlab?: { baseUrl: string; project: string } }): ChannelLink {
  const kind = (address.kind === 'mr' ? 'mr' : 'issue') as GitlabKind
  const iid = address.iid ?? ''
  const gitlab = links.gitlab
  const url = address.url ?? (gitlab && iid ? gitlabPage(gitlab.baseUrl, gitlab.project, kind, Number(iid)) : '')
  return { url, label: kind === 'mr' ? { zh: `GitLab !${iid}`, en: `GitLab !${iid}` } : { zh: `GitLab #${iid}`, en: `GitLab #${iid}` } }
}
