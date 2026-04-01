---
paths:
  - '**/*.test.ts'
  - '**/*.test.tsx'
---

# TypeScript/JavaScript Testing

> This file extends [common/testing.md](../../common/testing.md) with TypeScript/JavaScript specific content.

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

## Testing Library Query Priority

Follow the [Testing Library query priority](https://testing-library.com/docs/queries/about/#priority). Use the **most accessible** query that works for your test case.

**Priority order:** `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` (content only) > `getByAltText` > `getByTestId` (last resort)

**Key rules:**

- `getByRole` is the default for interactive elements and landmarks
- `getByText` is only for verifying displayed content, never as primary element locator
- `getByTestId` is last resort for layout/styling tests only
- Material Icons: add `aria-hidden="true"` to icon spans, query parent via `getByRole`
- Every a11y attribute in a component must be exercised by its test

For test query examples (buttons, headings, status, landmarks, articles, figures), see [a11y-queries.md](./a11y-queries.md).
For component-side a11y patterns (which attributes to add), see [../coding-style/a11y-components.md](../coding-style/a11y-components.md).

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
