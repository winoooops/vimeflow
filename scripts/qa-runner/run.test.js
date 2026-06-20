import { describe, expect, test } from 'vitest'
import {
  codexExecArgs,
  codexInvocation,
  fixerTimeoutMs,
  kimiInvocation,
  kimiModelArgs,
  normalizeFixerEngine,
} from './run.js'

describe('fixer engine selection', () => {
  test('defaults to Kimi for existing deployments', () => {
    expect(normalizeFixerEngine({})).toBe('kimi')
  })

  test('normalizes the Codex engine name', () => {
    expect(normalizeFixerEngine({ QA_FIXER_ENGINE: 'Codex' })).toBe('codex')
  })

  test('rejects unsupported fixer engines', () => {
    expect(() => normalizeFixerEngine({ QA_FIXER_ENGINE: 'claude' })).toThrow(
      'unsupported QA_FIXER_ENGINE'
    )
  })
})

describe('fixer command args', () => {
  test('uses the default Kimi model unless API-mode env is present', () => {
    expect(kimiModelArgs({})).toEqual(['-m', 'kimi-code/kimi-for-coding'])
    expect(kimiModelArgs({ KIMI_MODEL_NAME: 'kimi-for-coding' })).toEqual([])
    expect(kimiModelArgs({ KIMI_MODEL: 'my-alias' })).toEqual([
      '-m',
      'my-alias',
    ])
  })

  test('runs Codex in the PR worktree with repo metadata writable', () => {
    expect(
      codexExecArgs({
        wt: '/repo/.claude/worktrees/qa-pr-348',
        repoRoot: '/repo',
        env: { QA_CODEX_MODEL: 'gpt-test' },
      })
    ).toEqual([
      'exec',
      '--sandbox',
      'workspace-write',
      '--cd',
      '/repo/.claude/worktrees/qa-pr-348',
      '--add-dir',
      '/repo',
      '--model',
      'gpt-test',
      '-',
    ])
  })
})

describe('fixer prompts', () => {
  test('keeps Kimi on the slash-skill path', () => {
    expect(kimiInvocation(348, true)).toContain('/skill:upsource-review 348')
  })

  test('instructs Codex to execute the skill directly', () => {
    const prompt = codexInvocation(348, true)

    expect(prompt).toContain('skills/upsource-review/SKILL.md')
    expect(prompt).toContain('USER_SUPPLIED_PR_NUMBER=348')
    expect(prompt).toContain('SINGLE PASS')
    expect(prompt).not.toContain('/skill:upsource-review')
  })
})

describe('fixer timeout', () => {
  test('defaults to 45 minutes', () => {
    expect(fixerTimeoutMs({})).toBe(45 * 60 * 1000)
  })

  test('allows a positive millisecond override', () => {
    expect(fixerTimeoutMs({ QA_FIXER_TIMEOUT_MS: '5400000' })).toBe(5400000)
  })

  test('rejects invalid timeout overrides', () => {
    expect(() => fixerTimeoutMs({ QA_FIXER_TIMEOUT_MS: '0' })).toThrow(
      'QA_FIXER_TIMEOUT_MS'
    )
  })
})
