import { describe, expect, test } from 'vitest'
import { buildGitDiffArgs, extractHunkPatch } from './gitPatch'

const diffText = [
  'diff --git a/src/App.tsx b/src/App.tsx',
  'index 1111111..2222222 100644',
  '--- a/src/App.tsx',
  '+++ b/src/App.tsx',
  '@@ -1,2 +1,2 @@',
  ' old line',
  '-removed first',
  '+added first',
  '@@ -10,2 +10,2 @@',
  ' context',
  '-removed second',
  '+added second',
  '',
].join('\n')

describe('buildGitDiffArgs', () => {
  test('uses working tree diff by default so displayed hunks match hunk mutations', () => {
    expect(
      buildGitDiffArgs({ safePath: 'src/App.tsx', staged: false })
    ).toEqual(['--', 'src/App.tsx'])
  })

  test('uses cached diff for staged file rows', () => {
    expect(buildGitDiffArgs({ safePath: 'src/App.tsx', staged: true })).toEqual(
      ['--cached', '--', 'src/App.tsx']
    )
  })

  test('supports explicit base branch comparison mode', () => {
    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: false,
        baseBranch: 'main',
      })
    ).toEqual(['main', '--', 'src/App.tsx'])
  })

  test('does not treat unsafe base branch values as git options', () => {
    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: false,
        baseBranch: '--cached',
      })
    ).toEqual(['--', 'src/App.tsx'])
  })

  test('rejects git range syntax in base branch (..)', () => {
    // `main..HEAD` is a two-dot range diff (commits reachable from HEAD
    // but not main), not a simple branch comparison; allowing it would
    // misrepresent the displayed hunks. Falling back to the no-base
    // working-tree path is the safe behavior.
    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: false,
        baseBranch: 'main..HEAD',
      })
    ).toEqual(['--', 'src/App.tsx'])
  })

  test('rejects symmetric difference (...) in base branch', () => {
    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: false,
        baseBranch: 'main...HEAD',
      })
    ).toEqual(['--', 'src/App.tsx'])
  })

  test('accepts slash-separated ref paths and SHA-shaped values', () => {
    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: false,
        baseBranch: 'feature/diff-cleanup',
      })
    ).toEqual(['feature/diff-cleanup', '--', 'src/App.tsx'])

    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: false,
        baseBranch: 'abc1234',
      })
    ).toEqual(['abc1234', '--', 'src/App.tsx'])
  })

  test('staged: true takes precedence over baseBranch (no merge of the two)', () => {
    // Pinning test for the priority order. `--cached` and a base
    // branch comparison are mutually exclusive call shapes; the
    // implementation returns the staged form unconditionally when
    // staged is true. A future change that tried to combine them
    // would have to update this test.
    expect(
      buildGitDiffArgs({
        safePath: 'src/App.tsx',
        staged: true,
        baseBranch: 'main',
      })
    ).toEqual(['--cached', '--', 'src/App.tsx'])
  })
})

describe('extractHunkPatch', () => {
  test('extracts the requested hunk with the file header', () => {
    const patch = extractHunkPatch(diffText, 1)

    expect(patch).toContain('diff --git a/src/App.tsx b/src/App.tsx')
    expect(patch).toContain('@@ -10,2 +10,2 @@')
    expect(patch).toContain('+added second')
    expect(patch).not.toContain('@@ -1,2 +1,2 @@')
    expect(patch).not.toContain('+added first')
  })

  test('returns null for stale or invalid hunk indexes', () => {
    expect(extractHunkPatch(diffText, 2)).toBeNull()
    expect(extractHunkPatch(diffText, -1)).toBeNull()
    expect(extractHunkPatch(diffText, 0.5)).toBeNull()
    expect(extractHunkPatch(diffText, '0')).toBeNull()
    expect(extractHunkPatch('', 0)).toBeNull()
  })
})
