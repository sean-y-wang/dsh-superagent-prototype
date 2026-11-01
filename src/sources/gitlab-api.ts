/** GitLab REST helper via a configured `glab` (or compatible) CLI, scoped to one project on a self-hosted instance. */
import { z } from 'zod'
import { CliError, validItems, type Commands, type Tally } from '../infra/commands.ts'

export interface GitlabTarget {
  /** Instance origin, such as `https://git.iflytek.com` (no trailing slash). Used for panel URLs and address parsing. */
  baseUrl: string
  /** Project path `group/name` or numeric project id as a string. */
  project: string
  /**
   * Absolute path or command name of a glab wrapper signed in as the agent account.
   * The wrapper must set `GITLAB_HOST` (or equivalent) to `baseUrl`; credentials stay in the wrapper, never in Source config.
   */
  cli: string
}
/** Encodes a project path or numeric id for `/api/v4/projects/:id`. */
export function projectApiId(project: string): string {
  if (/^\d+$/.test(project)) return project
  return encodeURIComponent(project.replace(/^\/+|\/+$/g, ''))
}
const UserSchema = z.looseObject({ username: z.string(), id: z.number() })
/**
 * Runs `glab api` against the configured project.
 * Host and token come from the CLI wrapper environment (see docs/009-gitlab-source.md); this helper never accepts a PAT.
 */
export class GitlabApi {
  constructor(private readonly commands: Commands, private readonly target: GitlabTarget) {}
  withSignal(signal?: AbortSignal): GitlabApi {
    return signal ? new GitlabApi(this.commands.withSignal(signal), this.target) : this
  }
  get projectPath(): string { return `projects/${projectApiId(this.target.project)}` }
  async run(args: string[]): Promise<string> {
    return this.commands.run(this.target.cli, args)
  }
  async api<T>(schema: z.ZodType<T>, path: string, ...flags: string[]): Promise<T>
  async api(path: string, ...flags: string[]): Promise<string>
  async api<T>(schema: z.ZodType<T> | string, ...rest: string[]): Promise<T | string> {
    if (typeof schema === 'string') return this.run(['api', this.path(schema), ...rest])
    const [path = '', ...flags] = rest
    const raw = await this.run(['api', this.path(path), ...flags])
    return schema.parse(JSON.parse(raw))
  }
  async pages<T>(item: z.ZodType<T>, path: string, tally?: Tally): Promise<T[]> {
    // glab --paginate may print one JSON array, or concatenated arrays/objects; normalize to a flat item list.
    const raw = await this.run(['api', this.path(path), '--paginate'])
    let list: unknown[]
    try {
      const trimmed = raw.trim()
      const parsed: unknown = JSON.parse(trimmed.startsWith('[') ? trimmed : `[${trimmed.replace(/}\s*{/g, '},{')}]`)
      list = Array.isArray(parsed) ? (parsed as unknown[]).flatMap(page => Array.isArray(page) ? page : [page]) : []
    } catch (error) {
      throw new CliError(`GitLab API returned non-JSON for ${path}: ${String(error)}`)
    }
    return validItems(item, list, tally)
  }
  async whoami(): Promise<{ username: string; id: number }> {
    return this.api(UserSchema, '/user')
  }
  private path(path: string): string {
    if (path.startsWith('/')) return path.replace(/^\//, '')
    if (!path) return this.projectPath
    return `${this.projectPath}/${path}`
  }
}
/** True when GitLab reports the resource is gone in a way that should stop retries. */
export const gitlabGone = (error: unknown): boolean =>
  error instanceof CliError && (error.code === 404 || error.code === 410)
