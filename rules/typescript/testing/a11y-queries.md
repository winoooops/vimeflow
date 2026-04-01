---
paths:
  - '**/*.test.tsx'
  - '**/*.test.jsx'
---

# A11y Query Patterns for Testing Library

> Referenced from [CLAUDE.md](./CLAUDE.md). Read this when writing or refactoring component tests.
> For the component-side patterns (which attributes to add), see [../coding-style/a11y-components.md](../coding-style/a11y-components.md).

## `getByText` — content assertions only

Use `getByText` to verify rendered text, never to locate interactive elements:

```typescript
// CORRECT: getByRole locates, toHaveTextContent verifies
const badge = screen.getByRole('status')
expect(badge).toHaveTextContent('THINKING')

// CORRECT: verifying body text rendered
expect(screen.getByText('Hello world')).toBeInTheDocument()

// WRONG: locating interactive elements by text
screen.getByText('Send') // → getByRole('button', { name: /send/i })
screen.getByText('Settings') // → getByRole('button', { name: /settings/i })
```

## Buttons

```typescript
screen.getByRole('button', { name: /send/i }) // aria-label="send"
screen.getByRole('button', { name: /settings/i }) // aria-label="Settings"
screen.getByRole('button', { name: /terminal/i }) // aria-label="Terminal"
screen.getByRole('button', { name: 'Chat' }) // visible text
```

## Headings

```typescript
screen.getByRole('heading', { name: /recent chats/i }) // <h2>
screen.getByRole('heading', { name: /agent status/i }) // <h2>
screen.getByRole('heading', { name: /ai strategy/i }) // <h3>
```

## Status indicators

```typescript
const status = screen.getByRole('status') // role="status"
expect(status).toHaveTextContent('THINKING')
```

## Landmark regions

```typescript
screen.getByRole('complementary') // <aside>
screen.getByRole('region', { name: /message thread/i }) // <section aria-label="...">
screen.getByRole('navigation') // <nav>
screen.getByRole('search') // <search> or role="search"
screen.getByRole('banner') // <header>
screen.getByRole('contentinfo') // <footer>
```

## Articles (chat messages)

```typescript
screen.getByRole('article', { name: /message from you/i })
screen.getByRole('article', { name: /vibm agent/i })
screen.getAllByRole('article') // all messages in thread
```

## Figures (code blocks)

```typescript
screen.getByRole('figure', { name: 'auth_middleware.py' })
screen.getAllByRole('figure') // all code blocks
```

## Definition terms (stat labels)

```typescript
const terms = screen.getAllByRole('term') // <dt> elements
const latency = terms.find((t) => t.textContent === 'Latency')
```

## Form elements

```typescript
screen.getByRole('textbox') // <textarea> / <input>
screen.getByPlaceholderText(/ask anything/i) // fallback
screen.getByLabelText('Agent avatar') // aria-label
```

## Images

```typescript
screen.getByAltText('User Profile') // <img alt="...">
screen.getByRole('img', { name: /vimeflow logo/i }) // role="img" aria-label
```

## Icon verification

Material Symbols are `aria-hidden` so they're invisible to a11y queries. To verify an icon exists inside a button, extract the `querySelector` to a variable (see [CLAUDE.md QA section](./CLAUDE.md#qa-material-symbols-icon-verification) for why):

```typescript
const button = screen.getByRole('button', { name: /send/i })
// eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
const icon = button.querySelector('.material-symbols-outlined')
expect(icon).toBeInTheDocument()
```

## Elements without implicit ARIA roles

Some semantic HTML elements have **no default ARIA role**, so `getByRole` cannot find them. Add `aria-label` to make them queryable:

| Element                  | Implicit role | Workaround                                                |
| ------------------------ | ------------- | --------------------------------------------------------- |
| `<dl>`                   | none          | Add `aria-label`, query via `getByLabelText` + `within()` |
| `<dt>`                   | `term`        | Queryable: `getAllByRole('term')`                         |
| `<dd>`                   | `definition`  | Queryable: `getAllByRole('definition')`                   |
| `<div>`                  | none          | Add `role` + `aria-label` if interactive                  |
| `<span>`                 | none          | Add `role` if semantic (e.g. `role="status"`)             |
| `<section>` (no label)   | none          | Add `aria-label` → becomes `region`                       |
| `<section>` (with label) | `region`      | Queryable: `getByRole('region', { name })`                |

Example — querying a definition list with `within()`:

```typescript
// Component: add aria-label to <dl>
<dl aria-label="Model statistics" className="grid grid-cols-2 gap-2">
  <div>
    <dt>Latency</dt>
    <dd>142ms</dd>
  </div>
</dl>

// Test: use within() scoped to the labeled list
const stats = screen.getByLabelText('Model statistics')
expect(within(stats).getByText('Latency')).toBeInTheDocument()
expect(within(stats).getByText(/142ms/)).toBeInTheDocument()
```

## Pairing rule

Every a11y attribute in a component must be exercised by a test query. If you add `role="status"`, the test must use `getByRole('status')`.
