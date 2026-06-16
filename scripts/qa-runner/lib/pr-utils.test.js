import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  backfillPrRef,
  linkedVim,
  linkedVimForPr,
  readLinkedIssueCacheRecord,
  writeLinkedIssueCache,
} from './pr-utils.js'

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

  test('prefers explicit refs over incidental body mentions', () => {
    expect(
      linkedVim(
        [
          'Cloud smoke against PR #353 passed:',
          '',
          'GOOD_SHAPE #353 feat/browser-pane (VIM-56)',
          '',
          'Refs VIM-70',
        ].join('\n'),
        'feature/vim-70-control-owned-merge'
      )
    ).toBe('VIM-70')
  })

  test('prefers branch issue over generic body mentions', () => {
    expect(
      linkedVim(
        'Follow-up from an older smoke test on VIM-56.',
        'feature/vim-70-linear-env-split'
      )
    ).toBe('VIM-70')
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

  test('reads cached issue metadata for follow-up GitHub comments', () => {
    const file = makeStore()
    writeLinkedIssueCache(
      330,
      {
        identifier: 'VIM-43',
        url: 'https://linear.app/vimeflow/issue/VIM-43/test',
      },
      file
    )

    expect(readLinkedIssueCacheRecord(330, file)).toEqual({
      identifier: 'VIM-43',
      url: 'https://linear.app/vimeflow/issue/VIM-43/test',
    })
  })
})

describe('backfillPrRef', () => {
  const repo = { owner: 'example', name: 'repo', pr: 325 }

  // gh GET (no --method) returns the LIVE PR JSON; PATCH calls are recorded.
  const ghWithLiveBody = (liveBody, calls) => (args) => {
    calls.push(args)

    return args.includes('--method') ? '' : JSON.stringify({ body: liveBody })
  }

  test('re-reads the live body and appends "Refs VIM-N" when absent', () => {
    const calls = []

    const result = backfillPrRef(
      { ...repo, identifier: 'VIM-52' },
      { gh: ghWithLiveBody('Original body.', calls) }
    )

    expect(result.changed).toBe(true)
    expect(calls).toEqual([
      ['api', 'repos/example/repo/pulls/325'],
      [
        'api',
        '--method',
        'PATCH',
        'repos/example/repo/pulls/325',
        '-f',
        'body=Original body.\n\nRefs VIM-52',
      ],
    ])
  })

  test('no-ops without patching when the live body already has the id', () => {
    const calls = []

    const result = backfillPrRef(
      { ...repo, identifier: 'VIM-52' },
      { gh: ghWithLiveBody('Some description.\n\nRefs VIM-52', calls) }
    )

    expect(result.changed).toBe(false)
    expect(calls).toEqual([['api', 'repos/example/repo/pulls/325']])
  })

  test('uses the bare ref when the live body is empty', () => {
    const calls = []
    backfillPrRef(
      { ...repo, identifier: 'VIM-52' },
      { gh: ghWithLiveBody('', calls) }
    )

    const patch = calls.find((a) => a.includes('--method'))
    expect(patch[patch.indexOf('-f') + 1]).toBe('body=Refs VIM-52')
  })
})
