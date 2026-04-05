# Editor View — UI Design Spec

## Overview

Refactor the standalone Files Explorer into a combined IDE-style Editor view. The file explorer becomes a collapsible left pane, paired with a tabbed code editor showing real project files with syntax highlighting. The "Files" and "Editor" TopTabBar tabs merge into a single "Editor" tab. The right ContextPanel becomes collapsible with a redesigned layout.

## Tech Stack

- **Framework**: Vite + React 19 + TypeScript (strict, arrow-function components only)
- **Styling**: Tailwind CSS v4 with Catppuccin Mocha tokens from `tailwind.config.js`
- **Fonts**: Manrope (headlines), Inter (body/labels), JetBrains Mono (code/paths)
- **Icons**: Material Symbols Outlined (via Google Fonts CDN)
- **Syntax Highlighting**: Shiki with `catppuccin-mocha` theme
- **Testing**: Vitest + Testing Library (a11y queries: `getByRole`, `getByLabelText`)
- **File Service**: Vite dev middleware (same pattern as diff view's `gitService.ts`)

## Source of Truth

- Visual: `docs/design/files_and_editor/screen.png`
- Implementation reference: `docs/design/files_and_editor/code.html`
- Design system: `docs/design/DESIGN.md`
- Previous spec (superseded): `docs/superpowers/specs/2026-04-04-files-explorer-ui-design.md`

## Migration Plan

### Renamed / Moved

| Old Path              | New Path               |
| --------------------- | ---------------------- |
| `src/features/files/` | `src/features/editor/` |
| `FilesView.tsx`       | `EditorView.tsx`       |
| `mockFileTree.ts`     | `mockEditorData.ts`    |

### Reused (moved, not rewritten)

- `FileTree.tsx` — container, manages context menu state
- `FileTreeNode.tsx` — recursive folder/file node
- `ContextMenu.tsx` — glassmorphism right-click overlay
- `types/index.ts` — `FileNode`, `GitStatus`, `ContextMenuAction`, type guards

### Removed

- `Breadcrumbs.tsx` + test — replaced by explorer pane header
- `DropZone.tsx` + test — not in new design
- `FileStatusBar.tsx` + test — replaced by `EditorStatusBar`

### New Components

- `ExplorerPane.tsx` — left pane wrapper (header + file tree)
- `EditorTabs.tsx` — tab bar for open files
- `CodeEditor.tsx` — code content area with line numbers + syntax highlighting
- `EditorStatusBar.tsx` — vim-style bottom status bar

### New Services/Hooks

- `services/fileService.ts` — file reading via dev middleware
- `hooks/useFileContent.ts` — fetch + cache file content
- `hooks/useFileTree.ts` — fetch directory tree

## File Structure

```
src/features/editor/
├── EditorView.tsx
├── EditorView.test.tsx
├── components/
│   ├── ExplorerPane.tsx
│   ├── ExplorerPane.test.tsx
│   ├── FileTree.tsx                # Reused from files/
│   ├── FileTree.test.tsx
│   ├── FileTreeNode.tsx            # Reused from files/
│   ├── FileTreeNode.test.tsx
│   ├── ContextMenu.tsx             # Reused from files/
│   ├── ContextMenu.test.tsx
│   ├── EditorTabs.tsx
│   ├── EditorTabs.test.tsx
│   ├── CodeEditor.tsx
│   ├── CodeEditor.test.tsx
│   ├── EditorStatusBar.tsx
│   └── EditorStatusBar.test.tsx
├── hooks/
│   ├── useFileContent.ts
│   ├── useFileContent.test.ts
│   ├── useFileTree.ts
│   └── useFileTree.test.ts
├── services/
│   ├── fileService.ts
│   └── fileService.test.ts
├── data/
│   ├── mockEditorData.ts
│   └── mockEditorData.test.ts
└── types/
    ├── index.ts
    └── index.test.ts
```

## Data Model

### Reused Types (from files/)

```typescript
type GitStatus = 'M' | 'A' | 'D' | 'U'

interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  gitStatus?: GitStatus
  icon?: string
  defaultExpanded?: boolean
}

interface ContextMenuAction {
  label: string
  icon: string
  variant?: 'danger'
  separator?: boolean
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  targetNode: FileNode | null
}
```

Note: `isDragTarget` and `isDragging` fields are removed from `FileNode` — drag-and-drop is not part of the new design.

### New Types

```typescript
type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND'

interface EditorTab {
  id: string
  fileName: string
  filePath: string
  icon: string
  isActive: boolean
  isDirty: boolean
}

interface CursorPosition {
  line: number
  column: number
}

interface EditorStatusBarState {
  vimMode: VimMode
  gitBranch: string
  syncStatus: { behind: number; ahead: number }
  fileName: string
  encoding: string
  language: string
  cursor: CursorPosition
}
```

Type guards: `isEditorTab`, `isVimMode`, `isCursorPosition` following the pattern in the existing `types/index.ts`.

### File Icon Mapping

Same as the existing files feature:

| Extension                                 | Icon          | Style                      |
| ----------------------------------------- | ------------- | -------------------------- |
| `.tsx`, `.ts`, `.jsx`, `.js`              | `description` | outlined, `text-[#8fbaff]` |
| `.json`                                   | `data_object` | outlined                   |
| `.rs`                                     | `code_blocks` | outlined                   |
| `.md`                                     | `description` | outlined                   |
| `.css`, `.scss`                           | `palette`     | outlined                   |
| config files (`tailwind.config.js`, etc.) | `settings`    | outlined, `text-[#cba6f7]` |
| `package.json`                            | `info`        | outlined, `text-error`     |
| fallback                                  | `draft`       | outlined                   |

Note: The screenshot uses `description` (document icon) in blue (`text-[#8fbaff]`) for `.tsx`/`.ts` files, but DO FOLLOW the `code` icon from the previous spec.

## Component Specifications

### EditorView (Page Assembly)

Same layout shell as ChatView:

- Reuses `IconRail`, `Sidebar`, `TopTabBar`, `ContextPanel` from `src/components/layout/`
- TopTabBar: `activeTab="Editor"`
- Main content: `ml-[308px] flex-1 flex flex-col` (no `mr` — handled dynamically based on ContextPanel collapsed state)
- Right margin transitions: `mr-[280px]` when panel open, `mr-0` when collapsed, `transition-all duration-300`
- Children: horizontal flex with `ExplorerPane` (left) + code area (right, `flex-1 flex flex-col`)
- `EditorStatusBar` fixed at bottom

```tsx
<div className="h-screen overflow-hidden flex bg-background text-on-surface font-body">
  <IconRail />
  <Sidebar conversations={mockConversations} />
  <main
    className={`ml-[308px] ${isContextPanelOpen ? 'mr-[280px]' : 'mr-0'} flex-1 flex flex-col mt-14 mb-6 transition-all duration-300`}
  >
    <div className="flex-1 flex overflow-hidden">
      <ExplorerPane />
      <section className="flex-1 flex flex-col bg-surface overflow-hidden">
        <EditorTabs />
        <CodeEditor />
      </section>
    </div>
  </main>
  <ContextPanel isOpen={isContextPanelOpen} onToggle={handleTogglePanel} />
  <EditorStatusBar />
</div>
```

### ExplorerPane

Container: `w-64 bg-surface-container-low/50 backdrop-blur-lg flex flex-col border-r border-outline-variant/10`

**Header**:

- `p-4 flex items-center justify-between`
- Label: `text-xs font-bold uppercase tracking-widest text-on-surface-variant/70` — "EXPLORER"
- Collapse button: `keyboard_double_arrow_left` icon, `text-xs text-on-surface-variant cursor-pointer hover:text-on-surface`
- Clicking collapse hides the pane (width transitions to 0)

**File tree content**:

- `flex-1 overflow-y-auto px-2 font-label text-[13px]`
- Renders `FileTree` component with project files
- Selected file: `bg-primary/10 text-on-surface` (per screenshot: `App.tsx` is selected)
- Unselected files: `text-on-surface-variant hover:bg-surface-variant/30`
- Folders: `text-primary` when expanded with `keyboard_arrow_down`, `text-on-surface-variant` when collapsed with `keyboard_arrow_right`
- Folder icons: `folder_open` (filled) when expanded, `folder` when collapsed

**Collapsible behavior**:

- `isExplorerOpen` state in `EditorView`
- When collapsed: `w-0 overflow-hidden` with `transition-all duration-300`
- Code area fills the space

### EditorTabs

Container: `h-10 bg-surface-container-low flex items-center`

**Active tab**:

- `h-full px-4 flex items-center gap-2 bg-surface text-on-surface border-t-2 border-primary cursor-pointer`
- File icon (colored per mapping) + filename (`text-xs font-medium`) + close button

**Inactive tab**:

- `h-full px-4 flex items-center gap-2 text-on-surface-variant/60 hover:bg-surface-variant/20 cursor-pointer transition-colors`
- Same structure, muted colors

**Close button**: `material-symbols-outlined text-[10px] ml-2 hover:bg-surface-variant rounded-full p-0.5` — `close` icon

**Empty fill**: `flex-1 bg-surface-container-low h-full` after last tab

### CodeEditor

Container: `flex-1 p-6 font-label text-[14px] leading-relaxed overflow-y-auto no-scrollbar`

**Layout**: horizontal flex with gutter + content

**Line number gutter**:

- `w-12 text-on-surface-variant/30 select-none text-right pr-4 border-r border-outline-variant/10`
- Current line number: `text-primary/60`

**Code content**:

- `flex-1 pl-6`
- Rendered by Shiki with `catppuccin-mocha` theme
- Current line block highlighted: `bg-primary/5 rounded border-l-2 border-primary`
- Content fetched via `useFileContent` hook

**Shiki integration**:

- Use `shiki/wasm` for browser-compatible tokenization
- Load `catppuccin-mocha` theme and language grammars on demand
- Render tokens as styled spans (no `<pre>` wrapper — custom layout)
- Language detection from file extension

### EditorStatusBar

Container: `fixed bottom-0 left-[308px] right-[280px] h-6 bg-[#1a1a2a] border-t border-[#4a444f]/15 flex items-center justify-between z-30 font-label text-[10px] uppercase tracking-wider text-[#cdc3d1]`

Note: `right` value adjusts dynamically based on ContextPanel collapsed state (same as main content margin).

**Left section** (`flex items-center gap-0`):

1. Vim mode: `bg-primary text-background px-3 h-6 flex items-center font-bold` — e.g., "-- NORMAL --"
2. Git branch: `flex items-center gap-2 px-3 border-r border-[#4a444f]/15 h-6` — `account_tree` icon + "main\*"
3. Sync status: `flex items-center gap-2 px-3 h-6` — `sync` icon + "0 ↓ 1 ↑"

**Right section** (`flex items-center gap-0`):

1. Filename: `px-3 border-l border-[#4a444f]/15 h-6 flex items-center` — "App.tsx"
2. Encoding: same style — "UTF-8"
3. Language: `text-primary` — "TypeScript"
4. Cursor position: — "Ln 42, Col 12"

Each segment: `hover:bg-[#333344] transition-colors cursor-pointer`

## ContextPanel Updates (Shared Component)

### Collapsible Behavior

Add props to `ContextPanel`:

```typescript
interface ContextPanelProps {
  isOpen: boolean
  onToggle: () => void
}
```

- `isOpen` state lifted to `App.tsx` (persists across tab switches)
- When open: current layout (`w-[280px] fixed right-0`)
- When collapsed: `translate-x-full` (slides off-screen right)
- Transition: `transition-all duration-300`
- Main content and EditorStatusBar `right` values adjust accordingly

### Redesigned Layout (per screenshot)

**Header**:

- `p-4 flex items-center justify-between border-b border-[#4a444f]/10 mb-4`
- Left: `psychology` icon + "AGENT STATUS" label (`text-secondary font-bold text-xs uppercase tracking-wider`)
- Right: `dock_to_right` button → calls `onToggle`

**Content** (`px-4 flex flex-col gap-6 flex-1 overflow-y-auto no-scrollbar`):

1. **Token usage section**:
   - Model label: `text-on-surface-variant text-[0.75rem] font-label` — "GPT-4o Active"
   - Progress bar: `h-1 bg-surface-variant rounded-full` with `bg-gradient-to-r from-secondary to-secondary-container` fill
   - Label row: `text-[10px] font-label uppercase text-on-surface-variant/60` — "Token Usage" + "74%"

2. **Navigation items**:
   - Active item (e.g., "Model Info"): `text-secondary font-bold font-label text-[0.75rem]` with `info` icon, `hover:bg-surface-variant/20 p-2 rounded`
   - Inactive items ("Context", "Activity"): `text-[#cdc3d1] hover:text-white font-label text-[0.75rem]` with `memory`/`history` icons

3. **Live Insights card**:
   - Container: `rounded-xl bg-surface-container p-4 border border-outline-variant/10 shadow-lg`
   - Header: `lightbulb` icon (`text-primary`) + "Live Insights" (`text-xs font-bold text-on-surface`)
   - Body: `text-[11px] text-on-surface-variant leading-relaxed` with highlighted file name in `text-secondary`
   - Button: `w-full py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-bold uppercase rounded-lg border border-primary/20` — "APPLY FIX"

**Footer**:

- `p-4 mt-auto border-t border-[#4a444f]/10`
- "Collapse Panel" button: `w-full flex items-center justify-center gap-2 py-2 text-xs text-on-surface-variant hover:text-on-surface`
- `close_fullscreen` icon → calls `onToggle`

## File Service (Dev Middleware)

### API Endpoints

| Endpoint             | Method | Params                         | Returns                                 |
| -------------------- | ------ | ------------------------------ | --------------------------------------- |
| `/api/files/tree`    | GET    | `root` (optional, default `.`) | `FileNode[]`                            |
| `/api/files/content` | GET    | `path` (required)              | `{ content: string, language: string }` |

### Vite Plugin

Create `vite-plugin-files.ts` in project root (same pattern as the diff view's git middleware):

```typescript
import type { Plugin } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'

export const filesPlugin = (): Plugin => ({
  name: 'vimeflow-files',
  configureServer(server) {
    server.middlewares.use('/api/files/tree', async (req, res) => {
      // Read directory recursively, return FileNode[]
    })
    server.middlewares.use('/api/files/content', async (req, res) => {
      // Read file content, detect language from extension
    })
  },
})
```

### Service Interface

```typescript
interface FileService {
  getTree(root?: string): Promise<FileNode[]>
  getFileContent(
    filePath: string
  ): Promise<{ content: string; language: string }>
}
```

- `HttpFileService` — calls dev middleware endpoints
- `MockFileService` — returns hardcoded fallback data for tests and offline development

### Security

- Path traversal prevention: resolve paths relative to project root, reject `..` segments
- Ignore `.git/`, `node_modules/`, and other common excludes
- Max file size limit for content reads (e.g., 1MB)

## Global Component Changes

These changes affect **all views** (Chat, Editor, and future Diff), not just the Editor view.

### TopTabBar

Update `TabName` type:

```typescript
// Before
type TabName = 'Chat' | 'Files' | 'Editor' | 'Diff'

// After
type TabName = 'Chat' | 'Editor' | 'Diff'
```

### App.tsx (State Lifting)

- Lift `isContextPanelOpen` state to `App.tsx` with `useState<boolean>(true)` (open by default)
- Pass `isContextPanelOpen` and `onToggleContextPanel` to **all views** and to `ContextPanel`
- Remove `FilesView` import and `activeTab === 'Files'` branch
- Add `activeTab === 'Editor'` → `EditorView`

```tsx
const [isContextPanelOpen, setIsContextPanelOpen] = useState(true)
const handleToggleContextPanel = (): void => { setIsContextPanelOpen(prev => !prev) }

// Pass to every view:
<ChatView onTabChange={handleTabChange} isContextPanelOpen={isContextPanelOpen} onToggleContextPanel={handleToggleContextPanel} />
<EditorView onTabChange={handleTabChange} isContextPanelOpen={isContextPanelOpen} onToggleContextPanel={handleToggleContextPanel} />
```

### ChatView Updates

ChatView currently hardcodes `mr-[280px]` and renders `<ContextPanel />` with no props. Update:

- Add `isContextPanelOpen` and `onToggleContextPanel` props to `ChatViewProps`
- Dynamic right margin: `${isContextPanelOpen ? 'mr-[280px]' : 'mr-0'} transition-all duration-300`
- Pass props to `<ContextPanel isOpen={isContextPanelOpen} onToggle={onToggleContextPanel} />`

### ContextPanel (Shared Layout Component)

The ContextPanel redesign (collapsible behavior + new layout) is a **shared component change**. Once updated, all views automatically get:

- Slide-in/out animation (`translate-x-full` when collapsed)
- Dock icon toggle in header
- "Collapse Panel" footer button
- Redesigned content (token usage, nav items, Live Insights card)

## Interactivity Summary

| Interaction                     | Behavior                                                        |
| ------------------------------- | --------------------------------------------------------------- |
| Click file in explorer          | Opens file in editor (creates tab if not open), fetches content |
| Click folder in explorer        | Toggle expand/collapse, rotate chevron                          |
| Click editor tab                | Switch active tab, display file content                         |
| Click tab close (×)             | Remove tab, switch to adjacent tab                              |
| Right-click in explorer         | Show ContextMenu at cursor position                             |
| Click outside context menu      | Close context menu                                              |
| Press Escape                    | Close context menu                                              |
| Click explorer collapse chevron | Toggle explorer pane visibility                                 |
| Click ContextPanel dock icon    | Toggle right panel visibility                                   |
| Click "Collapse Panel" button   | Toggle right panel visibility                                   |
| Click context menu item         | No action (dead page)                                           |

## Design Rules (from DESIGN.md)

- **No-Line Rule**: No `1px solid` borders for sectioning — use background color shifts
- **Glass & Gradient Rule**: Glassmorphism on floating elements (context menu)
- **Ghost Border Fallback**: `outline-variant` at 15% opacity or less
- **Hierarchy Rule**: `on-surface-variant` for body text, `on-surface` for titles/active states
- **No divider lines in lists** — use spacing
- **No pure black/white**, no sharp corners
- **Ambient shadows**: `0px 10px 40px rgba(0, 0, 0, 0.4)` for floating elements

## Testing Strategy

- Co-located test files for every component
- Use a11y queries: `getByRole`, `getByLabelText`, `getByText` as fallback
- `test()` not `it()`, no `console.log`
- Test coverage target: 80%+

### Key Test Cases

- Explorer pane expand/collapse toggle
- File tree folder expand/collapse
- Context menu open/close (right-click + click outside + Escape)
- Editor tab switching (click tab → active state changes)
- Editor tab close (removes tab, switches to adjacent)
- File selection in explorer → tab creation
- CodeEditor renders syntax-highlighted content
- EditorStatusBar displays all segments
- ContextPanel collapse/expand toggle
- Mock data renders correctly
- Type guards for new types

## Out of Scope

- Real vim keybindings or mode switching
- File editing / save operations
- Drag-and-drop reordering
- File creation / deletion / rename operations
- Minimap
- Search within file
- Multiple editor panes (split view)
- Tauri/Rust backend (dev middleware only)
- React Router
