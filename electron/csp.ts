import { randomBytes } from 'node:crypto'

export const DEV_REACT_REFRESH_NONCE_ENV = 'VIMEFLOW_DEV_REACT_REFRESH_NONCE'

const localhostHttpSources = ['http://localhost:*', 'http://127.0.0.1:*']
const localhostWebSocketSources = ['ws://localhost:*', 'ws://127.0.0.1:*']

// Specific image CDNs the markdown reading view is allowed to load — shields.io
// badges and GitHub-hosted images (raw content, the image proxy, and user
// uploads all sit under *.githubusercontent.com). Deliberately NOT a bare
// `https:` wildcard: an
// untrusted local .md must not be able to beacon to an arbitrary host via an
// <img> sub-resource (which the navigation guard cannot intercept). Broader
// image support (local files, an explicit remote policy) is a planned follow-up.
const imageCdnSources = [
  'https://img.shields.io',
  'https://*.githubusercontent.com',
]

const directive = (name: string, sources: string[]): string =>
  `${name} ${sources.join(' ')}`

export const packagedContentSecurityPolicy = [
  directive('default-src', ["'self'"]),
  directive('script-src', ["'self'"]),
  directive('style-src', ["'self'", "'unsafe-inline'"]),
  directive('img-src', ["'self'", 'data:', 'blob:', ...imageCdnSources]),
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

// The reading view's allowed image CDNs (see `imageCdnSources`) plus the dev
// server origins; the rest of the policy stays tight.
const devAssetSources = [
  "'self'",
  'data:',
  'blob:',
  ...imageCdnSources,
  ...localhostHttpSources,
]
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
  /<script\b((?=[^>]*\btype\s*=\s*["']module["'])(?![^>]*\bnonce\s*=)[^>]*)>(?=\s*import\s+(?:[\s\S]*?\s+from\s+)?["'][^"']*@react-refresh["'];)/

export const addDevReactRefreshNonce = (
  html: string,
  nonce: string
): string => {
  const safeNonce = validateDevReactRefreshNonce(nonce)

  const transformed = html.replace(
    reactRefreshPreamblePattern,
    (_match, attributes: string) => `<script${attributes} nonce="${safeNonce}">`
  )

  if (transformed === html && html.includes('@react-refresh')) {
    // eslint-disable-next-line no-console
    console.warn(
      'Vite React Refresh preamble found, but dev CSP nonce was not injected'
    )
  }

  return transformed
}
