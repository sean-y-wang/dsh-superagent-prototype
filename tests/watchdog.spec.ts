import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

const script = join(process.cwd(), 'scripts/rdg-portal-watchdog.py')
const py = (args: string[], opts?: { input?: string }) =>
  execFileSync('python3', [script, ...args], { encoding: 'utf8', input: opts?.input, timeout: 15_000 })

it('passes the offline self-test', () => {
  const out = py(['--self-test'])
  expect(JSON.parse(out)).toMatchObject({ selfTest: 'passed' })
})

it('reports stalled open tickets from a local sqlite stateDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'watchdog-'))
  const dbPath = join(dir, 'orchestrator.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO ticket VALUES (?, ?)').run('t1', JSON.stringify({
    id: 't1', title: 'Stuck ticket',
    assignments: [{ createdAt: '2020-01-01T00:00:00Z', report: { state: 'blocked', summary: 'help', at: '2020-01-01T00:00:00Z' } }],
    inputs: [],
  }))
  db.prepare('INSERT INTO ticket VALUES (?, ?)').run('t2', JSON.stringify({
    id: 't2', title: 'Closed', ended: { at: '2020-01-01T00:00:00Z', by: 'human', outcome: 'stopped' },
    assignments: [], inputs: [],
  }))
  db.close()

  const report = JSON.parse(py(['--state-dir', dir, '--stale-hours', '1', '--json']))
  expect(report.ok).toBe(true)
  expect(report.count).toBe(1)
  expect(report.findings[0]).toMatchObject({ kind: 'ticket', id: 't1', title: 'Stuck ticket' })
})

it('accepts a stub GitLab list command without network', () => {
  const dir = mkdtempSync(join(tmpdir(), 'watchdog-gl-'))
  const stub = join(dir, 'list-mrs.sh')
  writeFileSync(stub, `#!/bin/sh\nprintf '%s' '[{"id":"3","title":"Old MR","updatedAt":"2020-01-01T00:00:00Z"}]'\n`)
  chmodSync(stub, 0o755)
  // Empty state-dir list not allowed alone — pass a fake empty db
  const state = join(dir, 'state')
  mkdirSync(state)
  const db = new DatabaseSync(join(state, 'orchestrator.sqlite'))
  db.exec('CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.close()

  const report = JSON.parse(py([
    '--state-dir', state,
    '--stale-hours', '1',
    '--gitlab-list-cmd', stub,
    '--json',
  ]))
  expect(report.findings.some((f: { kind: string; id: string }) => f.kind === 'gitlab_mr' && f.id === '3')).toBe(true)
})
