/** Admin feedback HTTP helper via a configured CLI wrapper (Internal-Secret stays in the wrapper env). */
import { CliError } from 'dsh-superagent/sdk'
import type { Commands } from 'dsh-superagent/sdk'
import { z } from 'zod'

export interface PortalFeedbackTarget {
  /** Origin that serves `/aihub/api/v1/admin/feedback` (no trailing slash), e.g. https://ai-dev.xf-yun.com. */
  baseUrl: string
  /**
   * Absolute path or command name of a CLI wrapper that adds `X-Internal-Secret` (and optional `X-Admin-User`)
   * and talks to `baseUrl`. Credentials never appear in Source settings — same pattern as the GitLab glab wrapper.
   */
  cli: string
}

/** Envelope returned by aihub-service (`code === 0` is success). */
export const ApiEnvelope = z.looseObject({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional(),
})

/**
 * Runs `cli api <METHOD> <path> …` against the admin feedback API.
 * The wrapper must prepend `baseUrl`, inject auth headers from its own env, and print the JSON body on stdout.
 * Example contract (see docs/010-portal-feedback-source.md):
 *   feedback-cli api GET /aihub/api/v1/admin/feedback?status=published&page=1&limit=50
 *   feedback-cli api POST /aihub/api/v1/admin/feedback/FB-…/comments --body '<json>'
 */
export class PortalFeedbackApi {
  constructor(private readonly commands: Commands, private readonly target: PortalFeedbackTarget) {}
  withSignal(signal?: AbortSignal): PortalFeedbackApi {
    return signal ? new PortalFeedbackApi(this.commands.withSignal(signal), this.target) : this
  }
  async run(args: string[]): Promise<string> {
    return this.commands.run(this.target.cli, args)
  }
  async api<T>(schema: z.ZodType<T>, method: 'GET' | 'POST', path: string, ...flags: string[]): Promise<T> {
    const raw = await this.run(['api', method, this.path(path), ...flags])
    let parsed: unknown
    try { parsed = JSON.parse(raw) }
    catch (error) { throw new CliError(`portal-feedback API returned non-JSON for ${method} ${path}: ${String(error)}`) }
    const envelope = ApiEnvelope.safeParse(parsed)
    if (envelope.success) {
      if (envelope.data.code !== 0) {
        throw new CliError(`portal-feedback API ${method} ${path} failed: code=${envelope.data.code} ${envelope.data.message ?? ''}`)
      }
      return schema.parse(envelope.data.data)
    }
    // Wrappers may unwrap `data` already; accept the payload directly.
    return schema.parse(parsed)
  }
  private path(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    const base = this.target.baseUrl.replace(/\/$/, '')
    const rel = path.startsWith('/') ? path : `/${path}`
    // Pass absolute URL so a dumb curl-style wrapper need not know baseUrl; smart wrappers may ignore the host.
    return `${base}${rel}`
  }
}

export const portalFeedbackGone = (error: unknown): boolean =>
  error instanceof CliError && (error.code === 404 || error.code === 410)
