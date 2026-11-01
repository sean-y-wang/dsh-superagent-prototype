import { expect, it, vi, afterEach } from 'vitest'
import { Commands, CliError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import type { OutboundMessage } from '../src/core/index.ts'
import { PortalFeedbackApi } from '../src/sources/portal-feedback-api.ts'
import { sendPortalFeedback, portalFeedbackLink } from '../src/sources/portal-feedback-channel.ts'
import {
  FeedbackEntrySchema, FeedbackListSchema, feedbackTrigger, portalFeedbackKind, productRepo, shouldIntake, SOURCE,
} from '../src/sources/portal-feedback.ts'

const base = 'https://ai-dev.example.com'
const target = { baseUrl: base, cli: 'feedback-cli' }
const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
afterEach(() => vi.restoreAllMocks())

const published = {
  id: 'FB-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  source: 'portal' as const,
  type: 'request' as const,
  content: 'Button does nothing',
  pageUrl: 'https://ai-dev.xf-yun.com/models',
  pageKey: '/models',
  pageTitle: 'Models',
  status: 'published',
  userId: 'INTERNAL:101',
  submittedAt: '2026-11-01T12:00:00Z',
}

it('parses config defaults and finds FB- thread references', () => {
  expect(portalFeedbackKind.schema.parse({})).toMatchObject({
    baseUrl: '', cli: '', pollSeconds: 120,
    sources: [{ id: 'portal' }, { id: 'console' }, { id: 'docs' }],
  })
  expect(portalFeedbackKind.find!('please see FB-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa thanks').threads)
    .toEqual([`${SOURCE}:FB-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`])
  expect(productRepo('console')).toBe('rdg-promotion-console')
  expect(portalFeedbackKind.scope!({ meta: {} }, portalFeedbackKind.schema.parse({}))).toMatchObject({
    listened: true, observed: true,
  })
})

it('skips draft, deleted, and empty content on the fast path', () => {
  expect(shouldIntake(FeedbackEntrySchema.parse(published))).toBe(true)
  expect(shouldIntake(FeedbackEntrySchema.parse({ ...published, status: 'draft' }))).toBe(false)
  expect(shouldIntake(FeedbackEntrySchema.parse({ ...published, content: '  ' }))).toBe(false)
  expect(shouldIntake(FeedbackEntrySchema.parse({ ...published, deletedAt: '2026-11-01T13:00:00Z' }))).toBe(false)
})

it('builds a Trigger with productRepo meta and stable id', () => {
  const a = feedbackTrigger(FeedbackEntrySchema.parse(published))
  const b = feedbackTrigger(FeedbackEntrySchema.parse(published))
  expect(a.id).toBe(b.id)
  expect(a.source).toBe(SOURCE)
  expect(a.meta).toMatchObject({
    feedbackId: published.id, source: 'portal', productRepo: 'aihub-site', type: 'request',
  })
  expect(a.channel?.address.id).toBe(published.id)
  expect(a.text).toContain('Button does nothing')
})

it('lists published feedback through the CLI wrapper and unwraps the API envelope', async () => {
  const run = vi.spyOn(commands, 'run').mockResolvedValueOnce(JSON.stringify({
    code: 0, message: 'success',
    data: { items: [published], total: 1, page: 1, limit: 50 },
  }))
  const api = new PortalFeedbackApi(commands, target)
  const list = await api.api(FeedbackListSchema, 'GET', '/aihub/api/v1/admin/feedback?status=published')
  expect(list.items).toHaveLength(1)
  expect(FeedbackEntrySchema.parse(list.items[0])).toMatchObject({ id: published.id, status: 'published' })
  expect(run).toHaveBeenCalledWith('feedback-cli', [
    'api', 'GET', `${base}/aihub/api/v1/admin/feedback?status=published`,
  ])
})

it('posts an admin comment once and returns gone on 404', async () => {
  const run = vi.spyOn(commands, 'run').mockResolvedValueOnce(JSON.stringify({
    code: 0, data: { id: 'c1', feedbackId: published.id, content: 'Looking into it.' },
  }))
  const message: OutboundMessage = {
    id: 'abcdef0123456789abcdef0123456789', text: 'Looking into it.', kind: 'reply',
    channel: { source: SOURCE, thread: `${SOURCE}:${published.id}`, address: { id: published.id } },
  }
  await expect(sendPortalFeedback({ commands }, message, target)).resolves.toBe('sent')
  expect(run.mock.calls[0]![1]).toEqual([
    'api', 'POST', `${base}/aihub/api/v1/admin/feedback/${published.id}/comments`,
    '--body', expect.stringContaining('"requestId":"abcdef0123456789abcdef0123456789"'),
  ])
  run.mockRejectedValueOnce(new CliError('Not Found', 404))
  await expect(sendPortalFeedback({ commands }, message, target)).resolves.toBe('gone')
})

it('builds a channel link from the address url when present', () => {
  expect(portalFeedbackLink({ id: published.id, url: published.pageUrl }, {})).toEqual({
    url: published.pageUrl,
    label: { zh: `反馈 ${published.id}`, en: `Feedback ${published.id}` },
  })
})
