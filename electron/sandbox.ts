export const VIMEFLOW_NO_SANDBOX_ENV = 'VIMEFLOW_NO_SANDBOX'

type Env = Readonly<Record<string, string | undefined>>

export const isElectronNoSandboxRequested = (env: Env = process.env): boolean =>
  env[VIMEFLOW_NO_SANDBOX_ENV] === '1'

export const electronStartupArgs = (env: Env = process.env): string[] => [
  '.',
  ...(isElectronNoSandboxRequested(env) ? ['--no-sandbox'] : []),
]
