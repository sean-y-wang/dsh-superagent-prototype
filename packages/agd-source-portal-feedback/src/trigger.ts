/** Trigger translation and product-repo routing for the portal-feedback Source. */
import { key } from 'dsh-superagent/sdk'
import type { Trigger } from 'dsh-superagent/sdk'
import { z } from 'zod'

export const SOURCE = 'portal-feedback' as const

/** Short product-repo names hinted to the Worker from feedback `source`. */
export const PRODUCT_REPOS = {
  portal: 'aihub-site',
  console: 'rdg-promotion-console',
  docs: 'aihub-doc',
} as const
export type FeedbackSource = keyof typeof PRODUCT_REPOS

/**
 * Full git.iflytek.com project paths for Worker delivery (`glab -R` / low-risk merge).
 * Operators may override via ticket notes if a path moves; keep in sync with docs/011.
 */
export const PRODUCT_GITLAB_PATHS = {
  portal: 'rdg-ai-cloud/ai-hub/aihub-site',
  console: 'rdg-ai-cloud/ai-hub/rdg-promotion-console',
  docs: 'rdg-ai-cloud/ai-hub/aihub-doc',
} as const

/** Non-feedback product repos still served by the same single instance (GitLab Issues/MRs). */
export const EXTRA_PRODUCT_GITLAB_PATHS = {
  'aihub-service': 'rdg-ai-cloud/ai-hub/aihub-service',
  'aihub-admin': 'rdg-ai-cloud/ai-hub/aihub-admin',
} as const

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

/** Full GitLab project path for opening / merging MRs for this feedback source. */
export function deliveryGitlabProject(source: string): string {
  return PRODUCT_GITLAB_PATHS[source as FeedbackSource] ?? ''
}

/** Resolve a short product name (or feedback source) to a GitLab path when known. */
export function gitlabPathForProduct(name: string): string {
  if (name in PRODUCT_GITLAB_PATHS) return PRODUCT_GITLAB_PATHS[name as FeedbackSource]
  if (name in PRODUCT_REPOS) return PRODUCT_GITLAB_PATHS[name as FeedbackSource]
  const byShort = Object.entries(PRODUCT_REPOS).find(([, short]) => short === name)
  if (byShort) return PRODUCT_GITLAB_PATHS[byShort[0] as FeedbackSource]
  return EXTRA_PRODUCT_GITLAB_PATHS[name as keyof typeof EXTRA_PRODUCT_GITLAB_PATHS] ?? ''
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
      productGitlabPath: deliveryGitlabProject(entry.source),
      status: entry.status,
    },
  }
}
