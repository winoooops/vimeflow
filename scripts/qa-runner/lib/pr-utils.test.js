import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { linkedVim, linkedVimForPr, writeLinkedIssueCache } from './pr-utils.js'

const tempRoots = []

const makeStore = () => {
  const root = mkdtempSync(join(tmpdir(), 'pr-utils-'))
  tempRoots.push(root)

  return join(root, 'linear-pr-330.json')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('linkedVim', () => {
  test('prefers closing magic words and also scans branch text', () => {
    expect(linkedVim('Related VIM-1\nCloses VIM-20')).toBe('VIM-20')
    expect(linkedVim('', 'feature/vim-21-ci-fixes')).toBe('VIM-21')
  })
})

describe('linked issue cache', () => {
  test('falls back to a cached orchestrator-created issue', () => {
    const file = makeStore()
    writeLinkedIssueCache(
      330,
      {
        identifier: 'VIM-42',
        url: 'https://linear.app/vimeflow/issue/VIM-42/test',
      },
      file
    )

    expect(
      linkedVimForPr({
        body: '',
        branch: 'feature/no-ticket',
        pr: 330,
        cacheFile: file,
      })
    ).toBe('VIM-42')
  })
})
