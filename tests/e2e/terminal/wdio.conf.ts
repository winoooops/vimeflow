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
    // See tests/e2e/core/wdio.conf.ts onPrepare for the rationale:
    // skip agent detection in this suite so real claude processes on
    // the dev host don't destabilise unrelated terminal specs. See #71.
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

  waitforTimeout: 20_000,
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
}
