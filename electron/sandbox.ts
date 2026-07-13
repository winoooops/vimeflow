export const VIMEFLOW_NO_SANDBOX_ENV = 'VIMEFLOW_NO_SANDBOX'

export const VIMEFLOW_USER_DATA_DIR_ENV = 'VIMEFLOW_USER_DATA_DIR'

type Env = Readonly<Record<string, string | undefined>>

export const isElectronNoSandboxRequested = (env: Env = process.env): boolean =>
  env[VIMEFLOW_NO_SANDBOX_ENV] === '1'

// Dev shares the prod userData dir (Electron derives it from package.json name),
// so a dev run reads/writes the same sessions, settings, and agent state as the
// installed app. Set VIMEFLOW_USER_DATA_DIR to point dev at a throwaway dir and
// get a clean env that never touches prod. HOME is left alone (fake HOME breaks
// Claude auth) — only Electron's userData is redirected.
const requestedUserDataDir = (env: Env): string | undefined => {
  const dir = env[VIMEFLOW_USER_DATA_DIR_ENV]?.trim()

  return dir !== undefined && dir.length > 0 ? dir : undefined
}

export const electronStartupArgs = (env: Env = process.env): string[] => {
  const userDataDir = requestedUserDataDir(env)

  return [
    '.',
    ...(isElectronNoSandboxRequested(env) ? ['--no-sandbox'] : []),
    ...(userDataDir !== undefined ? [`--user-data-dir=${userDataDir}`] : []),
  ]
}
