/** Read-only GitLab Issue, MR, note, and pipeline inspection for assessments and workers. */
import { z } from 'zod'
import type { ThreadFact } from '../core/index.ts'
import { validItems, type Commands, type Tally } from '../infra/commands.ts'
import { GitlabApi, type GitlabTarget } from './gitlab-api.ts'
import { IssueSchema, MergeRequestSchema, NoteSchema, isHumanUser, type GitlabNote } from './gitlab-trigger.ts'
import type { ContextMessage, ThreadContext } from './kind.ts'

const PipelineSchema = z.looseObject({
  id: z.number(), status: z.string(), ref: z.string().nullish(), sha: z.string(), web_url: z.string().nullish(),
  updated_at: z.string().nullish(),
})
const JobSchema = z.looseObject({ name: z.string(), status: z.string(), stage: z.string().nullish() })
export interface PipelineSnapshot {
  head: string
  status: string
  jobs: { name: string; status: string; stage?: string }[]
  url?: string
}
const FAILING = new Set(['failed', 'canceled', 'cancelled', 'skipped'])
export function pipelineCounts(snapshot: PipelineSnapshot): { failed: number; running: number } {
  return {
    failed: snapshot.jobs.filter(job => FAILING.has(job.status)).length + (FAILING.has(snapshot.status) ? 1 : 0),
    running: snapshot.jobs.filter(job => job.status === 'running' || job.status === 'pending' || job.status === 'created').length,
  }
}
export function pipelineSummary(snapshot: PipelineSnapshot, where: string, read: string): string {
  const failed = snapshot.jobs.filter(job => FAILING.has(job.status)).map(job => job.name)
  const running = snapshot.jobs.filter(job => job.status === 'running' || job.status === 'pending').map(job => job.name)
  const names = (list: string[]) => list.slice(0, 5).join(', ') + (list.length > 5 ? `, and ${list.length - 5} more` : '')
  const at = `on ${where} at ${snapshot.head.slice(0, 7)} (pipeline ${snapshot.status})`
  const still = running.length ? `; ${running.length} still running` : ''
  const line = failed.length ? `Pipeline failed ${failed.length} ${at}: ${names(failed)}${still}`
    : running.length ? `Pipeline running ${running.length} ${at}: ${names(running)}`
      : `Pipeline ${snapshot.status} ${at}`
  return `${line}\nRead ${read} for every job.`
}
export function pipelineFact(counts: { failed: number; running: number }): ThreadFact {
  if (counts.failed) return { label: { zh: '流水线失败', en: 'Pipeline failed' }, value: String(counts.failed), problem: true }
  if (counts.running) return { label: { zh: '流水线进行中', en: 'Pipeline running' }, value: String(counts.running) }
  return { label: { zh: '流水线', en: 'Pipeline' }, value: { zh: '通过', en: 'passed' } }
}
export async function readPipeline(api: GitlabApi, sha: string, tally?: Tally): Promise<PipelineSnapshot> {
  const pipelines = await api.pages(PipelineSchema, `pipelines?sha=${encodeURIComponent(sha)}&per_page=5`, tally)
  const latest = pipelines[0]
  if (!latest) return { head: sha, status: 'unknown', jobs: [] }
  const jobs = await api.pages(JobSchema, `pipelines/${latest.id}/jobs?per_page=100`, tally)
  return { head: sha, status: latest.status, jobs: jobs.map(({ name, status, stage }) => ({ name, status, ...stage ? { stage } : {} })),
    ...latest.web_url ? { url: latest.web_url } : {} }
}
function gitlabMessage(note: GitlabNote, text: string, id: string): ContextMessage {
  const path = note.position?.new_path ?? note.position?.old_path
  const line = note.position?.new_line ?? note.position?.old_line
  return { id, from: note.author.username, at: note.created_at ?? '', text,
    ...!isHumanUser(note.author) ? { bot: true } : {},
    ...path ? { path, ...line != null ? { line } : {} } : {} }
}
/**
 * Reads an Issue or MR, a page of its notes, or a pipeline snapshot as model-facing messages.
 * Resource grammar: `gitlab/issues/<iid>`, `gitlab/merge_requests/<iid>`, optional `/notes/<page>` or `/pipelines`.
 */
export async function readGitlab(commands: Commands, target: GitlabTarget, resource: string): Promise<unknown> {
  const api = new GitlabApi(commands, target)
  const match = /^gitlab\/(issues|merge_requests)\/([1-9]\d*)(?:\/(notes|pipelines)(?:\/([1-9]\d*))?)?$/.exec(resource)
  if (!match) {
    throw new Error('Use gitlab/issues/<iid>, gitlab/merge_requests/<iid>, or append /notes/<page> or /pipelines')
  }
  const [, kind, iid, section, page = '1'] = match
  const path = kind === 'merge_requests' ? `merge_requests/${iid}` : `issues/${iid}`
  if (section === 'pipelines') {
    if (kind !== 'merge_requests') throw new Error('Pipelines require a merge request')
    if (match[4]) throw new Error('Pipelines do not take a page number')
    const mr = await api.api(MergeRequestSchema, path)
    const sha = mr.sha ?? mr.squash_commit_sha
    if (!sha) return { head: '', status: 'unknown', jobs: [] }
    return readPipeline(api, sha)
  }
  if (!section) {
    const item = kind === 'merge_requests'
      ? await api.api(MergeRequestSchema, path)
      : await api.api(IssueSchema, path)
    const labels = item.labels?.map(label => typeof label === 'string' ? label : label.name)
    return { iid: item.iid, title: item.title, state: item.state, ...labels?.length ? { labels } : {},
      ...kind === 'merge_requests' ? {
        head: (item as z.infer<typeof MergeRequestSchema>).source_branch,
        base: (item as z.infer<typeof MergeRequestSchema>).target_branch,
        ...((item as z.infer<typeof MergeRequestSchema>).draft || (item as z.infer<typeof MergeRequestSchema>).work_in_progress)
          ? { draft: true } : {},
      } : {},
      id: String(item.iid), from: item.author.username, at: item.created_at, text: item.description ?? '', url: item.web_url }
  }
  const listed = await api.api(z.array(z.unknown()), `${path}/notes?per_page=20&page=${page}&sort=asc`)
  const tally = { skipped: 0 }
  const items = validItems(NoteSchema, listed, tally).filter(note => !note.system)
  const messages = items.map(item => gitlabMessage(item, item.body ?? '', String(item.id)))
  return { messages, ...tally.skipped ? { skipped: tally.skipped } : {},
    ...listed.length === 20 ? { next_resource: `gitlab/${kind}/${iid}/notes/${Number(page) + 1}` } : {} }
}
/** Thread context for assessments: page 1 leads with the Issue/MR description, then notes. */
export function gitlabThreadContext(target: () => GitlabTarget | undefined): ThreadContext<Record<string, unknown>> {
  return {
    messageId: trigger => String(trigger.meta.noteId ?? trigger.url ?? ''),
    read: async (commands, trigger, _part, cursor) => {
      const configured = target()
      if (!configured) return { messages: [], body: { messages: [] } }
      const api = new GitlabApi(commands, configured)
      const kind = trigger.meta.kind === 'mr' ? 'mr' : 'issue'
      const iid = Number(trigger.meta.iid)
      if (!iid) return { messages: [], body: { messages: [] } }
      const path = kind === 'mr' ? `merge_requests/${iid}` : `issues/${iid}`
      const page = cursor ? Number(cursor) : 1
      const messages: ContextMessage[] = []
      if (page === 1) {
        const item = kind === 'mr' ? await api.api(MergeRequestSchema, path) : await api.api(IssueSchema, path)
        messages.push({ id: item.web_url, from: item.author.username, at: item.created_at,
          text: `${item.title}\n\n${item.description ?? ''}`, url: item.web_url })
      }
      const listed = await api.api(z.array(z.unknown()), `${path}/notes?per_page=100&page=${page}&sort=asc`)
      const notes = validItems(NoteSchema, listed).filter(note => !note.system)
      for (const note of notes) {
        messages.push(gitlabMessage(note, note.body ?? '', String(note.id)))
      }
      return { messages, ...(listed.length === 100 ? { next: String(page + 1) } : {}), body: { messages } }
    },
  }
}
