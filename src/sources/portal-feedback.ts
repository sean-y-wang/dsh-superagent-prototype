/** Portal page-feedback Source: polls aihub-service admin feedback API and writes progress as admin comments. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { validItems, type Tally } from '../infra/commands.ts'
import { KV } from '../kv.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import type { Localized, SourceKind } from './kind.ts'
import { cursorAt, pause, POLL_HORIZON_MS } from './poll.ts'
import { PortalFeedbackApi, type PortalFeedbackTarget } from './portal-feedback-api.ts'
import { portalFeedbackLink, sendPortalFeedback } from './portal-feedback-channel.ts'
import {
  FeedbackEntrySchema, FeedbackListSchema, PRODUCT_REPOS, SOURCE, feedbackTrigger, shouldIntake, type FeedbackEntry,
} from './portal-feedback-trigger.ts'

export { SOURCE, FeedbackEntrySchema, FeedbackListSchema, feedbackTrigger, shouldIntake, productRepo, PRODUCT_REPOS } from './portal-feedback-trigger.ts'
export type { PortalFeedbackTarget } from './portal-feedback-api.ts'

const PortalFeedbackConfigSchema = z.object({
  baseUrl: z.string().trim().url().or(z.literal('')).default(''),
  cli: z.string().trim().default(''),
  /** Which feedback sources to poll (panel rows keyed by id). Empty means all three. */
  sources: z.array(z.object({ id: z.enum(['portal', 'console', 'docs']) }).strict()).default([
    { id: 'portal' }, { id: 'console' }, { id: 'docs' },
  ]),
  /** Display nickname on admin comments (writeback). */
  adminNickname: z.string().trim().default('dsh-superagent'),
  pollSeconds: z.number().int().min(60).max(3600).default(120),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
}).strict()
export type PortalFeedbackConfig = z.infer<typeof PortalFeedbackConfigSchema>

function targetOf(config: PortalFeedbackConfig): PortalFeedbackTarget | undefined {
  if (!config.baseUrl || !config.cli) return undefined
  return { baseUrl: config.baseUrl.replace(/\/$/, ''), cli: config.cli }
}

type ChannelSend = NonNullable<SourceKind<PortalFeedbackConfig>['channel']>['send']
type ChannelLinkFn = NonNullable<SourceKind<PortalFeedbackConfig>['channel']>['link']
let liveSend: ChannelSend = async () => { throw new Error('The portal-feedback Source plugin is not loaded') }
let liveLink: ChannelLinkFn = (address, links) => portalFeedbackLink(address, links)

export const portalFeedbackKind: SourceKind<PortalFeedbackConfig> = {
  kind: SOURCE,
  title: { zh: '门户反馈', en: 'Portal feedback' },
  description: {
    zh: '轮询 aihub-service 管理端开放只读反馈 API（admin-pre 风格），将已发布反馈收为工单；进度通过管理员评论回写。密钥经 CLI 包装注入，不进设置。',
    en: 'Polls the aihub-service admin feedback API (admin-pre style) for published items; progress writeback uses admin comments. Secrets stay in the CLI wrapper, not settings.',
  },
  schema: PortalFeedbackConfigSchema,
  fields: [
    { key: 'baseUrl', type: 'text', pattern: 'https?://.+', label: { zh: '服务根地址', en: 'Service base URL' },
      hint: { zh: '提供 /aihub/api/v1/admin/feedback 的源站，例如 https://ai-pre.xf-yun.com，不要末尾斜杠。',
        en: 'Origin that serves /aihub/api/v1/admin/feedback, for example https://ai-pre.xf-yun.com, no trailing slash.' } },
    { key: 'cli', type: 'text', label: { zh: '反馈 API CLI', en: 'Feedback API CLI' },
      hint: { zh: '命令名或绝对路径。包装脚本从环境注入 X-Internal-Secret（及可选 X-Admin-User）；配置里不要写密钥。见 docs/010。',
        en: 'Command name or absolute path. The wrapper injects X-Internal-Secret (and optional X-Admin-User) from its env; never put secrets in this configuration. See docs/010.' } },
    { key: 'sources', type: 'rows', label: { zh: '轮询的来源', en: 'Sources to poll' },
      columns: [
        { key: 'id', type: 'select', label: { zh: '来源', en: 'Source' }, options: [
          { value: 'portal', label: { zh: '门户 (aihub-site)', en: 'Portal (aihub-site)' } },
          { value: 'console', label: { zh: '控制台 (rdg-promotion-console)', en: 'Console (rdg-promotion-console)' } },
          { value: 'docs', label: { zh: '文档 (aihub-doc)', en: 'Docs (aihub-doc)' } },
        ] },
      ] },
    { key: 'adminNickname', type: 'text', advanced: true, label: { zh: '管理员评论昵称', en: 'Admin comment nickname' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 60, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20,
      label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' } },
  ],
  scope: (_trigger, _config) => ({ listened: true, observed: true, row: 'published' }),
  health: ['portal-feedback'],
  channel: {
    send: (host, message) => liveSend(host, message),
    link: (address, links) => liveLink(address, links),
  },
  find: query => {
    const id = /\b(FB-[A-Za-z0-9-]+)\b/.exec(query)?.[1]
    return id ? { threads: [`${SOURCE}:${id}`], terms: [id] } : { threads: [], terms: [] }
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().min(1) }).strict()).default([]),
    }).strict(),
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的反馈账号', en: 'Feedback accounts that may originate work' },
        columns: [{ key: 'id', type: 'text', label: { zh: 'userId', en: 'userId' } }] },
    ],
    explicit: { zh: '名单里的账号在门户/控制台/文档提交的已发布反馈。', en: 'An allowlisted account publishes feedback on portal, console, or docs.' },
    rows() {
      return [{
        id: 'published',
        label: { zh: '已发布反馈', en: 'Published feedback' },
        note: { zh: '全部', en: 'All' },
        cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true },
      }]
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_PORTAL_FEEDBACK_ID', description: {
        zh: '接下工单的反馈 id（FB-…）；非反馈工单为空', en: 'Feedback id (FB-…) that started the ticket; empty otherwise' } },
      { key: 'DSH_SUPERAGENT_PORTAL_FEEDBACK_SOURCE', description: {
        zh: '反馈来源 portal|console|docs', en: 'Feedback source portal|console|docs' } },
      { key: 'DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO', description: {
        zh: '按来源路由的产品仓提示：portal→aihub-site，console→rdg-promotion-console，docs→aihub-doc',
        en: 'Product repo hint from source: portal→aihub-site, console→rdg-promotion-console, docs→aihub-doc' } },
      { key: 'DSH_SUPERAGENT_PORTAL_FEEDBACK_PAGE_URL', description: {
        zh: '反馈的页面 URL', en: 'Page URL of the feedback' } },
      { key: 'DSH_SUPERAGENT_PORTAL_FEEDBACK_TYPE', description: {
        zh: '反馈类型 request|issue|suggestion', en: 'Feedback type request|issue|suggestion' } },
    ],
    values: ({ trigger }) => {
      if (trigger?.source !== SOURCE) {
        return {
          DSH_SUPERAGENT_PORTAL_FEEDBACK_ID: '',
          DSH_SUPERAGENT_PORTAL_FEEDBACK_SOURCE: '',
          DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO: '',
          DSH_SUPERAGENT_PORTAL_FEEDBACK_PAGE_URL: '',
          DSH_SUPERAGENT_PORTAL_FEEDBACK_TYPE: '',
        }
      }
      const meta = trigger.meta
      return {
        DSH_SUPERAGENT_PORTAL_FEEDBACK_ID: String(meta.feedbackId ?? ''),
        DSH_SUPERAGENT_PORTAL_FEEDBACK_SOURCE: String(meta.source ?? ''),
        DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO: String(meta.productRepo ?? ''),
        DSH_SUPERAGENT_PORTAL_FEEDBACK_PAGE_URL: String(meta.pageUrl ?? ''),
        DSH_SUPERAGENT_PORTAL_FEEDBACK_TYPE: String(meta.type ?? ''),
      }
    },
  },
  facts: (): Record<string, Localized | string> => ({
    auth: {
      zh: '鉴权：CLI 包装注入 X-Internal-Secret（非存储网关 HMAC）。见 docs/010-portal-feedback-source.md',
      en: 'Auth: CLI wrapper injects X-Internal-Secret (not storage-gateway HMAC). See docs/010-portal-feedback-source.md',
    },
  }),
}

export async function sendPortalFeedbackVia(ctx: SourceContext, message: Parameters<typeof sendPortalFeedback>[1]): Promise<'sent' | 'gone'> {
  const config = ctx.config<PortalFeedbackConfig>(SOURCE)
  const target = config && targetOf(config)
  if (!target) throw new Error('The portal-feedback Source is not configured')
  return sendPortalFeedback(ctx, message, target, config.adminNickname || 'dsh-superagent')
}

export const name = 'dsh-superagent-portal-feedback'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  liveSend = (_host, message) => sendPortalFeedbackVia(sourceContext(ctx.orchestrator, portalFeedbackKind), message)
  liveLink = (address, links) => portalFeedbackLink(address, links)
  ctx.effect(() => ctx.orchestrator.sources.register(portalFeedbackKind), 'portal-feedback: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, portalFeedbackKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('portal-feedback', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

export function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined {
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: String(error) }) : undefined
}

async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('portal-feedback', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<PortalFeedbackConfig>(SOURCE)
    try {
      if (config) await pollRound(ctx, signal)
      else ctx.report('portal-feedback', health('paused', 'sourceOff'))
      failures = 0
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config?.failuresBeforeError ?? 1, error)
      if (!signal.aborted && failed) ctx.report('portal-feedback', failed)
    }
    await pause((ctx.config<PortalFeedbackConfig>(SOURCE)?.pollSeconds ?? 120) * 1000, signal)
  }
}

interface Round {
  started: string
  signal?: AbortSignal | undefined
  failures: string[]
  tally: Tally
  target: PortalFeedbackTarget
  sources: readonly ('portal' | 'console' | 'docs')[]
}

const stopped = (ctx: SourceContext, round: Round): boolean => !!round.signal?.aborted || !ctx.config(SOURCE)

/** One polling round over configured product sources; Engine.receive dedupes by Trigger id. */
export async function pollRound(ctx: SourceContext, signal?: AbortSignal): Promise<void> {
  const config = ctx.config<PortalFeedbackConfig>(SOURCE)
  const target = config && targetOf(config)
  if (!config || !target) {
    ctx.report('portal-feedback', { state: 'paused', detail: 'baseUrl and cli are required', at: new Date().toISOString() })
    return
  }
  const sources = (config.sources.length ? config.sources.map(row => row.id) : ['portal', 'console', 'docs']) as ('portal'|'console'|'docs')[]
  const round: Round = {
    started: new Date().toISOString(), signal, failures: [], tally: { skipped: 0 }, target,
    sources: [...sources],
  }
  for (const source of round.sources) {
    if (stopped(ctx, round)) return
    try { await pollSource(ctx, round, source) }
    catch (error) { if (!stopped(ctx, round)) round.failures.push(`${source}: ${String(error)}`) }
  }
  if (signal?.aborted) return
  if (round.failures.length) throw new Error(`${round.failures.length} portal-feedback reads failed: ${round.failures.slice(0, 3).join('; ')}`)
  const dropped = round.tally.skipped ? `; ${round.tally.skipped} unreadable items skipped` : ''
  ctx.report('portal-feedback', { state: 'ready', detail: `polled ${round.sources.join(',')}${dropped}`, at: round.started })
}

async function pollSource(ctx: SourceContext, round: Round, source: 'portal' | 'console' | 'docs'): Promise<void> {
  const api = new PortalFeedbackApi(ctx.commands, round.target).withSignal(round.signal)
  const streamKey = KV.portalFeedback.stream(source)
  const stored = ctx.state.get(streamKey)
  const started = stored?.started ?? round.started
  const horizon = Math.floor((Date.parse(round.started) - POLL_HORIZON_MS) / 3_600_000) * 3_600_000
  const since = new Date(Math.max(Date.parse(stored?.since ?? round.started), horizon)).toISOString()
  // First enable: seed cursor without ingesting history (same pattern as GitHub/GitLab observe streams).
  if (!stored) {
    ctx.state.set(streamKey, { since: cursorAt(round.started), started: round.started })
    return
  }
  const path = `/aihub/api/v1/admin/feedback?status=published&source=${encodeURIComponent(source)}&from=${encodeURIComponent(since)}&page=1&limit=50`
  const list = await api.api(FeedbackListSchema, 'GET', path)
  const entries = validItems(FeedbackEntrySchema, list.items, round.tally)
  let newest = Date.parse(since)
  for (const entry of entries) {
    if (stopped(ctx, round)) throw new Error('The portal-feedback Source stopped during the poll')
    const at = Date.parse(entry.submittedAt || entry.createdAt || '')
    if (Number.isFinite(at) && at > newest) newest = at
    if (Number.isFinite(at) && at < Math.max(Date.parse(started), horizon)) continue
    if (!shouldIntake(entry)) continue
    await ctx.receive(feedbackTrigger(entry))
    nameThread(ctx, entry)
  }
  const moved = Number.isFinite(newest) ? cursorAt(new Date(newest).toISOString()) : since
  ctx.state.set(streamKey, { since: Date.parse(moved) > Date.parse(since) ? moved : since, started })
}

function nameThread(ctx: SourceContext, entry: FeedbackEntry): void {
  const label = `${entry.id} · ${PRODUCT_REPOS[entry.source]} · ${entry.type}`
  ctx.threads.describe(`${SOURCE}:${entry.id}`, {
    label,
    ...(entry.pageUrl ? { url: entry.pageUrl } : {}),
    facts: {
      source: { value: entry.source },
      productRepo: { value: PRODUCT_REPOS[entry.source] },
      type: { value: entry.type },
      page: { value: entry.pageTitle || entry.pageKey || entry.pageUrl },
    },
  })
}
