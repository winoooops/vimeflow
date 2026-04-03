---
paths:
  - '**/*.tsx'
  - '**/*.jsx'
---

# Component A11y Patterns

> Referenced from [CLAUDE.md](./CLAUDE.md). Read this when adding or modifying React component markup.

## Material Icons

Material Symbols render icon names as visible text. Mark them as decorative so screen readers skip them — the parent element carries the accessible name.

```tsx
// WRONG: icon text is exposed to assistive technology
<button>
  <span className="material-symbols-outlined">send</span>
</button>

// CORRECT: icon hidden, button has accessible name
<button aria-label="Send message">
  <span className="material-symbols-outlined" aria-hidden="true">send</span>
</button>
```

For non-interactive icons (e.g. decorative icons next to a heading), `aria-hidden="true"` is sufficient — no `aria-label` needed on the parent.

```tsx
<h3>
  <span className="material-symbols-outlined" aria-hidden="true">
    history
  </span>
  Recent Actions
</h3>
```

## Semantic HTML over ARIA roles

Prefer native HTML elements that carry implicit roles. Only add explicit `role` when no semantic element fits.

| Need            | Use                                 | Not                              |
| --------------- | ----------------------------------- | -------------------------------- |
| Navigation      | `<nav>`                             | `<div role="navigation">`        |
| Sidebar         | `<aside>`                           | `<div role="complementary">`     |
| Search area     | `<search>` or `<div role="search">` | plain `<div>`                    |
| Code block      | `<figure>` + `<figcaption>`         | `<div data-testid="code-block">` |
| Section heading | `<h2>`, `<h3>`                      | `<span class="heading">`         |
| Status text     | `<span role="status">`              | plain `<span>`                   |

## Interactive elements — prefer native `<button>`

Always use `<button>` for clickable elements. Reset default styles with `appearance-none border-none bg-transparent p-0`:

```tsx
// WRONG: div pretending to be a button
<div className="cursor-pointer" onClick={handleClick}>
  <span className="material-symbols-outlined">terminal</span>
</div>

// CORRECT: native button with reset styles
<button
  type="button"
  aria-label="Terminal"
  className="appearance-none border-none bg-transparent p-0 cursor-pointer"
  onClick={handleClick}
>
  <span className="material-symbols-outlined" aria-hidden="true">terminal</span>
</button>
```

### Fallback: `role="button"` (rare)

Only use `role="button"` when `<button>` is truly impossible (e.g. a drag handle that must be a specific element). When you do, you **must** also handle keyboard activation — `<button>` gets this for free, `role="button"` does not:

```tsx
<div
  role="button"
  tabIndex={0}
  aria-label="Terminal"
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }}
>
  ...
</div>
```

## Message containers

Chat messages use `role="article"` with an `aria-label` identifying the sender:

```tsx
// User message
<div role="article" aria-label="Message from You" className="...">
  {/* avatar + content */}
</div>

// Agent message
<div role="article" aria-label="Message from VIBM Agent" className="...">
  {/* avatar + content */}
</div>
```

## Labeled regions

A `<section>` without a label has no implicit ARIA role. Adding `aria-label` gives it `role="region"`, making it queryable:

```tsx
// WRONG: section without label has no role
<section data-testid="message-thread">...</section>

// CORRECT: section with label becomes a region landmark
<section aria-label="Message thread">...</section>
```

## Code blocks with figure/figcaption

Use `<figure>` for self-contained content blocks (code, images, diagrams). Reset default margins with `m-0`:

```tsx
<figure aria-label={filename} className="m-0 bg-surface-container-highest ...">
  <figcaption className="flex items-center justify-between ...">
    <span className="material-symbols-outlined" aria-hidden="true">
      description
    </span>
    {filename}
  </figcaption>
  <pre>{code}</pre>
</figure>
```

## Definition lists for key-value stats

Use `<dl>/<dt>/<dd>` for label-value pairs. Reset default margins:

```tsx
<dl className="m-0 grid grid-cols-2 gap-2">
  <div className="text-center">
    <dt className="text-[9px]">Latency</dt>
    <dd className="m-0 text-[11px]">142ms</dd>
  </div>
</dl>
```
