/** Outbound channel: post an admin comment on a feedback item for progress writeback. */
import type { ChannelLink, ChannelLinks, OutboundMessage, SourceContext } from 'dsh-superagent/sdk'
import { z } from 'zod'
import { PortalFeedbackApi, portalFeedbackGone, type PortalFeedbackTarget } from './api.ts'

const CommentSchema = z.looseObject({
  id: z.string(),
  feedbackId: z.string().optional(),
  content: z.string().optional(),
})

/**
 * POST `/aihub/api/v1/admin/feedback/:id/comments` with Internal-Secret (via CLI).
 * Idempotent via `requestId` = outbound message id (32-hex key ids match the server's safeID).
 */
export async function sendPortalFeedback(host: Pick<SourceContext, 'commands'>, message: OutboundMessage,
  target: PortalFeedbackTarget, nickname = 'dsh-superagent'): Promise<'sent' | 'gone'> {
  const id = message.channel.address.id
  if (!id) throw new Error('Missing portal-feedback reply target')
  const api = new PortalFeedbackApi(host.commands, target)
  const body = JSON.stringify({
    requestId: message.id,
    content: message.text,
    nickname,
  })
  try {
    await api.api(CommentSchema, 'POST', `/aihub/api/v1/admin/feedback/${encodeURIComponent(id)}/comments`,
      '--body', body)
    return 'sent'
  } catch (error) {
    if (portalFeedbackGone(error)) return 'gone'
    throw error
  }
}

export function portalFeedbackLink(address: Record<string, string>, _links: ChannelLinks): ChannelLink {
  const id = address.id ?? ''
  const url = address.url ?? ''
  return { url, label: { zh: `反馈 ${id}`, en: `Feedback ${id}` } }
}
