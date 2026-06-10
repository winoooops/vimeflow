// Structured, namespaced console logger.
//
// Centralizes the single `no-console` escape hatch so feature code stays
// lint-clean and every line is searchable by its `[vimeflow:<namespace>]`
// prefix in the Chrome devtools console. Use this instead of scattering
// `// eslint-disable-next-line no-console` across the codebase.
//
// `info` is for observability breadcrumbs (e.g. the session-restore
// lifecycle); `warn` / `error` mirror the existing failure-path usage.

export interface Logger {
  info: (message: string, ...context: unknown[]) => void
  warn: (message: string, ...context: unknown[]) => void
  error: (message: string, ...context: unknown[]) => void
}

export const createLogger = (namespace: string): Logger => {
  const prefix = `[vimeflow:${namespace}]`

  return {
    info: (message, ...context): void => {
      // eslint-disable-next-line no-console
      console.info(`${prefix} ${message}`, ...context)
    },
    warn: (message, ...context): void => {
      // eslint-disable-next-line no-console
      console.warn(`${prefix} ${message}`, ...context)
    },
    error: (message, ...context): void => {
      // eslint-disable-next-line no-console
      console.error(`${prefix} ${message}`, ...context)
    },
  }
}
