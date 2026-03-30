---
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.js'
  - '**/*.jsx'
---

# TypeScript/JavaScript Testing

> This file extends [common/testing.md](../common/testing.md) with TypeScript/JavaScript specific content.

## Unit & Integration Testing

- **Framework**: Vitest
- Use `test()` not `it()` (enforced by `vitest/consistent-test-it`)
- Test files: `*.test.ts` / `*.test.tsx` colocated with source
- React component tests use **Testing Library** (`@testing-library/react`)

## E2E Testing

Use **Playwright** for E2E tests against the Tauri webview (via `tauri-driver` or remote debugging).

## Test Commands

```bash
npx vitest                    # Run all tests (watch mode)
npx vitest run                # Run all tests (CI mode)
npx vitest run src/path       # Run tests in a directory
npx vitest run --coverage     # Coverage report
```

## Agent Support

- **tdd-guide** — Test-driven development enforcement
- **e2e-runner** — Desktop E2E testing with tauri-driver/Playwright
