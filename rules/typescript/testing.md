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

## Test Data Style

- **Inline single-use test data** directly into the call site instead of declaring a named variable. Readability of each test case matters more than DRY in tests.
- Only extract a variable when it is referenced 2+ times in the same test (e.g. once in `render()` and once in an assertion comparing the same value).

```typescript
// WRONG: variable used only once adds indirection
test('renders agent message', () => {
  const message: Message = {
    id: '1',
    sender: 'agent',
    content: 'Hello',
    timestamp: '2026-03-31T10:00:00Z',
  }

  render(<AgentMessage message={message} />)
  expect(screen.getByText('Hello')).toBeInTheDocument()
})

// CORRECT: inline the data where it's used
test('renders agent message', () => {
  render(
    <AgentMessage
      message={{
        id: '1',
        sender: 'agent',
        content: 'Hello',
        timestamp: '2026-03-31T10:00:00Z',
      }}
    />
  )
  expect(screen.getByText('Hello')).toBeInTheDocument()
})
```

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
