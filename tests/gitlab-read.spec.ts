import { afterEach, expect, it, vi } from 'vitest'
import { Commands } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { readGitlab } from '../src/sources/gitlab-read.ts'

const target = { baseUrl: 'https://git.iflytek.com', project: 'rdg-ai-cloud/aihub-site', cli: 'glab-agent' }
const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
afterEach(() => vi.restoreAllMocks())

it('rejects unsupported gitlab resource paths without calling the CLI', async () => {
  const run = vi.spyOn(commands, 'run')
  for (const resource of ['gitlab/../outside', 'gitlab/issues/1/pipelines', 'gitlab/merge_requests/1/notes/x']) {
    await expect(readGitlab(commands, target, resource)).rejects.toThrow()
  }
  expect(run).not.toHaveBeenCalled()
})

it('reads an Issue description and a bounded notes page with next_resource', async () => {
  const run = vi.spyOn(commands, 'run')
    .mockResolvedValueOnce(JSON.stringify({
      id: 300, iid: 3, title: 'Broken link', description: 'Details', state: 'opened',
      author: { username: 'alice' }, created_at: '2026-10-01T00:00:00Z',
      web_url: 'https://git.iflytek.com/rdg-ai-cloud/aihub-site/-/issues/3', labels: ['bug'],
    }))
  expect(await readGitlab(commands, target, 'gitlab/issues/3')).toMatchObject({
    iid: 3, title: 'Broken link', from: 'alice', text: 'Details', labels: ['bug'],
  })
  run.mockResolvedValueOnce(JSON.stringify(Array.from({ length: 20 }, (_, id) => ({
    id: id + 1, body: `note ${id + 1}`, author: { username: 'alice' }, created_at: '2026-10-01T00:00:00Z', system: false,
  }))))
  expect(await readGitlab(commands, target, 'gitlab/issues/3/notes/1')).toMatchObject({
    next_resource: 'gitlab/issues/3/notes/2',
  })
})

it('reads an MR with branches and its pipeline snapshot', async () => {
  const run = vi.spyOn(commands, 'run')
    .mockResolvedValueOnce(JSON.stringify({
      id: 900, iid: 9, title: 'Fix', description: 'x', state: 'opened', draft: true,
      author: { username: 'carol' }, created_at: '2026-10-01T00:00:00Z',
      web_url: 'https://git.iflytek.com/rdg-ai-cloud/aihub-site/-/merge_requests/9',
      source_branch: 'agent/fix', target_branch: 'main', sha: 'abc1234',
    }))
  expect(await readGitlab(commands, target, 'gitlab/merge_requests/9')).toMatchObject({
    head: 'agent/fix', base: 'main', draft: true, from: 'carol',
  })
  run.mockResolvedValueOnce(JSON.stringify({
    id: 900, iid: 9, title: 'Fix', description: 'x', state: 'opened',
    author: { username: 'carol' }, created_at: '2026-10-01T00:00:00Z',
    web_url: 'https://git.iflytek.com/rdg-ai-cloud/aihub-site/-/merge_requests/9',
    source_branch: 'agent/fix', target_branch: 'main', sha: 'abc1234',
  }))
  run.mockResolvedValueOnce(JSON.stringify([{ id: 1, status: 'success', sha: 'abc1234', web_url: 'https://example/pipelines/1' }]))
  run.mockResolvedValueOnce(JSON.stringify([{ name: 'build', status: 'success', stage: 'test' }]))
  expect(await readGitlab(commands, target, 'gitlab/merge_requests/9/pipelines')).toMatchObject({
    head: 'abc1234', status: 'success', jobs: [{ name: 'build', status: 'success', stage: 'test' }],
  })
})
