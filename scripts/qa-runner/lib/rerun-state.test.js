import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  markRerunAttempt,
  readRerunStore,
  rerunKey,
  rerunStatus,
} from './rerun-state.js'

const tempRoots = []

const makeStore = () => {
  const root = mkdtempSync(join(tmpdir(), 'rerun-state-'))
  tempRoots.push(root)

  return join(root, 'reruns.json')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('rerun state', () => {
  test('tracks reruns by PR, head SHA, and check identity', () => {
    const file = makeStore()

    const key = rerunKey({
      pr: 330,
      headSha: 'abc',
      check: {
        name: 'Claude Code Review',
        workflow: 'Claude PR Review',
        link: 'https://github.com/winoooops/vimeflow/actions/runs/123',
      },
    })

    const empty = readRerunStore(file)
    expect(rerunStatus({ store: empty, key, max: 3 })).toEqual({
      count: 0,
      nextAttempt: 1,
      exhausted: false,
    })

    markRerunAttempt(empty, key, file, () => '2026-06-02T00:00:00.000Z')
    const once = readRerunStore(file)

    expect(rerunStatus({ store: once, key, max: 1 })).toEqual({
      count: 1,
      nextAttempt: 2,
      exhausted: true,
    })
  })
})
