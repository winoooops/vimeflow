import { describe, expect, test } from 'vitest'
import {
  codexExecArgs,
  codexInvocation,
  DEFAULT_LOCAL_CI_COMMAND,
  fixerTimeoutMs,
  gitCredentialHelperCommand,
  gitPushCiWrapperScript,
  kimiInvocation,
  kimiModelArgs,
  localCiCommand,
  normalizeFixerEngine,
  staleDeterministicCiPreflight,
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

  test('builds a file-backed GitHub credential helper command', () => {
    expect(
      gitCredentialHelperCommand({
        helperPath: '/repo/scripts/qa-runner/lib/git-credential-helper.js',
        botEnvPath: "/repo/scripts/qa-runner/bot's.env",
      })
    ).toBe(
      "!node '/repo/scripts/qa-runner/lib/git-credential-helper.js' '/repo/scripts/qa-runner/bot'\\''s.env' 'GH_BOT'"
    )
  })
})

describe('local CI push gate', () => {
  test('defaults to the local CI Checks workflow commands', () => {
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('npm ci')
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('npm run lint')
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('npm run format:check')
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('npm run type-check')
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('npm test')
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('cargo test')
    expect(DEFAULT_LOCAL_CI_COMMAND).toContain('npm run generate:bindings')
  })

  test('allows the worker CI command to be overridden', () => {
    expect(localCiCommand({ QA_LOCAL_CI_COMMAND: 'npm test' })).toBe(
      'npm test'
    )
  })

  test('wraps git push with local CI even when push uses --no-verify', () => {
    const script = gitPushCiWrapperScript({
      realGit: '/usr/bin/git',
      ciCommand: 'npm test',
    })

    expect(script).toContain('if [ "$arg" = "push" ]')
    expect(script).toContain('bash -lc "$ci_cmd"')
    expect(script).toContain('exec "$real_git" "$@"')
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
    expect(prompt).toContain('worker enforces local CI')
    expect(prompt).not.toContain('/skill:upsource-review')
  })
})

describe('fixer timeout', () => {
  test('defaults to 90 minutes', () => {
    expect(fixerTimeoutMs({})).toBe(90 * 60 * 1000)
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

describe('deterministic CI preflight', () => {
  const context = { kind: 'deterministic_ci_failure' }

  test('runs when current non-review CI is still failing', () => {
    expect(
      staleDeterministicCiPreflight(context, [
        { name: 'Code Quality Check', bucket: 'fail', workflow: 'CI Checks' },
      ])
    ).toEqual({ stale: false })
  })

  test('skips stale deterministic CI dispatches once CI is green', () => {
    expect(
      staleDeterministicCiPreflight(context, [
        { name: 'Unit Tests', bucket: 'pass', workflow: 'CI Checks' },
        { name: 'Claude Code Review', bucket: 'pending', workflow: 'Claude' },
      ])
    ).toMatchObject({ stale: true })
  })

  test('does not skip review adjudication fix cycles', () => {
    expect(
      staleDeterministicCiPreflight(
        { kind: 'review_adjudication' },
        [{ name: 'Unit Tests', bucket: 'pass', workflow: 'CI Checks' }]
      )
    ).toEqual({ stale: false })
  })
})
