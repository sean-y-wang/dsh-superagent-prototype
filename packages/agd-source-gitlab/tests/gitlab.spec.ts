import { expect, it } from 'vitest'
import { commandError, CliError } from '../../../src/infra/commands.ts'
import {
  gitlabAddress, gitlabPage, issueTrigger, mentions, mrTrigger, noteTrigger, parseThreadId, threadId,
} from '../../../src/sources/gitlab-trigger.ts'
import { gitlabLink, sendGitlab } from '../src/channel.ts'
import { projectApiId } from '../../../src/sources/gitlab-api.ts'
import { gitlabKind } from '../src/index.ts'
import type { OutboundMessage } from '../../../src/core/index.ts'
import { Commands } from '../../../src/infra/commands.ts'
import { testDeployment } from '../../../tests/fixtures/deployment.ts'
import { vi } from 'vitest'

const base = 'https://git.iflytek.com'
const project = 'rdg-ai-cloud/aihub-site'

it('maps Issues and MRs onto separate thread ids', () => {
  expect(threadId('issue', 12)).toBe('issue:12')
  expect(threadId('mr', 12)).toBe('mr:12')
  expect(parseThreadId('issue:12')).toEqual({ kind: 'issue', iid: 12 })
  expect(parseThreadId('mr:12')).toEqual({ kind: 'mr', iid: 12 })
  expect(parseThreadId('12')).toBeUndefined()
})

it('builds panel URLs for Issues and MRs on a self-hosted instance', () => {
  expect(gitlabPage(base, project, 'issue', 3)).toBe(`${base}/${project}/-/issues/3`)
  expect(gitlabPage(base, project, 'mr', 9)).toBe(`${base}/${project}/-/merge_requests/9`)
})

it('parses web URLs for the configured project only', () => {
  expect(gitlabAddress(`${base}/${project}/-/issues/4#note_88`, base, project))
    .toEqual({ kind: 'issue', iid: 4, note: 88 })
  expect(gitlabAddress(`${base}/${project}/-/merge_requests/5`, base, project))
    .toEqual({ kind: 'mr', iid: 5 })
  expect(gitlabAddress(`${base}/other/group/-/issues/1`, base, project)).toBeUndefined()
})

it('encodes project paths for the Projects API', () => {
  expect(projectApiId('rdg-ai-cloud/aihub-site')).toBe('rdg-ai-cloud%2Faihub-site')
  expect(projectApiId('42')).toBe('42')
})

it('translates an Issue body into a stable Trigger and drops the agent\'s own notes', () => {
  const issue = issueTrigger({
    iid: 7, title: 'Fix nav', description: 'Please @agent-bot look', author: { username: 'alice' },
    created_at: '2026-10-01T00:00:00Z', web_url: `${base}/${project}/-/issues/7`,
  }, 'agent-bot')
  expect(issue).toMatchObject({
    source: 'gitlab', threads: [{ source: 'gitlab', id: 'issue:7' }], actor: { id: 'alice' }, human: true,
    addressed: 'mention', meta: { kind: 'issue', iid: 7 },
  })
  expect(mentions('hi @agent-bot!', 'agent-bot')).toBe(true)
  expect(mentions('mail@agent-bot.example', 'agent-bot')).toBe(false)
  expect(noteTrigger({
    id: 1, body: 'self', author: { username: 'agent-bot' }, created_at: '2026-10-01T00:00:00Z',
  }, { kind: 'issue', iid: 7 }, 'agent-bot')?.human).toBe(false)
  expect(noteTrigger({
    id: 2, body: '', author: { username: 'alice' }, system: true, created_at: '2026-10-01T00:00:00Z',
  }, { kind: 'issue', iid: 7 }, 'agent-bot')).toBeUndefined()
})

it('reuses a distinct id space for MRs so Issue #1 and MR !1 do not collide', () => {
  const issue = issueTrigger({
    iid: 1, title: 'I', description: '', author: { username: 'alice' },
    created_at: '2026-10-01T00:00:00Z', web_url: `${base}/${project}/-/issues/1`,
  }, 'agent-bot')
  const mr = mrTrigger({
    iid: 1, title: 'M', description: '', author: { username: 'alice' },
    created_at: '2026-10-01T00:00:00Z', web_url: `${base}/${project}/-/merge_requests/1`,
  }, 'agent-bot')
  expect(issue.id).not.toBe(mr.id)
  expect(issue.threads[0]!.id).toBe('issue:1')
  expect(mr.threads[0]!.id).toBe('mr:1')
})

it('finds Issue and MR threads from #n, !n and page URLs', () => {
  expect(gitlabKind.find!('#12').threads).toEqual(['gitlab:issue:12'])
  expect(gitlabKind.find!('!9').threads).toEqual(['gitlab:mr:9'])
  expect(gitlabKind.find!(`${base}/${project}/-/merge_requests/3`).threads).toEqual(['gitlab:mr:3'])
})

it('defaults the Source to receive nothing until observe switches are on', () => {
  expect(gitlabKind.schema.parse({})).toEqual({
    baseUrl: '', project: '', cli: '', pollSeconds: 60, failuresBeforeError: 3,
    observeIssues: false, observeMrs: false, observeNotes: false, observePipelines: false,
  })
  expect(gitlabKind.scope!({ meta: { kind: 'issue', iid: 1 } }, gitlabKind.schema.parse({}))).toMatchObject({
    listened: true, observed: false, row: 'issues',
  })
  expect(gitlabKind.scope!({ meta: { kind: 'issue', iid: 1 } }, gitlabKind.schema.parse({ observeIssues: true })))
    .toMatchObject({ observed: true })
})

it('posts a note once, using an HTML marker for idempotency, and returns gone on 404', async () => {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  const run = vi.spyOn(commands, 'run')
  run.mockResolvedValueOnce(JSON.stringify([])) // pages: no existing note
    .mockResolvedValueOnce(JSON.stringify({ id: 99 })) // create
  const message: OutboundMessage = {
    id: 'out-1', text: 'Working on it.', kind: 'reply',
    channel: { source: 'gitlab', thread: 'gitlab:issue:3', address: { kind: 'issue', iid: '3' } },
  }
  await expect(sendGitlab({ commands }, message, { baseUrl: base, project, cli: 'glab-agent' }, 'agent-bot'))
    .resolves.toBe('sent')
  expect(run.mock.calls[1]![1]).toEqual(expect.arrayContaining(['api', expect.stringContaining('issues/3/notes')]))
  // Second send finds the marker and does not create again.
  run.mockResolvedValueOnce(JSON.stringify([{ id: 99, body: 'Working on it.\n\n<!-- dsh-superagent:out-1 -->', author: { username: 'agent-bot' } }]))
  await expect(sendGitlab({ commands }, message, { baseUrl: base, project, cli: 'glab-agent' }, 'agent-bot'))
    .resolves.toBe('sent')
  expect(run).toHaveBeenCalledTimes(3)

  run.mockRejectedValueOnce(new CliError('Not Found', 404))
  await expect(sendGitlab({ commands }, message, { baseUrl: base, project, cli: 'glab-agent' }, 'agent-bot'))
    .resolves.toBe('gone')
})

it('builds Channel links from baseUrl and project when the address has no url', () => {
  expect(gitlabLink({ kind: 'mr', iid: '8' }, { gitlab: { baseUrl: base, project } })).toEqual({
    url: `${base}/${project}/-/merge_requests/8`,
    label: { zh: 'GitLab !8', en: 'GitLab !8' },
  })
})

it('surfaces CLI HTTP status through commandError for retry classification', () => {
  const error = commandError(Object.assign(new Error('fail'), { stderr: 'glab: 404 Not Found (HTTP 404)\n', code: 1 }), 'glab')
  expect(error).toBeInstanceOf(CliError)
  expect((error as CliError).code).toBe(404)
})
