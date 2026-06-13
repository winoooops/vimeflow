# Floating Surface Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a package-private `base/floating` substrate beneath three flat public primitives (`Dropdown`, `Menu`, `Popover`), migrate the six hand-rolled floating surfaces onto them, and close the `@floating-ui` ratchet 6 → 0.

**Architecture:** A `useFloatingSurface` hook + `SurfacePanel` component own all `@floating-ui/react` usage (positioning, dismiss, portal, glass chrome) under `src/components/base/floating/`; `base/OptionList` renders option rows shared by `Dropdown` and `Menu.Submenu`. Public `Dropdown`/`Menu`/`Popover` compose them and are the only floating UI that `src/features/**` imports. Three ESLint rings enforce the boundary.

**Tech Stack:** React 19 + TypeScript (strict), `@floating-ui/react`, Tailwind (Obsidian Lens tokens), Vitest + Testing Library (jsdom), ESLint flat config. ESM; no semicolons, single quotes, trailing commas es5, arrow-function components, explicit return types on exports.

**Spec:** `docs/superpowers/specs/2026-06-13-floating-surface-primitives-design.md` (read it first — §5 has the contracts, §7 the per-consumer behaviour matrix, §6 the lint rings).

**Conventions every task must follow:**
- Test co-location: each `Foo.tsx` has a sibling `Foo.test.tsx`. Every test file **must** `import { describe, test, expect, vi, beforeEach } from 'vitest'` explicitly (globals are runtime-only; `tsc -b` + lint-staged block the commit otherwise).
- Run a single file: `npx vitest run <path>`. Full gate before each PR: `npm run lint && npm run type-check && npm run test && npm run build`.
- Material Symbols render as ligature **text** if the name is invalid — verify any new icon in a browser, not just via `textContent`.
- The `@/components/*` alias and the `@floating-ui/react` features ratchet already exist (#440). This plan **tightens** the ratchet; it does not create it.

---

## File structure

**PR1 — substrate + `Dropdown`**

| Path | Responsibility |
| --- | --- |
| `src/components/base/floating/glassSurface.ts` | `GLASS_SURFACE` className constant; re-export `type Placement` from `@floating-ui/react` |
| `src/components/base/floating/useFloatingSurface.ts` | Hook: positioning + dismiss + role + optional list-nav. Returns refs/styles/context/get*Props. Only `@floating-ui` importer (with SurfacePanel) |
| `src/components/base/floating/SurfacePanel.tsx` | Portal + glass div + optional `FloatingFocusManager` |
| `src/components/base/OptionList.tsx` | Renders `DropdownOption[]` rows (label/description, selected highlight) |
| `src/components/Dropdown.tsx` | Public select; composes the substrate + `OptionList` |
| `src/features/diff/components/toolbar/Dropdown.tsx` | **Deleted** — diff toolbar imports `@/components/Dropdown` |
| `eslint.config.js` | Ring 1 (tighten) + Ring 2 (new) |
| `docs/design/UNIFIED.md`, `rules/typescript/coding-style/CLAUDE.md`, `AGENTS.md` | Doc stubs |

**PR2 — `Menu` + 3 migrations**

| Path | Responsibility |
| --- | --- |
| `src/components/Menu.tsx` | Compound menu: `Menu`, `Menu.Context`, `Menu.Section`, `Menu.Item`, `Menu.Checkbox`, `Menu.Submenu` |
| `src/features/diff/components/toolbar/ViewSettingsDropdown.tsx` | Rewritten on `Menu` + `Menu.Submenu`; sub-popover hand-roll deleted |
| `src/features/diff/components/toolbar/PriorityPlus.tsx` | Overflow list rewritten on `Menu` |
| `src/features/terminal/components/TerminalContextMenu.tsx` | Rewritten on `Menu.Context` |

**PR3 — `Popover` + 2 migrations + docs finalize**

| Path | Responsibility |
| --- | --- |
| `src/components/Popover.tsx` | Public dialog card on the substrate (role=dialog, modal focus) |
| `src/features/diff/components/FinishFeedbackPopover.tsx` | Rewritten on `Popover` |
| `src/features/diff/components/toolbar/DiffChipToolbar.tsx` | Confirm popover rewritten on `Popover` |

---

# PR1 — substrate + `Dropdown` (ratchet 6 → 5)

### Task 1: `glassSurface.ts` — chrome constant + Placement re-export

**Files:**
- Create: `src/components/base/floating/glassSurface.ts`
- Test: `src/components/base/floating/glassSurface.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { GLASS_SURFACE } from './glassSurface'

test('GLASS_SURFACE is the canonical glass-panel chrome', () => {
  expect(GLASS_SURFACE).toContain('rounded-lg')
  expect(GLASS_SURFACE).toContain('bg-surface-container-high/95')
  expect(GLASS_SURFACE).toContain('backdrop-blur-md')
  expect(GLASS_SURFACE).toContain('border-outline-variant/20')
  expect(GLASS_SURFACE).toContain('shadow-xl')
})
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './glassSurface'`). Run: `npx vitest run src/components/base/floating/glassSurface.test.ts`

- [ ] **Step 3: Implement** — port the canonical className from the current `src/features/diff/components/toolbar/Dropdown.tsx:138` (verify the exact line before copying):

```ts
// The one floating-panel chrome. Every floating surface renders this — no per-call-site restyle.
export const GLASS_SURFACE =
  'z-50 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl'

// The single floating-ui type the public primitives need. Re-exported so Dropdown/Menu/Popover
// type their `placement` prop without importing @floating-ui/react (ring 1 confines it here).
export type { Placement } from '@floating-ui/react'
```

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit:** `git add src/components/base/floating/glassSurface.* && git commit -m "feat(components): add base/floating glass-surface chrome constant"`

---

### Task 2: `useFloatingSurface` hook

**Files:**
- Create: `src/components/base/floating/useFloatingSurface.ts`
- Test: `src/components/base/floating/useFloatingSurface.test.tsx`

Port the floating-ui wiring that currently lives inline in `src/features/diff/components/toolbar/Dropdown.tsx:60-91` (`useFloating` with `offset(4)/flip()/shift({padding:8})` + `autoUpdate`, `useDismiss({ancestorScroll})`, `useRole`, `useListNavigation`, `useInteractions`) into a parameterized hook matching the spec §5.1 signature.

- [ ] **Step 1: Write the failing test** (smoke-test the return shape + that a virtual-point anchor is accepted — full behaviour is covered through `Dropdown` in Task 5):

```tsx
import { test, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFloatingSurface } from './useFloatingSurface'

test('returns ref setters, styles, context and prop getters', () => {
  const { result } = renderHook(() =>
    useFloatingSurface({ open: false, onOpenChange: () => {} })
  )
  expect(typeof result.current.refs.setReference).toBe('function')
  expect(typeof result.current.refs.setFloating).toBe('function')
  expect(typeof result.current.getReferenceProps).toBe('function')
  expect(typeof result.current.getFloatingProps).toBe('function')
  expect(typeof result.current.getItemProps).toBe('function')
  expect(result.current.context).toBeDefined()
})

test('accepts a virtual-point anchor without throwing', () => {
  const { result } = renderHook(() =>
    useFloatingSurface({ open: true, onOpenChange: () => {}, anchor: { x: 10, y: 20 }, role: 'menu' })
  )
  expect(result.current.floatingStyles).toBeDefined()
})
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/components/base/floating/useFloatingSurface.test.tsx`

- [ ] **Step 3: Implement** the hook. Signature per spec §5.1. Key logic:
  - `useFloating({ open, onOpenChange, placement = 'bottom-start', middleware: [offset(opts.offset ?? 4), flip({ fallbackPlacements: opts.fallbackPlacements }), shift({ padding: 8 })], whileElementsMounted: opts.middleware?.autoUpdate === false ? undefined : autoUpdate })`. (TerminalContextMenu passes `offset: 0` + explicit `fallbackPlacements`.)
  - When `anchor` is a `{x,y}` point, set a virtual reference via `refs.setPositionReference({ getBoundingClientRect })` (port the rect builder from `TerminalContextMenu.tsx:109-128`); when it is an `HTMLElement`, pass through `elements.reference`.
  - `useDismiss(context, { ancestorScroll: opts.middleware?.ancestorScroll !== false, outsidePress: opts.dismissWhen })`.
  - `useRole(context, { role: opts.role ?? 'menu' })`.
  - If `opts.list`, add `useListNavigation(context, { listRef: opts.list.ref, activeIndex: opts.list.activeIndex, onNavigate: opts.list.onNavigate, loop: opts.list.loop, disabledIndices: opts.list.disabledIndices, focusItemOnOpen: opts.list.focusItemOnOpen, openOnArrowKeyDown: opts.list.openOnArrowKeyDown })`.
  - `useInteractions([dismiss, role, ...listNav])`; return `{ refs, floatingStyles, context, getReferenceProps, getFloatingProps, getItemProps }`.
  - Explicit return type (define a `FloatingSurfaceApi` interface).

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit:** `git commit -am "feat(components): add useFloatingSurface hook"`

---

### Task 3: `SurfacePanel`

**Files:**
- Create: `src/components/base/floating/SurfacePanel.tsx`
- Test: `src/components/base/floating/SurfacePanel.test.tsx`

- [ ] **Step 1: Write the failing test:**

```tsx
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SurfacePanel } from './SurfacePanel'
import { useFloatingSurface } from './useFloatingSurface'

const Harness = ({ focus }: { focus?: false | { initialFocus?: number } }): React.ReactElement => {
  const fs = useFloatingSurface({ open: true, onOpenChange: () => {} })
  return (
    <SurfacePanel
      setFloating={fs.refs.setFloating}
      style={fs.floatingStyles}
      context={fs.context}
      focus={focus}
      {...fs.getFloatingProps()}
    >
      <button type="button">Item</button>
    </SurfacePanel>
  )
}

describe('SurfacePanel', () => {
  test('renders children on the canonical glass chrome (portaled)', () => {
    render(<Harness focus={false} />)
    const item = screen.getByRole('button', { name: 'Item' })
    expect(item.closest('div')?.className).toContain('rounded-lg')
    expect(item.closest('div')?.className).toContain('backdrop-blur-md')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement:** default `focus = false`. `FloatingPortal` → `FloatingFocusManager` **only when `focus` is an object** (passing `context`, `focus.initialFocus`, `focus.modal`); otherwise render the panel directly → `div ref={setFloating} style={{...style, width}} className={GLASS_SURFACE}`. No arbitrary `className` prop. Props per spec §5.1.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `git commit -am "feat(components): add SurfacePanel"`

---

### Task 4: `base/OptionList`

**Files:**
- Create: `src/components/base/OptionList.tsx`
- Test: `src/components/base/OptionList.test.tsx`

Port the option-row markup from `Dropdown.tsx:141-163` (the `w-full text-left px-3 py-1.5 hover:bg-surface-container-highest` button, label + optional description, `text-primary` when selected). Re-grep before porting — line numbers shift.

- [ ] **Step 1: Write the failing test:**

```tsx
import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OptionList } from './OptionList'

const OPTIONS = [
  { value: 'a', label: 'Apple', description: 'pome' },
  { value: 'b', label: 'Pear' },
] as const

test('renders options and reports selection', async () => {
  const onSelect = vi.fn()
  render(<OptionList options={OPTIONS} value="a" onSelect={onSelect} getItemProps={() => ({})} registerItem={() => {}} />)
  expect(screen.getByText('Apple')).toBeInTheDocument()
  expect(screen.getByText('pome')).toBeInTheDocument()
  await userEvent.click(screen.getByText('Pear'))
  expect(onSelect).toHaveBeenCalledWith('b')
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement:** maps `options` to `role="menuitem"` buttons; calls `onSelect(value)`; applies selected highlight; spreads `getItemProps`/`registerItem(index, node)` so the parent wires keyboard nav. Define `interface DropdownOption<T>` here as the single source — but it lives under `base/` (package-private). The public `Dropdown` (Task 5) **re-exports** the type so features import it from `@/components/Dropdown`, never from `@/components/base/*` (Ring 2). The old `./Dropdown` type is deleted in Task 6.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `git commit -am "feat(components): add base/OptionList shared renderer"`

---

### Task 5: `Dropdown` (public)

**Files:**
- Create: `src/components/Dropdown.tsx`
- Test: `src/components/Dropdown.test.tsx`

Compose `useFloatingSurface` (role `'menu'`, `list` for keyboard nav) + `SurfacePanel` + `OptionList`. Trigger markup ports from `Dropdown.tsx:100-132` (re-grep). Props per spec §5.2 (incl. `renderTrigger`). **Keep `role="menu"`/`menuitem`** (spec §2 — listbox is a deferred a11y change). **Re-export the type:** `export type { DropdownOption } from '@/components/base/OptionList'` so features import it from `@/components/Dropdown`, never from `base/`.

- [ ] **Step 1: Write the failing tests.** Port the FULL existing behaviour set from the old `src/features/diff/components/toolbar/Dropdown.test.tsx` (portal placement, arrow-key focus, outside-click dismiss, selected styling, descriptions, `leadingIcon`, numeric values) into `src/components/Dropdown.test.tsx`, and add `renderTrigger` coverage — these must land BEFORE Task 6 deletes the old file. The headline cases below also cover the substrate:

```tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dropdown } from './Dropdown'

const OPTIONS = [
  { value: 'mocha', label: 'Obsidian Lens' },
  { value: 'flexoki', label: 'Flexoki' },
] as const

describe('Dropdown', () => {
  test('opens on trigger click and lists options', async () => {
    render(<Dropdown label="Theme" value="mocha" options={OPTIONS} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Obsidian Lens/ }))
    expect(screen.getByText('Flexoki')).toBeInTheDocument()
  })

  test('selecting an option calls onChange and closes', async () => {
    const onChange = vi.fn()
    render(<Dropdown label="Theme" value="mocha" options={OPTIONS} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Obsidian Lens/ }))
    await userEvent.click(screen.getByText('Flexoki'))
    expect(onChange).toHaveBeenCalledWith('flexoki')
    expect(screen.queryByText('Flexoki')).not.toBeInTheDocument()
  })

  test('closes on Escape', async () => {
    render(<Dropdown label="Theme" value="mocha" options={OPTIONS} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Obsidian Lens/ }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Flexoki')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `Dropdown` per the composition above; `placement?: Placement` imported from `@/components/base/floating/glassSurface`.
- [ ] **Step 4: Run — expect PASS** (all three).
- [ ] **Step 5: Commit:** `git commit -am "feat(components): add public Dropdown on the floating substrate"`

---

### Task 6: Migrate the diff toolbar; delete the old `Dropdown` + its ratchet disable

**Files:**
- Delete: `src/features/diff/components/toolbar/Dropdown.tsx`
- Modify: every importer of the old path → `@/components/Dropdown` (grep below). `ViewSettingsDropdown.tsx`, `DiffChipToolbar.tsx`, and `toolbar/index.ts` import `DropdownOption` from `@/components/Dropdown` (the public re-export) — **not** from `base/`, which Ring 2 forbids (its consumer migration lands in PR2; this only fixes the import).

- [ ] **Step 1:** `grep -rn "toolbar/Dropdown" src --include='*.tsx' --include='*.ts'` — list importers. Repoint each to `@/components/Dropdown` (both `Dropdown` and the re-exported `DropdownOption`).
- [ ] **Step 2:** Delete `src/features/diff/components/toolbar/Dropdown.tsx` and its `src/features/diff/components/toolbar/Dropdown.test.tsx` if present. Remove the file-level `@floating-ui` eslint-disable that named this file (the ratchet decrement).
- [ ] **Step 3: Run the diff-toolbar tests** that exercise the dropdown (e.g. theme/layout selectors). Run: `npx vitest run src/features/diff`. Expected: PASS (behaviour preserved).
- [ ] **Step 4:** `npm run lint` — expect green (one fewer floating-ui disable; no new violations).
- [ ] **Step 5: Commit:** `git commit -am "refactor(diff): use shared Dropdown; drop the toolbar's floating-ui disable (ratchet 6->5)"`

---

### Task 7: ESLint rings 1 + 2

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1:** Apply **Ring 1** exactly as spec §6 (widen the existing `@floating-ui/react` `@typescript-eslint/no-restricted-imports` from `src/features/**` to `files: ['src/**/*.{ts,tsx}']` with `ignores: ['src/components/base/floating/**', 'src/components/Tooltip.tsx']`; **no `allowTypeImports`**).
- [ ] **Step 2:** Add **Ring 2** exactly as spec §6 (`files: ['src/**/*.{ts,tsx}'], ignores: ['src/components/**']`, `no-restricted-imports` `patterns` banning the `@/components/base` group). Mirror #440's `regex` rule for the canonical alias spelling.
- [ ] **Step 3: Prove the rings** with the same synthetic check codex used — create `/tmp/ring-check.mjs` linting fixtures: `@floating-ui` import in `src/App.tsx` (value + `import type`) → **error**; in `base/floating/**` + `Tooltip.tsx` → **ok**; `@/components/base/floating` import in `src/hooks/x.ts` and `src/features/x.tsx` → **error**; in `src/components/Menu.tsx` → **ok**. Run: `node /tmp/ring-check.mjs`. Expected: errors/oks as listed.
- [ ] **Step 4:** `npm run lint` on the repo — expect green (remaining 5 grandfathered popovers still carry their disables).
- [ ] **Step 5: Commit:** `git commit -am "build(eslint): confine @floating-ui to base/floating; make components/base package-private"`

---

### Task 8: Doc stubs + PR1 verification gate

**Files:** `docs/design/UNIFIED.md`, `rules/typescript/coding-style/CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1:** Add UNIFIED.md `§5.7 Dropdown` (mirror the §5.6 Tooltip format: interface + Rules). Add the `base/` convention to coding-style "Shared UI Primitives" (spec §4 definition). Extend the AGENTS.md primitives line (spec §8).
- [ ] **Step 2: Full gate:** `npm run lint && npm run type-check && npm run test && npm run build` — all green.
- [ ] **Step 3:** `codex review --base main` from the worktree (proxy cleared, `< /dev/null`, no `--model`) → resolve to clean. `git checkout -- src/bindings/` if it dirties them.
- [ ] **Step 4: Open PR1** against `feat/floating-surface-primitives`. Body: "ratchet 6→5; substrate + Dropdown. Part of VIM-116."

---

# PR2 — `Menu` (compound + context mode) + 3 migrations (ratchet 5 → 2)

> `Menu` is the deep module the spec's §5.3 + the IDEA Danger field are about: keep its interface the compound subcomponents; it owns submenu lifecycle. Build it test-first against the three real consumers' behaviour (spec §7 matrix).

### Task 9: `Menu` core (`Menu` + `Menu.Section` + `Menu.Item`)

**Files:** Create `src/components/Menu.tsx`, `src/components/Menu.test.tsx`

- [ ] **Step 1: Failing test** — `Menu` with a `trigger` opens on click; `Menu.Item` fires `onSelect` and closes; `Menu.Item disabled` does not fire; `Escape`/outside-press dismiss. (Write concrete tests mirroring the Task 5 shape.)
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement** `Menu` on `useFloatingSurface({ role: 'menu', list })` + `SurfacePanel`. Compound parts via context: `Menu.Section` (header + group), `Menu.Item` (`role=menuitem`, shortcut chip ported from `TerminalContextMenu.tsx:48-50`, `disabled` → `aria-disabled` + skip in `disabledIndices`).
- [ ] **Step 4:** Run — PASS. **Step 5:** Commit.

### Task 10: `Menu.Checkbox` + `Menu.Submenu`

- [ ] **Step 1: Failing test** — `Menu.Checkbox` toggles `onChange(!checked)` and shows the check indicator; `Menu.Submenu` opens a sub-list, selecting an option calls its `onChange` and **closes only the submenu** (parent stays open); opening a second submenu closes the first.
- [ ] **Step 2–4:** Implement: `Menu.Checkbox` ports `CheckIndicator` from `ViewSettingsDropdown.tsx:128-145`. `Menu.Submenu` renders a `Menu.Item` row that anchors a second `useFloatingSurface` whose body is `OptionList`; the parent `Menu` owns one-open-submenu state and registers each submenu's portal root so the parent `dismissWhen` ignores presses inside it (port the `[data-view-sub-menu]` predicate from `ViewSettingsDropdown.tsx:246-259`). **Step 5:** Commit.

### Task 11: `Menu.Context` (cursor-anchored, controlled)

- [ ] **Step 1: Failing test** — `Menu.Context` rendered with `open` + `position={{x,y}}` shows items at that point; `onOpenChange(false)` on outside-press/Escape; a `disabled` first item is skipped by arrow-key nav; focus is non-modal.
- [ ] **Step 2–4:** Implement on `useFloatingSurface({ anchor: position, role: 'menu', list: { disabledIndices } })` + `SurfacePanel focus={{ modal: false }}`. Port the virtual-rect builder behaviour (now in the hook from Task 2) and `openOnArrowKeyDown: false` semantics from `TerminalContextMenu.tsx`. **Step 5:** Commit.

### Task 12: Migrate `ViewSettingsDropdown` → `Menu` (ratchet 5 → 4)

- [ ] **Step 1:** Rewrite `ViewSettingsDropdown.tsx` as a `Menu` with two `Menu.Section`s: Format (two `Menu.Submenu` for Indicators/Overflow, options = the existing `INDICATOR_OPTIONS`/`OVERFLOW_OPTIONS`) + View options (four `Menu.Checkbox`). Delete the hand-rolled `Row`/`CheckIndicator`/`SubDropdownPopover` and all three inline `useFloating` calls. Remove its floating-ui disable.
- [ ] **Step 2:** Keep its existing test file green; update only DOM-structure assertions the rewrite changes (preserve behaviour assertions). Run: `npx vitest run src/features/diff/components/toolbar`.
- [ ] **Step 3:** `npm run lint` green. **Step 4: Commit** `refactor(diff): ViewSettings on shared Menu (ratchet 5->4)`.

### Task 13: Migrate `PriorityPlus` → `Menu` (ratchet 4 → 3)

- [ ] **Step 1:** Replace the overflow popover with a `Menu` of `Menu.Item`s. **Preserve the manual window-scroll-dismiss** (spec §7) — pass it through `dismissWhen`/an effect; do not silently adopt `ancestorScroll`. Remove its floating-ui disable.
- [ ] **Step 2–4:** Tests green (`npx vitest run src/features/diff/components/toolbar`); lint green; commit.

### Task 14: Migrate `TerminalContextMenu` → `Menu.Context` (ratchet 3 → 2)

- [ ] **Step 1:** Replace the component body with `Menu.Context` (`open={isOpen}`, `position`, `onOpenChange`); the two items become `Menu.Item` (Copy with `canCopy`-driven `disabled`, Paste), shortcuts via the `shortcut` prop. Remove its floating-ui disable. **Preserve no-autoUpdate / no-ancestorScroll / non-modal focus** (spec §7).
- [ ] **Step 2–4:** Run `npx vitest run src/features/terminal` — preserve the copy/paste + platform-shortcut assertions; lint green; commit. **PR2 gate:** full gate + `codex review --base main` to clean; open PR2.

---

# PR3 — `Popover` + 2 migrations + docs finalize (ratchet 2 → 0)

### Task 15: `Popover` (public)

**Files:** Create `src/components/Popover.tsx`, `src/components/Popover.test.tsx`

- [ ] **Step 1: Failing test** — renders `children` on glass chrome anchored to `anchor`, `role="dialog"` with the required `aria-label`, dismisses on outside-press/Escape via `onOpenChange`, focus is modal (`initialFocus -1`).
- [ ] **Step 2–4:** Implement on `useFloatingSurface({ role: 'dialog', middleware: props.middleware })` + `SurfacePanel focus={{ initialFocus: -1, modal: true }}`. Forward the optional `middleware` prop (spec §5.4 — e.g. `{ ancestorScroll: false }` for Task 17). Port the surface usage from `FinishFeedbackPopover.tsx:33-61` (re-grep). **Step 5:** Commit.

### Task 16: Migrate `FinishFeedbackPopover` → `Popover` (ratchet 2 → 1)

- [ ] **Step 1:** Keep the three `result.kind` body branches verbatim; replace the outer `useFloating`/`FloatingFocusManager`/glass div with `<Popover anchor={anchor} open onOpenChange={…} aria-label="Finish feedback">`. Remove its floating-ui disable.
- [ ] **Step 2–4:** `npx vitest run src/features/diff` green; lint green; commit.

### Task 17: Migrate `DiffChipToolbar` confirm → `Popover` (ratchet 1 → 0)

- [ ] **Step 1:** Replace the confirm-dialog floating surface (`DiffChipToolbar.tsx:333-357`, re-grep) with `Popover`. **Preserve its plain dismiss** (spec §7 — no `ancestorScroll`): pass `middleware={{ ancestorScroll: false }}` (Popover exposes it, Task 15). Remove the **last** floating-ui disable.
- [ ] **Step 2:** `npm run lint` — Ring 1 now stands with **zero** feature exceptions (only `base/floating` + `Tooltip` remain). Confirm: `grep -rn "@floating-ui/react" src/features` → no value imports.
- [ ] **Step 3:** Finalize docs — UNIFIED.md `§5.8 Menu` (incl. `Menu.Context`) + `§5.9 Popover`; complete the coding-style + AGENTS lines.
- [ ] **Step 4: Full gate** + `codex review --base main` clean. Open PR3.

### Task 18: Final integration → main

- [ ] **Step 1:** Confirm `Done when` (spec §11) line-by-line: substrate + 3 primitives exist; 6 consumers migrated; 6 disables deleted; rings green; `@floating-ui` only in `base/floating` + `Tooltip`; docs in three places.
- [ ] **Step 2:** Open the `feat/floating-surface-primitives` → `main` PR. Body closes the VIM-116 floating-surface sub-issue (magic word adjacent to the unformatted id).

---

## Self-review (author checklist — completed)

- **Spec coverage:** §3 layout → File-structure + Tasks 1–4, 9–11, 15. §5.1 substrate → T1–3. §5.2 Dropdown → T5. §5.3 Menu/Context/Submenu → T9–11. §5.4 Popover → T15. §6 rings → T7 (+ verified in T7.3). §7 matrix → preserved per-migration in T13/T14/T17 (manual-scroll, no-autoUpdate/non-modal, plain-dismiss called out). §8 docs → T8 + T17.3. §9 PR slicing → PR1/2/3 headers. §2 deltas → T5 (role=menu kept), terminal-chrome convergence inherent in `GLASS_SURFACE` (T1).
- **Placeholder scan:** none — migration steps reference exact source `file:line` to port (verbatim-port contract), not "TODO".
- **Type consistency:** `DropdownOption` defined once in `base/OptionList` (T4), consumed by `Dropdown` (T5) and `Menu.Submenu` (T10); `Placement` re-exported once (T1) and used by every primitive; `useFloatingSurface` return shape (T2) consumed unchanged by `SurfacePanel`/`Dropdown`/`Menu`/`Popover`.
