export const VIMEFLOW_NO_SANDBOX_ENV = 'VIMEFLOW_NO_SANDBOX'

// Run the dev build on an isolated userData dir so it never shares the default
// `vibm` dir with an installed production app (which holds the Local Storage
// lock). Off by default; opt in via the env var.
export const VIMEFLOW_USER_DATA_DIR_ENV = 'VIMEFLOW_USER_DATA_DIR'

type Env = Readonly<Record<string, string | undefined>>

export const isElectronNoSandboxRequested = (env: Env = process.env): boolean =>
  env[VIMEFLOW_NO_SANDBOX_ENV] === '1'

export const electronStartupArgs = (env: Env = process.env): string[] => [
  '.',
  ...(isElectronNoSandboxRequested(env) ? ['--no-sandbox'] : []),
  ...(env[VIMEFLOW_USER_DATA_DIR_ENV]
    ? [`--user-data-dir=${env[VIMEFLOW_USER_DATA_DIR_ENV]}`]
    : []),
]
