/** GitLab source kind definition, project polling loops, and Cordis plugin entry (fork customization for self-hosted GitLab). */
import { GitlabApi, IssueSchema, KV, MergeRequestSchema, NoteSchema, POLL_HORIZON_MS, SOURCE, cursorAt, gitlabThreadContext, health, issueTrigger, key, mrPipelineTrigger, mrTrigger, noteTrigger, parseThreadId, pause, pipelineCounts, pipelineFact, pipelineSummary, pipelineTrigger, pollThreads as pollEach, readPipeline, sameName, sourceContext, threadId, validItems } from 'dsh-superagent/sdk'
import type { GitlabKind, GitlabTarget, Health, Localized, SourceContext, SourceKind, Tally, Thread } from 'dsh-superagent/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { gitlabLink, sendGitlab } from './channel.ts'
import { observeMr, mrsOf, readMr } from './mr.ts'
import { z } from 'zod'

export { issueTrigger, mrTrigger, noteTrigger, SOURCE, type GitlabKind } from 'dsh-superagent/sdk'
export type { GitlabTarget } from 'dsh-superagent/sdk'

const GitlabConfigSchema = z.object({
  baseUrl: z.string().trim().url().or(z.literal('')).default(''),
  project: z.string().trim().regex(/^([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*|\d+)?$/).default(''),
  cli: z.string().trim().default(''),
  pollSeconds: z.number().int().min(60).max(3600).default(60),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  observeIssues: z.boolean().default(false),
  observeMrs: z.boolean().default(false),
  observeNotes: z.boolean().default(false),
  observePipelines: z.boolean().default(false),
}).strict()
export type GitlabConfig = z.infer<typeof GitlabConfigSchema>

const OBSERVED = { issues: 'observeIssues', mrs: 'observeMrs', notes: 'observeNotes', pipelines: 'observePipelines' } as const
type Scope = keyof typeof OBSERVED
function scopeOf(meta: Record<string, unknown>): Scope | undefined {
  if (meta.pipeline === true) return typeof meta.branch === 'string' ? 'pipelines' : meta.kind === 'mr' ? 'pipelines' : undefined
  if (meta.kind === 'issue' && meta.noteId == null) return 'issues'
  if (meta.kind === 'mr' && meta.noteId == null && meta.pipeline !== true) return 'mrs'
  return meta.noteId != null ? 'notes' : undefined
}
function targetOf(config: GitlabConfig): GitlabTarget | undefined {
  if (!config.baseUrl || !config.project || !config.cli) return undefined
  return { baseUrl: config.baseUrl.replace(/\/$/, ''), project: config.project, cli: config.cli }
}

/** Bound by `apply` so the exported kind's channel and threadContext see the live Runtime. */
type ChannelSend = NonNullable<SourceKind<GitlabConfig>['channel']>['send']
type ChannelLinkFn = NonNullable<SourceKind<GitlabConfig>['channel']>['link']
let liveSend: ChannelSend = async () => { throw new Error('The GitLab Source plugin is not loaded') }
let liveLink: ChannelLinkFn = (address, links) => gitlabLink(address, links)
let liveTarget: () => GitlabTarget | undefined = () => undefined
let liveAgent: () => string = () => ''

export const gitlabKind: SourceKind<GitlabConfig> = {
  kind: SOURCE,
  title: { zh: 'GitLab', en: 'GitLab' },
  description: {
    zh: '智能体的 GitLab 账号（自建实例，例如 git.iflytek.com）；轮询项目的 Issue、MR、评论与流水线。这是相对上游 dsh（仅支持 github.com）的 fork 定制。',
    en: 'The agent\'s GitLab account on a self-hosted instance (for example git.iflytek.com); polls Issues, MRs, notes, and pipelines. Fork customization — upstream dsh supports github.com only.',
  },
  schema: GitlabConfigSchema,
  fields: [
    { key: 'baseUrl', type: 'text', pattern: 'https?://.+', label: { zh: 'GitLab 实例地址', en: 'GitLab instance URL' },
      hint: { zh: '例如 https://git.iflytek.com，不要末尾斜杠。面板链接和地址解析用它；glab 包装脚本需设置相同的 GITLAB_HOST。',
        en: 'For example https://git.iflytek.com, no trailing slash. Panel links and address parsing use it; the glab wrapper must set the same GITLAB_HOST.' } },
    { key: 'project', type: 'text', pattern: '[A-Za-z0-9_.\\-]+(/[A-Za-z0-9_.\\-]+)*|\\d+', label: { zh: '监听的项目', en: 'Project' },
      hint: { zh: '写作 group/name，或数字项目 id。这个来源只接收该项目的事件。', en: 'Written group/name, or a numeric project id. This Source receives only that project\'s events.' } },
    { key: 'cli', type: 'text', label: { zh: '智能体的 GitLab CLI', en: 'Agent GitLab CLI' },
      hint: { zh: '命令名或绝对路径，通常是设置了 GITLAB_HOST 与令牌、并以智能体账号登录的 glab 包装脚本。配置里不要写 PAT。',
        en: 'A command name or absolute path, usually a glab wrapper with GITLAB_HOST and a token for the agent account. Never put a PAT in this configuration.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 60, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20,
      label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' } },
    { key: 'observeIssues', type: 'switch', label: { zh: '接收项目里的新 Issue', en: 'Receive new Issues in the project' },
      hint: { zh: '打开后，没有 @ 智能体的新 Issue 也会收到。从打开时开始，不读以前的。',
        en: 'New Issues that do not mention the agent are received too. Starts when switched on; earlier ones are not read.' } },
    { key: 'observeMrs', type: 'switch', label: { zh: '接收项目里的新 MR', en: 'Receive new merge requests in the project' } },
    { key: 'observeNotes', type: 'switch', label: { zh: '接收项目里的评论', en: 'Receive notes in the project' } },
    { key: 'observePipelines', type: 'switch', label: { zh: '接收默认分支的流水线', en: 'Receive the default branch\'s pipelines' } },
  ],
  scope: ({ meta }, config) => {
    const row = scopeOf(meta)
    return { listened: true, observed: row !== undefined && config[OBSERVED[row]], ...row ? { row } : {} }
  },
  health: ['gitlab'],
  channel: {
    send: (host, message) => liveSend(host, message),
    link: (address, links) => liveLink(address, links),
  },
  threadContext: gitlabThreadContext(() => liveTarget()),
  find: query => {
    const mr = /^!?(\d+)$/.exec(query.trim()) ?? /\/-\/merge_requests\/(\d+)/.exec(query)
    const issue = /^#?(\d+)$/.exec(query.trim()) ?? /\/-\/issues\/(\d+)/.exec(query)
    if (/merge_requests/.test(query) && mr) return { threads: [`${SOURCE}:${threadId('mr', Number(mr[1]))}`], terms: [] }
    if (/issues/.test(query) && issue) return { threads: [`${SOURCE}:${threadId('issue', Number(issue[1]))}`], terms: [] }
    if (query.trim().startsWith('!') && mr) return { threads: [`${SOURCE}:${threadId('mr', Number(mr[1]))}`], terms: [] }
    if (issue) return { threads: [`${SOURCE}:${threadId('issue', Number(issue[1]))}`], terms: [] }
    return { threads: [], terms: [] }
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_.-]+$/) }).strict()).default([]),
      bots: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_.-]+$/) }).strict()).optional(),
    }).strict(),
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的 GitLab 账号', en: 'GitLab accounts that may originate work' },
        columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9_.\\-]+' }] },
      { key: 'bots', type: 'rows', label: { zh: '评论可以成为候选的机器人', en: 'Bots whose notes may become candidates' },
        columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9_.\\-]+' }] },
    ],
    explicit: { zh: '名单里的账号在 Issue 或评论里 @ 智能体的账号。', en: 'An account on the list mentions the agent\'s account in an Issue or a note.' },
    rows(stored) {
      const config = GitlabConfigSchema.partial().parse(stored)
      const note = (observed: boolean | undefined) => observed ? { zh: '全部', en: 'All' } : { zh: '仅 @', en: '@ only' }
      const row = (id: Scope, label: { zh: string; en: string }) => ({
        id, label, note: note(config[OBSERVED[id]]),
        cells: { listedUnaddressed: !!config[OBSERVED[id]], unlistedAddressed: true, unlistedUnaddressed: !!config[OBSERVED[id]] },
      })
      return [
        row('issues', { zh: '新 Issue', en: 'New Issues' }),
        row('mrs', { zh: '新 MR', en: 'New merge requests' }),
        row('notes', { zh: '评论', en: 'Notes' }),
        { id: 'pipelines', label: { zh: '默认分支流水线', en: 'Default branch pipelines' },
          note: config.observePipelines ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: !!config.observePipelines } },
      ]
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_GITLAB_BASE_URL', description: {
        zh: '这个来源的 GitLab 实例地址', en: 'GitLab instance URL for this Source' } },
      { key: 'DSH_SUPERAGENT_GITLAB_PROJECT', description: {
        zh: '监听的项目 path 或数字 id。智能体在这里开的 MR，分支最后一段是 DSH_SUPERAGENT_NAME 时会关联到工单',
        en: 'Watched project path or numeric id. An MR whose branch last segment is DSH_SUPERAGENT_NAME binds to the ticket' } },
      { key: 'DSH_SUPERAGENT_GITLAB_ACCOUNT', description: {
        zh: '智能体的 GitLab 用户名；glab 以它登录', en: 'The agent\'s GitLab username; glab is signed in as it' } },
      { key: 'DSH_SUPERAGENT_GITLAB_IID', description: {
        zh: '接下工单的 Issue 或 MR 的 iid；工单不是从 GitLab 来的时为空',
        en: 'IID of the Issue or MR that started the ticket; empty when the ticket did not start on GitLab' } },
      { key: 'DSH_SUPERAGENT_GITLAB_KIND', description: {
        zh: '接下工单的是 issue 还是 mr；否则为空', en: 'Whether the origin was issue or mr; empty otherwise' } },
    ],
    values: ({ config, trigger }) => {
      const iid = trigger?.source === SOURCE ? Number(trigger.meta.iid) || 0 : 0
      const kind = trigger?.source === SOURCE && (trigger.meta.kind === 'issue' || trigger.meta.kind === 'mr')
        ? String(trigger.meta.kind) : ''
      return {
        DSH_SUPERAGENT_GITLAB_BASE_URL: config.baseUrl,
        DSH_SUPERAGENT_GITLAB_PROJECT: config.project,
        DSH_SUPERAGENT_GITLAB_ACCOUNT: liveAgent(),
        DSH_SUPERAGENT_GITLAB_IID: iid ? String(iid) : '',
        DSH_SUPERAGENT_GITLAB_KIND: kind,
      }
    },
  },
  facts: (deployment): Record<string, Localized | string> => deployment?.gitlab ? {
    cli: { zh: `当前账号 @${deployment.gitlab.username}（${deployment.gitlab.baseUrl}）`, en: `Current account @${deployment.gitlab.username} (${deployment.gitlab.baseUrl})` },
  } : {
    cli: { zh: '由 glab 包装脚本登录；见 docs/009-gitlab-source.md', en: 'Signed in via the glab wrapper; see docs/009-gitlab-source.md' },
  },
}

/** Channel send bound to the live Source config and cached agent username. */
export async function sendGitlabVia(ctx: SourceContext, message: Parameters<typeof sendGitlab>[1]): Promise<'sent' | 'gone'> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  const target = config && targetOf(config)
  if (!target) throw new Error('The GitLab Source is not configured')
  const agent = ctx.state.get(KV.gitlab.agent) ?? ''
  return sendGitlab(ctx, message, target, agent)
}

export const name = 'dsh-superagent-gitlab'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  liveSend = (_host, message) => sendGitlabVia(sourceContext(ctx.orchestrator, gitlabKind), message)
  liveLink = (address, links) => {
    const config = ctx.orchestrator.sources.instance<GitlabConfig>(SOURCE)?.config
    const gitlab = config && targetOf(config)
    return gitlabLink(address, { ...links, ...(gitlab ? { gitlab } : {}) })
  }
  liveTarget = () => {
    const config = ctx.orchestrator.sources.instance<GitlabConfig>(SOURCE)?.config
    return config ? targetOf(config) : undefined
  }
  liveAgent = () => {
    try { return sourceContext(ctx.orchestrator, gitlabKind).state.get(KV.gitlab.agent) ?? '' }
    catch { return '' }
  }
  ctx.effect(() => ctx.orchestrator.sources.register(gitlabKind), 'gitlab: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, gitlabKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('gitlab', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

export function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined {
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: String(error) }) : undefined
}

async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('gitlab', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<GitlabConfig>(SOURCE)
    try {
      if (config) await pollRound(ctx, signal)
      else ctx.report('gitlab', health('paused', 'sourceOff'))
      failures = 0
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config?.failuresBeforeError ?? 1, error)
      if (!signal.aborted && failed) ctx.report('gitlab', failed)
    }
    await pause((ctx.config<GitlabConfig>(SOURCE)?.pollSeconds ?? 60) * 1000, signal)
  }
}

interface Round {
  started: string; signal?: AbortSignal | undefined
  failures: string[]; tally: Tally; agent: string; target: GitlabTarget
}
const stopped = (ctx: SourceContext, round: Round): boolean => !!round.signal?.aborted || !ctx.config(SOURCE)

/**
 * One polling round: resolve the agent identity, then observed project streams, ticket MRs, and subscribed Threads.
 * Webhooks are not implemented yet; this Source is poll-only (see docs/009-gitlab-source.md).
 */
export async function pollRound(ctx: SourceContext, signal?: AbortSignal): Promise<void> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  const target = config && targetOf(config)
  if (!config || !target) {
    ctx.report('gitlab', { state: 'paused', detail: 'baseUrl, project, and cli are required', at: new Date().toISOString() })
    return
  }
  const api = new GitlabApi(ctx.commands, target).withSignal(signal)
  const me = await api.whoami()
  ctx.state.set(KV.gitlab.agent, me.username)
  const round: Round = { started: new Date().toISOString(), signal, failures: [], tally: { skipped: 0 }, agent: me.username, target }
  await pollRepository(ctx, round)
  await pollTicketMrs(ctx, round)
  await pollThreads(ctx, round)
  if (signal?.aborted) return
  if (round.failures.length) throw new Error(`${round.failures.length} GitLab reads failed: ${round.failures.slice(0, 3).join('; ')}`)
  const dropped = round.tally.skipped ? `; ${round.tally.skipped} unreadable items skipped` : ''
  ctx.report('gitlab', { state: 'ready', detail: `polled as @${me.username}${dropped}`, at: round.started })
}

async function pollRepository(ctx: SourceContext, round: Round): Promise<void> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  if (!config) return
  if (config.observeIssues || config.observeMrs) {
    try { await readIssuesAndMrs(ctx, round, config) }
    catch (error) { if (!stopped(ctx, round)) round.failures.push(`issues/mrs: ${String(error)}`) }
  } else {
    ctx.state.set(KV.gitlab.stream('issues'), undefined)
    ctx.state.set(KV.gitlab.stream('mrs'), undefined)
  }
  if (config.observeNotes) {
    try { await readNotes(ctx, round) }
    catch (error) { if (!stopped(ctx, round)) round.failures.push(`notes: ${String(error)}`) }
  } else ctx.state.set(KV.gitlab.stream('notes'), undefined)
  if (config.observePipelines) {
    try { await pollDefaultPipeline(ctx, round) }
    catch (error) { if (!stopped(ctx, round)) round.failures.push(`pipelines: ${String(error)}`) }
  } else {
    const seen = ctx.state.get(KV.gitlab.branchPipeline)
    ctx.state.set(KV.gitlab.branchPipeline, seen && { revision: seen.revision })
  }
}

async function readIssuesAndMrs(ctx: SourceContext, round: Round, config: GitlabConfig): Promise<void> {
  const api = new GitlabApi(ctx.commands, round.target).withSignal(round.signal)
  for (const stream of [
    { id: 'issues' as const, enabled: config.observeIssues, path: 'issues', parse: IssueSchema, trigger: issueTrigger, kind: 'issue' as const },
    { id: 'mrs' as const, enabled: config.observeMrs, path: 'merge_requests', parse: MergeRequestSchema, trigger: mrTrigger, kind: 'mr' as const },
  ]) {
    if (!stream.enabled) { ctx.state.set(KV.gitlab.stream(stream.id), undefined); continue }
    if (stopped(ctx, round)) return
    const stored = ctx.state.get(KV.gitlab.stream(stream.id))
    const started = stored?.started ?? round.started
    const horizon = Math.floor((Date.parse(round.started) - POLL_HORIZON_MS) / 3_600_000) * 3_600_000
    const since = new Date(Math.max(Date.parse(stored?.since ?? round.started), horizon)).toISOString()
    const path = `${stream.path}?state=all&updated_after=${encodeURIComponent(since)}&order_by=updated_at&sort=asc&per_page=100`
    const items = validItems(stream.parse, await api.api(z.array(z.unknown()), path), round.tally)
    for (const item of items) {
      if (stopped(ctx, round)) throw new Error('The GitLab Source stopped during the poll')
      if (sameName(item.author.username, round.agent)) continue
      if (Date.parse(item.created_at) < Math.max(Date.parse(started), horizon)) continue
      await ctx.receive(stream.trigger(item, round.agent))
      nameThread(ctx, stream.kind, item.iid, item.title, item.web_url)
    }
    const newest = Math.max(...items.map(item => Date.parse(item.updated_at ?? item.created_at)).filter(Number.isFinite))
    const moved = Number.isFinite(newest) ? cursorAt(new Date(newest).toISOString()) : since
    ctx.state.set(KV.gitlab.stream(stream.id), { since: Date.parse(moved) > Date.parse(since) ? moved : since, started })
  }
}

async function readNotes(ctx: SourceContext, round: Round): Promise<void> {
  // Project-wide note listing is not available on all GitLab versions; poll open subscribed threads instead when observeNotes is on.
  // New notes on unsubscribed items still arrive once a mention creates a Trigger via issue/MR observation or a later subscription.
  const stored = ctx.state.get(KV.gitlab.stream('notes'))
  const started = stored?.started ?? round.started
  ctx.state.set(KV.gitlab.stream('notes'), { since: cursorAt(round.started), started })
}

async function pollDefaultPipeline(ctx: SourceContext, round: Round): Promise<void> {
  const api = new GitlabApi(ctx.commands, round.target).withSignal(round.signal)
  const project = await api.api(z.looseObject({ default_branch: z.string().nullish() }), '')
  const branch = project.default_branch
  if (!branch) return
  const pipelines = await api.pages(z.looseObject({
    id: z.number(), status: z.string(), sha: z.string(), web_url: z.string().nullish(), updated_at: z.string().nullish(),
  }), `pipelines?ref=${encodeURIComponent(branch)}&per_page=5`, round.tally)
  const latest = pipelines[0]
  if (!latest) return
  const snapshot = await readPipeline(api, latest.sha, round.tally)
  const previous = ctx.state.get(KV.gitlab.branchPipeline)
  const known = previous?.branch === branch ? previous.failures : undefined
  const failures = snapshot.jobs.filter(job => job.status === 'failed' || job.status === 'canceled').map(job => job.name).sort()
  const counts = pipelineCounts(snapshot)
  const now = failures.length || !counts.running ? failures : known ?? []
  let revision = previous?.revision ?? 0
  if (known && JSON.stringify(now) !== JSON.stringify(known)) {
    revision += 1
    const summary = pipelineSummary(snapshot, branch, `gitlab/merge_requests/0/pipelines`)
    const url = latest.web_url ?? `${round.target.baseUrl}/${round.target.project}/-/pipelines`
    await ctx.receive(pipelineTrigger(branch, latest.sha, revision, summary, url))
    ctx.threads.describe(`${SOURCE}:pipeline:${branch}`, { label: `Pipeline on ${branch}`, facts: { pipeline: pipelineFact(counts) } })
  }
  ctx.state.set(KV.gitlab.branchPipeline, { branch, failures: now, revision })
}

async function pollTicketMrs(ctx: SourceContext, round: Round): Promise<void> {
  const iids = [...new Set(ctx.tickets.open().flatMap(ticket => mrsOf(ticket, true)))]
  for (const iid of iids) {
    if (stopped(ctx, round)) return
    try {
      const mr = await readMr(ctx, round.target, iid, round.signal)
      await observeMr(ctx, mr, round.agent)
      if (mr.state === 'opened' || mr.state === 'open') await pollMrPipeline(ctx, round, mr)
    } catch (error) { if (!stopped(ctx, round)) round.failures.push(`!${iid}: ${String(error)}`) }
  }
}

async function pollMrPipeline(ctx: SourceContext, round: Round, mr: Awaited<ReturnType<typeof readMr>>): Promise<void> {
  const sha = mr.sha ?? mr.squash_commit_sha
  if (!sha) return
  const api = new GitlabApi(ctx.commands, round.target).withSignal(round.signal)
  const snapshot = await readPipeline(api, sha, round.tally)
  const fingerprint = key(JSON.stringify(snapshot))
  const previous = ctx.state.get(KV.gitlab.pipeline(iidKey('mr', mr.number)))
  if (previous?.fingerprint === fingerprint) return
  const revision = previous ? previous.revision + 1 : 0
  if (previous) {
    await ctx.receive(mrPipelineTrigger({ iid: mr.number, web_url: mr.web_url, author: mr.author }, revision,
      pipelineSummary(snapshot, `MR !${mr.number}`, `gitlab/merge_requests/${mr.number}/pipelines`)))
  }
  ctx.state.set(KV.gitlab.pipeline(iidKey('mr', mr.number)), { fingerprint, revision })
  ctx.threads.describe(`${SOURCE}:${threadId('mr', mr.number)}`, { facts: { pipeline: pipelineFact(pipelineCounts(snapshot)) } })
}

function iidKey(kind: GitlabKind, iid: number): string { return threadId(kind, iid) }

function nameThread(ctx: SourceContext, kind: GitlabKind, iid: number, title: string, url: string): void {
  const id = threadId(kind, iid)
  ctx.threads.patch(`${SOURCE}:${id}`, { kind, iid, title, url })
  const label = kind === 'mr' ? `!${iid} ${title}` : `#${iid} ${title}`
  ctx.threads.describe(`${SOURCE}:${id}`, { label, url, facts: { number: { value: kind === 'mr' ? `!${iid}` : `#${iid}` } } })
}

export async function pollThreads(ctx: SourceContext, round: Round): Promise<void> {
  await pollEach(ctx, SOURCE, () => stopped(ctx, round), async thread => {
    try { await pollThread(ctx, round, thread) }
    catch (error) {
      if (stopped(ctx, round)) throw error
      round.failures.push(`${thread.key}: ${String(error)}`)
      throw error
    }
  })
}

async function pollThread(ctx: SourceContext, round: Round, thread: Thread): Promise<void> {
  if (thread.ref.id.startsWith('pipeline:')) return
  const parsed = parseThreadId(thread.ref.id)
  if (!parsed) throw new Error('Subscribed thread has no GitLab issue or MR iid')
  const { kind, iid } = parsed
  const checkpoint = KV.gitlab.cursor(thread.ref.id)
  const since = ctx.state.get(checkpoint) ?? thread.createdAt
  const api = new GitlabApi(ctx.commands, round.target).withSignal(round.signal)
  const path = kind === 'mr' ? `merge_requests/${iid}` : `issues/${iid}`
  if (typeof thread.meta.title !== 'string') {
    if (kind === 'mr') {
      const mr = await api.api(MergeRequestSchema, path)
      nameThread(ctx, kind, iid, mr.title, mr.web_url)
      await observeMr(ctx, { ...mr, number: iid }, round.agent)
    } else {
      const item = await api.api(IssueSchema, path)
      nameThread(ctx, kind, iid, item.title, item.web_url)
    }
  } else if (kind === 'mr') {
    const mr = await readMr(ctx, round.target, iid, round.signal)
    await observeMr(ctx, mr, round.agent)
  }
  const notes = await api.pages(NoteSchema, `${path}/notes?per_page=100&sort=asc`, round.tally)
  for (const note of notes) {
    if (stopped(ctx, round)) throw new Error('The GitLab Source stopped during the poll')
    const timestamp = Date.parse(note.updated_at ?? note.created_at ?? '')
    if (!Number.isFinite(timestamp) || timestamp < Date.parse(since)) continue
    if (sameName(note.author.username, round.agent)) continue
    const trigger = noteTrigger(note, { kind, iid, url: String(thread.meta.url ?? '') || undefined,
      ...kind === 'mr' && typeof thread.meta.mrAuthor === 'string' ? { mrAuthor: thread.meta.mrAuthor } : {} }, round.agent)
    if (trigger) await ctx.receive(trigger)
  }
  ctx.state.set(checkpoint, cursorAt(round.started))
}
