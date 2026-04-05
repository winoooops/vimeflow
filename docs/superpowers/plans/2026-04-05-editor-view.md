# Editor View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the standalone Files Explorer into a combined IDE-style Editor view with collapsible file explorer, tabbed code editor with Shiki syntax highlighting, vim-style status bar, and a collapsible ContextPanel that persists across all views.

**Architecture:** Rename `src/features/files/` to `src/features/editor/`, reuse `FileTree`/`FileTreeNode`/`ContextMenu` components, add new `ExplorerPane`, `EditorTabs`, `CodeEditor`, `EditorStatusBar` components. File content served via Vite dev middleware (`/api/files/*`). ContextPanel gets `isOpen`/`onToggle` props with state lifted to `App.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (Catppuccin Mocha), Shiki (syntax highlighting), Vitest + Testing Library, Vite dev middleware

**Spec:** `docs/superpowers/specs/2026-04-05-editor-view-design.md`

---

## Task 1: Rename `files/` to `editor/` and remove unused components

**Files:**

- Rename: `src/features/files/` → `src/features/editor/`
- Delete: `src/features/editor/components/Breadcrumbs.tsx` + test
- Delete: `src/features/editor/components/DropZone.tsx` + test
- Delete: `src/features/editor/components/FileStatusBar.tsx` + test
- Modify: `src/features/editor/types/index.ts` — remove `isDragTarget`/`isDragging` from `FileNode`
- Modify: `src/features/editor/components/FileTreeNode.tsx` — remove drag styling
- Modify: `src/features/editor/components/FileTreeNode.test.tsx` — remove drag tests
- Modify: `src/features/editor/data/mockFileTree.ts` — remove drag fields from mock data
- Modify: `src/features/editor/data/mockFileTree.test.ts` — update assertions
- Modify: `src/App.tsx` — update imports
- Modify: `src/features/editor/FilesView.tsx` → rename to `EditorView.tsx` (placeholder, rebuilt in Task 5)

- [ ] **Step 1: Rename directory**

```bash
git mv src/features/files src/features/editor
```

- [ ] **Step 2: Delete Breadcrumbs, DropZone, FileStatusBar**

```bash
rm src/features/editor/components/Breadcrumbs.tsx
rm src/features/editor/components/Breadcrumbs.test.tsx
rm src/features/editor/components/DropZone.tsx
rm src/features/editor/components/DropZone.test.tsx
rm src/features/editor/components/FileStatusBar.tsx
rm src/features/editor/components/FileStatusBar.test.tsx
```

- [ ] **Step 3: Remove `isDragTarget`/`isDragging` from `FileNode` type**

In `src/features/editor/types/index.ts`, remove the two optional fields:

```typescript
export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  gitStatus?: GitStatus
  icon?: string
  defaultExpanded?: boolean
  // isDragTarget and isDragging REMOVED
}
```

Also remove their checks from `isFileNode` type guard (the `isDragTarget` and `isDragging` validation blocks).

- [ ] **Step 4: Remove drag styling from `FileTreeNode.tsx`**

In `src/features/editor/components/FileTreeNode.tsx`:

- Remove the `if (node.isDragging)` block that adds drag classes
- Remove the `if (node.isDragTarget)` block that adds target classes
- Remove the `{node.isDragTarget && ...}` JSX block that renders the "DROP HERE" badge

- [ ] **Step 5: Remove drag tests from `FileTreeNode.test.tsx`**

Remove these two tests:

- `'displays drag target badge when isDragTarget is true'`
- `'applies drag styling when isDragging is true'`

- [ ] **Step 6: Remove drag fields from mock data**

In `src/features/editor/data/mockFileTree.ts`:

- Remove `isDragTarget: true` from the `components` folder node
- Remove `isDragging: true` from the `TerminalPanel.tsx` node
- Remove `mockBreadcrumbs` export
- Remove `mockFileStatusBarData` export and `FileStatusBarData` interface

- [ ] **Step 7: Update mock data test**

In `src/features/editor/data/mockFileTree.test.ts`, remove tests that reference `isDragTarget`, `isDragging`, `mockBreadcrumbs`, `mockFileStatusBarData`, and `FileStatusBarData`.

- [ ] **Step 8: Update `App.tsx` imports**

```typescript
// Before
import FilesView from './features/files/FilesView'
// After
import EditorView from './features/editor/EditorView'
```

Update the rendering: replace `<FilesView` with `<EditorView` and keep it rendering for `activeTab === 'Editor'` (and also `'Files'` temporarily until TopTabBar is updated in Task 3).

- [ ] **Step 9: Rename `FilesView.tsx` to `EditorView.tsx`**

```bash
git mv src/features/editor/FilesView.tsx src/features/editor/EditorView.tsx
git mv src/features/editor/FilesView.test.tsx src/features/editor/EditorView.test.tsx
```

Update the component name inside from `FilesView` to `EditorView`, update the `data-testid` from `files-view` to `editor-view`, and strip out `Breadcrumbs`, `DropZone`, `FileStatusBar` imports/usage. This is a temporary scaffold — it will be fully rebuilt in Task 5.

- [ ] **Step 10: Run tests to verify nothing is broken**

```bash
npx vitest run src/features/editor/ --reporter=verbose
```

Expected: All remaining tests pass. Deleted component tests no longer run.

- [ ] **Step 11: Run lint and type-check**

```bash
npm run type-check && npm run lint
```

Expected: No errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: rename files/ to editor/, remove Breadcrumbs/DropZone/FileStatusBar and drag states"
```

---

## Task 2: Add new types for Editor view

**Files:**

- Modify: `src/features/editor/types/index.ts`
- Modify: `src/features/editor/types/index.test.ts`

- [ ] **Step 1: Write failing tests for new types**

In `src/features/editor/types/index.test.ts`, add:

```typescript
import { isVimMode, isEditorTab, isCursorPosition } from './index'

describe('VimMode', () => {
  test('isVimMode returns true for valid modes', () => {
    expect(isVimMode('NORMAL')).toBe(true)
    expect(isVimMode('INSERT')).toBe(true)
    expect(isVimMode('VISUAL')).toBe(true)
    expect(isVimMode('COMMAND')).toBe(true)
  })

  test('isVimMode returns false for invalid values', () => {
    expect(isVimMode('REPLACE')).toBe(false)
    expect(isVimMode('')).toBe(false)
    expect(isVimMode(42)).toBe(false)
  })
})

describe('EditorTab', () => {
  test('isEditorTab returns true for valid tab', () => {
    expect(
      isEditorTab({
        id: 'tab-1',
        fileName: 'App.tsx',
        filePath: 'src/App.tsx',
        icon: 'code',
        isActive: true,
        isDirty: false,
      })
    ).toBe(true)
  })

  test('isEditorTab returns false for missing fields', () => {
    expect(isEditorTab({ id: 'tab-1' })).toBe(false)
    expect(isEditorTab(null)).toBe(false)
    expect(isEditorTab('string')).toBe(false)
  })
})

describe('CursorPosition', () => {
  test('isCursorPosition returns true for valid position', () => {
    expect(isCursorPosition({ line: 42, column: 12 })).toBe(true)
  })

  test('isCursorPosition returns false for invalid values', () => {
    expect(isCursorPosition({ line: 'a', column: 12 })).toBe(false)
    expect(isCursorPosition(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/types/index.test.ts --reporter=verbose
```

Expected: FAIL — `isVimMode`, `isEditorTab`, `isCursorPosition` not exported.

- [ ] **Step 3: Implement new types and type guards**

In `src/features/editor/types/index.ts`, add after existing types:

```typescript
export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND'

export interface EditorTab {
  id: string
  fileName: string
  filePath: string
  icon: string
  isActive: boolean
  isDirty: boolean
}

export interface CursorPosition {
  line: number
  column: number
}

export interface EditorStatusBarState {
  vimMode: VimMode
  gitBranch: string
  syncStatus: { behind: number; ahead: number }
  fileName: string
  encoding: string
  language: string
  cursor: CursorPosition
}

const VIM_MODES: readonly string[] = ['NORMAL', 'INSERT', 'VISUAL', 'COMMAND']

export const isVimMode = (value: unknown): value is VimMode =>
  typeof value === 'string' && VIM_MODES.includes(value)

export const isEditorTab = (value: unknown): value is EditorTab => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj.id === 'string' &&
    typeof obj.fileName === 'string' &&
    typeof obj.filePath === 'string' &&
    typeof obj.icon === 'string' &&
    typeof obj.isActive === 'boolean' &&
    typeof obj.isDirty === 'boolean'
  )
}

export const isCursorPosition = (value: unknown): value is CursorPosition => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return typeof obj.line === 'number' && typeof obj.column === 'number'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/features/editor/types/index.test.ts --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/types/
git commit -m "feat: add VimMode, EditorTab, CursorPosition types with type guards"
```

---

## Task 3: Update TopTabBar — merge Files+Editor into Editor

**Files:**

- Modify: `src/components/layout/TopTabBar.tsx`
- Modify: `src/components/layout/TopTabBar.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update TopTabBar tests**

In `src/components/layout/TopTabBar.test.tsx`, update tests that reference the "Files" tab. The tabs should now be `['Chat', 'Editor', 'Diff']`. Remove/update any test expecting a "Files" button. Add a test verifying there is no "Files" tab:

```typescript
test('does not render a Files tab', () => {
  render(<TopTabBar />)
  expect(screen.queryByRole('button', { name: 'Files' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/layout/TopTabBar.test.tsx --reporter=verbose
```

Expected: FAIL — "Files" tab still exists.

- [ ] **Step 3: Update `TabName` type and tabs array**

In `src/components/layout/TopTabBar.tsx`:

```typescript
// Before
export type TabName = 'Chat' | 'Files' | 'Editor' | 'Diff'
// After
export type TabName = 'Chat' | 'Editor' | 'Diff'
```

```typescript
// Before
const tabs: TabName[] = ['Chat', 'Files', 'Editor', 'Diff']
// After
const tabs: TabName[] = ['Chat', 'Editor', 'Diff']
```

- [ ] **Step 4: Update `App.tsx`**

Remove the `activeTab === 'Files'` branch. Ensure `activeTab === 'Editor'` renders `EditorView`:

```typescript
const App = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabName>('Chat')

  const handleTabChange = (tab: TabName): void => {
    setActiveTab(tab)
  }

  return (
    <>
      {activeTab === 'Editor' ? (
        <EditorView onTabChange={handleTabChange} />
      ) : (
        <ChatView onTabChange={handleTabChange} />
      )}
      <CommandPalette />
    </>
  )
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/components/layout/TopTabBar.test.tsx src/features/editor/EditorView.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 6: Run type-check**

```bash
npm run type-check
```

Expected: No errors. Any remaining references to `'Files'` as a `TabName` will surface here.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/TopTabBar.tsx src/components/layout/TopTabBar.test.tsx src/App.tsx
git commit -m "refactor: merge Files+Editor tabs into single Editor tab"
```

---

## Task 4: Make ContextPanel collapsible + redesign layout

**Files:**

- Modify: `src/components/layout/ContextPanel.tsx`
- Modify: `src/components/layout/ContextPanel.test.tsx`
- Modify: `src/App.tsx` — lift `isContextPanelOpen` state
- Modify: `src/features/chat/ChatView.tsx` — accept panel props, dynamic margin
- Modify: `src/features/chat/ChatView.test.tsx` — update tests

- [ ] **Step 1: Write failing tests for collapsible ContextPanel**

In `src/components/layout/ContextPanel.test.tsx`, add:

```typescript
test('renders dock toggle button in header', () => {
  render(<ContextPanel isOpen onToggle={vi.fn()} />)
  expect(screen.getByRole('button', { name: /toggle panel/i })).toBeInTheDocument()
})

test('renders collapse panel button in footer', () => {
  render(<ContextPanel isOpen onToggle={vi.fn()} />)
  expect(screen.getByRole('button', { name: /collapse panel/i })).toBeInTheDocument()
})

test('calls onToggle when dock button is clicked', async () => {
  const onToggle = vi.fn()
  render(<ContextPanel isOpen onToggle={onToggle} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /toggle panel/i }))
  expect(onToggle).toHaveBeenCalledTimes(1)
})

test('calls onToggle when collapse button is clicked', async () => {
  const onToggle = vi.fn()
  render(<ContextPanel isOpen onToggle={onToggle} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /collapse panel/i }))
  expect(onToggle).toHaveBeenCalledTimes(1)
})

test('applies translate-x-full when isOpen is false', () => {
  render(<ContextPanel isOpen={false} onToggle={vi.fn()} />)
  const aside = screen.getByRole('complementary')
  expect(aside).toHaveClass('translate-x-full')
})

test('does not apply translate-x-full when isOpen is true', () => {
  render(<ContextPanel isOpen onToggle={vi.fn()} />)
  const aside = screen.getByRole('complementary')
  expect(aside).not.toHaveClass('translate-x-full')
})
```

Update ALL existing tests to pass `isOpen` and `onToggle` props:

```typescript
// Before
render(<ContextPanel />)
// After
render(<ContextPanel isOpen onToggle={vi.fn()} />)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/layout/ContextPanel.test.tsx --reporter=verbose
```

Expected: FAIL — ContextPanel doesn't accept `isOpen`/`onToggle` props.

- [ ] **Step 3: Rewrite ContextPanel with props and new layout**

Replace `src/components/layout/ContextPanel.tsx` with the redesigned version:

```typescript
import type { ReactElement } from 'react'

interface ContextPanelProps {
  isOpen: boolean
  onToggle: () => void
}

const ContextPanel = ({ isOpen, onToggle }: ContextPanelProps): ReactElement => (
  <aside
    role="complementary"
    aria-label="Agent status panel"
    className={`w-[280px] h-screen fixed right-0 top-0 bg-[#1a1a2a]/95 backdrop-blur-xl border-l border-[#4a444f]/15 z-40 flex flex-col overflow-hidden transition-all duration-300 ${
      isOpen ? '' : 'translate-x-full'
    }`}
    data-testid="context-panel"
  >
    {/* Header */}
    <div className="p-4 flex items-center justify-between border-b border-[#4a444f]/10 mb-4">
      <div className="flex items-center gap-2 text-secondary">
        <span className="material-symbols-outlined text-lg" aria-hidden="true">
          psychology
        </span>
        <h2 className="font-bold text-xs uppercase tracking-wider">
          Agent Status
        </h2>
      </div>
      <button
        className="text-on-surface-variant hover:text-on-surface p-1 hover:bg-surface-variant/30 rounded transition-colors"
        aria-label="Toggle panel"
        onClick={onToggle}
      >
        <span className="material-symbols-outlined text-lg" aria-hidden="true">
          dock_to_right
        </span>
      </button>
    </div>

    {/* Content */}
    <div className="px-4 flex flex-col gap-6 flex-1 overflow-y-auto no-scrollbar">
      {/* Token Usage */}
      <div>
        <p className="text-on-surface-variant text-[0.75rem] font-label mb-4">
          GPT-4o Active
        </p>
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center text-[10px] font-label uppercase text-on-surface-variant/60">
            <span>Token Usage</span>
            <span>74%</span>
          </div>
          <div className="h-1 bg-surface-variant rounded-full overflow-hidden">
            <div
              className="h-full w-[74%] bg-gradient-to-r from-secondary to-secondary-container"
            />
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 text-secondary font-bold font-label text-[0.75rem] cursor-pointer hover:bg-surface-variant/20 p-2 rounded -mx-2 transition-all">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">info</span>
          <span>Model Info</span>
        </div>
        <div className="flex items-center gap-3 text-[#cdc3d1] hover:text-white transition-colors cursor-pointer font-label text-[0.75rem] p-2 rounded -mx-2">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">memory</span>
          <span>Context</span>
        </div>
        <div className="flex items-center gap-3 text-[#cdc3d1] hover:text-white transition-colors cursor-pointer font-label text-[0.75rem] p-2 rounded -mx-2">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">history</span>
          <span>Activity</span>
        </div>
      </div>

      {/* Live Insights Card */}
      <div className="mt-4 rounded-xl bg-surface-container p-4 border border-outline-variant/10 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-sm" aria-hidden="true">
            lightbulb
          </span>
          <h3 className="text-xs font-bold text-on-surface">Live Insights</h3>
        </div>
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          AI is analyzing <span className="text-secondary">App.tsx</span>.
          Suggested refactor for the state management identified in line 42.
        </p>
        <button className="mt-3 w-full py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-bold uppercase rounded-lg transition-all border border-primary/20">
          Apply Fix
        </button>
      </div>
    </div>

    {/* Footer */}
    <div className="p-4 mt-auto border-t border-[#4a444f]/10">
      <button
        className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
        aria-label="Collapse panel"
        onClick={onToggle}
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          close_fullscreen
        </span>
        <span>Collapse Panel</span>
      </button>
    </div>
  </aside>
)

export default ContextPanel
```

- [ ] **Step 4: Update existing ContextPanel tests**

Update all existing `render(<ContextPanel />)` calls to `render(<ContextPanel isOpen onToggle={vi.fn()} />)`. Update assertions that reference old content (model name, recent actions, AI strategy, system health) to reference new content (token usage, Model Info, Context, Activity, Live Insights). Specifically:

- `'renders "AGENT STATUS" header'` — now checks for `text-secondary` styling + `psychology` icon
- `'renders model info'` — now checks for "GPT-4o Active" text
- `'renders context usage'` — now checks for "Token Usage" and "74%"
- Remove tests for: latency, tokens stats, recent actions, AI strategy, system health
- Add test for: "Live Insights" card, "Apply Fix" button

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/components/layout/ContextPanel.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 6: Lift `isContextPanelOpen` state to `App.tsx`**

```typescript
const App = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabName>('Chat')
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(true)

  const handleTabChange = (tab: TabName): void => {
    setActiveTab(tab)
  }

  const handleToggleContextPanel = (): void => {
    setIsContextPanelOpen((prev) => !prev)
  }

  return (
    <>
      {activeTab === 'Editor' ? (
        <EditorView
          onTabChange={handleTabChange}
          isContextPanelOpen={isContextPanelOpen}
          onToggleContextPanel={handleToggleContextPanel}
        />
      ) : (
        <ChatView
          onTabChange={handleTabChange}
          isContextPanelOpen={isContextPanelOpen}
          onToggleContextPanel={handleToggleContextPanel}
        />
      )}
      <CommandPalette />
    </>
  )
}
```

- [ ] **Step 7: Update ChatView to accept panel props**

In `src/features/chat/ChatView.tsx`:

```typescript
interface ChatViewProps {
  onTabChange?: (tab: TabName) => void
  isContextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

const ChatView = ({
  onTabChange = undefined,
  isContextPanelOpen = true,
  onToggleContextPanel = undefined,
}: ChatViewProps): ReactElement => (
  <div
    className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
    data-testid="chat-view"
  >
    <IconRail />
    <Sidebar conversations={mockConversations} />
    <main
      className={`ml-[308px] ${isContextPanelOpen ? 'mr-[280px]' : 'mr-0'} flex-1 flex flex-col transition-all duration-300`}
      data-testid="main-content"
    >
      <TopTabBar activeTab="Chat" onTabChange={onTabChange} />
      <div className="flex-1 flex flex-col" data-testid="message-area">
        <MessageThread messages={mockMessages} />
        <MessageInput />
      </div>
    </main>
    <ContextPanel
      isOpen={isContextPanelOpen}
      onToggle={onToggleContextPanel ?? ((): void => {})}
    />
  </div>
)
```

- [ ] **Step 8: Update ChatView tests**

In `src/features/chat/ChatView.test.tsx`, update the `'main content area applies correct margin classes'` test:

```typescript
test('main content area applies correct margin classes when panel open', () => {
  render(<ChatView isContextPanelOpen onToggleContextPanel={vi.fn()} />)
  const mainContent = screen.getByTestId('main-content')
  expect(mainContent).toHaveClass('ml-[308px]')
  expect(mainContent).toHaveClass('mr-[280px]')
})

test('main content area applies mr-0 when panel closed', () => {
  render(<ChatView isContextPanelOpen={false} onToggleContextPanel={vi.fn()} />)
  const mainContent = screen.getByTestId('main-content')
  expect(mainContent).toHaveClass('ml-[308px]')
  expect(mainContent).toHaveClass('mr-0')
})
```

- [ ] **Step 9: Run all tests**

```bash
npx vitest run src/components/layout/ContextPanel.test.tsx src/features/chat/ChatView.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 10: Run type-check and lint**

```bash
npm run type-check && npm run lint
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add src/components/layout/ContextPanel.tsx src/components/layout/ContextPanel.test.tsx src/App.tsx src/features/chat/ChatView.tsx src/features/chat/ChatView.test.tsx
git commit -m "feat: make ContextPanel collapsible with redesigned layout, persist state across views"
```

---

## Task 5: Create EditorStatusBar component

**Files:**

- Create: `src/features/editor/components/EditorStatusBar.tsx`
- Create: `src/features/editor/components/EditorStatusBar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/features/editor/components/EditorStatusBar.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { EditorStatusBar } from './EditorStatusBar'
import type { EditorStatusBarState } from '../types'

const defaultState: EditorStatusBarState = {
  vimMode: 'NORMAL',
  gitBranch: 'main*',
  syncStatus: { behind: 0, ahead: 1 },
  fileName: 'App.tsx',
  encoding: 'UTF-8',
  language: 'TypeScript',
  cursor: { line: 42, column: 12 },
}

describe('EditorStatusBar', () => {
  test('renders vim mode indicator', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()
  })

  test('renders git branch', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    expect(screen.getByText('main*')).toBeInTheDocument()
  })

  test('renders sync status', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    expect(screen.getByText('0 ↓ 1 ↑')).toBeInTheDocument()
  })

  test('renders file name', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
  })

  test('renders encoding', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })

  test('renders language with primary color', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    const lang = screen.getByText('TypeScript')
    expect(lang).toBeInTheDocument()
    expect(lang).toHaveClass('text-primary')
  })

  test('renders cursor position', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    expect(screen.getByText('Ln 42, Col 12')).toBeInTheDocument()
  })

  test('adjusts right position when context panel is closed', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen={false} />)
    const bar = screen.getByRole('status')
    expect(bar).toHaveClass('right-0')
  })

  test('adjusts right position when context panel is open', () => {
    render(<EditorStatusBar state={defaultState} isContextPanelOpen />)
    const bar = screen.getByRole('status')
    expect(bar).toHaveClass('right-[280px]')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/components/EditorStatusBar.test.tsx --reporter=verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement EditorStatusBar**

Create `src/features/editor/components/EditorStatusBar.tsx`:

```typescript
import type { ReactElement } from 'react'
import type { EditorStatusBarState } from '../types'

interface EditorStatusBarProps {
  state: EditorStatusBarState
  isContextPanelOpen: boolean
}

export const EditorStatusBar = ({
  state,
  isContextPanelOpen,
}: EditorStatusBarProps): ReactElement => (
  <footer
    role="status"
    aria-label="Editor status bar"
    className={`fixed bottom-0 left-[308px] ${isContextPanelOpen ? 'right-[280px]' : 'right-0'} h-6 bg-[#1a1a2a] border-t border-[#4a444f]/15 flex items-center justify-between z-30 font-label text-[10px] uppercase tracking-wider text-[#cdc3d1] transition-all duration-300`}
  >
    <div className="flex items-center gap-0">
      <div className="bg-primary text-background px-3 h-6 flex items-center font-bold">
        -- {state.vimMode} --
      </div>
      <div className="flex items-center gap-2 px-3 border-r border-[#4a444f]/15 h-6">
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
          account_tree
        </span>
        <span>{state.gitBranch}</span>
      </div>
      <div className="flex items-center gap-2 px-3 h-6">
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
          sync
        </span>
        <span>
          {state.syncStatus.behind} ↓ {state.syncStatus.ahead} ↑
        </span>
      </div>
    </div>
    <div className="flex items-center gap-0">
      <span className="px-3 hover:bg-[#333344] transition-colors cursor-pointer border-l border-[#4a444f]/15 h-6 flex items-center">
        {state.fileName}
      </span>
      <span className="px-3 hover:bg-[#333344] transition-colors cursor-pointer border-l border-[#4a444f]/15 h-6 flex items-center">
        {state.encoding}
      </span>
      <span className="px-3 hover:bg-[#333344] transition-colors cursor-pointer border-l border-[#4a444f]/15 h-6 flex items-center text-primary">
        {state.language}
      </span>
      <span className="px-3 hover:bg-[#333344] transition-colors cursor-pointer border-l border-[#4a444f]/15 h-6 flex items-center">
        Ln {state.cursor.line}, Col {state.cursor.column}
      </span>
    </div>
  </footer>
)
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/features/editor/components/EditorStatusBar.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/components/EditorStatusBar.tsx src/features/editor/components/EditorStatusBar.test.tsx
git commit -m "feat: add EditorStatusBar with vim mode, git branch, sync, cursor position"
```

---

## Task 6: Create EditorTabs component

**Files:**

- Create: `src/features/editor/components/EditorTabs.tsx`
- Create: `src/features/editor/components/EditorTabs.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/features/editor/components/EditorTabs.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { EditorTabs } from './EditorTabs'
import type { EditorTab } from '../types'

const mockTabs: EditorTab[] = [
  { id: 'tab-1', fileName: 'App.tsx', filePath: 'src/App.tsx', icon: 'code', isActive: true, isDirty: false },
  { id: 'tab-2', fileName: 'utils.ts', filePath: 'src/utils.ts', icon: 'code', isActive: false, isDirty: false },
]

describe('EditorTabs', () => {
  test('renders all tabs', () => {
    render(<EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />)
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(screen.getByText('utils.ts')).toBeInTheDocument()
  })

  test('active tab has primary border styling', () => {
    render(<EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />)
    const activeTab = screen.getByText('App.tsx').closest('[role="tab"]')
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(activeTab).toHaveClass('border-t-2', 'border-primary')
  })

  test('inactive tab does not have primary border', () => {
    render(<EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />)
    const inactiveTab = screen.getByText('utils.ts').closest('[role="tab"]')
    expect(inactiveTab).toHaveAttribute('aria-selected', 'false')
    expect(inactiveTab).not.toHaveClass('border-primary')
  })

  test('calls onTabClick when tab is clicked', async () => {
    const onTabClick = vi.fn()
    const user = userEvent.setup()
    render(<EditorTabs tabs={mockTabs} onTabClick={onTabClick} onTabClose={vi.fn()} />)
    await user.click(screen.getByText('utils.ts'))
    expect(onTabClick).toHaveBeenCalledWith('tab-2')
  })

  test('calls onTabClose when close button is clicked', async () => {
    const onTabClose = vi.fn()
    const user = userEvent.setup()
    render(<EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={onTabClose} />)
    const closeButtons = screen.getAllByRole('button', { name: /close/i })
    await user.click(closeButtons[0])
    expect(onTabClose).toHaveBeenCalledWith('tab-1')
  })

  test('renders tab bar container', () => {
    render(<EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />)
    const tablist = screen.getByRole('tablist')
    expect(tablist).toHaveClass('h-10', 'bg-surface-container-low')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/components/EditorTabs.test.tsx --reporter=verbose
```

Expected: FAIL.

- [ ] **Step 3: Implement EditorTabs**

Create `src/features/editor/components/EditorTabs.tsx`:

```typescript
import type { ReactElement } from 'react'
import type { EditorTab } from '../types'

interface EditorTabsProps {
  tabs: EditorTab[]
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export const EditorTabs = ({
  tabs,
  onTabClick,
  onTabClose,
}: EditorTabsProps): ReactElement => (
  <div role="tablist" className="h-10 bg-surface-container-low flex items-center">
    {tabs.map((tab) => (
      <div
        key={tab.id}
        role="tab"
        aria-selected={tab.isActive}
        className={`h-full px-4 flex items-center gap-2 cursor-pointer transition-colors ${
          tab.isActive
            ? 'bg-surface text-on-surface border-t-2 border-primary'
            : 'text-on-surface-variant/60 hover:bg-surface-variant/20'
        }`}
        onClick={(): void => onTabClick(tab.id)}
      >
        <span
          className={`material-symbols-outlined text-sm ${tab.isActive ? 'text-[#8fbaff]' : 'opacity-50'}`}
          aria-hidden="true"
        >
          {tab.icon}
        </span>
        <span className="text-xs font-medium">{tab.fileName}</span>
        <button
          className="material-symbols-outlined text-[10px] ml-2 hover:bg-surface-variant rounded-full p-0.5"
          aria-label={`Close ${tab.fileName}`}
          onClick={(e): void => {
            e.stopPropagation()
            onTabClose(tab.id)
          }}
        >
          close
        </button>
      </div>
    ))}
    <div className="flex-1 bg-surface-container-low h-full" />
  </div>
)
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/features/editor/components/EditorTabs.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/components/EditorTabs.tsx src/features/editor/components/EditorTabs.test.tsx
git commit -m "feat: add EditorTabs component with active/inactive states and close buttons"
```

---

## Task 7: Create ExplorerPane component

**Files:**

- Create: `src/features/editor/components/ExplorerPane.tsx`
- Create: `src/features/editor/components/ExplorerPane.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/features/editor/components/ExplorerPane.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { ExplorerPane } from './ExplorerPane'
import type { FileNode, ContextMenuAction } from '../types'

const mockNodes: FileNode[] = [
  {
    id: 'node-src',
    name: 'src',
    type: 'folder',
    defaultExpanded: true,
    children: [
      { id: 'node-app', name: 'App.tsx', type: 'file' },
    ],
  },
]

const mockActions: ContextMenuAction[] = [
  { label: 'Rename', icon: 'edit' },
]

describe('ExplorerPane', () => {
  test('renders EXPLORER header', () => {
    render(
      <ExplorerPane
        nodes={mockNodes}
        contextMenuActions={mockActions}
        isOpen
        onToggle={vi.fn()}
        onFileSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Explorer')).toBeInTheDocument()
  })

  test('renders file tree with nodes', () => {
    render(
      <ExplorerPane
        nodes={mockNodes}
        contextMenuActions={mockActions}
        isOpen
        onToggle={vi.fn()}
        onFileSelect={vi.fn()}
      />
    )
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
  })

  test('renders collapse button', () => {
    render(
      <ExplorerPane
        nodes={mockNodes}
        contextMenuActions={mockActions}
        isOpen
        onToggle={vi.fn()}
        onFileSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /collapse explorer/i })).toBeInTheDocument()
  })

  test('calls onToggle when collapse button is clicked', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <ExplorerPane
        nodes={mockNodes}
        contextMenuActions={mockActions}
        isOpen
        onToggle={onToggle}
        onFileSelect={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /collapse explorer/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test('applies w-0 overflow-hidden when closed', () => {
    const { container } = render(
      <ExplorerPane
        nodes={mockNodes}
        contextMenuActions={mockActions}
        isOpen={false}
        onToggle={vi.fn()}
        onFileSelect={vi.fn()}
      />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const pane = container.firstChild as HTMLElement
    expect(pane).toHaveClass('w-0', 'overflow-hidden')
  })

  test('applies w-64 when open', () => {
    const { container } = render(
      <ExplorerPane
        nodes={mockNodes}
        contextMenuActions={mockActions}
        isOpen
        onToggle={vi.fn()}
        onFileSelect={vi.fn()}
      />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const pane = container.firstChild as HTMLElement
    expect(pane).toHaveClass('w-64')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/components/ExplorerPane.test.tsx --reporter=verbose
```

Expected: FAIL.

- [ ] **Step 3: Implement ExplorerPane**

Create `src/features/editor/components/ExplorerPane.tsx`:

```typescript
import type { ReactElement } from 'react'
import type { FileNode, ContextMenuAction } from '../types'
import { FileTree } from './FileTree'

interface ExplorerPaneProps {
  nodes: FileNode[]
  contextMenuActions: ContextMenuAction[]
  isOpen: boolean
  onToggle: () => void
  onFileSelect: (node: FileNode) => void
}

export const ExplorerPane = ({
  nodes,
  contextMenuActions,
  isOpen,
  onToggle,
  onFileSelect,
}: ExplorerPaneProps): ReactElement => (
  <aside
    className={`${isOpen ? 'w-64' : 'w-0 overflow-hidden'} bg-surface-container-low/50 backdrop-blur-lg flex flex-col border-r border-outline-variant/10 transition-all duration-300`}
  >
    <div className="p-4 flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant/70">
        Explorer
      </span>
      <button
        className="text-on-surface-variant cursor-pointer hover:text-on-surface"
        aria-label="Collapse explorer"
        onClick={onToggle}
      >
        <span className="material-symbols-outlined text-xs" aria-hidden="true">
          keyboard_double_arrow_left
        </span>
      </button>
    </div>
    <div className="flex-1 overflow-y-auto px-2 font-label text-[13px]">
      <FileTree
        nodes={nodes}
        contextMenuActions={contextMenuActions}
        onNodeSelect={onFileSelect}
      />
    </div>
  </aside>
)
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/features/editor/components/ExplorerPane.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/components/ExplorerPane.tsx src/features/editor/components/ExplorerPane.test.tsx
git commit -m "feat: add ExplorerPane with collapsible file tree sidebar"
```

---

## Task 8: Vite dev middleware for file reading + file service

**Files:**

- Modify: `vite.config.ts` — add `filesApiPlugin()`
- Create: `src/features/editor/services/fileService.ts`
- Create: `src/features/editor/services/fileService.test.ts`

- [ ] **Step 1: Write failing tests for fileService**

Create `src/features/editor/services/fileService.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { MockFileService } from './fileService'

describe('MockFileService', () => {
  const service = new MockFileService()

  test('getTree returns array of FileNode objects', async () => {
    const tree = await service.getTree()
    expect(Array.isArray(tree)).toBe(true)
    expect(tree.length).toBeGreaterThan(0)
    expect(tree[0]).toHaveProperty('id')
    expect(tree[0]).toHaveProperty('name')
    expect(tree[0]).toHaveProperty('type')
  })

  test('getFileContent returns content and language', async () => {
    const result = await service.getFileContent('src/App.tsx')
    expect(result).toHaveProperty('content')
    expect(result).toHaveProperty('language')
    expect(typeof result.content).toBe('string')
    expect(result.content.length).toBeGreaterThan(0)
  })

  test('getFileContent detects TypeScript language', async () => {
    const result = await service.getFileContent('src/App.tsx')
    expect(result.language).toBe('typescript')
  })

  test('getFileContent detects Rust language', async () => {
    const result = await service.getFileContent('src/main.rs')
    expect(result.language).toBe('rust')
  })

  test('getFileContent defaults to plaintext for unknown extensions', async () => {
    const result = await service.getFileContent('README')
    expect(result.language).toBe('plaintext')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/services/fileService.test.ts --reporter=verbose
```

Expected: FAIL.

- [ ] **Step 3: Implement fileService with interface + MockFileService**

Create `src/features/editor/services/fileService.ts`:

```typescript
import type { FileNode } from '../types'

interface FileContentResult {
  content: string
  language: string
}

export interface FileService {
  getTree(root?: string): Promise<FileNode[]>
  getFileContent(filePath: string): Promise<FileContentResult>
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
}

const detectLanguage = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext'
}

export class HttpFileService implements FileService {
  async getTree(root = '.'): Promise<FileNode[]> {
    const res = await fetch(`/api/files/tree?root=${encodeURIComponent(root)}`)
    if (!res.ok) {
      throw new Error(`Failed to fetch file tree: ${res.statusText}`)
    }
    return res.json() as Promise<FileNode[]>
  }

  async getFileContent(filePath: string): Promise<FileContentResult> {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(filePath)}`
    )
    if (!res.ok) {
      throw new Error(`Failed to fetch file content: ${res.statusText}`)
    }
    return res.json() as Promise<FileContentResult>
  }
}

const MOCK_CODE = `import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'

export default function App() {
  const [active, setActive] = useState(true)

  return (
    <Layout>
      <main className="flex-1">
        {/* AI Generated Component View */}
      </main>
    </Layout>
  )
}`

export class MockFileService implements FileService {
  async getTree(): Promise<FileNode[]> {
    return [
      {
        id: 'node-src',
        name: 'src',
        type: 'folder',
        defaultExpanded: true,
        children: [
          { id: 'node-app', name: 'App.tsx', type: 'file' },
          { id: 'node-utils', name: 'utils.ts', type: 'file' },
          {
            id: 'node-components',
            name: 'components',
            type: 'folder',
            children: [],
          },
          {
            id: 'node-assets',
            name: 'assets',
            type: 'folder',
            children: [],
          },
        ],
      },
      {
        id: 'node-tailwind',
        name: 'tailwind.config.js',
        type: 'file',
        icon: 'settings',
      },
      {
        id: 'node-package',
        name: 'package.json',
        type: 'file',
        icon: 'info',
      },
    ]
  }

  async getFileContent(filePath: string): Promise<FileContentResult> {
    return {
      content: MOCK_CODE,
      language: detectLanguage(filePath),
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/features/editor/services/fileService.test.ts --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 5: Add filesApiPlugin to vite.config.ts**

Add a new plugin function in `vite.config.ts`:

```typescript
import fs from 'node:fs/promises'

function filesApiPlugin(): Plugin {
  return {
    name: 'files-api',
    configureServer(server): void {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/files/')) {
          return next()
        }

        try {
          const url = new URL(req.url, `http://${req.headers.host}`)
          const pathname = url.pathname

          if (pathname === '/api/files/tree' && req.method === 'GET') {
            const root = url.searchParams.get('root') ?? '.'
            const safePath = validateRepoPath(root)

            if (!safePath && root !== '.') {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid root path' }))
              return
            }

            const targetDir =
              root === '.' ? repoRoot : path.resolve(repoRoot, safePath ?? '.')
            const tree = await buildFileTree(targetDir, targetDir)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(tree))
            return
          }

          if (pathname === '/api/files/content' && req.method === 'GET') {
            const filePath = url.searchParams.get('path')

            if (!filePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing path parameter' }))
              return
            }

            const safePath = validateRepoPath(filePath)

            if (!safePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid file path' }))
              return
            }

            const fullPath = path.resolve(repoRoot, safePath)
            const stat = await fs.stat(fullPath)

            if (stat.size > 1024 * 1024) {
              res.writeHead(413, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'File too large (max 1MB)' }))
              return
            }

            const content = await fs.readFile(fullPath, 'utf-8')
            const ext = path.extname(filePath).slice(1).toLowerCase()
            const langMap: Record<string, string> = {
              ts: 'typescript',
              tsx: 'typescript',
              js: 'javascript',
              jsx: 'javascript',
              rs: 'rust',
              json: 'json',
              md: 'markdown',
              css: 'css',
              scss: 'scss',
              html: 'html',
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                content,
                language: langMap[ext] ?? 'plaintext',
              })
            )
            return
          }

          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.claude',
  '.codex-reviews',
  '.superpowers',
])

async function buildFileTree(
  dirPath: string,
  rootPath: string
): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue

    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(rootPath, fullPath)

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, rootPath)
      nodes.push({
        id: `node-${relativePath.replace(/[\\/]/g, '-')}`,
        name: entry.name,
        type: 'folder',
        children,
      })
    } else {
      nodes.push({
        id: `node-${relativePath.replace(/[\\/]/g, '-')}`,
        name: entry.name,
        type: 'file',
      })
    }
  }

  return nodes
}
```

Add `filesApiPlugin()` to the plugins array:

```typescript
export default defineConfig({
  plugins: [react(), gitApiPlugin(), filesApiPlugin()],
})
```

Import `FileNode` from the editor types at the top of `vite.config.ts`:

```typescript
import type { FileNode } from './src/features/editor/types'
```

- [ ] **Step 6: Run type-check**

```bash
npm run type-check
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts src/features/editor/services/
git commit -m "feat: add file service with Vite dev middleware for tree listing and content reading"
```

---

## Task 9: Create hooks (useFileTree, useFileContent)

**Files:**

- Create: `src/features/editor/hooks/useFileTree.ts`
- Create: `src/features/editor/hooks/useFileTree.test.ts`
- Create: `src/features/editor/hooks/useFileContent.ts`
- Create: `src/features/editor/hooks/useFileContent.test.ts`

- [ ] **Step 1: Write failing tests for useFileTree**

Create `src/features/editor/hooks/useFileTree.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { useFileTree } from './useFileTree'
import type { FileService } from '../services/fileService'
import type { FileNode } from '../types'

const mockTree: FileNode[] = [
  { id: 'node-src', name: 'src', type: 'folder', children: [] },
]

const mockService: FileService = {
  getTree: vi.fn().mockResolvedValue(mockTree),
  getFileContent: vi
    .fn()
    .mockResolvedValue({ content: '', language: 'plaintext' }),
}

describe('useFileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns loading state initially', () => {
    const { result } = renderHook(() => useFileTree(mockService))
    expect(result.current.loading).toBe(true)
  })

  test('returns file tree after loading', async () => {
    const { result } = renderHook(() => useFileTree(mockService))
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.tree).toEqual(mockTree)
  })

  test('returns error when service fails', async () => {
    const errorService: FileService = {
      getTree: vi.fn().mockRejectedValue(new Error('Network error')),
      getFileContent: vi.fn(),
    }
    const { result } = renderHook(() => useFileTree(errorService))
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('Network error')
  })
})
```

- [ ] **Step 2: Write failing tests for useFileContent**

Create `src/features/editor/hooks/useFileContent.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { useFileContent } from './useFileContent'
import type { FileService } from '../services/fileService'

const mockService: FileService = {
  getTree: vi.fn(),
  getFileContent: vi
    .fn()
    .mockResolvedValue({ content: 'const x = 1', language: 'typescript' }),
}

describe('useFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('does not fetch when filePath is null', () => {
    renderHook(() => useFileContent(mockService, null))
    expect(mockService.getFileContent).not.toHaveBeenCalled()
  })

  test('fetches content when filePath is provided', async () => {
    const { result } = renderHook(() =>
      useFileContent(mockService, 'src/App.tsx')
    )
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.content).toBe('const x = 1')
    expect(result.current.language).toBe('typescript')
  })

  test('returns error when service fails', async () => {
    const errorService: FileService = {
      getTree: vi.fn(),
      getFileContent: vi.fn().mockRejectedValue(new Error('Not found')),
    }
    const { result } = renderHook(() =>
      useFileContent(errorService, 'bad/path.ts')
    )
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('Not found')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/hooks/ --reporter=verbose
```

Expected: FAIL.

- [ ] **Step 4: Implement useFileTree**

Create `src/features/editor/hooks/useFileTree.ts`:

```typescript
import { useState, useEffect } from 'react'
import type { FileNode } from '../types'
import type { FileService } from '../services/fileService'

interface UseFileTreeResult {
  tree: FileNode[]
  loading: boolean
  error: string | null
}

export const useFileTree = (service: FileService): UseFileTreeResult => {
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchTree = async (): Promise<void> => {
      try {
        setLoading(true)
        const result = await service.getTree()
        if (!cancelled) {
          setTree(result)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchTree()

    return (): void => {
      cancelled = true
    }
  }, [service])

  return { tree, loading, error }
}
```

- [ ] **Step 5: Implement useFileContent**

Create `src/features/editor/hooks/useFileContent.ts`:

```typescript
import { useState, useEffect } from 'react'
import type { FileService } from '../services/fileService'

interface UseFileContentResult {
  content: string | null
  language: string | null
  loading: boolean
  error: string | null
}

export const useFileContent = (
  service: FileService,
  filePath: string | null
): UseFileContentResult => {
  const [content, setContent] = useState<string | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!filePath) {
      return
    }

    let cancelled = false

    const fetchContent = async (): Promise<void> => {
      try {
        setLoading(true)
        const result = await service.getFileContent(filePath)
        if (!cancelled) {
          setContent(result.content)
          setLanguage(result.language)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchContent()

    return (): void => {
      cancelled = true
    }
  }, [service, filePath])

  return { content, language, loading, error }
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/features/editor/hooks/ --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/hooks/
git commit -m "feat: add useFileTree and useFileContent hooks with loading/error states"
```

---

## Task 10: Install Shiki + create CodeEditor component

**Files:**

- Create: `src/features/editor/components/CodeEditor.tsx`
- Create: `src/features/editor/components/CodeEditor.test.tsx`

- [ ] **Step 1: Install Shiki**

```bash
npm install shiki
```

- [ ] **Step 2: Write failing tests**

Create `src/features/editor/components/CodeEditor.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { CodeEditor } from './CodeEditor'

describe('CodeEditor', () => {
  test('renders code content area', () => {
    render(<CodeEditor content="const x = 1" language="typescript" currentLine={1} />)
    expect(screen.getByRole('region', { name: /code editor/i })).toBeInTheDocument()
  })

  test('renders line numbers', () => {
    render(<CodeEditor content="line 1\nline 2\nline 3" language="plaintext" currentLine={1} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  test('renders code text content', () => {
    render(<CodeEditor content="const x = 42" language="typescript" currentLine={1} />)
    expect(screen.getByText(/const/)).toBeInTheDocument()
  })

  test('renders loading state when content is null', () => {
    render(<CodeEditor content={null} language={null} currentLine={1} />)
    expect(screen.getByText(/no file open/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/features/editor/components/CodeEditor.test.tsx --reporter=verbose
```

Expected: FAIL.

- [ ] **Step 4: Implement CodeEditor**

Create `src/features/editor/components/CodeEditor.tsx`:

```typescript
import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { codeToTokens } from 'shiki'

interface CodeEditorProps {
  content: string | null
  language: string | null
  currentLine: number
}

interface TokenLine {
  tokens: Array<{ content: string; color?: string }>
}

export const CodeEditor = ({
  content,
  language,
  currentLine,
}: CodeEditorProps): ReactElement => {
  const [tokenLines, setTokenLines] = useState<TokenLine[]>([])

  useEffect(() => {
    if (!content || !language) {
      setTokenLines([])
      return
    }

    let cancelled = false

    const tokenize = async (): Promise<void> => {
      try {
        const { tokens } = await codeToTokens(content, {
          lang: language as Parameters<typeof codeToTokens>[1]['lang'],
          theme: 'catppuccin-mocha',
        })

        if (!cancelled) {
          setTokenLines(
            tokens.map((line) => ({
              tokens: line.map((token) => ({
                content: token.content,
                color: token.color,
              })),
            }))
          )
        }
      } catch {
        // Fallback: render as plain text
        if (!cancelled) {
          setTokenLines(
            content.split('\n').map((line) => ({
              tokens: [{ content: line }],
            }))
          )
        }
      }
    }

    void tokenize()

    return (): void => {
      cancelled = true
    }
  }, [content, language])

  if (!content) {
    return (
      <div
        role="region"
        aria-label="Code editor"
        className="flex-1 flex items-center justify-center text-on-surface-variant text-sm"
      >
        No file open
      </div>
    )
  }

  const lines = content.split('\n')

  return (
    <div
      role="region"
      aria-label="Code editor"
      className="flex-1 p-6 font-label text-[14px] leading-relaxed overflow-y-auto no-scrollbar"
    >
      <div className="flex">
        {/* Line number gutter */}
        <div className="w-12 text-on-surface-variant/30 select-none text-right pr-4 border-r border-outline-variant/10">
          {lines.map((_, i) => (
            <div
              key={i}
              className={i + 1 === currentLine ? 'text-primary/60' : ''}
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code content */}
        <div className="flex-1 pl-6">
          {tokenLines.length > 0
            ? tokenLines.map((line, i) => (
                <div
                  key={i}
                  className={
                    i + 1 === currentLine
                      ? 'bg-primary/5 rounded border-l-2 border-primary -ml-1 pl-[calc(1rem+1px)]'
                      : ''
                  }
                >
                  {line.tokens.map((token, j) => (
                    <span key={j} style={token.color ? { color: token.color } : undefined}>
                      {token.content}
                    </span>
                  ))}
                </div>
              ))
            : lines.map((line, i) => (
                <div
                  key={i}
                  className={
                    i + 1 === currentLine
                      ? 'bg-primary/5 rounded border-l-2 border-primary -ml-1 pl-[calc(1rem+1px)]'
                      : ''
                  }
                >
                  {line}
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/features/editor/components/CodeEditor.test.tsx --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/features/editor/components/CodeEditor.tsx src/features/editor/components/CodeEditor.test.tsx
git commit -m "feat: add CodeEditor with Shiki syntax highlighting and line numbers"
```

---

## Task 11: Assemble EditorView + update mock data

**Files:**

- Modify: `src/features/editor/data/mockFileTree.ts` → rename to `mockEditorData.ts`
- Modify: `src/features/editor/data/mockFileTree.test.ts` → rename to `mockEditorData.test.ts`
- Rewrite: `src/features/editor/EditorView.tsx`
- Rewrite: `src/features/editor/EditorView.test.tsx`

- [ ] **Step 1: Rename mock data files**

```bash
git mv src/features/editor/data/mockFileTree.ts src/features/editor/data/mockEditorData.ts
git mv src/features/editor/data/mockFileTree.test.ts src/features/editor/data/mockEditorData.test.ts
```

Update internal imports in `mockEditorData.ts` if needed. Add mock editor tab and status bar data:

```typescript
import type { EditorTab, EditorStatusBarState } from '../types'

export const mockEditorTabs: EditorTab[] = [
  {
    id: 'tab-1',
    fileName: 'App.tsx',
    filePath: 'src/App.tsx',
    icon: 'code',
    isActive: true,
    isDirty: false,
  },
  {
    id: 'tab-2',
    fileName: 'utils.ts',
    filePath: 'src/utils.ts',
    icon: 'code',
    isActive: false,
    isDirty: false,
  },
]

export const mockEditorStatusBar: EditorStatusBarState = {
  vimMode: 'NORMAL',
  gitBranch: 'main*',
  syncStatus: { behind: 0, ahead: 1 },
  fileName: 'App.tsx',
  encoding: 'UTF-8',
  language: 'TypeScript',
  cursor: { line: 42, column: 12 },
}
```

- [ ] **Step 2: Rewrite EditorView**

Replace `src/features/editor/EditorView.tsx`:

```typescript
import { useState, useCallback, useMemo } from 'react'
import type { ReactElement } from 'react'
import IconRail from '../../components/layout/IconRail'
import { Sidebar } from '../../components/layout/Sidebar'
import type { TabName } from '../../components/layout/TopTabBar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import ContextPanel from '../../components/layout/ContextPanel'
import { ExplorerPane } from './components/ExplorerPane'
import { EditorTabs } from './components/EditorTabs'
import { CodeEditor } from './components/CodeEditor'
import { EditorStatusBar } from './components/EditorStatusBar'
import { contextMenuActions } from './data/mockEditorData'
import { mockEditorTabs, mockEditorStatusBar } from './data/mockEditorData'
import { mockConversations } from '../chat/data/mockMessages'
import { useFileTree } from './hooks/useFileTree'
import { useFileContent } from './hooks/useFileContent'
import { HttpFileService, MockFileService } from './services/fileService'
import type { FileNode, EditorTab } from './types'

const fileService = import.meta.env.DEV
  ? new HttpFileService()
  : new MockFileService()

interface EditorViewProps {
  onTabChange?: (tab: TabName) => void
  isContextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

const EditorView = ({
  onTabChange = undefined,
  isContextPanelOpen = true,
  onToggleContextPanel = undefined,
}: EditorViewProps): ReactElement => {
  const [isExplorerOpen, setIsExplorerOpen] = useState(true)
  const [tabs, setTabs] = useState<EditorTab[]>(mockEditorTabs)
  const [statusBar, setStatusBar] = useState(mockEditorStatusBar)

  const { tree } = useFileTree(fileService)
  const activeTab = useMemo(() => tabs.find((t) => t.isActive), [tabs])
  const { content, language } = useFileContent(fileService, activeTab?.filePath ?? null)

  const handleToggleExplorer = useCallback((): void => {
    setIsExplorerOpen((prev) => !prev)
  }, [])

  const handleFileSelect = useCallback(
    (node: FileNode): void => {
      if (node.type !== 'file') return

      const existing = tabs.find((t) => t.filePath === `${node.name}`)
      if (existing) {
        setTabs((prev) =>
          prev.map((t) => ({ ...t, isActive: t.id === existing.id }))
        )
      } else {
        const newTab: EditorTab = {
          id: `tab-${node.id}`,
          fileName: node.name,
          filePath: node.name,
          icon: 'code',
          isActive: true,
          isDirty: false,
        }
        setTabs((prev) => [
          ...prev.map((t) => ({ ...t, isActive: false })),
          newTab,
        ])
      }

      setStatusBar((prev) => ({ ...prev, fileName: node.name }))
    },
    [tabs]
  )

  const handleTabClick = useCallback((tabId: string): void => {
    setTabs((prev) =>
      prev.map((t) => ({ ...t, isActive: t.id === tabId }))
    )
  }, [])

  const handleTabClose = useCallback((tabId: string): void => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId)
      if (filtered.length > 0 && !filtered.some((t) => t.isActive)) {
        filtered[filtered.length - 1] = {
          ...filtered[filtered.length - 1],
          isActive: true,
        }
      }
      return filtered
    })
  }, [])

  const handleTogglePanel = onToggleContextPanel ?? ((): void => {})

  return (
    <div
      className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
      data-testid="editor-view"
    >
      <IconRail />
      <Sidebar conversations={mockConversations} />

      <main
        className={`ml-[308px] ${isContextPanelOpen ? 'mr-[280px]' : 'mr-0'} flex-1 flex flex-col transition-all duration-300`}
        data-testid="main-content"
      >
        <TopTabBar activeTab="Editor" onTabChange={onTabChange} />

        <div className="flex-1 flex overflow-hidden" data-testid="editor-stage">
          <ExplorerPane
            nodes={tree}
            contextMenuActions={contextMenuActions}
            isOpen={isExplorerOpen}
            onToggle={handleToggleExplorer}
            onFileSelect={handleFileSelect}
          />
          <section className="flex-1 flex flex-col bg-surface overflow-hidden">
            <EditorTabs
              tabs={tabs}
              onTabClick={handleTabClick}
              onTabClose={handleTabClose}
            />
            <CodeEditor
              content={content}
              language={language}
              currentLine={statusBar.cursor.line}
            />
          </section>
        </div>
      </main>

      <ContextPanel isOpen={isContextPanelOpen} onToggle={handleTogglePanel} />
      <EditorStatusBar state={statusBar} isContextPanelOpen={isContextPanelOpen} />
    </div>
  )
}

export default EditorView
```

- [ ] **Step 3: Rewrite EditorView tests**

Replace `src/features/editor/EditorView.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import EditorView from './EditorView'

describe('EditorView', () => {
  test('renders editor view container', () => {
    render(<EditorView />)
    expect(screen.getByTestId('editor-view')).toBeInTheDocument()
  })

  test('renders IconRail', () => {
    render(<EditorView />)
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
  })

  test('renders Sidebar', () => {
    render(<EditorView />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  test('renders TopTabBar with Editor tab active', () => {
    render(<EditorView />)
    const editorTab = screen.getByRole('button', { name: 'Editor' })
    expect(editorTab).toHaveAttribute('aria-current', 'page')
  })

  test('renders ContextPanel', () => {
    render(<EditorView />)
    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
  })

  test('renders editor stage area', () => {
    render(<EditorView />)
    expect(screen.getByTestId('editor-stage')).toBeInTheDocument()
  })

  test('renders editor tab bar', () => {
    render(<EditorView />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  test('renders editor status bar', () => {
    render(<EditorView />)
    expect(screen.getByRole('status', { name: /editor status bar/i })).toBeInTheDocument()
  })

  test('renders code editor region', () => {
    render(<EditorView />)
    expect(screen.getByRole('region', { name: /code editor/i })).toBeInTheDocument()
  })

  test('main content adjusts margin when context panel closed', () => {
    render(<EditorView isContextPanelOpen={false} onToggleContextPanel={vi.fn()} />)
    const main = screen.getByTestId('main-content')
    expect(main).toHaveClass('mr-0')
  })

  test('main content has mr-[280px] when context panel open', () => {
    render(<EditorView isContextPanelOpen onToggleContextPanel={vi.fn()} />)
    const main = screen.getByTestId('main-content')
    expect(main).toHaveClass('mr-[280px]')
  })
})
```

- [ ] **Step 4: Run all editor tests**

```bash
npx vitest run src/features/editor/ --reporter=verbose
```

Expected: All PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test -- --run
```

Expected: All tests pass.

- [ ] **Step 6: Run type-check and lint**

```bash
npm run type-check && npm run lint
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: assemble EditorView with IDE split pane layout, file tree, tabs, and code editor"
```

---

## Task 12: Visual verification + cleanup

**Files:**

- All modified files from previous tasks

- [ ] **Step 1: Start dev server and verify visually**

```bash
npm run dev
```

Open the browser and verify:

- Click "Editor" tab — shows IDE split pane layout
- File explorer on the left with real project files
- Code editor on the right with syntax highlighting
- Vim-style status bar at the bottom
- Explorer collapse/expand works
- ContextPanel collapse/expand works (both dock icon and footer button)
- Switch to "Chat" tab — ContextPanel state persists
- Editor tabs show active/inactive states
- Close buttons on tabs work

- [ ] **Step 2: Run full test suite one final time**

```bash
npm run test -- --run && npm run type-check && npm run lint
```

Expected: All pass.

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: visual verification and cleanup for editor view"
```
