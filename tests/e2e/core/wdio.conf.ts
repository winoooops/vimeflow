import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appArgs,
  appEntryPoint,
  cleanupUserDataDirs,
  injectFreshUserDataDir,
} from '../shared/electron-app.js'

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

  // Per-spec app-data isolation: each WDIO session (one per spec) gets
  // a fresh --user-data-dir, then afterSession removes it. This
  // compensates for the Tauri e2e-test Cargo feature's cache-wipe NOT
  // firing on the Electron sidecar code path; without it,
  // sessions.json from spec N would be observed by spec N+1.
  beforeSession: (_config, capabilities) => {
    // beforeSession's capabilities param is typed as the union
    // (single | multiremote | W3C); our config always supplies the
    // single-WebdriverIO.Capabilities branch, so the cast is safe.
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

  waitforTimeout: 10_000,
  mochaOpts: { ui: 'bdd', timeout: 30_000 },
}
