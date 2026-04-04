# Files Explorer — UI Design Spec

## Overview

Implement the Files Explorer screen as a "dead page" with light interactivity — pixel-accurate to `docs/design/files_explorer/screen.png`. Folders expand/collapse on click, context menu opens on right-click, but all data is hardcoded mock data. Drag-and-drop is visual only (hardcoded states on specific items). No backend; no routing.

## Tech Stack

- **Framework**: Vite + React 19 + TypeScript (strict, arrow-function components only)
- **Styling**: Tailwind CSS v4 with Catppuccin Mocha tokens from `tailwind.config.js`
- **Fonts**: Manrope (headlines), Inter (body/labels), JetBrains Mono (code/paths)
- **Icons**: Material Symbols Outlined (via Google Fonts CDN)
- **Testing**: Vitest + Testing Library (a11y queries: `getByRole`, `getByLabelText`)
- **No**: Tauri, React Router, real data fetching, Storybook

## Source of Truth

- Visual: `docs/design/files_explorer/screen.png`
- Implementation reference: `docs/design/files_explorer/code.html`
- Design system: `docs/design/DESIGN.md`

## File Structure

```
src/features/files/
├── FilesView.tsx                # Page assembly (like ChatView)
├── FilesView.test.tsx
├── components/
│   ├── Breadcrumbs.tsx          # Path navigation bar
│   ├── Breadcrumbs.test.tsx
│   ├── FileTree.tsx             # Container, renders root nodes + manages context menu
│   ├── FileTree.test.tsx
│   ├── FileTreeNode.tsx         # Recursive folder/file node
│   ├── FileTreeNode.test.tsx
│   ├── ContextMenu.tsx          # Glassmorphism right-click overlay
│   ├── ContextMenu.test.tsx
│   ├── DropZone.tsx             # Dashed upload area
│   ├── DropZone.test.tsx
│   ├── FileStatusBar.tsx        # Bottom bar (file count, git branch, etc.)
│   └── FileStatusBar.test.tsx
├── data/
│   ├── mockFileTree.ts          # Mock file/folder tree data
│   └── mockFileTree.test.ts
└── types/
    ├── index.ts                 # FileNode, GitStatus, ContextMenuAction
    └── index.test.ts
```

## Data Model

```typescript
type GitStatus = 'M' | 'A' | 'D' | 'U'

interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  gitStatus?: GitStatus
  icon?: string // Material Symbol name override (see icon mapping below)
  defaultExpanded?: boolean // Initial expand state for folders (default: false)
  isDragTarget?: boolean // Visual-only drag state (hardcoded)
  isDragging?: boolean // Visual-only drag state (hardcoded)
}

interface ContextMenuAction {
  label: string
  icon: string
  variant?: 'danger'
  separator?: boolean // Render a divider before this item
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  targetNode: FileNode | null
}
```

Type guards: `isFileNode` and `isContextMenuAction` following the pattern in `features/chat/types/index.ts`.

### File Icon Mapping

Files use Material Symbols based on extension (folders always use `folder`/`folder_open`):

| Extension                    | Icon          | Style    |
| ---------------------------- | ------------- | -------- |
| `.tsx`, `.ts`, `.jsx`, `.js` | `code`        | outlined |
| `.json`                      | `data_object` | outlined |
| `.rs`                        | `code_blocks` | outlined |
| `.md`                        | `description` | outlined |
| `.css`, `.scss`              | `palette`     | outlined |
| fallback                     | `draft`       | outlined |

The `icon` field on `FileNode` allows overriding this default mapping.

## Mock Data

Hardcoded tree matching the screenshot:

```
src/                          (folder, defaultExpanded: true)
├── components/               (folder, defaultExpanded: true, isDragTarget: true, "DROP HERE" badge)
│   ├── FileTree.tsx          (file)
│   ├── NavBar.tsx            (file, gitStatus: 'M')
│   └── TerminalPanel.tsx     (file, isDragging: true, gitStatus: 'M')
├── utils/                    (folder, defaultExpanded: true)
│   └── api-helper.rs         (file, gitStatus: 'A')
└── tests/                    (folder, collapsed)
package.json                  (file)
tsconfig.json                 (file, gitStatus: 'D')
README.md                     (file)
```

## Component Specifications

### FilesView (Page Assembly)

Identical layout shell to `ChatView.tsx`:

- Reuses `IconRail`, `Sidebar`, `TopTabBar`, `ContextPanel` from `src/components/layout/`
- Main content area: `ml-[308px] mr-[280px] flex-1 flex flex-col`
- Children: `Breadcrumbs` → `FileTree` (with `ContextMenu`) → `DropZone` → `FileStatusBar`

### TopTabBar Modification

The "Files" tab must be active when `FilesView` is rendered:

- Active: `text-[#e2c7ff] border-b-2 border-[#cba6f7] font-headline font-semibold`
- "Chat" becomes inactive: `text-on-surface-variant hover:text-on-surface hover:bg-[#1e1e2e]`

**Approach**: Add an `activeTab` prop to `TopTabBar` (default: `'Chat'` for backwards compatibility). `FilesView` passes `activeTab="Files"`.

### Breadcrumbs

- Container: `h-10 bg-surface-container-low/50 flex items-center px-6 gap-2`
- Path segments: `text-on-surface-variant text-sm font-label` separated by `/`
- Current (last) segment: `text-on-surface font-semibold`
- Props: `segments: string[]` (e.g., `['vibm-project', 'src', 'components']`)

### FileTree (Container)

- Container: `bg-surface-container-low rounded-xl p-4 max-w-4xl mx-auto`
- Renders root-level `FileTreeNode` components from mock data
- Manages `ContextMenuState` — right-click on any node sets position + target
- Renders `ContextMenu` overlay when `contextMenu.visible === true`
- Closes context menu on click outside or Escape key

### FileTreeNode (Recursive)

- **Folder row**: `flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-surface-bright cursor-pointer transition-all duration-300`
  - Chevron: `material-symbols-outlined text-on-surface-variant text-sm` — rotated 90deg when expanded
  - Folder icon: `folder_open` (filled, `text-[#a8c8ff]`) when expanded, `folder` when collapsed
  - Name: `text-on-surface text-sm font-body`
  - Git badge (if present): `text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider`
    - `M` → `text-yellow-500/80 bg-yellow-500/10`
    - `A` → `text-green-500/80 bg-green-500/10`
    - `D` → `text-red-500/80 bg-red-500/10`
- **File row**: Same layout but no chevron, file-type icon instead of folder icon
- **Children**: Wrapped in `pl-6 border-l border-[#4a444f]/20 ml-5` for visual connector lines
- **State**: `isExpanded` via `useState`, toggled on click (folders only)
- **Drag states** (hardcoded via props):
  - `isDragging`: `opacity-60 scale-95 shadow-lg border-dashed border-outline-variant translate-x-4`
  - `isDragTarget`: `bg-secondary-container/20 ring-1 ring-secondary/40` + "DROP HERE" badge (`text-[9px] bg-secondary/20 text-secondary px-2 py-0.5 rounded-full font-bold uppercase`)
- **Right-click**: Calls `onContextMenu` prop with node + mouse position

### ContextMenu (Glassmorphism Overlay)

- Container: `fixed bg-surface-container-highest/80 backdrop-blur-[16px] border border-outline-variant/30 rounded-xl py-2 w-48 shadow-2xl z-50`
- Positioned at `(x, y)` from `ContextMenuState`
- Items:
  1. Rename (`edit` icon)
  2. Delete (`delete` icon, `variant: 'danger'` → `hover:bg-error/20 text-error`)
  3. Separator
  4. Copy Path (`content_copy` icon)
  5. Open in Editor (`open_in_new` icon)
  6. View Diff (`difference` icon)
- Each item: `flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-bright/50 cursor-pointer transition-colors`
- Close on click outside (via `useEffect` with document click listener)

### DropZone

- Container: `border-2 border-dashed border-outline-variant/30 rounded-xl p-8 flex flex-col items-center justify-center gap-2 max-w-4xl mx-auto mt-4`
- Upload icon: `material-symbols-outlined text-on-surface-variant text-3xl`
- Text: `text-on-surface-variant text-sm` — "Drop files here to upload to src/components/"

### FileStatusBar

- Container: `h-8 bg-surface-container-lowest flex items-center px-4 gap-6 text-[11px] font-label text-on-surface-variant fixed bottom-0 left-[308px] right-[280px]`
- Items: "142 files" | "12.4 MB" | "UTF-8" | "main\*" (git branch) | "Live Sync" (with `w-2 h-2 bg-secondary rounded-full animate-pulse` dot)

## Interactivity Summary

| Interaction                | Behavior                                     |
| -------------------------- | -------------------------------------------- |
| Click folder               | Toggle expand/collapse, rotate chevron       |
| Right-click any node       | Show ContextMenu at cursor position          |
| Click outside context menu | Close context menu                           |
| Press Escape               | Close context menu                           |
| Drag-and-drop              | Visual only — hardcoded states on mock items |
| Click context menu item    | No action (dead page)                        |
| Click breadcrumb segment   | No action (dead page)                        |

## Design Rules (from DESIGN.md)

- **No-Line Rule**: No `1px solid` borders for sectioning — use background color shifts
- **Glass & Gradient Rule**: Glassmorphism on floating elements (context menu)
- **Ghost Border Fallback**: `outline-variant` at 15% opacity
- **Hierarchy Rule**: `on-surface-variant` for body text, `on-surface` for titles/active states
- **No divider lines in lists** — use spacing
- **No pure black/white**, no sharp corners
- **Ambient shadows**: `0px 10px 40px rgba(0, 0, 0, 0.4)` for floating elements

## Testing Strategy

- Co-located test files for every component
- Use a11y queries: `getByRole`, `getByLabelText`, `getByText` as fallback
- Test folder expand/collapse toggle
- Test context menu open/close
- Test that all mock data renders correctly
- Test type guards for `FileNode` and `ContextMenuAction`
- `test()` not `it()`, no `console.log`

## Out of Scope

- Tauri/Rust backend
- React Router or tab navigation between Chat/Files views
- Real file system operations
- Actual drag-and-drop reordering
- Other screens (Editor, Diff, Command Palette)
- Storybook
