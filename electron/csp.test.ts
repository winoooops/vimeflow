import { describe, expect, test } from 'vitest'
import {
  DEV_REACT_REFRESH_NONCE,
  addDevReactRefreshNonce,
  devContentSecurityPolicy,
  devE2eContentSecurityPolicy,
  developmentContentSecurityPolicy,
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
  test('regular dev uses a React Refresh nonce without allowing inline scripts', () => {
    const scriptSrc = directive(devContentSecurityPolicy, 'script-src')

    expect(scriptSrc).toContain(`'nonce-${DEV_REACT_REFRESH_NONCE}'`)
    expect(scriptSrc).toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  test('E2E dev allows inline scripts without a nonce so WDIO injection works', () => {
    const scriptSrc = directive(devE2eContentSecurityPolicy, 'script-src')

    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc).toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain(`'nonce-${DEV_REACT_REFRESH_NONCE}'`)
  })

  test('development selector preserves the dev and E2E split', () => {
    expect(developmentContentSecurityPolicy(false)).toBe(
      devContentSecurityPolicy
    )

    expect(developmentContentSecurityPolicy(true)).toBe(
      devE2eContentSecurityPolicy
    )
  })

  test('packaged builds keep strict script policy', () => {
    expect(directive(packagedContentSecurityPolicy, 'script-src')).toBe(
      "script-src 'self'"
    )
  })

  test('adds nonce to Vite React Refresh preamble script', () => {
    const html = [
      '<html><head>',
      '<script type="module">',
      'import { injectIntoGlobalHook } from "/@react-refresh";',
      'injectIntoGlobalHook(window);',
      '</script>',
      '</head></html>',
    ].join('\n')

    expect(addDevReactRefreshNonce(html)).toContain(
      `<script type="module" nonce="${DEV_REACT_REFRESH_NONCE}">`
    )
  })

  test('leaves unrelated module scripts unchanged', () => {
    const html = '<script type="module">import "/src/main.tsx";</script>'

    expect(addDevReactRefreshNonce(html)).toBe(html)
  })
})
