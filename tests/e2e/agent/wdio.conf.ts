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
    // See tests/e2e/core/wdio.conf.ts — required on some Linux + GPU
    // combos to prevent a silent DMA-BUF-renderer webview crash.
    process.env.WEBKIT_DISABLE_DMABUF_RENDERER = '1'
    // Agent suite wants detection enabled — explicitly clear the env
    // var in case it leaks in from the shell or a prior WDIO run. The
    // spec itself has a skip-guard for pre-existing host claude
    // processes (see agent-detect-fake.spec.ts and #71).
    delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION
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

  // Agent detection polls every ~2s; give it room.
  waitforTimeout: 30_000,
  mochaOpts: { ui: 'bdd', timeout: 90_000 },
}
