# Panel Refinement: CodeMirror Editor + Vim Mode + File Explorer Integration

**Date:** 2026-04-09
**Branch:** `feat/panel-editor-vim`
**Status:** Design approved

## Overview

Replace the read-only Shiki-based editor with CodeMirror 6 + full vim emulation, wire the file explorer to open files in the editor via Tauri IPC, add an unsaved-changes dialog, and increase default panel sizes for better content visibility.

## Tech Stack

- **Editor engine:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/language`)
- **Vim emulation:** `@replit/codemirror-vim` (full vim — NORMAL/INSERT/VISUAL/COMMAND, ex commands, registers, macros)
- **Language support:** `@codemirror/lang-typescript`, `@codemirror/lang-rust`, `@codemirror/lang-json`, `@codemirror/lang-css`, `@codemirror/lang-html`
- **Backend:** Tauri 2 (Rust) — new `read_file` and `write_file` IPC commands
- **Animation:** framer-motion (reuse command palette modal pattern)
- **Target:** Tauri desktop app only (no browser mode)

## Core Features

- **CodeMirror 6 editor** replacing Shiki renderer with full editing capability
- **Full vim emulation** via `@replit/codemirror-vim` — all standard vim motions, text objects, registers, macros, ex commands (`:w`, `:q`, `/search`)
- **File explorer → editor integration** — click a file in the explorer to open it in the editor
- **Single-buffer model** — one file open at a time (vim-native workflow)
- **Unsaved-changes dialog** — glassmorphism modal guards file switches when buffer is dirty
- **Tauri IPC commands** — `read_file` and `write_file` with home-directory scope enforcement
- **Catppuccin Mocha CodeMirror theme** — matches Obsidian Lens design tokens
- **VimStatusBar wired to real state** — mode, cursor position, dirty indicator `[+]`
- **Larger default panel sizes** — better content visibility across all panels
- **Resizable BottomDrawer** — upgrade from fixed `h-1/3` to resizable with drag handle

## New Packages

```json
{
  "codemirror": "^6.x",
  "@codemirror/view": "^6.x",
  "@codemirror/state": "^6.x",
  "@codemirror/language": "^6.x",
  "@codemirror/lang-typescript": "^6.x",
  "@codemirror/lang-rust": "^6.x",
  "@codemirror/lang-json": "^6.x",
  "@codemirror/lang-css": "^6.x",
  "@codemirror/lang-html": "^6.x",
  "@replit/codemirror-vim": "^6.x"
}
```

## Component Changes

| Component                                               | Change                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `features/editor/components/CodeEditor.tsx`             | **Replace** Shiki renderer with CodeMirror 6 + vim extension                         |
| `features/editor/components/VimStatusBar.tsx`           | **Wire** to real CodeMirror vim state (mode, cursor, dirty)                          |
| `features/workspace/components/panels/FileExplorer.tsx` | **Wire** `onFileSelect` to open file in editor via parent                            |
| `features/workspace/components/BottomDrawer.tsx`        | **Upgrade** to resizable (50% default), pass selected file to editor                 |
| `features/workspace/WorkspaceView.tsx`                  | **Update** grid defaults (sidebar 340px, activity 360px), plumb file selection state |
| `features/workspace/components/Sidebar.tsx`             | **Update** default width to 340px, max to 560px, explorer height to 320px            |

### New Files

| File                                                  | Purpose                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `features/editor/hooks/useCodeMirror.ts`              | Hook to create/manage EditorView instance with vim extension |
| `features/editor/hooks/useVimMode.ts`                 | Hook to track vim mode from CM vim extension                 |
| `features/editor/hooks/useEditorBuffer.ts`            | Hook managing file path, dirty state, original content       |
| `features/editor/theme/catppuccin.ts`                 | CodeMirror theme matching Obsidian Lens tokens               |
| `features/editor/services/languageService.ts`         | Detect language from filename, return CM language extension  |
| `features/editor/components/UnsavedChangesDialog.tsx` | Glassmorphism modal for unsaved changes                      |

### Removed/Replaced

| File                                         | Reason                                   |
| -------------------------------------------- | ---------------------------------------- |
| `features/editor/services/shikiService.ts`   | Replaced by CodeMirror                   |
| `features/editor/components/LineNumbers.tsx` | CodeMirror handles line numbers natively |

## New Tauri Commands

Added to `src-tauri/src/filesystem/commands.rs`:

### `read_file`

```rust
#[tauri::command]
pub fn read_file(request: ReadFileRequest) -> Result<String, String>
```

- **Args:** `{ path: string }` — absolute or `~`-relative path
- **Returns:** File content as UTF-8 string
- **Security:** Home-directory scope enforcement (same as `list_dir`)
- **Errors:** Path outside home dir, file not found, not a file, read error

### `write_file`

```rust
#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String>
```

- **Args:** `{ path: string, content: string }`
- **Returns:** Unit on success
- **Security:** Home-directory scope enforcement
- **Behavior:** Creates parent directories if needed, overwrites existing content
- **Errors:** Path outside home dir, permission denied, write error

### Registration in `src-tauri/src/lib.rs`

Add `read_file` and `write_file` to the `use filesystem::` import and the `invoke_handler!` macro alongside existing `list_dir`.

### New Types in `src-tauri/src/filesystem/types.rs`

```rust
#[derive(Debug, Deserialize)]
pub struct ReadFileRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}
```

## Frontend File Service

Extend `IFileSystemService` in `src/features/files/services/fileSystemService.ts` with two new methods:

```typescript
export interface IFileSystemService {
  listDir(path: string): Promise<FileNode[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}
```

`TauriFileSystemService` implements via `invoke('read_file', { request: { path } })` and `invoke('write_file', { request: { path, content } })` — same pattern as existing `listDir`.

`MockFileSystemService` is not extended (Tauri-only target). The mock class can throw or return empty string as a no-op stub.

## Data Flow

### File Open Flow

```
FileExplorer.onFileSelect(filePath)
  → WorkspaceView receives filePath
  → useEditorBuffer checks isDirty
    → if dirty: render UnsavedChangesDialog
      → Save: invoke write_file, then proceed
      → Discard: proceed without saving
      → Cancel: abort, stay on current file
    → if clean: proceed
  → invoke Tauri read_file(filePath)
  → set CodeMirror doc content
  → update filePath, originalContent, isDirty=false
```

### Save Flow

```
User types :w in vim COMMAND mode
  → @replit/codemirror-vim triggers save callback
  → invoke Tauri write_file(filePath, currentContent)
  → update originalContent = currentContent
  → set isDirty = false
  → VimStatusBar removes [+] indicator
```

### Dirty Detection

```
CodeMirror updateListener fires on every edit
  → compare currentDoc vs originalContent
  → update isDirty boolean
  → VimStatusBar shows [+] when dirty
```

### Vim Mode Tracking

```
@replit/codemirror-vim mode change event
  → useVimMode hook captures current mode
  → VimStatusBar displays: NORMAL | INSERT | VISUAL | COMMAND
```

## UnsavedChangesDialog

Reuses the command palette modal pattern from `CommandPalette.tsx`:

- **Backdrop:** `backdrop-blur-sm bg-black/40`, click to cancel
- **Panel:** `bg-[#1e1e2e]/90 glass-panel rounded-2xl border border-[#4a444f]/30 shadow-2xl`
- **Animation:** framer-motion spring (stiffness 400, damping 30), same as command palette
- **Buttons:** Save (primary accent), Discard (error/warning), Cancel (neutral)
- **Keyboard:** `Esc` = Cancel

**Props:**

```typescript
interface UnsavedChangesDialogProps {
  isOpen: boolean
  fileName: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}
```

**Triggers:**

- File explorer click when `isDirty === true`
- `:q` vim command when `isDirty === true`

## Panel Size Changes

| Panel               | Current                  | New                                         | Where                             |
| ------------------- | ------------------------ | ------------------------------------------- | --------------------------------- |
| Sidebar width       | 256px (min 180, max 480) | 340px (min 180, max 560)                    | `Sidebar.tsx` useResizable        |
| FileExplorer height | 240px (min 100, max 500) | 320px (min 100, max 500)                    | `Sidebar.tsx` useResizable        |
| BottomDrawer        | `h-1/3` fixed (33%)      | 50% default, resizable (min 150px, max 80%) | `BottomDrawer.tsx` useResizable   |
| Activity panel      | 320px fixed              | 360px fixed                                 | `WorkspaceView.tsx` grid template |

### BottomDrawer Resize

- Add `useResizable` hook with vertical axis (same pattern as sidebar)
- Drag handle at top edge of BottomDrawer
- Default: 50% of main zone height
- Min: 150px, Max: 80% of parent height

## CodeMirror Theme: Catppuccin Mocha

Maps Obsidian Lens design tokens to CodeMirror theme:

| CodeMirror Element | Token                    | Value                    |
| ------------------ | ------------------------ | ------------------------ |
| Editor background  | `surface`                | `#121221`                |
| Gutter background  | `surface-container-low`  | `#1a1a2a`                |
| Gutter text        | `outline`                | `#968e9a`                |
| Selection          | `surface-container-high` | `#292839` at 60% opacity |
| Cursor             | `primary`                | `#e2c7ff`                |
| Active line        | `surface-container`      | `#1e1e2e`                |
| Matching bracket   | `primary-container`      | `#cba6f7` at 30% opacity |

### Syntax Highlighting

| Token    | Color     | Catppuccin Name |
| -------- | --------- | --------------- |
| Keyword  | `#cba6f7` | Mauve           |
| String   | `#a6e3a1` | Green           |
| Function | `#89b4fa` | Blue            |
| Variable | `#f5e0dc` | Rosewater       |
| Comment  | `#6c7086` | Overlay0        |
| Type     | `#f9e2af` | Yellow          |
| Number   | `#fab387` | Peach           |
| Operator | `#89dceb` | Sky             |

## Testing Strategy

All new files get co-located `.test.ts`/`.test.tsx` siblings.

### Unit Tests

- `useEditorBuffer` — dirty detection, file switch logic, save/discard flows
- `useVimMode` — mode change tracking
- `useCodeMirror` — editor creation, extension configuration
- `languageService` — filename → language extension mapping
- `UnsavedChangesDialog` — render states, button callbacks, keyboard handling
- `catppuccin theme` — theme object structure validation

### Integration Tests

- File explorer click → editor content update
- Dirty buffer → dialog → save → file switch
- Dirty buffer → dialog → discard → file switch
- Dirty buffer → dialog → cancel → stay on file
- `:w` command → write_file invocation

### Rust Tests

- `read_file` — reads file content, home-dir scoping, error cases
- `write_file` — writes content, creates parent dirs, home-dir scoping, error cases
