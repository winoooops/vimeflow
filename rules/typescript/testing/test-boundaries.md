---
paths:
  - '**/*.test.ts'
  - '**/*.test.tsx'
---

# Test Boundaries

> Referenced from [CLAUDE.md](./CLAUDE.md). Read this when writing or refactoring component tests to avoid over-testing or testing the wrong layer.

## Core Principle

**Test your code, not the library's code. Test integration at the consumer layer, not the primitive's internals.**

Duplicating tests across layers creates brittle suites that break when dependencies upgrade, and wastes CI time on coverage that adds no confidence.

---

## Rule 1: Do Not Test Third-Party Library Internals

When a library handles behavior internally (ARIA attributes, event sequencing, positioning math), trust its own test suite. Your tests should verify that **your usage** integrates correctly, not that the library's DOM looks a certain way.

### WRONG: asserting specific ARIA attributes the library adds

```typescript
// Floating UI adds role="tooltip" and aria-describedby automatically.
// This is testing the library's implementation, not our code.
test('wires role="tooltip" and aria-describedby on the trigger', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  const btn = screen.getByRole('button', { name: 'trigger' })
  await user.hover(btn)
  const tip = await screen.findByRole('tooltip')
  expect(tip).toBeInTheDocument()
  expect(btn).toHaveAttribute('aria-describedby', tip.id) // ❌ library detail
})
```

### CORRECT: assert the user-visible behavior

```typescript
// Verify the tooltip content appears and the trigger has an accessible description.
// The exact ARIA mechanism is Floating UI's concern.
test('exposes content as accessible description on the trigger', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  const btn = screen.getByRole('button', { name: 'trigger' })
  await user.hover(btn)
  await screen.findByRole('tooltip')
  expect(btn).toHaveAccessibleDescription('hello') // ✅ behavior, not structure
})
```

### Key distinction

| What the library guarantees | What you verify                            |
| --------------------------- | ------------------------------------------ |
| `role="tooltip"` exists     | tooltip content is correct                 |
| `aria-describedby` is wired | accessible description is available        |
| hover delay timing          | hover shows the expected text              |
| Escape dismissal logic      | your state resets after dismissal (if any) |

Use high-level assertions (`toHaveAccessibleDescription`, `toHaveTextContent`, `findByRole`) instead of inspecting specific attribute names or IDs that the library controls.

---

## Rule 2: Consumers Should Not Re-Test Primitive Behavior

When a primitive component (e.g. `Tooltip`) already has thorough unit tests for its own interactions, **consumer components should only test their integration points** with that primitive. Do not duplicate hover/leave/focus/escape tests in every parent component.

### WRONG: IconRail re-testing Tooltip's interaction mechanics

```typescript
// Tooltip.test.tsx already covers hover, leave, focus, Escape.
// These four tests in IconRail add no new confidence.
test('shows tooltip on hover and exposes it as accessible description', async () => {
  /* ... */
})
test('hides tooltip on mouse leave', async () => {
  /* ... */
})
test('opens tooltip on keyboard focus', async () => {
  /* ... */
})
test('dismisses tooltip on Escape', async () => {
  /* ... */
})
```

### CORRECT: one integration smoke test per consumer

```typescript
// IconRail only needs to verify it passes the right content to Tooltip.
test('shows item name in tooltip on hover', async () => {
  const user = userEvent.setup()
  render(<IconRail items={mockItems} settingsItem={mockSettings} />)

  await user.hover(screen.getByRole('button', { name: 'Dashboard' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Dashboard')
})
```

### When consumers DO need extra tests

Consumer tests are justified when the component adds **its own logic** on top of the primitive:

```typescript
// ActivityEvent adds tabIndex={0} to a span — that's a consumer choice.
// This test is specific to ActivityEvent, not Tooltip.
test('makes the body span focusable with tabIndex 0', () => {
  render(<ActivityEvent event={mockEvent} now={...} />)
  expect(
    screen.getByText('src/components/Tooltip.tsx', { selector: 'span' })
  ).toHaveAttribute('tabindex', '0')
})
```

### Summary: what to test at each layer

| Layer                                      | Test                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Primitive** (`Tooltip`)                  | hover/leave, focus, Escape, a11y wiring, ref forwarding, placement, theming           |
| **Consumer** (`IconRail`, `ActivityEvent`) | correct content passed, correct props configured, consumer-specific DOM/focus changes |

---

## Rule 3: Prefer Content Assertions Over Structure Assertions

Tests that assert on CSS classes, wrapper div counts, or element hierarchy break when you refactor styling or DOM nesting, even if behavior is unchanged.

### WRONG: testing class names and wrapper structure

```typescript
expect(tip).toHaveClass('custom-extra')
expect(tip).toHaveClass('backdrop-blur-md')
expect(wrapper.children.length).toBe(3)
```

### CORRECT: testing what the user perceives

```typescript
expect(tip).toHaveTextContent('hello')
expect(btn).toHaveAccessibleDescription('hello')
```

Structure assertions are only acceptable when the structure itself is the contract (e.g. a layout component that must render exactly two columns).

---

## Checklist

Before adding a test, ask:

1. **Am I testing my code or the library's code?** → If it's the library's, stop.
2. **Does the primitive already test this interaction?** → If yes, don't duplicate in the consumer.
3. **Am I asserting structure or behavior?** → Prefer behavior (text, roles, accessibility).
4. **Will this test break if I swap the underlying library?** → If yes, it's probably over-coupled.
