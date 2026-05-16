import { describe, expect, test } from 'vitest'
import {
  DEV_REACT_REFRESH_NONCE_ENV,
  addDevReactRefreshNonce,
  createDevReactRefreshNonce,
  devContentSecurityPolicy,
  devE2eContentSecurityPolicy,
  developmentContentSecurityPolicy,
  ensureDevReactRefreshNonce,
  getDevReactRefreshNonce,
  packagedContentSecurityPolicy,
} from './csp'

const directive = (policy: string, name: string): string => {
  const match = policy.split('; ').find((entry) => entry.startsWith(`${name} `))

  if (match === undefined) {
    throw new Error(`Missing ${name} directive`)
  }

  return match
}

describe('Content Security Policy', () => {
  const nonce = 'test-dev-nonce'

  test('regular dev uses a React Refresh nonce without allowing inline scripts', () => {
    const scriptSrc = directive(devContentSecurityPolicy(nonce), 'script-src')

    expect(scriptSrc).toContain(`'nonce-${nonce}'`)
    expect(scriptSrc).toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  test('E2E dev allows inline scripts without a nonce so WDIO injection works', () => {
    const scriptSrc = directive(devE2eContentSecurityPolicy, 'script-src')

    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc).toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'nonce-")
  })

  test('development selector preserves the dev and E2E split', () => {
    expect(developmentContentSecurityPolicy(false, nonce)).toBe(
      devContentSecurityPolicy(nonce)
    )

    expect(developmentContentSecurityPolicy(true, nonce)).toBe(
      devE2eContentSecurityPolicy
    )
  })

  test('packaged builds keep strict script policy', () => {
    expect(directive(packagedContentSecurityPolicy, 'script-src')).toBe(
      "script-src 'self'"
    )
  })

  test('adds nonce to Vite React Refresh preamble script', () => {
    const htmlNonce = 'html-nonce'

    const html = [
      '<html><head>',
      '<script type="module">',
      'import { injectIntoGlobalHook } from "/@react-refresh";',
      'injectIntoGlobalHook(window);',
      '</script>',
      '</head></html>',
    ].join('\n')

    expect(addDevReactRefreshNonce(html, htmlNonce)).toContain(
      `<script type="module" nonce="${htmlNonce}">`
    )
  })

  test('leaves unrelated module scripts unchanged', () => {
    const html = '<script type="module">import "/src/main.tsx";</script>'

    expect(addDevReactRefreshNonce(html, nonce)).toBe(html)
  })

  test('generates opaque nonce values instead of using a source-known constant', () => {
    const generated = createDevReactRefreshNonce()

    expect(generated).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(generated.length).toBeGreaterThanOrEqual(22)
    expect(generated).not.toBe('vimeflow-dev-react-refresh')
  })

  test('reuses the environment nonce when one is configured', () => {
    const previous = process.env[DEV_REACT_REFRESH_NONCE_ENV]

    process.env[DEV_REACT_REFRESH_NONCE_ENV] = 'from-env'

    try {
      expect(getDevReactRefreshNonce()).toBe('from-env')
      expect(ensureDevReactRefreshNonce()).toBe('from-env')
    } finally {
      if (previous === undefined) {
        delete process.env[DEV_REACT_REFRESH_NONCE_ENV]
      } else {
        process.env[DEV_REACT_REFRESH_NONCE_ENV] = previous
      }
    }
  })
})
