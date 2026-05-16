export const DEV_REACT_REFRESH_NONCE = 'vimeflow-dev-react-refresh'

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

const devScriptSources = [
  "'self'",
  "'unsafe-eval'",
  `'nonce-${DEV_REACT_REFRESH_NONCE}'`,
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

export const devContentSecurityPolicy = developmentPolicy(devScriptSources)

export const devE2eContentSecurityPolicy =
  developmentPolicy(devE2eScriptSources)

export const developmentContentSecurityPolicy = (
  isE2eRuntime: boolean
): string =>
  isE2eRuntime ? devE2eContentSecurityPolicy : devContentSecurityPolicy

const reactRefreshPreamblePattern =
  /<script type="module">(\s*import\s+\{\s*injectIntoGlobalHook\s*\}\s+from\s+["'][^"']*@react-refresh["'];)/

export const addDevReactRefreshNonce = (html: string): string =>
  html.replace(
    reactRefreshPreamblePattern,
    `<script type="module" nonce="${DEV_REACT_REFRESH_NONCE}">$1`
  )
