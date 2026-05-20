# Icon Rail Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md` (committed + codex-reviewed)

**Goal:** Trim the workspace icon rail to identity + global utilities per the handoff at `docs/design/rail/CHANGES.md`, hoist `useCommandPalette` into `WorkspaceView` so the rail can open the palette programmatically, stub the Settings gear with an `aria-disabled` tooltip pointing at a follow-up issue, and bring `docs/design/UNIFIED.md` in sync with the actual implementation.

**Architecture:** Hook-hoist via props pattern (spec §6). `CommandPalette` becomes a controlled render component. `IconRail` body is hardcoded with the new bottom buttons + optional `identity` prop. `UNIFIED.md` is updated at five lines so the post-merge design contract is accurate.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Testing Library + Vitest. No backend / Rust changes.

**File map (lifted from spec §7):**

- Create: `src/features/command-palette/CommandPalette.testUtils.tsx`
- Modify: `src/features/command-palette/CommandPalette.tsx`
- Modify: `src/features/command-palette/CommandPalette.test.tsx`
- Modify: `src/features/workspace/components/IconRail.tsx`
- Modify: `src/features/workspace/components/IconRail.test.tsx` (effective rewrite)
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.command-palette.test.tsx` (rail-click case + mock update)
- Modify: `src/features/workspace/data/mockNavigation.ts`
- Modify: `src/features/workspace/data/mockNavigation.test.ts` (rewrite)
- Modify: `docs/design/UNIFIED.md` (lines 47, 48, 51, 193, 212)

**Atomic commit boundaries (per spec §11.1):**

1. Palette hoist + WorkspaceView palette wiring — Task 1.
2. Rail rewrite + WorkspaceView rail wiring + mockNavigation + tests — Task 2.
3. UNIFIED.md doc sync — Task 3.

Each commit must keep `npm run type-check` clean.

---

## Task 1: Hoist `useCommandPalette` into `WorkspaceView`

Refactors `CommandPalette` into a controlled render component and moves the hook call up into `WorkspaceView`. The component's render body and the hook's internals are unchanged; only the call site moves and the prop shape inverts. The `Ctrl+:` keyboard listener stays inside the hook and continues to work bit-for-bit (spec §6.4).

**Files:**

- Create: `src/features/command-palette/CommandPalette.testUtils.tsx`
- Modify: `src/features/command-palette/CommandPalette.tsx`
- Modify: `src/features/command-palette/CommandPalette.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`

---

- [ ] **Step 1.1: Sanity-check current `CommandPalette.tsx` hook destructure**

  Run: `sed -n '13,25p' src/features/command-palette/CommandPalette.tsx`

  Expected output (six destructured fields from `useCommandPalette`):

  ```
  export const CommandPalette = ({
    commands,
  }: CommandPaletteProps = {}): ReactElement | null => {
    const {
      state,
      filteredResults,
      clampedSelectedIndex,
      close,
      setQuery,
      selectIndex,
    } = useCommandPalette(commands)
  ```

  Confirms no upstream refactor landed between spec-time and execution-time. If the destructure differs, stop and reconcile with spec §7.2 before continuing.

- [ ] **Step 1.2: Write the failing test (controlled `state.isOpen`)**

  File: `src/features/command-palette/CommandPalette.test.tsx`

  Add this test alongside the existing cases (imports come from the helper that doesn't exist yet — the import error is the first signal of failure):

  ```tsx
  import { renderPalette } from './CommandPalette.testUtils'

  test('does not render the dialog when state.isOpen is false', () => {
    const { utils } = renderPalette({ state: { isOpen: false } })
    expect(utils.queryByRole('dialog')).toBeNull()
  })

  test('renders the dialog when state.isOpen is true', () => {
    const { utils } = renderPalette({ state: { isOpen: true } })
    expect(
      utils.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })

  test('calls close when the backdrop is clicked', async () => {
    const { close, utils } = renderPalette({ state: { isOpen: true } })
    // Backdrop is the absolute-inset-0 sibling of the panel
    const backdrop = utils.container.querySelector(
      'div.absolute.inset-0'
    ) as HTMLElement
    expect(backdrop).not.toBeNull()
    backdrop.click()
    expect(close).toHaveBeenCalledTimes(1)
  })
  ```

  Also remove any existing test that depends on the internal hook's `Ctrl+:` listener — those move to `useCommandPalette.test.ts` (already covered there).

- [ ] **Step 1.3: Run the test, expect FAIL (import error)**

  Run: `npx vitest run src/features/command-palette/CommandPalette.test.tsx`

  Expected: `Error: Failed to load url ./CommandPalette.testUtils` (or equivalent module-not-found message). This confirms the helper file is the missing piece.

- [ ] **Step 1.4: Create `CommandPalette.testUtils.tsx`**

  File: `src/features/command-palette/CommandPalette.testUtils.tsx`

  Contents (verbatim from spec §9.2):

  ```tsx
  // src/features/command-palette/CommandPalette.testUtils.tsx
  // Co-located with the file it supports — the project does not
  // use separate `__test-helpers__` directories.
  //
  // Explicit `vi` import: this file is NOT a `*.test.*` file, so
  // ESLint does not grant Vitest globals here and tsconfig.json
  // does not declare them. Without the explicit import, every
  // `vi.fn()` and `ReturnType<typeof vi.fn>` below would fail
  // type-check.
  import { vi } from 'vitest'
  import { render } from '@testing-library/react'
  import { CommandPalette } from './CommandPalette'
  import type { CommandPaletteState, Command } from './registry/types'

  export interface RenderPaletteOptions {
    state?: Partial<CommandPaletteState>
    filteredResults?: Command[]
    clampedSelectedIndex?: number
  }

  const defaultState: CommandPaletteState = {
    isOpen: true,
    query: ':',
    selectedIndex: 0,
    currentNamespace: null,
  }

  export const renderPalette = (
    options: RenderPaletteOptions = {}
  ): {
    close: ReturnType<typeof vi.fn>
    setQuery: ReturnType<typeof vi.fn>
    selectIndex: ReturnType<typeof vi.fn>
    utils: ReturnType<typeof render>
  } => {
    const close = vi.fn()
    const setQuery = vi.fn()
    const selectIndex = vi.fn()
    const utils = render(
      <CommandPalette
        state={{ ...defaultState, ...options.state }}
        filteredResults={options.filteredResults ?? []}
        clampedSelectedIndex={options.clampedSelectedIndex ?? -1}
        close={close}
        setQuery={setQuery}
        selectIndex={selectIndex}
      />
    )
    return { close, setQuery, selectIndex, utils }
  }
  ```

- [ ] **Step 1.5: Run the test, expect FAIL (palette ignores new props)**

  Run: `npx vitest run src/features/command-palette/CommandPalette.test.tsx`

  Expected: The new cases fail because React silently ignores unknown DOM-prop-style props on a custom component — the existing `CommandPalette` (which still calls its internal `useCommandPalette()`) reads `commands` and nothing else. The new test cases either:
  - `queryByRole('dialog')` returns null when `state.isOpen` is `true` (the prop is ignored; the internal hook keeps `isOpen` at `false` because no `Ctrl+:` was pressed), so the `getByRole(... 'Command palette')` assertion throws "Unable to find role dialog"; OR
  - The backdrop click never fires the `close` spy because the backdrop element wasn't rendered.

  TypeScript will NOT raise an error at this stage because `npx vitest run` does not run `tsc -b` and React itself does not validate prop shape. Run `npm run type-check` separately if you want to see the TS-level mismatch; that's not required for this step.

- [ ] **Step 1.6: Refactor `CommandPalette.tsx` to controlled props**

  File: `src/features/command-palette/CommandPalette.tsx`

  Replace the prop signature and the destructure block. The render body (AnimatePresence wrapper, motion.div panel, CommandInput / CommandResults / CommandFooter) is preserved verbatim from the current file:

  ```tsx
  import { AnimatePresence, motion } from 'framer-motion'
  import type { ReactElement } from 'react'
  import { CommandInput } from './components/CommandInput'
  import { CommandResults } from './components/CommandResults'
  import { CommandFooter } from './components/CommandFooter'
  import type { Command, CommandPaletteState } from './registry/types'

  export interface CommandPaletteProps {
    state: CommandPaletteState
    filteredResults: Command[]
    clampedSelectedIndex: number
    close: () => void
    setQuery: (query: string) => void
    selectIndex: (index: number) => void
  }

  export const CommandPalette = ({
    state,
    filteredResults,
    clampedSelectedIndex,
    close,
    setQuery,
    selectIndex,
  }: CommandPaletteProps): ReactElement | null => {
    return (
      <AnimatePresence>
        {state.isOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 backdrop-blur-sm bg-black/40"
              onClick={close}
            />

            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: -8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: -8 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 30,
              }}
              className="relative w-full max-w-2xl mx-4 bg-[#1e1e2e]/90 glass-panel rounded-2xl border border-[#4a444f]/30 shadow-2xl overflow-hidden flex flex-col h-fit"
            >
              <CommandInput
                value={state.query}
                onChange={setQuery}
                activeDescendantId={
                  clampedSelectedIndex >= 0
                    ? `command-${filteredResults[clampedSelectedIndex].id}`
                    : undefined
                }
              />

              <div className="h-px bg-surface-container-low/30" />

              <CommandResults
                filteredResults={filteredResults}
                selectedIndex={clampedSelectedIndex}
                onSelect={selectIndex}
              />

              <div className="h-px bg-surface-container-low/30" />
              <CommandFooter />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    )
  }
  ```

  Delete the now-unused `useCommandPalette` import.

- [ ] **Step 1.7: Run the test, expect PASS**

  Run: `npx vitest run src/features/command-palette/CommandPalette.test.tsx`

  Expected: PASS (all three new cases + any preserved existing cases that don't depend on the internal hook listener).

- [ ] **Step 1.8: Verify the hook's own tests stay green**

  Run: `npx vitest run src/features/command-palette/hooks/`

  Expected: PASS for both `useCommandPalette.test.ts` and `useCommandPalette.staleClosure.test.ts`. These exercise the hook directly; the hoist doesn't touch the hook's internals.

- [ ] **Step 1.9: Wire `useCommandPalette` into `WorkspaceView.tsx`**

  File: `src/features/workspace/WorkspaceView.tsx`

  Add the import next to the other command-palette import (currently around line 31):

  ```tsx
  import { CommandPalette } from '../command-palette/CommandPalette'
  import { useCommandPalette } from '../command-palette/hooks/useCommandPalette'
  ```

  Inside the `WorkspaceView` render body, immediately after the `workspaceCommands` `useMemo` (the block ending around line 179), add:

  ```tsx
  const commandPalette = useCommandPalette(workspaceCommands)
  ```

  Replace the existing `<CommandPalette commands={workspaceCommands} />` (currently line 920) with:

  ```tsx
  <CommandPalette
    state={commandPalette.state}
    filteredResults={commandPalette.filteredResults}
    clampedSelectedIndex={commandPalette.clampedSelectedIndex}
    close={commandPalette.close}
    setQuery={commandPalette.setQuery}
    selectIndex={commandPalette.selectIndex}
  />
  ```

- [ ] **Step 1.10: Run type-check + full test suite**

  Run: `npm run type-check && npx vitest run`

  Expected: `tsc -b` exits 0; all tests pass. In particular: `WorkspaceView.command-palette.test.tsx` stays green because the `Ctrl+:` listener is still mounted via the hook, just from a different component.

- [ ] **Step 1.11: Commit Task 1**

  ```bash
  git add src/features/command-palette/CommandPalette.tsx \
          src/features/command-palette/CommandPalette.test.tsx \
          src/features/command-palette/CommandPalette.testUtils.tsx \
          src/features/workspace/WorkspaceView.tsx
  git commit -m "refactor(command-palette): hoist useCommandPalette into WorkspaceView"
  ```

---

## Task 2: Trim the icon rail + wire the command button

Rewrites `IconRail.tsx` per spec §7.1, empties `mockNavigationItems`, rewrites `mockNavigation.test.ts` + `IconRail.test.tsx`, updates the `WorkspaceView` call site to pass the new required `settingsIssueNumber`, and adds the rail-click open-path case to `WorkspaceView.command-palette.test.tsx`.

This commit is atomic because adding the new required `settingsIssueNumber` prop forces the `WorkspaceView` call site to update at the same instant the rail's prop interface changes.

**Files:**

- Modify: `src/features/workspace/components/IconRail.tsx`
- Modify: `src/features/workspace/components/IconRail.test.tsx` (effective rewrite)
- Modify: `src/features/workspace/data/mockNavigation.ts`
- Modify: `src/features/workspace/data/mockNavigation.test.ts` (rewrite)
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.command-palette.test.tsx` (mock update + new case)

---

- [ ] **Step 2.1: Empty `mockNavigationItems` and rewrite its test**

  File: `src/features/workspace/data/mockNavigation.ts` — replace entire contents with the spec §7.4 shape:

  ```ts
  import type { NavigationItem } from '../types'

  // Kept for one cycle so external callers compile. The rail body
  // no longer iterates this array — see
  // docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md §7.1.
  // A follow-up cleanup PR removes both exports once the Settings
  // dialog lands.
  export const mockNavigationItems: NavigationItem[] = []

  export const mockSettingsItem: NavigationItem = {
    id: 'settings',
    name: 'Settings',
    icon: 'settings',
    color: 'bg-indigo-500',
    onClick: (): void => {
      // No-op; the rail's settings button is aria-disabled and
      // does not consult this handler.
    },
  }
  ```

  File: `src/features/workspace/data/mockNavigation.test.ts` — replace entire contents with the spec §9.5 shape:

  ```ts
  import { describe, test, expect } from 'vitest'
  import { mockNavigationItems, mockSettingsItem } from './mockNavigation'

  describe('mockNavigation', () => {
    test('mockNavigationItems is empty during the deprecation cycle', () => {
      expect(mockNavigationItems).toHaveLength(0)
    })

    test('mockSettingsItem keeps its shape for backward-compat callers', () => {
      expect(mockSettingsItem).toMatchObject({
        id: 'settings',
        name: 'Settings',
        icon: 'settings',
        color: 'bg-indigo-500',
      })
      expect(typeof mockSettingsItem.onClick).toBe('function')
    })
  })
  ```

- [ ] **Step 2.2: Rewrite `IconRail.test.tsx` with failing cases**

  File: `src/features/workspace/components/IconRail.test.tsx` — replace entire contents with the cases per spec §9.1:

  ```tsx
  import { describe, test, expect, vi } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { IconRail } from './IconRail'

  describe('IconRail', () => {
    test('renders the identity slot with default "w"', () => {
      render(<IconRail settingsIssueNumber={1} />)
      const avatar = screen.getByRole('img', { name: 'Account' })
      expect(avatar).toHaveTextContent('w')
    })

    test('renders a custom initial from identity prop', () => {
      render(<IconRail settingsIssueNumber={1} identity={{ initial: 'M' }} />)
      expect(screen.getByRole('img', { name: 'Account' })).toHaveTextContent(
        'M'
      )
    })

    test('truncates a multi-char initial to the first grapheme', () => {
      render(<IconRail settingsIssueNumber={1} identity={{ initial: 'AB' }} />)
      expect(screen.getByRole('img', { name: 'Account' })).toHaveTextContent(
        'A'
      )
    })

    test('preserves an emoji grapheme via Array.from', () => {
      render(<IconRail settingsIssueNumber={1} identity={{ initial: '🚀' }} />)
      expect(screen.getByRole('img', { name: 'Account' })).toHaveTextContent(
        '🚀'
      )
    })

    test('falls back to "Account" when ariaLabel is an empty string', () => {
      render(
        <IconRail
          settingsIssueNumber={1}
          identity={{ initial: 'w', ariaLabel: '' }}
        />
      )
      const avatar = screen.getByRole('img', { name: 'Account' })
      expect(avatar.getAttribute('aria-label')).toBe('Account')
    })

    test('renders the command palette button with stable aria-label', () => {
      render(<IconRail settingsIssueNumber={1} />)
      const button = screen.getByRole('button', { name: 'Command Palette' })
      expect(button).toBeInTheDocument()
      // The icon glyph span MUST be hidden from assistive tech.
      const iconSpan = button.querySelector('.material-symbols-outlined')
      expect(iconSpan?.getAttribute('aria-hidden')).toBe('true')
    })

    test('fires onCommand when the command palette button is clicked', () => {
      const onCommand = vi.fn()
      render(<IconRail settingsIssueNumber={1} onCommand={onCommand} />)
      screen.getByRole('button', { name: 'Command Palette' }).click()
      expect(onCommand).toHaveBeenCalledTimes(1)
    })

    test('renders the settings button as aria-disabled and interpolates the issue number on hover', async () => {
      const user = userEvent.setup()
      render(<IconRail settingsIssueNumber={42} />)
      const settings = screen.getByRole('button', { name: 'Settings' })
      expect(settings.getAttribute('aria-disabled')).toBe('true')

      // The Tooltip primitive (src/components/Tooltip.tsx) wraps
      // the button with Floating UI's `useRole({ role: 'tooltip' })`
      // and renders the tooltip body inside a FloatingPortal only
      // while the target is hovered or focused. Drive that path
      // explicitly — without the hover, no tooltip element exists.
      await user.hover(settings)
      const tooltip = await screen.findByRole('tooltip')
      expect(tooltip).toHaveTextContent('Settings panel coming — see issue #42')
    })

    test('does NOT fire onSettings when the disabled gear is clicked', () => {
      const onSettings = vi.fn()
      render(<IconRail settingsIssueNumber={42} onSettings={onSettings} />)
      screen.getByRole('button', { name: 'Settings' }).click()
      expect(onSettings).not.toHaveBeenCalled()
    })

    test('ignores items and settingsItem props (backward-compat seam)', () => {
      const noop = (): void => {}
      render(
        <IconRail
          settingsIssueNumber={1}
          items={[
            {
              id: 'a',
              name: 'A',
              icon: 'add',
              color: 'bg-red-500',
              onClick: noop,
            },
          ]}
          settingsItem={{
            id: 'settings',
            name: 'Settings',
            icon: 'settings',
            color: 'bg-indigo-500',
            onClick: noop,
          }}
        />
      )
      // Only the rail's hardcoded bottom buttons render; the items
      // array is iterated nowhere in the new body.
      expect(screen.queryAllByRole('button')).toHaveLength(2)
      expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
    })
  })
  ```

  Notes for the implementer:
  - The Settings tooltip assertion (`'issue #42'`) is defensive — it accepts either a `title` attribute or a Tooltip-primitive data attribute. Read `src/components/Tooltip.tsx` and adjust the assertion to match the actual rendered structure if neither holds. The spec contract is that the tooltip text contains the substring `issue #42`; how it lands in the DOM is the Tooltip primitive's concern.

- [ ] **Step 2.3: Run the rail tests, expect FAIL across the board**

  Run: `npx vitest run src/features/workspace/components/IconRail.test.tsx src/features/workspace/data/mockNavigation.test.ts`

  Expected: `IconRail.test.tsx` cases all fail (component still uses the old shape). `mockNavigation.test.ts` cases fail because the data file was emptied in Step 2.1 but the test still references the old structure — that test should now PASS since both files were rewritten in lockstep. Confirm `mockNavigation.test.ts` passes; if it fails, re-read Step 2.1 to verify the data file was overwritten correctly.

- [ ] **Step 2.4: Rewrite `IconRail.tsx`**

  File: `src/features/workspace/components/IconRail.tsx` — replace entire contents with the spec §7.1 implementation:

  ```tsx
  import type { ReactElement } from 'react'
  import { Tooltip } from '../../../components/Tooltip'
  import type { NavigationItem } from '../types'

  export interface IconRailIdentity {
    initial: string
    ariaLabel?: string
  }

  export interface IconRailProps {
    settingsIssueNumber: number
    onCommand?: () => void
    onSettings?: () => void
    identity?: IconRailIdentity
    items?: NavigationItem[]
    settingsItem?: NavigationItem
  }

  interface RailBtnProps {
    icon: string
    accessibleName: string
    tooltipContent: string
    onClick?: () => void
    ariaDisabled?: boolean
  }

  const RailBtn = ({
    icon,
    accessibleName,
    tooltipContent,
    onClick,
    ariaDisabled = false,
  }: RailBtnProps): ReactElement => (
    <Tooltip content={tooltipContent} placement="right">
      <button
        type="button"
        aria-label={accessibleName}
        aria-disabled={ariaDisabled || undefined}
        onClick={(): void => {
          if (ariaDisabled) {
            return
          }
          onClick?.()
        }}
        className={`
          flex h-[34px] w-[34px] items-center justify-center rounded-lg
          border border-transparent transition-colors duration-150 ease-out
          ${
            ariaDisabled
              ? 'cursor-not-allowed text-on-surface-muted/60'
              : 'cursor-pointer text-on-surface-muted hover:bg-primary/[0.06] hover:text-primary'
          }
        `}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px]"
        >
          {icon}
        </span>
      </button>
    </Tooltip>
  )

  export const IconRail = ({
    settingsIssueNumber,
    onCommand,
    onSettings,
    identity,
  }: IconRailProps): ReactElement => {
    const initial = Array.from(identity?.initial ?? 'w')[0] ?? 'w'
    const accountLabel = identity?.ariaLabel || 'Account'
    const settingsTooltip = `Settings panel coming — see issue #${settingsIssueNumber}`

    return (
      <nav
        data-testid="icon-rail"
        className="
          relative z-[5] flex h-full w-12 flex-col items-center
          bg-surface-container-lowest border-r border-outline-variant/25
          py-2.5
        "
      >
        <Tooltip content={accountLabel} placement="right">
          <div
            role="img"
            aria-label={accountLabel}
            className="
              mb-3.5 h-[30px] w-[30px] grid place-items-center
              rounded-full border border-primary/35
              bg-[linear-gradient(135deg,theme(colors.primary-deep),theme(colors.surface-container-low))]
              font-display text-[12px] font-semibold text-primary
              shadow-[0_4px_18px_rgba(203,166,247,0.25)]
            "
          >
            {initial}
          </div>
        </Tooltip>

        <div className="flex-1" aria-hidden="true" />

        <div className="flex flex-col gap-1">
          <RailBtn
            icon="search"
            accessibleName="Command Palette"
            tooltipContent="Command Palette (Ctrl+:)"
            onClick={onCommand}
          />
          <RailBtn
            icon="settings"
            accessibleName="Settings"
            tooltipContent={settingsTooltip}
            ariaDisabled
            onClick={onSettings}
          />
        </div>
      </nav>
    )
  }
  ```

- [ ] **Step 2.5: Run the rail tests, expect PASS**

  Run: `npx vitest run src/features/workspace/components/IconRail.test.tsx`

  Expected: All 10 cases pass. If the Settings-tooltip case fails because the Tooltip primitive doesn't expose the content the way the test queries it, open `src/components/Tooltip.tsx`, adjust the test's DOM query to match the Tooltip's actual rendering, and re-run. The spec contract is the substring `issue #42` in the tooltip content; how the Tooltip primitive surfaces that is implementation detail.

- [ ] **Step 2.6: Update `WorkspaceView.tsx` to pass the new rail props**

  File: `src/features/workspace/WorkspaceView.tsx`

  Near the top of the file (after the existing imports, before the `SIDEBAR_MIN` constant block around line 64), declare the issue-number constant:

  ```tsx
  // Filed before merge — see the PR description for the issue body.
  // `0` is intentionally a loud placeholder; the gear tooltip
  // renders "see issue #0" so a missed pre-merge bump is obvious.
  const SETTINGS_FOLLOWUP_ISSUE_NUMBER = 0
  ```

  Update the rail call site (currently `<IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />` on line 753):

  ```tsx
  <IconRail
    settingsIssueNumber={SETTINGS_FOLLOWUP_ISSUE_NUMBER}
    onCommand={commandPalette.open}
    items={mockNavigationItems}
    settingsItem={mockSettingsItem}
  />
  ```

  Notes:
  - `onSettings` is intentionally omitted (the button is `aria-disabled`; the spec calls out that omitting the prop is the correct way to express "no destination yet").
  - `items` / `settingsItem` are kept for one cycle for backward compat (spec §2). Both are ignored by the new rail body.

- [ ] **Step 2.7: Update `WorkspaceView.command-palette.test.tsx` mock + add rail-click case**

  File: `src/features/workspace/WorkspaceView.command-palette.test.tsx`

  Find the existing `IconRail` mock (a `vi.mock('./components/IconRail', ...)` block that returns a minimal `<div data-testid="icon-rail" />`). Replace its factory with a mock that renders a real button forwarding `onCommand`:

  ```tsx
  vi.mock('./components/IconRail', () => ({
    IconRail: ({
      onCommand,
    }: {
      onCommand?: () => void
      settingsIssueNumber: number
    }) => (
      <div data-testid="icon-rail">
        <button
          type="button"
          aria-label="Command Palette"
          onClick={(): void => {
            onCommand?.()
          }}
        >
          palette
        </button>
      </div>
    ),
  }))
  ```

  Then add the new test case at the end of the existing `describe('WorkspaceView command palette', ...)` block:

  ```tsx
  test('rail command button opens the palette', async () => {
    render(<WorkspaceView />)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    screen.getByRole('button', { name: 'Command Palette' }).click()
    expect(
      screen.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })
  ```

  If the file already mocks `IconRail` with extra props beyond `onCommand`/`settingsIssueNumber`, preserve them in the mock signature — the implementer should read the current file before editing.

- [ ] **Step 2.8: Run type-check + the touched test suites**

  Run: `npm run type-check && npx vitest run src/features/workspace`

  Expected: `tsc -b` exits 0. All rail / mockNavigation / WorkspaceView tests pass. If a sibling `WorkspaceView.*.test.tsx` fails because it asserted against the old rail icons, drop the dropped-icon assertion (spec §9.3 — mechanical sweep).

- [ ] **Step 2.9: Run the full test suite**

  Run: `npx vitest run`

  Expected: All tests pass. This is the canary for the full migration end-to-end.

- [ ] **Step 2.10: Commit Task 2**

  ```bash
  git add src/features/workspace/components/IconRail.tsx \
          src/features/workspace/components/IconRail.test.tsx \
          src/features/workspace/data/mockNavigation.ts \
          src/features/workspace/data/mockNavigation.test.ts \
          src/features/workspace/WorkspaceView.tsx \
          src/features/workspace/WorkspaceView.command-palette.test.tsx
  # If other WorkspaceView.*.test.tsx siblings were touched in Step
  # 2.8's mechanical sweep, add them here as well.
  git commit -m "refactor(workspace): trim icon rail + wire command button"
  ```

---

## Task 3: Bring `UNIFIED.md` in sync with the rail trim

Doc-only commit. Five single-line edits per spec §7.5. No code, no tests.

**Files:**

- Modify: `docs/design/UNIFIED.md` (lines 47, 48, 51, 193, 212)

---

- [ ] **Step 3.1: Apply the five UNIFIED edits**

  File: `docs/design/UNIFIED.md`

  Five replacements. Use exact-string `Edit` operations so unrelated content doesn't drift.

  **Line 47** (icon rail row in the 5-zone table):

  Old: `Brand mark (V) at top. Area switchers (Agent / Files / Editor / Diff / Context). Palette + settings + user at bottom.`

  New: `User avatar at top. Palette + Settings at bottom. No area switchers — Files lives in the sidebar Files tab; Editor and Diff live in the dock; Context arrives with the deferred Settings dialog.`

  **Line 48** (sidebar row):

  Old: `Three tabs: **Sessions**, **Files**, **Context**. Shows project switcher at top.`

  New: `Two tabs: **Sessions**, **Files**. Context arrives with the deferred Settings dialog. Shows project switcher at top.`

  **Line 51** (status-bar row):

  Old: ``Global: `vimeflow` - version - context smiley - turn count - `⌘K` hint.``

  New: ``Global: `vimeflow` - version - context smiley - turn count - `Ctrl+:` hint.``

  **Line 193** (CommandPalette contract, in §5.4):

  Old: `- ⌘K / Ctrl+K toggle, globally.`

  New: `- Ctrl+: toggle, globally.`

  **Line 212** (interaction rules — replace only the `⌘K palette` fragment, preserve the rest of the line):

  Old fragment: `**Keyboard shortcuts** -- ⌘K palette`

  New fragment: `**Keyboard shortcuts** -- Ctrl+: palette`

  The other shortcuts on line 212 (`⌘⇧E editor`, `⌘⇧D diff`, etc.) are **explicitly out of scope** per spec §7.5.

- [ ] **Step 3.2: Verify the five edits landed**

  Run each check below. All five must pass before committing.

  Shortcut edits (lines 51, 193, 212 — should now use `Ctrl+:`):

  ```bash
  grep -nc "Ctrl+:" docs/design/UNIFIED.md
  ```

  Expected output: `3` (or higher if other contexts pick up the same string). If less than 3, one of lines 51 / 193 / 212 wasn't updated.

  Rail copy (line 47):

  ```bash
  grep -nF "User avatar at top. Palette + Settings at bottom." docs/design/UNIFIED.md
  ```

  Expected output: one match showing line 47 with the new copy.

  Sidebar copy (line 48):

  ```bash
  grep -nF "Two tabs: **Sessions**, **Files**." docs/design/UNIFIED.md
  ```

  Expected output: one match showing line 48 with the new copy.

  No stale `⌘K` references remain (the negative check uses `!` so the command exits 0 when nothing matches; without `!`, `grep` exits 1 on no-match and would fail a strict-mode runner):

  ```bash
  ! grep -nF "⌘K" docs/design/UNIFIED.md
  ```

  Expected: the command exits 0 (negation of "no match found"). If it fails (exits non-zero), `⌘K` is still present somewhere in the file — find the line and update it.

  The other shortcuts on line 212 (`⌘⇧E`, `⌘⇧D`, `⌘⇧F`, `⌘⇧T`) are deliberately preserved and DO contain `⌘`, which is fine — only the bare `⌘K` is being removed.

- [ ] **Step 3.3: Commit Task 3**

  ```bash
  git add docs/design/UNIFIED.md
  git commit -m "docs(design): bring UNIFIED in sync with rail trim"
  ```

---

## Task 4: Smoke verification (manual)

Pre-PR manual check. Catches the kinds of regressions the unit tests can miss — visual drift, focus management, real palette opening behaviour. Skip if running under a non-interactive subagent; flag for the human reviewer in that case.

**Files:** none modified.

---

- [ ] **Step 4.1: Run the dev server**

  Run: `npm run dev`

  Expected: Vite starts, no compile errors, the Electron shell mounts in the browser preview or the desktop dev window.

- [ ] **Step 4.2: Visually verify the new rail**

  In the running app:
  - Rail width is 48 px, on the leftmost side.
  - Avatar slot at the top renders a gradient circle with the letter `w` inside.
  - The middle of the rail is empty (spacer).
  - Bottom of the rail has two buttons: a `search` glyph (above) and a `settings` glyph (below), separated by 4 px.
  - The settings button looks visually muted compared to the search button (it's `aria-disabled`).

- [ ] **Step 4.3: Verify the open paths**
  - Press `Ctrl+:` — the command palette opens. Press `Escape` to close.
  - Hover the rail's `search` button — tooltip reads `Command Palette (Ctrl+:)`. Click it — the palette opens.
  - Hover the rail's `settings` button — tooltip reads `Settings panel coming — see issue #0` (loud placeholder; bumped pre-merge). Click it — nothing happens. No console errors, no banner.

- [ ] **Step 4.4: Confirm dropped areas are still reachable**

  Confirm the destinations the rail used to claim are still reachable via their actual homes:
  - Sidebar has two tabs (`SESSIONS`, `FILES`). Click `FILES` — the file explorer renders.
  - Dock panel below the terminal exposes `editor` and `diff` tabs — neither is in the rail anymore, both still work.

- [ ] **Step 4.5: Stop the dev server**

  `Ctrl+C` in the dev-server terminal. Smoke verification complete.

---

## Post-implementation: open the PR + file the follow-up issue

Per spec §11.2:

1. Open the PR using `/lifeline:request-pr` (or `gh pr create`). The PR body should include the §10 issue body in a "Follow-up issue" section.
2. After the PR is open, file the follow-up issue using the §10 body. Capture the new issue's number.
3. Bump `SETTINGS_FOLLOWUP_ISSUE_NUMBER` in `src/features/workspace/WorkspaceView.tsx` from `0` to the real issue number.
4. Commit + push the bump: `chore(workspace): bump settings follow-up issue number to <N>`.
5. Confirm the gear tooltip in the running app renders the real number, not `#0`, before requesting review.

---

## Self-review

**Spec coverage check:**

| Spec section                             | Plan task / step                                                      |
| ---------------------------------------- | --------------------------------------------------------------------- |
| §6 hook-hoist approach                   | Task 1 (all steps)                                                    |
| §7.1 IconRail rewrite + IconRailIdentity | Task 2, Step 2.4                                                      |
| §7.2 CommandPalette controlled props     | Task 1, Step 1.6                                                      |
| §7.3 WorkspaceView wiring                | Task 1, Step 1.9 (palette) + Task 2, Step 2.6 (rail)                  |
| §7.4 mockNavigation empty-array          | Task 2, Step 2.1                                                      |
| §7.5 UNIFIED edits (×5)                  | Task 3, Step 3.1                                                      |
| §8 token mapping                         | Task 2, Step 2.4 (utilities inline in the rewrite)                    |
| §8.3 visual verification                 | Task 4 (smoke verification)                                           |
| §9.1 IconRail.test.tsx cases (×9)        | Task 2, Step 2.2                                                      |
| §9.2 CommandPalette.testUtils + tests    | Task 1, Steps 1.2, 1.4                                                |
| §9.3 WorkspaceView.\*.test.tsx update    | Task 2, Steps 2.7, 2.8                                                |
| §9.5 mockNavigation.test.ts rewrite      | Task 2, Step 2.1                                                      |
| §9.6 a11y assertions                     | Task 2, Step 2.2 (`aria-disabled`, `aria-hidden`, `role="img"` cases) |
| §10 follow-up issue                      | Post-implementation step (PR body + issue filing)                     |
| §11.2 pre-merge checklist                | Post-implementation step                                              |
| §11.4 rollback                           | n/a in plan (operational guidance)                                    |

No spec requirement is missing a corresponding task or step.

**Placeholder scan:** No `TBD` / `TODO` / "implement later" markers in the plan. The `SETTINGS_FOLLOWUP_ISSUE_NUMBER = 0` is a deliberate, documented placeholder per spec §7.3, not a plan placeholder.

**Type consistency check:**

- `IconRailIdentity` shape (`{ initial: string; ariaLabel?: string }`) is consistent between Step 2.2 (tests) and Step 2.4 (implementation).
- `CommandPaletteProps` shape (`state`, `filteredResults`, `clampedSelectedIndex`, `close`, `setQuery`, `selectIndex`) is identical in Step 1.4 (testUtils default state) and Step 1.6 (component signature) and Step 1.9 (WorkspaceView call site).
- `IconRailProps` matches the spec §7.1 interface verbatim in Step 2.4. The `WorkspaceView` call site in Step 2.6 passes the required `settingsIssueNumber` and the optional `onCommand` + legacy `items` / `settingsItem`, all of which line up.

No drift detected.
