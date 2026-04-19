import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appBinary,
  startTauriDriver,
  stopTauriDriver,
  TAURI_DRIVER_PORT,
} from '../shared/tauri-driver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],

  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  tsConfigPath: path.resolve(__dirname, '../tsconfig.json'),

  hostname: '127.0.0.1',
  port: TAURI_DRIVER_PORT,

  onPrepare: async () => {
    // Same reason as core/wdio.conf.ts — skip agent detection in this
    // suite so real claude processes on the dev host don't destabilise
    // unrelated terminal specs. See #71.
    process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
    await startTauriDriver()
  },
  onComplete: () => {
    stopTauriDriver()
  },

  capabilities: [
    {
      browserName: 'wry',
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': {
        application: appBinary,
      },
    },
  ],

  waitforTimeout: 20_000,
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
}
