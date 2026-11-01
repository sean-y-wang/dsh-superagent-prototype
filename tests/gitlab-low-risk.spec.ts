import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

describe('gitlab low-risk merge selftest', () => {
  it('passes offline heuristics', () => {
    const out = execFileSync('python3', [path.join(root, 'scripts/gitlab-low-risk-merge-selftest.py')], {
      encoding: 'utf8',
    })
    expect(out).toContain('PASS')
  })
})
