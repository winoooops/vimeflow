import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appArgs, appEntryPoint } from '../shared/electron-app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],

  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  tsConfigPath: path.resolve(__dirname, '../tsconfig.json'),

  services: ['electron'],

  onPrepare: () => {
    // Silence the host-global agent detector for this suite. See #71:
    // on a dev box with real Claude Code processes running, the host
    // detector can latch onto them and crash the webview during
    // startup, producing "invalid session id" failures that look
    // unrelated to this core spec's assertions.
    process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
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

  waitforTimeout: 10_000,
  mochaOpts: { ui: 'bdd', timeout: 30_000 },
}
