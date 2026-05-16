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
- Material Symbols (Google Fonts icon font, **not** MUI): add `aria-hidden="true"` to icon spans, query parent via `getByRole`
- Every a11y attribute in a component must be exercised by its test

For test query examples (buttons, headings, status, landmarks, articles, figures), see [a11y-queries.md](./a11y-queries.md).
For component-side a11y patterns (which attributes to add), see [../coding-style/a11y-components.md](../coding-style/a11y-components.md).
For rules on what to test at each layer (primitive vs consumer, library boundaries), see [test-boundaries.md](./test-boundaries.md).

## E2E Testing

Use **WebdriverIO** with `@wdio/electron-service` for E2E tests against the packaged Electron app. The three suites under `tests/e2e/{core,terminal,agent}/` run via `npm run test:e2e:all`; each `wdio.conf.ts` declares `browserName: 'electron'` + `wdio:electronServiceOptions: { appEntryPoint, appArgs }` from `tests/e2e/shared/electron-app.ts`. The `e2e-test` Cargo feature flag unlocks the `list_active_pty_sessions` sidecar method that the harness needs.

Historical note: pre-PR-D2 (2026-05-15) this used `tauri-driver` + `browserName: 'wry'`. The driver swap landed in PR-D2 (#210).

## Test Commands

```bash
npx vitest                    # Run all tests (watch mode)
npx vitest run                # Run all tests (CI mode)
npx vitest run src/path       # Run tests in a directory
npx vitest run --coverage     # Coverage report
npm run test:e2e:build        # Build renderer + Electron bundles + sidecar (e2e-test feature)
npm run test:e2e              # Run the core E2E suite (4 specs)
npm run test:e2e:terminal     # Run the terminal E2E suite (6 specs)
npm run test:e2e:agent        # Run the agent E2E suite (1 spec)
npm run test:e2e:all          # Run all three E2E suites in series
```

## Agent Support

- **tdd-guide** — Test-driven development enforcement
- **e2e-runner** — Desktop E2E testing with `@wdio/electron-service`

## QA

Known gotchas and workarounds encountered in this project. See also [a11y-queries.md](./a11y-queries.md) for query pattern examples.

### Material Symbols icon verification

This project uses **Material Symbols** (Google Fonts icon font, **not** MUI). Icons render as text inside `<span class="material-symbols-outlined">`. Since icons are `aria-hidden`, Testing Library a11y queries can't reach them.

To verify icon presence, extract the `querySelector` to a variable so `eslint-disable-next-line` survives Prettier wrapping:

```typescript
const button = screen.getByRole('button', { name: /send/i })
// eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
const icon = button.querySelector('.material-symbols-outlined')
expect(icon).toBeInTheDocument()
```

**Why a variable?** Prettier may wrap `expect(button.querySelector(...)).toBeInTheDocument()` across multiple lines, pushing `.querySelector` beyond the single-line eslint-disable range. A variable assignment keeps the violation on the disabled line.
