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
    // Silence the host-global agent detector for this suite. See #71:
    // on a dev box with real Claude Code processes running, the
    // detector latches onto them and can crash the webview during
    // startup, producing "invalid session id" failures that look
    // unrelated to this core spec's assertions.
    process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
    await startTauriDriver()
  },
  onComplete: () => {
    stopTauriDriver()
  },

  capabilities: [
    {
      browserName: 'wry',
      // Force classic WebDriver: WDIO 9 otherwise injects webSocketUrl: true and
      // unhandledPromptBehavior: "ignore" (both unsupported by WebKitWebDriver).
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': {
        application: appBinary,
      },
    },
  ],

  waitforTimeout: 10_000,
  mochaOpts: { ui: 'bdd', timeout: 30_000 },
}
