/** Trigger translation and product-repo routing for the portal-feedback Source. */
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'

export const SOURCE = 'portal-feedback' as const

/** Product repos hinted to the Worker from feedback `source` (git.iflytek.com paths are operator-local). */
export const PRODUCT_REPOS = {
  portal: 'aihub-site',
  console: 'rdg-promotion-console',
  docs: 'aihub-doc',
} as const
export type FeedbackSource = keyof typeof PRODUCT_REPOS

export const FeedbackEntrySchema = z.looseObject({
  id: z.string().min(1),
  source: z.enum(['portal', 'console', 'docs']),
  type: z.enum(['request', 'issue', 'suggestion']).or(z.string()),
  content: z.string().default(''),
  pageUrl: z.string().default(''),
  pageKey: z.string().default(''),
  pageTitle: z.string().default(''),
  status: z.string(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  nickname: z.string().optional(),
  environment: z.string().optional(),
  submittedAt: z.string().nullish(),
  createdAt: z.string().optional(),
  deletedAt: z.string().nullish(),
})
export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>

export const FeedbackListSchema = z.looseObject({
  items: z.array(z.unknown()).default([]),
  total: z.number().optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
})

/** Skip entries that must not create tickets (draft / deleted / empty / non-published). */
export function shouldIntake(entry: FeedbackEntry): boolean {
  if (entry.status !== 'published') return false
  if (entry.deletedAt) return false
  if (!entry.content.trim()) return false
  return true
}

export function productRepo(source: string): string {
  return PRODUCT_REPOS[source as FeedbackSource] ?? ''
}

export function threadId(feedbackId: string): string {
  return feedbackId
}

/** One published feedback item → one Trigger; Engine.receive dedupes by Trigger id. */
export function feedbackTrigger(entry: FeedbackEntry): Trigger {
  const actorId = entry.userId || entry.userName || entry.nickname || 'unknown'
  const title = entry.pageTitle || entry.pageKey || entry.pageUrl || entry.id
  const text = [
    `[${entry.type}] ${title}`,
    entry.pageUrl ? `page: ${entry.pageUrl}` : '',
    '',
    entry.content.trim(),
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== '')).join('\n').trim()
  return {
    id: key(SOURCE, entry.id),
    source: SOURCE,
    threads: [{ source: SOURCE, id: threadId(entry.id) }],
    actor: { source: SOURCE, id: actorId },
    human: true,
    at: entry.submittedAt || entry.createdAt || new Date().toISOString(),
    text,
    channel: {
      source: SOURCE,
      thread: `${SOURCE}:${threadId(entry.id)}`,
      address: { id: entry.id, ...(entry.pageUrl ? { url: entry.pageUrl } : {}) },
    },
    ...(entry.pageUrl ? { url: entry.pageUrl } : {}),
    meta: {
      feedbackId: entry.id,
      source: entry.source,
      type: entry.type,
      pageUrl: entry.pageUrl,
      pageKey: entry.pageKey,
      pageTitle: entry.pageTitle,
      productRepo: productRepo(entry.source),
      status: entry.status,
    },
  }
}
