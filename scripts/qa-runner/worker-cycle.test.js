import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadWorkerEnvFile,
  warnMissingWorkerEnv,
  workerConfigFromEnv,
  workerRunArgs,
} from './worker-cycle.js'

const tempEnvFile = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-worker-env-'))
  const file = join(dir, 'worker.env')
  writeFileSync(file, content)

  return {
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

describe('loadWorkerEnvFile', () => {
  test('loads local worker secrets without printing or command transport', () => {
    const { file, cleanup } = tempEnvFile(
      'CODEX_HOME=/etc/vimeflow/qa-runner/codex\nOPENAI_API_KEY=sk-openai\nAWS_REGION=us-west-1\n'
    )
    const env = {}

    try {
      expect(loadWorkerEnvFile(file, env)).toEqual([
        'CODEX_HOME',
        'OPENAI_API_KEY',
        'AWS_REGION',
      ])

      expect(env).toMatchObject({
        CODEX_HOME: '/etc/vimeflow/qa-runner/codex',
        OPENAI_API_KEY: 'sk-openai',
        AWS_REGION: 'us-west-1',
      })
    } finally {
      cleanup()
    }
  })

  test('does not override explicit process environment values', () => {
    const { file, cleanup } = tempEnvFile('OPENAI_API_KEY=from-file\n')
    const env = { OPENAI_API_KEY: 'from-command' }

    try {
      expect(loadWorkerEnvFile(file, env)).toEqual([])
      expect(env.OPENAI_API_KEY).toBe('from-command')
    } finally {
      cleanup()
    }
  })

  test('trims trailing whitespace from worker env values', () => {
    const { file, cleanup } = tempEnvFile(
      'OPENAI_API_KEY="sk-test"  \r\nAWS_REGION=us-west-1  \n'
    )
    const env = {}

    try {
      expect(loadWorkerEnvFile(file, env)).toEqual([
        'OPENAI_API_KEY',
        'AWS_REGION',
      ])

      expect(env).toMatchObject({
        OPENAI_API_KEY: 'sk-test',
        AWS_REGION: 'us-west-1',
      })
    } finally {
      cleanup()
    }
  })

  test('only strips matching outer quotes', () => {
    const { file, cleanup } = tempEnvFile(
      `MATCHED="sk-test"\nMISMATCHED="sk-test'\nSPACED=" sk-test "\n`
    )
    const env = {}

    try {
      expect(loadWorkerEnvFile(file, env)).toEqual([
        'MATCHED',
        'MISMATCHED',
        'SPACED',
      ])

      expect(env).toMatchObject({
        MATCHED: 'sk-test',
        MISMATCHED: '"sk-test\'',
        SPACED: ' sk-test ',
      })
    } finally {
      cleanup()
    }
  })

  test('returns an empty list when the worker env file is absent', () => {
    expect(loadWorkerEnvFile('/tmp/vimeflow-missing-worker.env', {})).toEqual(
      []
    )
  })

  test('returns an empty list when the worker env file exists but cannot be read', () => {
    const { file, cleanup } = tempEnvFile('OPENAI_API_KEY=from-file\n')
    const env = {}
    const warnings = []

    try {
      expect(
        loadWorkerEnvFile(
          file,
          env,
          () => {
            const error = new Error('permission denied')
            error.code = 'EACCES'
            throw error
          },
          (message) => warnings.push(message)
        )
      ).toEqual([])

      expect(env).toEqual({})
      expect(warnings).toEqual([
        `warning: cannot read worker env file ${file}: EACCES\n`,
      ])
    } finally {
      cleanup()
    }
  })

  test('throws unexpected worker env file read errors', () => {
    const { file, cleanup } = tempEnvFile('OPENAI_API_KEY=from-file\n')

    try {
      expect(() =>
        loadWorkerEnvFile(file, {}, () => {
          throw new Error('unexpected read failure')
        })
      ).toThrow('unexpected read failure')
    } finally {
      cleanup()
    }
  })
})

describe('warnMissingWorkerEnv', () => {
  test('warns when Codex auth context is unset after loading worker env', () => {
    const warnings = []

    warnMissingWorkerEnv({}, (message) => warnings.push(message))

    expect(warnings).toEqual([
      'warning: worker env did not provide CODEX_HOME or CODEX_API_KEY; codex exec auth may fail\n',
    ])
  })

  test('warns when worker env loaded keys but not Codex auth context', () => {
    const warnings = []

    warnMissingWorkerEnv(
      { AWS_REGION: 'us-west-1', OPENAI_API_KEY: 'from-env' },
      (message) => warnings.push(message)
    )

    expect(warnings).toEqual([
      'warning: worker env did not provide CODEX_HOME or CODEX_API_KEY; codex exec auth may fail\n',
    ])
  })

  test('does not warn when CODEX_HOME is already present', () => {
    const warnings = []

    warnMissingWorkerEnv(
      { CODEX_HOME: '/etc/vimeflow/qa-runner/codex' },
      (message) => warnings.push(message)
    )

    expect(warnings).toEqual([])
  })

  test('does not warn when CODEX_API_KEY is explicitly scoped to this process', () => {
    const warnings = []

    warnMissingWorkerEnv({ CODEX_API_KEY: 'from-env' }, (message) =>
      warnings.push(message)
    )

    expect(warnings).toEqual([])
  })
})

describe('workerConfigFromEnv', () => {
  test('maps daemon cycle environment into worker config', () => {
    expect(
      workerConfigFromEnv({
        QA_LABEL: 'auto-review',
        QA_APPROVE: '1',
        QA_LINEAR_DECISION_COMMENTS: '1',
        QA_LINEAR_CREATE_ISSUES: '0',
        QA_LINEAR_TEAM_KEY: 'VIM',
        QA_MAX_CI_RERUNS: '3',
        QA_REASON: 'ci:check_run',
      })
    ).toEqual({
      label: 'auto-review',
      approve: false,
      linearDecisionComments: true,
      linearCreateIssues: false,
      linearTeamKey: 'VIM',
      maxCiReruns: '3',
      reason: 'ci:check_run',
    })
  })
})

describe('workerRunArgs', () => {
  test('builds the expected fixer-only run.js command', () => {
    expect(
      workerRunArgs({
        QA_PR: '348',
        QA_LABEL: 'auto-review',
        QA_APPROVE: '1',
        QA_LINEAR_DECISION_COMMENTS: '1',
        QA_LINEAR_CREATE_ISSUES: '1',
        QA_LINEAR_TEAM_KEY: 'VIM',
        QA_MAX_CI_RERUNS: '3',
        QA_REASON: 'poll',
      })
    ).toEqual([
      expect.stringContaining('scripts/qa-runner/run.js'),
      '348',
      '--push',
    ])
  })

  test('never passes approval flags to the worker fixer', () => {
    expect(
      workerRunArgs({
        QA_PR: '348',
        QA_APPROVE: '1',
      })
    ).not.toContain('--approve')
  })

  test('requires the PR number', () => {
    expect(() => workerRunArgs({})).toThrow('QA_PR is required')
  })
})
