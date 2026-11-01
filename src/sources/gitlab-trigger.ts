/** Normalizes GitLab issues, merge requests, notes, and pipeline transitions into domain Triggers. */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import { escapeRegExp, sameName } from '../infra/text.ts'

export const SOURCE = 'gitlab'
/** Kind of GitLab work item: Issues and MRs use separate IID sequences within a project. */
export type GitlabKind = 'issue' | 'mr'
export const threadId = (kind: GitlabKind, iid: number): string => `${kind}:${iid}`
export const parseThreadId = (id: string): { kind: GitlabKind; iid: number } | undefined => {
  const match = /^(issue|mr):([1-9]\d*)$/.exec(id)
  return match ? { kind: match[1] as GitlabKind, iid: Number(match[2]) } : undefined
}
/** Reply address for an Issue or MR conversation note. */
export const gitlabChannel = (kind: GitlabKind, iid: number, url?: string): ChannelRef =>
  ({ source: SOURCE, thread: `${SOURCE}:${threadId(kind, iid)}`, address: { kind, iid: String(iid), ...(url ? { url } : {}) } })
/** Builds a web URL for an Issue (`#`) or MR (`!`) on a self-hosted or gitlab.com instance. */
export function gitlabPage(baseUrl: string, project: string, kind: GitlabKind, iid: number): string {
  const root = baseUrl.replace(/\/$/, '')
  const path = project.replace(/^\/+|\/+$/g, '')
  return `${root}/${path}/-/${kind === 'mr' ? 'merge_requests' : 'issues'}/${iid}`
}
/**
 * Parses a web or API URL for an Issue or MR in `project` on `baseUrl`.
 * Accepts both path-style project URLs and `/api/v4/projects/<id>/…` forms when the numeric project id matches.
 */
export function gitlabAddress(url: string, baseUrl: string, project: string, projectId?: number):
  { kind: GitlabKind; iid: number; note?: number } | undefined {
  const root = baseUrl.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const path = project.replace(/^\/+|\/+$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const web = new RegExp(`^${root}/${path}/-/(issues|merge_requests)/(\\d+)(?:#note_(\\d+))?`, 'i')
  const match = web.exec(url)
  if (match) {
    return { kind: match[1]!.toLowerCase() === 'merge_requests' ? 'mr' : 'issue', iid: Number(match[2]),
      ...match[3] ? { note: Number(match[3]) } : {} }
  }
  if (projectId != null) {
    const api = new RegExp(`^${root}/api/v4/projects/${projectId}/(issues|merge_requests)/(\\d+)`, 'i')
    const found = api.exec(url)
    if (found) return { kind: found[1]!.toLowerCase() === 'merge_requests' ? 'mr' : 'issue', iid: Number(found[2]) }
  }
  return undefined
}
/** GitLab returns a deleted user as `null`; treat it as `Ghost`. */
export const UserSchema = z.looseObject({ username: z.string(), id: z.number().optional(), bot: z.boolean().optional() }).nullable()
  .transform(user => user ?? { username: 'Ghost', bot: false })
export const NoteSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), author: UserSchema,
  created_at: z.string().nullish(), updated_at: z.string().nullish(),
  system: z.boolean().optional(), resolvable: z.boolean().optional(), resolved: z.boolean().optional(),
  type: z.string().nullish(), position: z.looseObject({
    new_path: z.string().nullish(), new_line: z.number().nullish(), old_path: z.string().nullish(), old_line: z.number().nullish(),
  }).nullish(),
})
export type GitlabNote = z.infer<typeof NoteSchema>
export const IssueSchema = z.looseObject({
  id: z.number(), iid: z.number(), title: z.string(), description: z.string().nullish(), state: z.string(),
  author: UserSchema, created_at: z.string(), web_url: z.string(), updated_at: z.string().nullish(),
  labels: z.array(z.union([z.string(), z.looseObject({ name: z.string() })])).nullish(),
})
export type GitlabIssue = z.infer<typeof IssueSchema>
export const MergeRequestSchema = IssueSchema.extend({
  source_branch: z.string(), target_branch: z.string(), merge_status: z.string().nullish(),
  draft: z.boolean().optional(), work_in_progress: z.boolean().optional(),
  merged_at: z.string().nullish(), closed_at: z.string().nullish(),
  sha: z.string().nullish(), squash_commit_sha: z.string().nullish(),
})
export type GitlabMergeRequest = z.infer<typeof MergeRequestSchema>
export interface WorkRef { kind: GitlabKind; iid: number; url?: string; mrAuthor?: string }
export const isHumanUser = (user: { username: string; bot?: boolean }): boolean =>
  !user.bot && !/bot$/i.test(user.username)
export const mentions = (text: string, username: string): boolean =>
  new RegExp(`(?:^|[^a-zA-Z0-9_@])@${escapeRegExp(username)}(?![a-zA-Z0-9_.-])`, 'i').test(text)
const author = (user: { username: string; bot?: boolean }, agent: string) =>
  ({ actor: { source: SOURCE, id: user.username }, human: isHumanUser(user) && !sameName(user.username, agent) })
function notePlace(note: GitlabNote): string {
  const path = note.position?.new_path ?? note.position?.old_path
  const line = note.position?.new_line ?? note.position?.old_line
  return path ? `${path}${line != null ? `:${line}` : ''}` : ''
}
function noteText(note: GitlabNote): string {
  return [notePlace(note), note.body ?? ''].filter(Boolean).join('\n\n')
}
/** Builds a trigger for a note on an Issue or MR; skips system notes and empty bodies. */
export function noteTrigger(note: GitlabNote, ref: WorkRef, agent: string): Trigger | undefined {
  if (note.system) return undefined
  const text = noteText(note)
  if (!text.trim()) return undefined
  const at = note.updated_at ?? note.created_at ?? new Date().toISOString()
  const version = note.updated_at ?? ''
  const id = key('gitlab-note', String(note.id), version)
  return { id, source: SOURCE, threads: [{ source: SOURCE, id: threadId(ref.kind, ref.iid) }], ...author(note.author, agent), at, text,
    ...(mentions(note.body ?? '', agent) ? { addressed: 'mention' as const } : {}),
    channel: gitlabChannel(ref.kind, ref.iid, ref.url),
    ...(ref.url ? { url: `${ref.url}#note_${note.id}` } : {}),
    meta: { kind: ref.kind, iid: ref.iid, noteId: note.id, work: ref.kind,
      ...(ref.mrAuthor ? { mrAuthor: ref.mrAuthor } : {}),
      ...(note.position?.new_path || note.position?.old_path
        ? { path: note.position.new_path ?? note.position.old_path, line: note.position.new_line ?? note.position.old_line ?? null }
        : {}) } }
}
/** Builds the trigger for a newly opened Issue's title and description. */
export function issueTrigger(issue: Pick<GitlabIssue, 'iid' | 'title' | 'description' | 'author' | 'created_at' | 'web_url'>,
  agent: string): Trigger {
  const body = issue.description ?? ''
  return { id: key('gitlab-issue', String(issue.iid)), source: SOURCE,
    threads: [{ source: SOURCE, id: threadId('issue', issue.iid) }], ...author(issue.author, agent), at: issue.created_at,
    text: `${issue.title}\n\n${body}`,
    ...(mentions(body, agent) ? { addressed: 'mention' as const } : {}),
    channel: gitlabChannel('issue', issue.iid, issue.web_url), url: issue.web_url,
    meta: { kind: 'issue', iid: issue.iid, work: 'issue' } }
}
/** Builds the trigger for a newly opened MR's title and description. */
export function mrTrigger(mr: Pick<GitlabMergeRequest, 'iid' | 'title' | 'description' | 'author' | 'created_at' | 'web_url'>,
  agent: string): Trigger {
  const body = mr.description ?? ''
  return { id: key('gitlab-mr', String(mr.iid)), source: SOURCE,
    threads: [{ source: SOURCE, id: threadId('mr', mr.iid) }], ...author(mr.author, agent), at: mr.created_at,
    text: `${mr.title}\n\n${body}`,
    ...(mentions(body, agent) ? { addressed: 'mention' as const } : {}),
    channel: gitlabChannel('mr', mr.iid, mr.web_url), url: mr.web_url,
    meta: { kind: 'mr', iid: mr.iid, work: 'mr', mrAuthor: mr.author.username } }
}
/** Builds a trigger for a default-branch pipeline transition; pipelines have no person to reply to. */
export function pipelineTrigger(branch: string, sha: string, revision: number, summary: string, url: string): Trigger {
  return { id: key('gitlab-pipeline', `branch:${branch}`, String(revision)), source: SOURCE,
    threads: [{ source: SOURCE, id: `pipeline:${branch}` }], actor: { source: SOURCE, id: '' }, human: false,
    at: new Date().toISOString(), text: summary, url, meta: { pipeline: true, branch, sha, revision } }
}
export function mrPipelineTrigger(mr: { iid: number; web_url: string; author: { username: string } }, revision: number,
  summary: string): Trigger {
  return { id: key('gitlab-pipeline', String(mr.iid), String(revision)), source: SOURCE,
    threads: [{ source: SOURCE, id: threadId('mr', mr.iid) }], actor: { source: SOURCE, id: '' }, human: false,
    at: new Date().toISOString(), text: summary, channel: gitlabChannel('mr', mr.iid), url: mr.web_url,
    meta: { kind: 'mr', iid: mr.iid, work: 'mr', mrAuthor: mr.author.username, pipeline: true, revision } }
}
