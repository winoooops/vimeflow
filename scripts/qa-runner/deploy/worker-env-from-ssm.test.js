// cspell:ignore pipefail esac
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SCRIPT = join(
  process.cwd(),
  'scripts/qa-runner/deploy/worker-env-from-ssm.sh'
)

const writeExecutable = (path, content) => {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

const createFakeCommands = (binDir) => {
  writeExecutable(
    join(binDir, 'aws'),
    `#!/usr/bin/env bash
set -euo pipefail
name=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      shift
      name="$1"
      ;;
  esac
  shift || true
done
key="\${name##*/}"
case "$key" in
  GH_BOT_TOKEN)
    printf "%s" "fixture-gh-token"
    ;;
  GH_BOT_USER)
    printf "%s" "curious-falcon"
    ;;
  GH_BOT_EMAIL)
    printf "%s" "curious-falcon@example.test"
    ;;
  LINEAR_CLIENT_ID)
    printf "%s" "linear-client"
    ;;
  LINEAR_CLIENT_SECRET)
    printf "%s" "fixture-linear-credential"
    ;;
  CODEX_API_KEY)
    if [ -n "\${FAKE_CODEX_API_KEY:-}" ]; then
      printf "%s" "$FAKE_CODEX_API_KEY"
    else
      echo "ParameterNotFound: $name" >&2
      exit 254
    fi
    ;;
  QA_WORKER_CODEX_AUTH_MODE)
    if [ -n "\${FAKE_QA_WORKER_CODEX_AUTH_MODE:-}" ]; then
      printf "%s" "$FAKE_QA_WORKER_CODEX_AUTH_MODE"
    else
      echo "ParameterNotFound: $name" >&2
      exit 254
    fi
    ;;
  QA_WORKER_CODEX_HOME|CODEX_HOME)
    if [ -n "\${FAKE_QA_WORKER_CODEX_HOME:-}" ]; then
      printf "%s" "$FAKE_QA_WORKER_CODEX_HOME"
    else
      echo "ParameterNotFound: $name" >&2
      exit 254
    fi
    ;;
  openai-api-key)
    printf "%s" "fixture-openai-value"
    ;;
  KIMI-API-KEY|KIMI_API_KEY)
    printf "%s" "fixture-kimi-value"
    ;;
  KIMI_MODEL_NAME)
    printf "%s" "kimi-for-coding"
    ;;
  KIMI_MODEL_PROVIDER_TYPE)
    printf "%s" "kimi"
    ;;
  KIMI_MODEL_BASE_URL|KIMI_BASE_URL)
    printf "%s" "https://kimi.example.test/coding/v1"
    ;;
  KIMI_MODEL_CAPABILITIES)
    printf "%s" "image_in,thinking"
    ;;
  QA_LIFELINE_SKILLS_DIR)
    printf "%s" "/opt/vimeflow/lifeline/skills"
    ;;
  *)
    echo "ParameterNotFound: $name" >&2
    exit 254
    ;;
esac
`
  )

  writeExecutable(
    join(binDir, 'codex'),
    `#!/usr/bin/env bash
set -euo pipefail
{
  printf "CODEX_HOME=%s\\n" "\${CODEX_HOME:-}"
  printf "ARGS=%s\\n" "$*"
} >>"$CODEX_FAKE_LOG"
cat >/dev/null
`
  )
}

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-worker-bootstrap-'))
  const binDir = join(root, 'bin')
  const repo = join(root, 'repo')
  const etcDir = join(root, 'etc')
  const codexLog = join(root, 'codex.log')

  mkdirSync(binDir)
  createFakeCommands(binDir)

  return {
    binDir,
    codexLog,
    etcDir,
    repo,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const runBootstrap = (harness, env = {}) => {
  execFileSync('bash', [SCRIPT], {
    env: {
      ...process.env,
      AWS_REGION: 'us-west-1',
      CODEX_FAKE_LOG: harness.codexLog,
      PATH: `${harness.binDir}:${process.env.PATH}`,
      QA_ETC_DIR: harness.etcDir,
      QA_REPO: harness.repo,
      QA_WORKER_PARAM_PREFIX: '/test/worker',
      ...env,
    },
    stdio: 'pipe',
  })
}

const readWorkerEnv = (harness) =>
  readFileSync(join(harness.etcDir, 'worker.env'), 'utf8')

describe('worker-env-from-ssm.sh', () => {
  test('uses mounted Codex auth without fetching or logging in with API key', () => {
    const harness = createHarness()
    const codexHome = join(harness.root, 'codex-auth')

    try {
      mkdirSync(codexHome)
      writeFileSync(join(codexHome, 'auth.json'), '{"mode":"browser"}\n')

      runBootstrap(harness, {
        QA_WORKER_CODEX_AUTH_MODE: 'existing',
        QA_WORKER_CODEX_HOME: codexHome,
      })

      expect(readWorkerEnv(harness)).toContain(`CODEX_HOME=${codexHome}\n`)
      expect(readWorkerEnv(harness)).toContain(
        'QA_WORKER_CODEX_AUTH_MODE=existing\n'
      )
      expect(existsSync(harness.codexLog)).toBe(false)
    } finally {
      harness.cleanup()
    }
  })

  test('reads mounted Codex auth settings from worker SSM parameters', () => {
    const harness = createHarness()
    const codexHome = join(harness.root, 'ssm-codex-auth')

    try {
      mkdirSync(codexHome)
      writeFileSync(join(codexHome, 'auth.json'), '{"mode":"browser"}\n')

      runBootstrap(harness, {
        FAKE_QA_WORKER_CODEX_AUTH_MODE: 'existing',
        FAKE_QA_WORKER_CODEX_HOME: codexHome,
      })

      expect(readWorkerEnv(harness)).toContain(`CODEX_HOME=${codexHome}\n`)
      expect(readWorkerEnv(harness)).toContain(
        'QA_WORKER_CODEX_AUTH_MODE=existing\n'
      )
      expect(existsSync(harness.codexLog)).toBe(false)
    } finally {
      harness.cleanup()
    }
  })

  test('keeps API-key login available when explicitly configured', () => {
    const harness = createHarness()
    const expectedCodexHome = join(harness.etcDir, 'codex')

    try {
      runBootstrap(harness, {
        FAKE_CODEX_API_KEY: 'fixture-codex-value',
        QA_WORKER_CODEX_AUTH_MODE: 'api-key',
      })

      expect(readWorkerEnv(harness)).toContain(
        `CODEX_HOME=${expectedCodexHome}\n`
      )

      expect(readWorkerEnv(harness)).toContain(
        'QA_WORKER_CODEX_AUTH_MODE=api-key\n'
      )

      expect(readFileSync(harness.codexLog, 'utf8')).toContain(
        `CODEX_HOME=${expectedCodexHome}\nARGS=login --with-api-key\n`
      )
    } finally {
      harness.cleanup()
    }
  })
})
