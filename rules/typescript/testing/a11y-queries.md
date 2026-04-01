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

Material Icons are `aria-hidden` so they're invisible to a11y queries. To verify an icon exists inside a button, use DOM traversal with an eslint-disable:

```typescript
const button = screen.getByRole('button', { name: /send/i })
// eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
expect(button.querySelector('.material-symbols-outlined')).toBeInTheDocument()
```

## Pairing rule

Every a11y attribute in a component must be exercised by a test query. If you add `role="status"`, the test must use `getByRole('status')`.
