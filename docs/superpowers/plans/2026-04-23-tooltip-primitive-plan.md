# Tooltip Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portaled, a11y-correct `<Tooltip>` primitive (built on `@floating-ui/react`) and migrate the two existing call-sites (`IconRail` short label + `ActivityEvent` long body) to use it.

**Architecture:** Single `Tooltip` component using Floating UI's `enabled` flag pattern. All hooks (`useFloating` + `useHover` + `useFocus` + `useDismiss` + `useRole` + `useInteractions` + `useMergeRefs`) run unconditionally for rules-of-hooks compliance, but each interaction hook gates its listeners on a derived `enabled` boolean. When disabled or content is empty, we return `children` unchanged after the hooks — no `cloneElement`, no ref injection, no interaction props attached. The floating element is portaled to `document.body` via `<FloatingPortal>` so it escapes any clipping or stacking context, with the project's glassmorphism baseline classes baked in. Both call-sites swap their hand-rolled / not-yet-existing tooltip code for `<Tooltip>` wrappers; IconRail's temporary `z-50` patch is removed once portaling kicks in.

**Tech Stack:** React 19, TypeScript 5, Vite 6, Tailwind v4, Vitest + Testing Library + user-event, `@floating-ui/react` (new dep).

**Spec:** [`docs/superpowers/specs/2026-04-23-tooltip-primitive-design.md`](../specs/2026-04-23-tooltip-primitive-design.md)
**Decision record:** [`docs/decisions/2026-04-22-tooltip-library.md`](../../decisions/2026-04-22-tooltip-library.md)

**Pre-flight:** Make sure you're on a feature branch (not `main`). Run `git status` and `git switch -c feat/tooltip-primitive` if needed. The session that produced this plan also left these uncommitted artifacts that should land first (in their own commits before Task 1):

- `src/features/workspace/components/IconRail.tsx` — `z-50` patch (commit as `fix(workspace): patch icon rail tooltip z-index until primitive lands`)
- `docs/decisions/CLAUDE.md`, `docs/decisions/2026-04-22-tooltip-library.md`, plus the `decisions/` references added to `docs/CLAUDE.md` and root `CLAUDE.md` (commit as `docs(decisions): introduce technical decision records + tooltip library decision`)
- `docs/superpowers/specs/2026-04-23-tooltip-primitive-design.md` (commit as `docs(specs): tooltip primitive design`)

---

## Task 1: Add `@floating-ui/react` dependency

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run:

```bash
npm install --save @floating-ui/react
```

If the install fails with a `502` or proxy-related error from `127.0.0.1:7897`, run `unproxy && npm install --save @floating-ui/react` instead (Clash-Verge proxy on this machine intercepts npm registry traffic).

Expected: `package.json` gains `"@floating-ui/react": "^0.27.x"` under `dependencies`. `package-lock.json` updates to add `@floating-ui/react`, `@floating-ui/react-dom`, `@floating-ui/utils`, `tabbable` (≈11 new packages total per the decision record).

- [ ] **Step 2: Verify the install**

Run:

```bash
node -e "console.log(require('@floating-ui/react/package.json').version)"
```

Expected: prints a version like `0.27.19` (any `0.27.x` is fine).

Run:

```bash
grep '@floating-ui/react' package.json
```

Expected: a line like `"@floating-ui/react": "^0.27.19",` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @floating-ui/react dependency for tooltip primitive"
```

---

## Task 2: Tooltip scaffold + short-circuit paths

Implements the outer `Tooltip` wrapper that short-circuits when there's nothing to show. No hooks fire on this code path. Covers spec test cases 1–2.

**Files:**

- Create: `src/components/Tooltip.tsx`
- Create: `src/components/Tooltip.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/Tooltip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  test('returns children unchanged when disabled', () => {
    render(
      <Tooltip content="hello" disabled>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('returns children unchanged when content is null', () => {
    render(
      <Tooltip content={null}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run src/components/Tooltip.test.tsx
```

Expected: both tests fail with `Cannot find module './Tooltip'` (or similar resolution error).

- [ ] **Step 3: Write the minimal scaffold**

Create `src/components/Tooltip.tsx`:

```tsx
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { Placement } from '@floating-ui/react'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement
  placement?: Placement
  delayMs?: number
  disabled?: boolean
  maxWidth?: number
  className?: string
}

export const Tooltip = ({
  content,
  children,
  disabled = false,
}: TooltipProps): ReactElement => {
  if (disabled || content == null || !isValidElement(children)) {
    return children
  }

  // Real implementation (hooks + portal) lands in Task 3.
  return children
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run src/components/Tooltip.test.tsx
```

Expected: both tests pass. (Each `queryByRole('tooltip')` returns `null` because the placeholder body never renders a tooltip element — exactly the behaviour we want for short-circuit cases.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Tooltip.tsx src/components/Tooltip.test.tsx
git commit -m "feat(tooltip): add Tooltip scaffold with disabled/null short-circuit"
```

---

## Task 3: Wire Floating UI hooks (interactions + a11y)

Replaces the placeholder body with the real implementation (single component, `enabled`-gated hooks). Covers spec test cases 3–7 (hover open + content render, mouse-leave close, focus open, Escape close, accessible description on trigger).

**Files:**

- Modify: `src/components/Tooltip.tsx`
- Modify: `src/components/Tooltip.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `src/components/Tooltip.test.tsx` inside the `describe('Tooltip', ...)` block (after the existing tests):

```tsx
test('opens on hover after delayMs and renders content', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="full body text" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await user.hover(screen.getByRole('button', { name: 'trigger' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('full body text')
})

test('closes on mouse leave', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  const btn = screen.getByRole('button', { name: 'trigger' })
  await user.hover(btn)
  expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  await user.unhover(btn)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

test('opens on focus', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await user.tab()
  expect(await screen.findByRole('tooltip')).toBeInTheDocument()
})

test('closes on Escape', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  await user.hover(screen.getByRole('button', { name: 'trigger' }))
  expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

test('exposes content as accessible description on the trigger', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  const btn = screen.getByRole('button', { name: 'trigger' })
  await user.hover(btn)
  // Wait for tooltip to open so the accessible description becomes available
  await screen.findByRole('tooltip')
  expect(btn).toHaveAccessibleDescription('hello')
})
```

Add this import at the top of the test file (next to the existing `@testing-library/react` import):

```tsx
import userEvent from '@testing-library/user-event'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run src/components/Tooltip.test.tsx
```

Expected: the 5 newly-added tests fail because no tooltip ever renders (`findByRole('tooltip')` times out). The 2 short-circuit tests still pass.

- [ ] **Step 3: Replace the scaffold with the real implementation**

Overwrite `src/components/Tooltip.tsx` with:

```tsx
import {
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement
  placement?: Placement
  delayMs?: number
  disabled?: boolean
  maxWidth?: number
  className?: string
}

const TOOLTIP_CLASSES =
  'pointer-events-none z-50 rounded-lg shadow-lg px-3 py-2 ' +
  'bg-surface-container-high/70 backdrop-blur-md backdrop-saturate-150 ' +
  'text-xs text-on-surface'

export const Tooltip = ({
  content,
  children,
  placement = 'top',
  delayMs = 250,
  disabled = false,
  maxWidth = 320,
  className,
}: TooltipProps): ReactElement => {
  const enabled = !disabled && content != null && isValidElement(children)

  const [open, setOpen] = useState(false)

  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      enabled,
      delay: { open: delayMs, close: 0 },
      handleClose: safePolygon(),
    }),
    useFocus(context, { enabled }),
    useDismiss(context, { enabled, escapeKey: true }),
    useRole(context, { enabled, role: 'tooltip' }),
  ])

  const childRef = isValidElement(children)
    ? (children.props as { ref?: Ref<unknown> }).ref
    : undefined
  const mergedRef = useMergeRefs([refs.setReference, childRef])

  if (!enabled) {
    return children
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        ...getReferenceProps(children.props as Record<string, unknown>),
      })}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            data-placement={resolvedPlacement}
            style={{ ...floatingStyles, maxWidth }}
            className={`${TOOLTIP_CLASSES} ${className ?? ''}`.trim()}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run src/components/Tooltip.test.tsx
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tooltip.tsx src/components/Tooltip.test.tsx
git commit -m "feat(tooltip): wire Floating UI hooks for hover, focus, dismiss, and a11y"
```

---

## Task 4: Configuration props (placement, maxWidth, className) + ref preservation

Covers spec test cases 9–12. The implementation already plumbs all four — these tests verify the wiring is correct.

**Files:**

- Modify: `src/components/Tooltip.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append inside the `describe('Tooltip', ...)` block:

```tsx
test('respects placement prop via data-placement attribute', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0} placement="bottom">
      <button type="button">trigger</button>
    </Tooltip>
  )

  await user.hover(screen.getByRole('button', { name: 'trigger' }))
  expect(
    (await screen.findByRole('tooltip')).getAttribute('data-placement')
  ).toMatch(/^bottom/)
})

test('applies maxWidth to the floating element', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0} maxWidth={200}>
      <button type="button">trigger</button>
    </Tooltip>
  )

  await user.hover(screen.getByRole('button', { name: 'trigger' }))
  expect(await screen.findByRole('tooltip')).toHaveStyle({
    maxWidth: '200px',
  })
})

test('preserves an existing ref on the trigger', () => {
  const ref = createRef<HTMLButtonElement>()
  render(
    <Tooltip content="hello" delayMs={0}>
      <button ref={ref} type="button">
        trigger
      </button>
    </Tooltip>
  )

  expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  expect(ref.current?.textContent).toBe('trigger')
})

test('appends className to the baseline classes', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="hello" delayMs={0} className="custom-extra">
      <button type="button">trigger</button>
    </Tooltip>
  )

  await user.hover(screen.getByRole('button', { name: 'trigger' }))
  const tip = await screen.findByRole('tooltip')
  expect(tip).toHaveClass('custom-extra')
  expect(tip).toHaveClass('backdrop-blur-md')
})
```

Add `createRef` to the React import at the top of the test file:

```tsx
import { createRef } from 'react'
```

- [ ] **Step 2: Run the tests to verify they pass**

Run:

```bash
npx vitest run src/components/Tooltip.test.tsx
```

Expected: all 11 tests pass (7 existing + 4 new). No implementation changes needed — the props were already plumbed in Task 3.

If the placement test fails because the rendered DOM has no `data-placement` attribute, double-check Task 3's `<div data-placement={resolvedPlacement} ...>` line was applied.

- [ ] **Step 3: Commit**

```bash
git add src/components/Tooltip.test.tsx
git commit -m "test(tooltip): cover placement, maxWidth, ref preservation, and className"
```

---

## Task 5: Migrate IconRail to the new primitive

Replaces both hand-rolled tooltip blocks, removes the `useState` hover state, drops the `relative` per-item wrappers (no longer anchoring anything), and removes the temporary `z-50` patch (the new primitive portals out of any stacking context).

**Files:**

- Modify: `src/features/workspace/components/IconRail.tsx`
- Modify: `src/features/workspace/components/IconRail.test.tsx`

- [ ] **Step 1: Update the component**

Overwrite `src/features/workspace/components/IconRail.tsx` with:

```tsx
import type { ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'
import type { NavigationItem } from '../types'

export interface IconRailProps {
  items: NavigationItem[]
  settingsItem: NavigationItem
}

export const IconRail = ({
  items,
  settingsItem,
}: IconRailProps): ReactElement => (
  <div
    className="relative flex h-full w-16 flex-col items-center justify-between bg-surface border-r border-white/5 py-3"
    data-testid="icon-rail"
  >
    <div className="flex w-full flex-col items-center gap-3">
      {items.map((item) => (
        <div key={item.id} className="flex w-full justify-center">
          <Tooltip content={item.name} placement="right">
            <button
              type="button"
              onClick={item.onClick}
              className={`flat-bookmark flex h-12 w-8 items-center justify-center ${item.color}`}
              aria-label={item.name}
            >
              <span className="material-symbols-outlined mb-2 text-lg text-white">
                {item.icon}
              </span>
            </button>
          </Tooltip>
        </div>
      ))}
    </div>

    <div className="flex w-full justify-center">
      <Tooltip content={settingsItem.name} placement="right">
        <button
          type="button"
          onClick={settingsItem.onClick}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface/50 transition-colors hover:bg-surface-container hover:text-on-surface"
          aria-label={settingsItem.name}
        >
          <span className="material-symbols-outlined text-xl">
            {settingsItem.icon}
          </span>
        </button>
      </Tooltip>
    </div>
  </div>
)
```

Things removed (sanity checklist):

- `import { useState, ... }` → just `import type { ReactElement }`
- `const [hoveredItem, setHoveredItem] = useState<string | null>(null)`
- `onMouseEnter` / `onMouseLeave` handlers on the per-item wrappers
- `relative` class on per-item wrappers
- The two `{hoveredItem === ... && (<div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 ...">...</div>)}` blocks (this is where the temporary `z-50` patch lived; it's gone now)

- [ ] **Step 2: Replace the existing tooltip-related tests with integration assertions**

Open `src/features/workspace/components/IconRail.test.tsx`. Replace the `'shows tooltip on hover'` test (currently around line 102) and the `'hides tooltip on mouse leave'` test (currently around line 124) with these two — they verify _integration_ (the right content flows to the right Tooltip). Hover / focus / Escape behaviour is covered by `Tooltip.test.tsx`; duplicating it here adds maintenance cost with no extra coverage.

```tsx
test('shows item name as tooltip on hover', async () => {
  const user = userEvent.setup()
  render(
    <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
  )

  await user.hover(screen.getByRole('button', { name: 'Dashboard' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Dashboard')
})

test('shows settings item name as tooltip on hover', async () => {
  const user = userEvent.setup()
  render(
    <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />
  )

  await user.hover(screen.getByRole('button', { name: mockSettingsItem.name }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    mockSettingsItem.name
  )
})
```

If `userEvent` is not yet imported in this test file, add at the top:

```tsx
import userEvent from '@testing-library/user-event'
```

- [ ] **Step 3: Run the affected tests**

Run:

```bash
npx vitest run src/features/workspace/components/IconRail.test.tsx
```

Expected: all tests pass — the 4 rewritten tooltip tests above plus all the existing non-tooltip ones (project switcher, button rendering, accessibility names, etc.).

If a test still references the removed `bg-surface-container` class or asserts `screen.getByText('Dashboard', { selector: 'div' })`, delete that assertion — it's targeting the old hand-rolled DOM that no longer exists.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/components/IconRail.tsx src/features/workspace/components/IconRail.test.tsx
git commit -m "feat(workspace): migrate IconRail tooltip to new Tooltip primitive"
```

---

## Task 6: Add tooltip to ActivityEvent body

Wraps the truncated body in a `<Tooltip>` and replaces the `<div>` with a focusable `<span>` so keyboard users can Tab to each event and have the full body announced via `aria-describedby`.

**Files:**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx`
- Modify: `src/features/agent-status/components/ActivityEvent.test.tsx`

- [ ] **Step 1: Update the component**

In `src/features/agent-status/components/ActivityEvent.tsx`, add the import next to the existing imports (top of file):

```tsx
import { Tooltip } from '../../../components/Tooltip'
```

Then replace the body block (currently at line 156, inside `ActivityEvent`'s JSX):

```tsx
<div className={`mt-0.5 truncate ${getBodyClass(event.kind)}`}>
  {event.body}
</div>
```

with:

```tsx
<Tooltip content={event.body} placement="left" maxWidth={320}>
  <span
    tabIndex={0}
    className={`mt-0.5 block truncate outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${getBodyClass(event.kind)}`}
  >
    {event.body}
  </span>
</Tooltip>
```

Notes:

- `<span>` (not `<div>`) — semantically lighter for an inline-style focusable element, and `cloneElement` works the same.
- `block` is added to the className so `truncate`'s ellipsis still works on the inline element.
- `tabIndex={0}` makes the wrapper participate in keyboard focus order.
- `outline-none focus-visible:ring-1 focus-visible:ring-primary-container` provides a visible focus indicator using the project's existing `primary-container` token.

- [ ] **Step 2: Add tests covering the integration**

In `src/features/agent-status/components/ActivityEvent.test.tsx`, add the following two tests inside the existing `describe('ActivityEvent', ...)` block (alongside the other tests). If `userEvent` is not yet imported, add `import userEvent from '@testing-library/user-event'` at the top.

These cover the two things specific to ActivityEvent: (a) the full body content flows into a Tooltip on hover, (b) the body span is focusable so keyboard users can reach it. Hover-open / focus-open / Escape-dismiss behaviour is covered by `Tooltip.test.tsx`; duplicating it here adds maintenance cost with no extra coverage.

```tsx
test('reveals full event body via tooltip on hover', async () => {
  const user = userEvent.setup()
  render(
    <ActivityEvent
      event={{
        id: 'e1',
        kind: 'bash',
        tool: 'Bash',
        body: 'grep -rn "very long search term" /home/will/projects/vimeflow/src --include="*.tsx"',
        timestamp: '2026-04-23T03:00:00Z',
        status: 'done',
        durationMs: 120,
      }}
      now={new Date('2026-04-23T03:01:00Z')}
    />
  )

  await user.hover(
    screen.getByText(/very long search term/, { selector: 'span' })
  )
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'very long search term'
  )
})

test('makes the body span focusable with tabIndex 0', () => {
  render(
    <ActivityEvent
      event={{
        id: 'e2',
        kind: 'edit',
        tool: 'Edit',
        body: 'src/components/Tooltip.tsx',
        timestamp: '2026-04-23T03:00:00Z',
        status: 'done',
        durationMs: 8,
        diff: { added: 12, removed: 0 },
      }}
      now={new Date('2026-04-23T03:01:00Z')}
    />
  )

  expect(
    screen.getByText('src/components/Tooltip.tsx', { selector: 'span' })
  ).toHaveAttribute('tabindex', '0')
})
```

If the existing tests assert that the body renders inside a `<div>` (e.g. `screen.getByText(..., { selector: 'div' })`), update those queries to use `selector: 'span'` to match the new wrapper element.

- [ ] **Step 3: Run the affected tests**

Run:

```bash
npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx
```

Expected: all tests pass — the 3 new ones plus the existing coverage. If an existing test fails due to the div→span change, update its `selector` value as noted above.

- [ ] **Step 4: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.tsx src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "feat(agent-status): reveal full event body via Tooltip on hover/focus"
```

---

## Task 7: Final verification

Catches anything the unit tests can't — visual regressions in the live app, lint or type errors elsewhere from the new import paths, and a full test-suite signal that nothing broke transitively.

**Files:** none modified directly.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm run test
```

Expected: all tests pass. If the run can't reach the registry / network, that's unrelated to this task.

- [ ] **Step 2: Run the type-checker**

Run:

```bash
npm run type-check
```

Expected: clean exit. Typical failure points to verify if it errors:

- The `cloneElement(children, { ref: mergedRef, ... })` in Tooltip.tsx — React 19 accepts `ref` as a regular prop, but if TS complains, cast: `cloneElement(children, { ref: mergedRef as Ref<unknown>, ... })`.
- `children.props as Record<string, unknown>` cast — adjust to `Record<string, never>` if the spread complains, or use `as any as Record<string, unknown>` only as a last resort (project rules ban bare `any`).

- [ ] **Step 3: Run the linter**

Run:

```bash
npm run lint
```

Expected: clean exit. The pre-commit hook should already have caught most issues, but full-tree lint covers things like unused imports left behind in IconRail (`useState` removal).

- [ ] **Step 4: Smoke-test in the live app**

Run:

```bash
unproxy && npm run tauri:dev
```

Once the Tauri window opens, manually verify:

1. Hover a left-rail icon → tooltip with the icon's name appears to the right, on top of the Sidebar (proves portaling works).
2. Press `Tab` repeatedly from page load → focus should land on each rail icon and trigger its tooltip; pressing `Esc` while a tooltip is open dismisses it.
3. Hover an event in the activity panel (right side) → tooltip with the full event body appears to the left of the panel; long bodies should not clip horizontally (Floating UI's `shift()` middleware should keep them inside the viewport).
4. Tab into the activity panel → each event's body span receives a visible focus ring (`primary-container` colored), and the tooltip opens on focus.
5. There are no console warnings about React keys, hook ordering, or `cloneElement` ref handling.

Close the window when done; the dev server will exit.

- [ ] **Step 5: Confirm IconRail's `z-50` patch is gone**

Run:

```bash
grep -n 'z-50' src/features/workspace/components/IconRail.tsx || echo "patch removed"
```

Expected: prints `patch removed`.

- [ ] **Step 6: No commit needed**

This task only verified existing commits. Nothing new to commit. If something broke and you fixed it, commit that fix in a small follow-up:

```bash
git commit -am "fix(tooltip): <one-line description of follow-up>"
```

---

## Summary

After all tasks, the branch contains 6 logical commits (or 9, including the 3 pre-flight commits for the existing uncommitted work):

1. `chore: add @floating-ui/react dependency for tooltip primitive`
2. `feat(tooltip): add Tooltip scaffold with disabled/null short-circuit`
3. `feat(tooltip): wire Floating UI hooks for hover, focus, dismiss, and a11y`
4. `test(tooltip): cover placement, maxWidth, ref preservation, and className`
5. `feat(workspace): migrate IconRail tooltip to new Tooltip primitive`
6. `feat(agent-status): reveal full event body via Tooltip on hover/focus`

Open a PR; the body should reference the spec at `docs/superpowers/specs/2026-04-23-tooltip-primitive-design.md` and the decision record at `docs/decisions/2026-04-22-tooltip-library.md`.
