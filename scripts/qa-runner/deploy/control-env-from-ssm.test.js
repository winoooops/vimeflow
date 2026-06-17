// cspell:ignore esac pipefail
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
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
  'scripts/qa-runner/deploy/control-env-from-ssm.sh'
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
  GITHUB_WEBHOOK_SECRET)
    printf "%s" "fixture-webhook-secret"
    ;;
  QA_STATUS_TOKEN)
    printf "%s" "fixture-status-token"
    ;;
  GH_ORCH_TOKEN)
    printf "%s" "fixture-gh-token"
    ;;
  GH_ORCH_USER)
    printf "%s" "orchestrator-bot"
    ;;
  GH_ORCH_EMAIL)
    printf "%s" "orchestrator@example.test"
    ;;
  LINEAR_CLIENT_ID)
    printf "%s" "linear-client"
    ;;
  LINEAR_CLIENT_SECRET)
    printf "%s" "linear-secret"
    ;;
  QA_MAX_PARALLEL)
    printf "%s" "6"
    ;;
  QA_WORKER_INSTANCE_IDS)
    printf "%s" "i-one,i-two,i-three"
    ;;
  QA_WORKER_CAPACITY_PER_INSTANCE)
    printf "%s" "2"
    ;;
  QA_WORKER_LEASE_WAIT_SECONDS)
    printf "%s" "120"
    ;;
  QA_WORKER_LEASE_STALE_SECONDS)
    printf "%s" "0"
    ;;
  QA_WORKER_TIMEOUT_SECONDS)
    printf "%s" "5400"
    ;;
  QA_WORKER_REFRESH_RUNNER)
    printf "%s" "1"
    ;;
  QA_WORKER_REF)
    printf "%s" "wip/linear-wiring"
    ;;
  QA_WORKER_BURST)
    printf "%s" "1"
    ;;
  QA_WORKER_STOP_AFTER_RUN)
    printf "%s" "1"
    ;;
  QA_WORKER_READY_TIMEOUT_SECONDS)
    printf "%s" "900"
    ;;
  QA_WORKER_IDLE_STOP_SECONDS)
    printf "%s" "2100"
    ;;
  QA_WORKER_MIN_FREE_PERCENT)
    printf "%s" "15"
    ;;
  *)
    echo "ParameterNotFound: $name" >&2
    exit 254
    ;;
esac
`
  )

  writeExecutable(
    join(binDir, 'install'),
    `#!/usr/bin/env bash
set -euo pipefail
mode=""
paths=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d)
      ;;
    -m)
      shift
      mode="$1"
      ;;
    -o|-g)
      shift
      ;;
    *)
      paths+=("$1")
      ;;
  esac
  shift || true
done
for path in "\${paths[@]}"; do
  mkdir -p "$path"
  if [ -n "$mode" ]; then
    chmod "$mode" "$path"
  fi
done
`
  )

  writeExecutable(
    join(binDir, 'chown'),
    `#!/usr/bin/env bash
exit 0
`
  )
}

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-control-bootstrap-'))
  const binDir = join(root, 'bin')
  const repo = join(root, 'repo')
  const etcDir = join(root, 'etc')

  mkdirSync(binDir)
  createFakeCommands(binDir)

  return {
    binDir,
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
      PATH: `${harness.binDir}:${process.env.PATH}`,
      QA_CONTROL_PARAM_PREFIX: '/test/control',
      QA_ETC_DIR: harness.etcDir,
      QA_REPO: harness.repo,
      QA_REQUIRE_CONTROL_CODEX_AUTH: '0',
      ...env,
    },
    stdio: 'pipe',
  })
}

const readControlEnv = (harness) =>
  readFileSync(join(harness.etcDir, 'control.env'), 'utf8')

describe('control-env-from-ssm.sh', () => {
  test('writes SSM-backed worker fleet capacity knobs', () => {
    const harness = createHarness()

    try {
      runBootstrap(harness)

      expect(readControlEnv(harness)).toContain('QA_MAX_PARALLEL=6\n')
      expect(readControlEnv(harness)).toContain(
        'QA_WORKER_INSTANCE_IDS=i-one,i-two,i-three\n'
      )

      expect(readControlEnv(harness)).toContain(
        'QA_WORKER_CAPACITY_PER_INSTANCE=2\n'
      )

      expect(readControlEnv(harness)).toContain(
        'QA_WORKER_LEASE_WAIT_SECONDS=120\n'
      )

      expect(readControlEnv(harness)).toContain(
        'QA_WORKER_LEASE_STALE_SECONDS=0\n'
      )
      expect(readControlEnv(harness)).not.toContain('QA_WORKER_INSTANCE_ID=')
    } finally {
      harness.cleanup()
    }
  })
})
