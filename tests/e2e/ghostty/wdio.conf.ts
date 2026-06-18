// cspell:ignore ghostty
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appArgs,
  appEntryPoint,
  cleanupUserDataDirs,
  injectFreshUserDataDir,
} from '../shared/electron-app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.resolve(
  process.env.RUNNER_TEMP ?? path.resolve(__dirname, '..', '.wdio-cache'),
  'ghostty'
)

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],
  cacheDir,

  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  tsConfigPath: path.resolve(__dirname, '../tsconfig.json'),

  services: ['electron'],

  onPrepare: () => {
    process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
    process.env.VITE_TERMINAL_RENDERER = 'ghostty'
  },

  beforeSession: (_config, capabilities) => {
    injectFreshUserDataDir(capabilities as WebdriverIO.Capabilities)
  },
  afterSession: () => {
    cleanupUserDataDirs()
  },

  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        appEntryPoint,
        appArgs,
      },
    },
  ],

  waitforTimeout: 20_000,
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
}
