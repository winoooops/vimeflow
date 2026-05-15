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
    // Agent suite wants detection enabled: explicitly clear the env
    // var in case it leaks in from the shell or a prior WDIO run. The
    // spec itself has a skip-guard for pre-existing host claude
    // processes (see agent-detect-fake.spec.ts and #71).
    delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION
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

  // Agent detection polls every ~2s; give it room.
  waitforTimeout: 30_000,
  mochaOpts: { ui: 'bdd', timeout: 90_000 },
}
