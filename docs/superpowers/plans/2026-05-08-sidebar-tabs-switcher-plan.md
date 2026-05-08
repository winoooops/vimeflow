# Sidebar Top-Tab Switcher (SESSIONS / FILES) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land issue #175 — add a `SESSIONS / FILES` top-tab switcher to the sidebar per handoff §4.2. CONTEXT, brand header, IconRail integration, persistence, and strict WAI-ARIA Tabs are explicitly deferred (per spec §3).

**Architecture:** Six-task TDD-shaped build. Pure / inert leaves first (`useSidebarTab` hook, then `SidebarTabs` component), then the two view wrappers (`SessionsView`, `FilesView`), then the WorkspaceView wiring + test audit. Each task lands its own commit on the branch; the PR merges via squash so `main` records one commit per spec §7. Every task ends green for `npm run lint`, `npm run type-check`, and `npm run test`.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), React 18, Tailwind CSS 3.x (tokens already defined in `tailwind.config.js`: `primary-container` = `#cba6f7`, `on-surface-variant` = `#cdc3d1`), Vitest + @testing-library/react + jsdom (`renderHook`, `userEvent`), ESLint flat config (`react/function-component-definition`, `@typescript-eslint/explicit-function-return-type`, no-console), Prettier (no semicolons, single quotes, trailing commas-es5), conventional-commits via commitlint.

**Spec:** `docs/superpowers/specs/2026-05-08-sidebar-tabs-switcher-design.md` (codex-reviewed; footer marker present).

**Branch:** `feat/sidebar-tabs-switcher-175` (already checked out — DO NOT switch). Spec commits already live on this branch.

**Out of scope (per spec §3) — do NOT implement here:** CONTEXT tab, brand header, IconRail integration, localStorage persistence, keyboard shortcuts (Ctrl+1/2/3 or arrow-key navigation), strict WAI-ARIA Tabs, removing `FilesPanel.tsx`, dropping `Sidebar.bottomPane` / `Sidebar.footer` slots from the primitive.

---

## Pre-flight

Verify environment before starting. Run these in order; if any fail, fix before continuing.

- [ ] **Step 1: Confirm branch**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/sidebar-tabs-switcher-175`. If different, run `git switch feat/sidebar-tabs-switcher-175`.

- [ ] **Step 2: Confirm clean working tree**

```bash
git status --porcelain
```

Expected: empty output. If dirty, stop and ask the user.

- [ ] **Step 3: Confirm baseline gates pass**

```bash
npm run lint && npm run type-check && npm run test
```

Expected: all clean. If anything fails before any code changes, the working tree has drifted — investigate before proceeding.

- [ ] **Step 4: Confirm spec exists**

```bash
ls docs/superpowers/specs/2026-05-08-sidebar-tabs-switcher-design.md
```

Expected: file exists. The plan derives every design decision from the spec; if the spec is missing, stop.

---

## Task 1: `useSidebarTab` hook (spec §5)

**Files:**

- Create: `src/hooks/useSidebarTab.ts`
- Create: `src/hooks/useSidebarTab.test.ts`

**What this task ships:** the `SidebarTab` string-literal union type, the `DEFAULT_SIDEBAR_TAB` const, the `useSidebarTab` hook, and 5 colocated unit tests. No consumer wiring yet — the hook is dead code until Task 5.

- [ ] **Step 1: Write the failing test file**

Create `src/hooks/useSidebarTab.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useSidebarTab,
  DEFAULT_SIDEBAR_TAB,
  type SidebarTab,
} from './useSidebarTab'

describe('useSidebarTab', () => {
  test('default initial value is sessions', () => {
    const { result } = renderHook(() => useSidebarTab())
    expect(result.current.activeTab).toBe('sessions')
    expect(DEFAULT_SIDEBAR_TAB).toBe('sessions')
  })

  test('accepts a custom initial value', () => {
    const { result } = renderHook(() => useSidebarTab({ initial: 'files' }))
    expect(result.current.activeTab).toBe('files')
  })

  test('setActiveTab updates activeTab', () => {
    const { result } = renderHook(() => useSidebarTab())
    act(() => {
      result.current.setActiveTab('files')
    })
    expect(result.current.activeTab).toBe('files')
  })

  test('setActiveTab reference is stable across renders', () => {
    const { result, rerender } = renderHook(() => useSidebarTab())
    const firstSetter = result.current.setActiveTab
    rerender()
    expect(result.current.setActiveTab).toBe(firstSetter)
  })

  test('setting to the same tab keeps activeTab equal', () => {
    const { result } = renderHook(() => useSidebarTab())
    act(() => {
      result.current.setActiveTab('sessions')
    })
    expect(result.current.activeTab).toBe('sessions')
  })

  // Compile-time gate — uncommenting should produce a TS error.
  // (Not asserted here; documented for the implementer.)
  // const t: SidebarTab = 'foobar' // TS2322 if uncommented.
  // void t
})
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/hooks/useSidebarTab.test.ts
```

Expected: FAIL with "Cannot find module './useSidebarTab'" (the source file doesn't exist yet).

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useSidebarTab.ts`:

```ts
import { useState } from 'react'

/**
 * Identifier for one of the sidebar's top tabs. The set is intentionally
 * a string-literal union (not a free `string`) so misspellings break at
 * compile time and IDE autocomplete suggests valid values.
 *
 * Adding CONTEXT later: extend this union AND append a matching entry
 * to `SIDEBAR_TAB_ITEMS` in `WorkspaceView` (see spec §6) AND any
 * consumer-side switch that lacks an exhaustive default.
 */
export type SidebarTab = 'sessions' | 'files'

/**
 * Default tab for a fresh session — opens to SESSIONS so the user lands
 * on the activity surface they're most likely to want.
 */
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'sessions'

export interface UseSidebarTabOptions {
  /** Initial tab. Defaults to `DEFAULT_SIDEBAR_TAB`. */
  initial?: SidebarTab
}

export interface UseSidebarTabReturn {
  /** Currently active tab. */
  activeTab: SidebarTab
  /**
   * Set the active tab. Reference identity is stable across renders
   * (React `setState` guarantee), so consumers can pass it as a prop /
   * effect dep without needing a `useCallback` wrapper.
   */
  setActiveTab: (tab: SidebarTab) => void
}

export const useSidebarTab = (
  options: UseSidebarTabOptions = {}
): UseSidebarTabReturn => {
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    options.initial ?? DEFAULT_SIDEBAR_TAB
  )
  return { activeTab, setActiveTab }
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npx vitest run src/hooks/useSidebarTab.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Run lint + type-check on touched files**

```bash
npx eslint src/hooks/useSidebarTab.ts src/hooks/useSidebarTab.test.ts
npx tsc -b
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSidebarTab.ts src/hooks/useSidebarTab.test.ts
git commit -m "feat(sidebar): add useSidebarTab hook"
```

---

## Task 2: `SidebarTabs` component (spec §4)

**Files:**

- Create: `src/components/sidebar/SidebarTabs.tsx`
- Create: `src/components/sidebar/SidebarTabs.test.tsx`

**What this task ships:** the generic-over-`TId` `SidebarTabs` component (toggle-button pattern, `role="toolbar"` + `aria-pressed`), styled per spec §4 visual contract. No consumer wiring yet.

**Reference spec sections:** §4 (Props, Visual contract, Accessibility contract, Test plan, Implementation notes).

- [ ] **Step 1: Write the failing test file**

Create `src/components/sidebar/SidebarTabs.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarTabs, type SidebarTabItem } from './SidebarTabs'

type Tab = 'sessions' | 'files'

const TABS: readonly SidebarTabItem<Tab>[] = [
  { id: 'sessions', label: 'SESSIONS' },
  { id: 'files', label: 'FILES' },
]

describe('SidebarTabs', () => {
  test('renders one toggle button per tab, in order', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent('SESSIONS')
    expect(buttons[1]).toHaveTextContent('FILES')
  })

  test('active button has aria-pressed=true; inactive has aria-pressed=false', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'SESSIONS' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'FILES' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('every button has the default tabIndex (0)', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )
    for (const btn of screen.getAllByRole('button')) {
      // tabIndex is the default (0) — neither -1 nor an explicit positive value.
      expect(btn).not.toHaveAttribute('tabindex', '-1')
    }
  })

  test('clicking a non-active button calls onChange with that id', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    await user.click(screen.getByRole('button', { name: 'FILES' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('files')
  })

  test('Enter on a focused button fires onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    const filesBtn = screen.getByRole('button', { name: 'FILES' })
    filesBtn.focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('files')
  })

  test('Space on a focused button fires onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    const filesBtn = screen.getByRole('button', { name: 'FILES' })
    filesBtn.focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith('files')
  })

  test('clicking the already-active button still fires onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    await user.click(screen.getByRole('button', { name: 'SESSIONS' }))
    expect(onChange).toHaveBeenCalledWith('sessions')
  })

  test('container has role="toolbar" and default aria-label', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar).toHaveAttribute('aria-label', 'Sidebar tabs')
  })

  test('aria-label can be overridden', () => {
    render(
      <SidebarTabs<Tab>
        tabs={TABS}
        activeId="sessions"
        onChange={vi.fn()}
        aria-label="Project navigation"
      />
    )
    expect(screen.getByRole('toolbar')).toHaveAttribute(
      'aria-label',
      'Project navigation'
    )
  })

  test('active button shows the accent bar; inactive does not', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )
    const accents = screen.getAllByTestId('sidebar-tabs-accent')
    expect(accents).toHaveLength(1)
    // Sanity: the accent lives inside the SESSIONS button.
    expect(screen.getByRole('button', { name: 'SESSIONS' })).toContainElement(
      accents[0]
    )
  })

  test('default data-testid is sidebar-tabs; can be overridden', () => {
    const { rerender } = render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )
    expect(screen.getByTestId('sidebar-tabs')).toBeInTheDocument()
    rerender(
      <SidebarTabs<Tab>
        tabs={TABS}
        activeId="sessions"
        onChange={vi.fn()}
        data-testid="my-tabs"
      />
    )
    expect(screen.getByTestId('my-tabs')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/components/sidebar/SidebarTabs.test.tsx
```

Expected: FAIL with "Cannot find module './SidebarTabs'".

- [ ] **Step 3: Implement the component**

Create `src/components/sidebar/SidebarTabs.tsx`:

```tsx
import type { ReactElement } from 'react'

export interface SidebarTabItem<TId extends string = string> {
  /** Stable id used for selection and as the React `key`. */
  id: TId
  /** Display label rendered inside the toggle button. ≤ 8 chars assumed. */
  label: string
}

export interface SidebarTabsProps<TId extends string = string> {
  /** Tabs to render, in left-to-right order. 1–4 entries. */
  tabs: readonly SidebarTabItem<TId>[]
  /** The currently active tab's id. Must be present in `tabs`. */
  activeId: TId
  /** Fires on every tab click; consumers may no-op when `id === activeId`. */
  onChange: (id: TId) => void
  /**
   * Accessible name for the toolbar. Default `'Sidebar tabs'`.
   */
  'aria-label'?: string
  /** Test hook id. Default `'sidebar-tabs'`. */
  'data-testid'?: string
}

export const SidebarTabs = <TId extends string = string>({
  tabs,
  activeId,
  onChange,
  'aria-label': ariaLabel = 'Sidebar tabs',
  'data-testid': testId = 'sidebar-tabs',
}: SidebarTabsProps<TId>): ReactElement => (
  <div
    role="toolbar"
    aria-label={ariaLabel}
    data-testid={testId}
    className="flex flex-row items-center gap-4 px-3 py-2"
  >
    {tabs.map((item) => {
      const isActive = item.id === activeId
      return (
        <button
          key={item.id}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(item.id)}
          className={`relative font-mono text-[11px] uppercase tracking-[0.08em] font-semibold transition-colors ${
            isActive
              ? 'pl-3 text-primary-container'
              : // §4.2 spec inactive color #6c7086 has no UI/surface token in
                // tailwind.config.js; the editor.syn.comment token shares the
                // hex but is for code highlighting (wrong category for chrome).
                'py-1 text-[#6c7086] hover:text-on-surface-variant cursor-pointer'
          }`}
        >
          {isActive && (
            <span
              data-testid="sidebar-tabs-accent"
              className="absolute left-1 top-2 bottom-2 w-0.5 rounded-sm bg-primary-container"
              aria-hidden
            />
          )}
          {item.label}
        </button>
      )
    })}
  </div>
)
```

Notes for the implementer:

- The component is a generic function expression — TS infers `TId` from the `tabs` prop.
- The accent bar uses `data-testid="sidebar-tabs-accent"` so the test in Step 1 can locate it without coupling to class names.
- No memoization in v1 (per spec §4 implementation notes).
- The Tailwind classes follow the project's existing pattern (no semicolons, the `text-[#6c7086]` literal has the §4.2 source comment one line above).

- [ ] **Step 4: Run the test — expect pass**

```bash
npx vitest run src/components/sidebar/SidebarTabs.test.tsx
```

Expected: 11 tests pass.

- [ ] **Step 5: Lint + type-check the touched files**

```bash
npx eslint src/components/sidebar/SidebarTabs.tsx src/components/sidebar/SidebarTabs.test.tsx
npx tsc -b
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/SidebarTabs.tsx src/components/sidebar/SidebarTabs.test.tsx
git commit -m "feat(sidebar): add SidebarTabs component (toggle-button pattern)"
```

---

## Task 3: `SessionsView` component (spec §6)

**Files:**

- Create: `src/features/workspace/components/SessionsView.tsx`
- Create: `src/features/workspace/components/SessionsView.test.tsx`

**What this task ships:** a thin composition component that renders `<List>` (forwarding all session-related props) plus the relocated "+ New Instance" gradient button as siblings. Accepts `hidden?: boolean` for the always-mounted-toggle-visibility pattern.

**Reference spec sections:** §6 (`SessionsView` component code block + the sibling `+` button discussion resolving F21).

- [ ] **Step 1: Write the failing test file**

Create `src/features/workspace/components/SessionsView.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsView } from './SessionsView'
import { mockSessions } from '../data/mockSessions'

const noop = (): void => {}

const baseProps = {
  sessions: mockSessions,
  activeSessionId: mockSessions[0]?.id ?? null,
  onSessionClick: noop,
  onCreateSession: noop,
  onRemoveSession: noop,
  onRenameSession: noop,
  onReorderSessions: noop,
}

describe('SessionsView', () => {
  test('renders the sessions List', () => {
    render(<SessionsView {...baseProps} />)
    expect(screen.getByTestId('sessions-view')).toBeInTheDocument()
    expect(screen.getByTestId('session-list')).toBeInTheDocument()
  })

  test('"New Instance" button fires onCreateSession on click', async () => {
    const onCreateSession = vi.fn()
    const user = userEvent.setup()
    render(<SessionsView {...baseProps} onCreateSession={onCreateSession} />)
    await user.click(screen.getByRole('button', { name: 'New Instance' }))
    expect(onCreateSession).toHaveBeenCalledTimes(1)
  })

  test('hidden prop applies to the testid root', () => {
    render(<SessionsView {...baseProps} hidden />)
    expect(screen.getByTestId('sessions-view')).toHaveAttribute('hidden')
  })

  test('hidden=false omits the hidden attribute', () => {
    render(<SessionsView {...baseProps} hidden={false} />)
    expect(screen.getByTestId('sessions-view')).not.toHaveAttribute('hidden')
  })

  test('hidden defaults to false (no attribute)', () => {
    render(<SessionsView {...baseProps} />)
    expect(screen.getByTestId('sessions-view')).not.toHaveAttribute('hidden')
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/features/workspace/components/SessionsView.test.tsx
```

Expected: FAIL with "Cannot find module './SessionsView'".

- [ ] **Step 3: Implement the component**

Create `src/features/workspace/components/SessionsView.tsx`:

```tsx
import type { ReactElement } from 'react'
import type { Session } from '../../sessions/types'
import { List } from '../../sessions/components/List'

export interface SessionsViewProps {
  /** When true, the view is `hidden` (display:none, inert). Default false. */
  hidden?: boolean
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (id: string) => void
  onCreateSession: () => void
  onRemoveSession: (id: string) => void
  onRenameSession: (id: string, name: string) => void
  onReorderSessions: (reordered: Session[]) => void
}

export const SessionsView = ({
  hidden = false,
  sessions,
  activeSessionId,
  onSessionClick,
  onCreateSession,
  onRemoveSession,
  onRenameSession,
  onReorderSessions,
}: SessionsViewProps): ReactElement => (
  <div
    hidden={hidden}
    className="flex min-h-0 flex-1 flex-col"
    data-testid="sessions-view"
  >
    <List
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSessionClick={onSessionClick}
      onNewInstance={onCreateSession}
      onRemoveSession={onRemoveSession}
      onRenameSession={onRenameSession}
      onReorderSessions={onReorderSessions}
    />

    {/* "+ New Instance" — relocated from Sidebar.footer. The small `+`
        in List's group header (driven by onNewInstance above) stays;
        this prominent button is a sibling-level UX accelerator. Both
        call onCreateSession. */}
    <button
      type="button"
      onClick={onCreateSession}
      className="m-3 flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
      aria-label="New Instance"
      data-testid="sessions-view-new-instance"
    >
      <span className="material-symbols-outlined text-lg">bolt</span>
      <span>New Instance</span>
    </button>
  </div>
)
```

Notes:

- The `<button aria-label="New Instance">` makes the `getByRole('button', { name: 'New Instance' })` query in the test resolve uniquely (the inner `<span>New Instance</span>` is the visible label too — they agree).
- `data-testid="sessions-view"` is on the root div; the `hidden` attribute applies to that same element.
- The List's existing `data-testid="session-list"` is what the test queries to assert List rendered.

- [ ] **Step 4: Run the test — expect pass**

```bash
npx vitest run src/features/workspace/components/SessionsView.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Lint + type-check**

```bash
npx eslint src/features/workspace/components/SessionsView.tsx src/features/workspace/components/SessionsView.test.tsx
npx tsc -b
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/SessionsView.tsx src/features/workspace/components/SessionsView.test.tsx
git commit -m "feat(sidebar): add SessionsView wrapper composing List + New Instance button"
```

---

## Task 4: `FilesView` component (spec §6)

**Files:**

- Create: `src/features/workspace/components/FilesView.tsx`
- Create: `src/features/workspace/components/FilesView.test.tsx`

**What this task ships:** a thin wrapper around `<FileExplorer>` with a `hidden?` prop. Exists for symmetry with `SessionsView` and a focused test surface for FILES-tab concerns.

**Reference spec section:** §6 (`FilesView` component code block).

- [ ] **Step 1: Write the failing test file**

Create `src/features/workspace/components/FilesView.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilesView } from './FilesView'

describe('FilesView', () => {
  test('renders FileExplorer with the cwd label', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} />)
    expect(screen.getByTestId('files-view')).toBeInTheDocument()
    // FileExplorer renders its own data-testid="file-explorer".
    expect(screen.getByTestId('file-explorer')).toBeInTheDocument()
  })

  test('hidden prop applies to the testid root', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} hidden />)
    expect(screen.getByTestId('files-view')).toHaveAttribute('hidden')
  })

  test('hidden=false omits the hidden attribute', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} hidden={false} />)
    expect(screen.getByTestId('files-view')).not.toHaveAttribute('hidden')
  })

  test('hidden defaults to false', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} />)
    expect(screen.getByTestId('files-view')).not.toHaveAttribute('hidden')
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/features/workspace/components/FilesView.test.tsx
```

Expected: FAIL with "Cannot find module './FilesView'".

- [ ] **Step 3: Implement the component**

Create `src/features/workspace/components/FilesView.tsx`:

```tsx
import type { ReactElement } from 'react'
import type { FileNode } from '../../files/types'
import { FileExplorer } from './panels/FileExplorer'

export interface FilesViewProps {
  /** When true, the view is `hidden` (display:none, inert). Default false. */
  hidden?: boolean
  cwd: string
  onFileSelect: (file: FileNode) => void
}

export const FilesView = ({
  hidden = false,
  cwd,
  onFileSelect,
}: FilesViewProps): ReactElement => (
  <div
    hidden={hidden}
    className="flex min-h-0 flex-1 flex-col"
    data-testid="files-view"
  >
    <FileExplorer cwd={cwd} onFileSelect={onFileSelect} />
  </div>
)
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npx vitest run src/features/workspace/components/FilesView.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Lint + type-check**

```bash
npx eslint src/features/workspace/components/FilesView.tsx src/features/workspace/components/FilesView.test.tsx
npx tsc -b
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/FilesView.tsx src/features/workspace/components/FilesView.test.tsx
git commit -m "feat(sidebar): add FilesView wrapper around FileExplorer"
```

---

## Task 5: Wire `WorkspaceView` (spec §6)

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.test.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.integration.test.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.notifyInfo.test.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.command-palette.test.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.visual.test.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.verification.test.tsx`
- Modify (audit): `src/features/workspace/WorkspaceView.subscription.test.tsx`

**What this task ships:** the WorkspaceView wiring delta — replace the `Sidebar.content`/`bottomPane`/`footer` props with a `content` slot that renders `SidebarTabs` + `SessionsView` + `FilesView`. Audit existing WorkspaceView tests for FileExplorer-visibility assumptions and switch them to FILES tab where needed.

**Reference spec sections:** §6 (WorkspaceView delta diff block + `SIDEBAR_TAB_ITEMS` const + Test coverage).

- [ ] **Step 1: Add new imports + the `SIDEBAR_TAB_ITEMS` const**

Open `src/features/workspace/WorkspaceView.tsx`. Near the top of the file, after the existing imports, add:

```tsx
import {
  SidebarTabs,
  type SidebarTabItem,
} from '../../components/sidebar/SidebarTabs'
import { useSidebarTab, type SidebarTab } from '../../hooks/useSidebarTab'
import { SessionsView } from './components/SessionsView'
import { FilesView } from './components/FilesView'
```

Remove these existing imports (their usages are about to disappear from this file):

```tsx
import { List } from '../sessions/components/List'
import { FileExplorer } from './components/panels/FileExplorer'
```

After all imports, before the component, add:

```tsx
const SIDEBAR_TAB_ITEMS: readonly SidebarTabItem<SidebarTab>[] = [
  { id: 'sessions', label: 'SESSIONS' },
  { id: 'files', label: 'FILES' },
] as const
```

- [ ] **Step 2: Add the `useSidebarTab` call inside the component**

Inside `WorkspaceView`'s body, before the early `return` that builds the JSX, add:

```tsx
const { activeTab, setActiveTab } = useSidebarTab()
```

Place it near the other hook calls (e.g., next to `useSessionManager`, `useResizable`, `useNotifyInfo`).

- [ ] **Step 3: Replace the `Sidebar` JSX wiring**

Find the `<Sidebar ... />` invocation. Replace its `content`, `bottomPane`, and `footer` props with the new shape; keep `header` unchanged.

The full new `<Sidebar>` block:

```tsx
<Sidebar
  header={
    <SidebarStatusHeader
      status={agentStatus}
      activeSessionName={activeSession?.name ?? null}
    />
  }
  content={
    <div className="flex h-full min-h-0 flex-col">
      <SidebarTabs<SidebarTab>
        tabs={SIDEBAR_TAB_ITEMS}
        activeId={activeTab}
        onChange={setActiveTab}
      />
      <SessionsView
        hidden={activeTab !== 'sessions'}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionClick={setActiveSessionId}
        onCreateSession={createSession}
        onRemoveSession={removeSession}
        onRenameSession={renameSession}
        onReorderSessions={reorderSessions}
      />
      <FilesView
        hidden={activeTab !== 'files'}
        cwd={activeSession?.workingDirectory ?? '~'}
        onFileSelect={handleFileSelect}
      />
    </div>
  }
/>
```

Pre-existing wiring to remove (these props were on the old `<Sidebar>`):

- `content={<List ... />}` — replaced
- `bottomPane={<FileExplorer ... />}` — removed entirely (FilesView absorbs it)
- `footer={<button>New Instance</button>}` — removed entirely (SessionsView absorbs it)

- [ ] **Step 4: Run the source-only changes through tooling**

```bash
npx tsc -b
npx eslint src/features/workspace/WorkspaceView.tsx
```

Expected: clean. If type errors surface, the most likely cause is a stale `List` / `FileExplorer` reference still in the file — search for them and remove.

- [ ] **Step 5: Run the WorkspaceView tests — expect SOME failures**

```bash
npx vitest run src/features/workspace/WorkspaceView
```

Expected: some tests will fail (these are the tests that asserted FileExplorer visibility on initial render — they need to click FILES first now). Capture the list of failing tests; you'll fix them in Step 6.

- [ ] **Step 6: Audit + fix existing WorkspaceView tests**

For EACH failing test, decide:

**If the test queries / clicks / asserts on FileExplorer** (role queries inside the file tree, `userEvent.click` on file rows, `getByTestId('file-explorer')`, "is visible" assertions):

Add a click prelude that switches to the FILES tab BEFORE the FileExplorer-related assertion:

```tsx
const user = userEvent.setup()
// ... existing render call

await user.click(screen.getByRole('button', { name: 'FILES' }))

// ... existing FileExplorer-related assertion(s)
```

**If the test queries `Sidebar.footer-wrapper` or assumes the "New Instance" button is in `Sidebar.footer`**:

The button is now in SessionsView (testid `sessions-view-new-instance`) instead. Either query by role (`getByRole('button', { name: 'New Instance' })` works for both old and new placement), or update the testid query.

**If the test asserts `getByTestId('sidebar-footer-wrapper')` exists**:

Change to `queryByTestId('sidebar-footer-wrapper')` and assert it's `null` — `WorkspaceView` no longer passes a `footer` prop, so the slot wrapper is suppressed.

**If the test asserts `getByTestId('explorer-resize-handle')` exists**:

Change to `queryByTestId('explorer-resize-handle')` and assert it's `null` — the bottom-pane slot is no longer used.

Run the full WorkspaceView suite incrementally as you fix:

```bash
npx vitest run src/features/workspace/WorkspaceView
```

Iterate until all pre-existing tests pass.

- [ ] **Step 7: Add new WorkspaceView tests for the tabs wiring**

Append the following tests to `src/features/workspace/WorkspaceView.test.tsx` (inside the existing `describe('WorkspaceView', ...)` block):

```tsx
import userEvent from '@testing-library/user-event'

// ... inside the existing describe block:

test('initial render shows SidebarTabs toolbar with SESSIONS active', () => {
  render(<WorkspaceView />)
  const toolbar = screen.getByRole('toolbar', { name: 'Sidebar tabs' })
  expect(toolbar).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'SESSIONS' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByRole('button', { name: 'FILES' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
})

test('both views are mounted on initial render; FILES is hidden', () => {
  render(<WorkspaceView />)
  expect(screen.getByTestId('sessions-view')).toBeInTheDocument()
  expect(screen.getByTestId('files-view')).toBeInTheDocument()
  expect(screen.getByTestId('sessions-view')).not.toHaveAttribute('hidden')
  expect(screen.getByTestId('files-view')).toHaveAttribute('hidden')
})

test('clicking FILES toggles the hidden attribute on each view', async () => {
  const user = userEvent.setup()
  render(<WorkspaceView />)
  await user.click(screen.getByRole('button', { name: 'FILES' }))
  expect(screen.getByTestId('sessions-view')).toHaveAttribute('hidden')
  expect(screen.getByTestId('files-view')).not.toHaveAttribute('hidden')
})

test('Sidebar.footer slot is suppressed (no "New Instance" wrapper)', () => {
  render(<WorkspaceView />)
  expect(screen.queryByTestId('sidebar-footer-wrapper')).not.toBeInTheDocument()
})

test('bottom-pane resize handle is gone (no Sidebar.bottomPane prop)', () => {
  render(<WorkspaceView />)
  expect(screen.queryByTestId('explorer-resize-handle')).not.toBeInTheDocument()
})
```

- [ ] **Step 8: Run the WorkspaceView tests — expect all pass**

```bash
npx vitest run src/features/workspace/WorkspaceView
```

Expected: every WorkspaceView test file green, including the 5 new tests.

- [ ] **Step 9: Run the full project test suite + lint + type-check**

```bash
npm run lint
npm run type-check
npm run test
```

Expected: all clean. Test count is +4 test files vs main (the four new component/hook tests).

- [ ] **Step 10: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/WorkspaceView.test.tsx
# Add any other test files you modified during the audit:
git status --short  # inspect; add the files listed
git add -p  # if you only want some chunks
git commit -m "feat(sidebar): wire SidebarTabs into WorkspaceView (handoff §4.2)"
```

---

## Task 6: Verify, smoke-test, codex-review

**What this task ships:** the verification gate that closes spec §7. Runs the full project gates, an in-app smoke test, and the local codex review. Any review findings get fixed in this task.

- [ ] **Step 1: Run the full gate**

```bash
npm run lint && npm run type-check && npm run test
```

Expected: all clean. If anything fails, fix and rerun before continuing.

- [ ] **Step 2: Test-file count check**

```bash
git diff --name-only --diff-filter=A main..HEAD -- 'src/**/*.test.ts' 'src/**/*.test.tsx' | wc -l
```

Expected: `4` (`useSidebarTab.test.ts`, `SidebarTabs.test.tsx`, `SessionsView.test.tsx`, `FilesView.test.tsx`).

- [ ] **Step 3: Search for stale references**

```bash
grep -rE "Sidebar\\.bottomPane|Sidebar\\.footer" src/features/workspace/WorkspaceView.tsx
```

Expected: no matches (those props are no longer passed at this consumer).

```bash
grep -rE "from '\\./components/panels/FileExplorer'" src/features/workspace/WorkspaceView.tsx
```

Expected: no matches (the import was removed; FileExplorer is now imported by FilesView).

- [ ] **Step 4: Smoke-test in dev**

```bash
npm run dev
```

In the running dev server (browser):

1. The sidebar should show: `SidebarStatusHeader` at top → tabs row (`SESSIONS / FILES`) → sessions list → "+ New Instance" gradient button at bottom.
2. The SESSIONS tab should be visually active (`#cba6f7` text + left accent bar).
3. Click the FILES tab: the tabs row's active state flips to FILES; the sessions list disappears and the file tree appears.
4. Navigate two folders deep in the file tree (click any folder twice).
5. Click SESSIONS; verify the sessions list reappears.
6. Click FILES; verify the file tree shows the path you navigated to (preserved across the round-trip).
7. From SESSIONS, click any other session. Notice the active session changes.
8. Click FILES; verify the file tree resets to the new active session's `workingDirectory`. (This reset is intentional, per spec §1 Goal 4 note.)
9. Stop the dev server (Ctrl+C).

If anything visually or functionally diverges from the above, stop and triage before continuing.

- [ ] **Step 5: Local codex review**

```bash
# scripts/review.sh hardcodes --model gpt-5.2-codex which ChatGPT-account
# auth rejects. Per memory feedback_codex_model_for_chatgpt_auth, invoke
# codex directly without --model:
codex exec review --base main --full-auto 2>&1 | tee .codex-reviews/latest.md
```

Expected: report saved to `.codex-reviews/latest.md`. Read the tail:

```bash
tail -20 .codex-reviews/latest.md
```

If codex returns "patch is correct" with no actionable HIGH/MEDIUM findings, proceed to Step 7.

If codex finds HIGH or MEDIUM issues, see Step 6.

- [ ] **Step 6: Apply codex review fixes (only if needed)**

For each HIGH / MEDIUM finding:

1. Read the cited file at the cited lines.
2. Apply the suggested fix (or a better one).
3. Rerun `npm run lint && npm run type-check && npm run test` until clean.

Commit with:

```bash
git add <touched files>
git commit -m "fix(sidebar): address local codex review findings"
```

- [ ] **Step 7: Branch summary**

```bash
git log --oneline main..HEAD
```

Expected (commits in order, oldest at bottom):

```
<hash> feat(sidebar): wire SidebarTabs into WorkspaceView (handoff §4.2)
<hash> feat(sidebar): add FilesView wrapper around FileExplorer
<hash> feat(sidebar): add SessionsView wrapper composing List + New Instance button
<hash> feat(sidebar): add SidebarTabs component (toggle-button pattern)
<hash> feat(sidebar): add useSidebarTab hook
<hash> docs(spec): mark spec codex-reviewed
<hash> docs(spec): apply codex feedback
<hash> docs(spec): sidebar-tabs-switcher
```

(Plus an optional `fix(sidebar): address local codex review findings` commit if Step 6 ran.)

- [ ] **Step 8: Hand-off**

Plan complete. Implementation done; tests green; codex says clean; manual smoke pass.

Next steps for the human / orchestrating agent:

1. Push the branch: `git push -u origin feat/sidebar-tabs-switcher-175`.
2. Open the PR via `/lifeline:request-pr` (or `gh pr create` with the spec §7 commit body adapted for the PR body).
3. PR review: GitHub Codex Code Review + Claude Code Review will run automatically; address any findings via `/lifeline:upsource-review` if needed.
4. Merge via `/lifeline:approve-pr Y` (squash-merges to a single commit on `main` per spec §7 single-commit goal).

---

## Self-review checklist

Before declaring the plan complete, the plan author runs this list:

**1. Spec coverage:** every spec section has at least one task implementing it.

| Spec section                                            | Task                                  |
| ------------------------------------------------------- | ------------------------------------- |
| §1 Goal 1 (`SidebarTabs` component)                     | Task 2                                |
| §1 Goal 2 (`useSidebarTab` hook)                        | Task 1                                |
| §1 Goal 3 (SessionsView/FilesView in `Sidebar.content`) | Tasks 3, 4, 5                         |
| §1 Goal 4 (cross-tab state via `hidden`)                | Tasks 3, 4, 5 (Step 7 test 3)         |
| §1 Goal 5 (no functional regression; test audit)        | Task 5 (Step 6), Task 6               |
| §3 Scope / Non-goals                                    | Plan header "Out of scope" line       |
| §4 SidebarTabs API + a11y + tests                       | Task 2                                |
| §5 useSidebarTab API + tests                            | Task 1                                |
| §6 WorkspaceView wiring + view components               | Tasks 3, 4, 5                         |
| §7 Single-PR/single-commit + verify gate                | Task 6 + plan note about squash-merge |
| §8 Future work                                          | not implemented (by design)           |

**2. Placeholder scan:** no `TBD`, `TODO`, `FIXME`, `// implement later`, "appropriate error handling", or "similar to Task N" in the plan. Plan author has run `grep -nE "TODO|FIXME|TBD|implement later|similar to Task" docs/superpowers/plans/2026-05-08-sidebar-tabs-switcher-plan.md` and verified zero matches.

**3. Type / signature consistency:**

- `SidebarTab` = `'sessions' | 'files'` — used identically in Tasks 1, 2, 5.
- `SidebarTabItem<TId>` — used in Tasks 2 and 5 with the same shape (`id`, `label`).
- `SessionsView` props — `hidden`, `sessions`, `activeSessionId`, `onSessionClick`, `onCreateSession`, `onRemoveSession`, `onRenameSession`, `onReorderSessions` — match between Task 3 (definition) and Task 5 (consumer).
- `FilesView` props — `hidden`, `cwd`, `onFileSelect` — match between Task 4 (definition) and Task 5 (consumer).
- `data-testid` values — `sessions-view`, `files-view`, `sidebar-tabs`, `sidebar-tabs-accent`, `sessions-view-new-instance`, plus the existing `session-list`, `file-explorer`, `sidebar-footer-wrapper`, `explorer-resize-handle` — used consistently across the plan.

---

<!-- codex-reviewed: false -->
