import { randomBytes } from 'node:crypto'

export const DEV_REACT_REFRESH_NONCE_ENV = 'VIMEFLOW_DEV_REACT_REFRESH_NONCE'

const localhostHttpSources = ['http://localhost:*', 'http://127.0.0.1:*']
const localhostWebSocketSources = ['ws://localhost:*', 'ws://127.0.0.1:*']

const directive = (name: string, sources: string[]): string =>
  `${name} ${sources.join(' ')}`

export const packagedContentSecurityPolicy = [
  directive('default-src', ["'self'"]),
  directive('script-src', ["'self'"]),
  directive('style-src', ["'self'", "'unsafe-inline'"]),
  directive('img-src', ["'self'", 'data:', 'blob:']),
  directive('font-src', ["'self'", 'data:']),
  directive('connect-src', ["'self'"]),
].join('; ')

const devBaseSources = [
  "'self'",
  ...localhostHttpSources,
  ...localhostWebSocketSources,
]

const devReactRefreshNoncePattern = /^[A-Za-z0-9_-]+$/

const validateDevReactRefreshNonce = (nonce: string): string => {
  if (!devReactRefreshNoncePattern.test(nonce)) {
    throw new Error(
      `${DEV_REACT_REFRESH_NONCE_ENV} must be a non-empty base64url value`
    )
  }

  return nonce
}

export const createDevReactRefreshNonce = (): string =>
  randomBytes(16).toString('base64url')

let fallbackDevReactRefreshNonce: string | null = null

export const getDevReactRefreshNonce = (): string => {
  const nonce = process.env[DEV_REACT_REFRESH_NONCE_ENV]

  if (nonce !== undefined && nonce.length > 0) {
    return validateDevReactRefreshNonce(nonce)
  }

  fallbackDevReactRefreshNonce ??= createDevReactRefreshNonce()

  return fallbackDevReactRefreshNonce
}

export const ensureDevReactRefreshNonce = (): string => {
  const nonce = getDevReactRefreshNonce()

  process.env[DEV_REACT_REFRESH_NONCE_ENV] = nonce

  return nonce
}

const devScriptSources = (nonce: string): string[] => [
  "'self'",
  "'unsafe-eval'",
  `'nonce-${validateDevReactRefreshNonce(nonce)}'`,
  ...localhostHttpSources,
]

// Keep E2E's inline-script relaxation separate from regular dev. Chromium
// ignores 'unsafe-inline' when a nonce is present, so this policy intentionally
// does not carry the React Refresh nonce.
const devE2eScriptSources = [
  "'self'",
  "'unsafe-eval'",
  "'unsafe-inline'",
  ...localhostHttpSources,
]

const devStyleSources = ["'self'", "'unsafe-inline'", ...localhostHttpSources]
const devAssetSources = ["'self'", 'data:', 'blob:', ...localhostHttpSources]
const devFontSources = ["'self'", 'data:', ...localhostHttpSources]

const devConnectSources = [
  "'self'",
  ...localhostHttpSources,
  ...localhostWebSocketSources,
]

const developmentPolicy = (scriptSources: string[]): string =>
  [
    directive('default-src', devBaseSources),
    directive('script-src', scriptSources),
    directive('style-src', devStyleSources),
    directive('img-src', devAssetSources),
    directive('font-src', devFontSources),
    directive('connect-src', devConnectSources),
  ].join('; ')

export const devContentSecurityPolicy = (
  nonce = getDevReactRefreshNonce()
): string => developmentPolicy(devScriptSources(nonce))

export const devE2eContentSecurityPolicy: string =
  developmentPolicy(devE2eScriptSources)

export const developmentContentSecurityPolicy = (
  isE2eRuntime: boolean,
  nonce = getDevReactRefreshNonce()
): string =>
  isE2eRuntime ? devE2eContentSecurityPolicy : devContentSecurityPolicy(nonce)

const reactRefreshPreamblePattern =
  /<script type="module">(?=\s*import\s+(?:[\s\S]*?\s+from\s+)?["'][^"']*@react-refresh["'];)/

export const addDevReactRefreshNonce = (
  html: string,
  nonce: string
): string => {
  const safeNonce = validateDevReactRefreshNonce(nonce)

  const transformed = html.replace(
    reactRefreshPreamblePattern,
    `<script type="module" nonce="${safeNonce}">`
  )

  if (transformed === html && html.includes('@react-refresh')) {
    // eslint-disable-next-line no-console
    console.warn(
      'Vite React Refresh preamble found, but dev CSP nonce was not injected'
    )
  }

  return transformed
}
