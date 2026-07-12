import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appArgs,
  appEntryPoint,
  cleanupUserDataDirs,
  injectFreshUserDataDir,
  repoRoot,
} from '../shared/electron-app.js'
import {
  AGENT_RESUME_SPEC_FILE,
  installAgentResumeFixture,
} from './agent-resume-fixture.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.resolve(
  process.env.RUNNER_TEMP ?? path.resolve(__dirname, '..', '.wdio-cache'),
  'terminal'
)
const originalFixtureEnv = {
  path: process.env.PATH,
  shell: process.env.SHELL,
  agentLog: process.env.VIMEFLOW_E2E_AGENT_LOG,
  followUpLog: process.env.VIMEFLOW_E2E_AGENT_FOLLOW_UP_LOG,
}

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key]

    return
  }

  process.env[key] = value
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  logLevel: 'warn',
  reporters: ['spec'],
  cacheDir,

  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  tsConfigPath: path.resolve(__dirname, '../tsconfig.json'),

  services: ['electron'],

  onPrepare: () => {
    // See tests/e2e/core/wdio.conf.ts onPrepare for the rationale:
    // skip agent detection in this suite so real claude processes on
    // the dev host don't destabilise unrelated terminal specs. See #71.
    process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
  },

  // Per-spec app-data isolation — see core/wdio.conf.ts beforeSession.
  beforeSession: (_config, capabilities, specs) => {
    const userDataDir = injectFreshUserDataDir(
      capabilities as WebdriverIO.Capabilities
    )
    if (!specs.some((spec) => path.basename(spec) === AGENT_RESUME_SPEC_FILE)) {
      return
    }

    const fixture = installAgentResumeFixture(userDataDir, repoRoot)

    process.env.PATH = `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`
    process.env.SHELL = '/bin/bash'
    process.env.VIMEFLOW_E2E_AGENT_LOG = fixture.logPath
    process.env.VIMEFLOW_E2E_AGENT_FOLLOW_UP_LOG = fixture.followUpLogPath
  },
  afterSession: () => {
    cleanupUserDataDirs()
    restoreEnv('PATH', originalFixtureEnv.path)
    restoreEnv('SHELL', originalFixtureEnv.shell)
    restoreEnv('VIMEFLOW_E2E_AGENT_LOG', originalFixtureEnv.agentLog)
    restoreEnv(
      'VIMEFLOW_E2E_AGENT_FOLLOW_UP_LOG',
      originalFixtureEnv.followUpLog
    )
  },

  capabilities: [
    {
      browserName: 'electron',
      'wdio:maxInstances': 1,
      'wdio:electronServiceOptions': {
        appEntryPoint,
        appArgs,
      },
    },
  ],

  waitforTimeout: 20_000,
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
}
