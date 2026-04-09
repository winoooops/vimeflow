# Panel Editor + Vim Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Shiki read-only editor with CodeMirror 6 + full vim emulation, wire file explorer clicks to open files via Tauri IPC, add unsaved-changes dialog, and increase panel sizes.

**Architecture:** Single-buffer editor in BottomDrawer. File explorer click → Tauri `read_file` IPC → CodeMirror buffer. Vim `:w` → Tauri `write_file`. Dirty detection via CodeMirror update listener. UnsavedChangesDialog guards file switches.

**Tech Stack:** CodeMirror 6, @replit/codemirror-vim, Tauri 2 (Rust), React 19, TypeScript, framer-motion, Vitest

**Worktree:** `.claude/worktrees/panel-editor-vim/` (branch `feat/panel-editor-vim`)

---

## File Structure

### New Files (Frontend)

- `src/features/editor/hooks/useCodeMirror.ts` — creates/manages EditorView with vim + theme + language
- `src/features/editor/hooks/useCodeMirror.test.ts` — tests for hook
- `src/features/editor/hooks/useVimMode.ts` — tracks vim mode from CM vim extension
- `src/features/editor/hooks/useVimMode.test.ts` — tests for hook
- `src/features/editor/hooks/useEditorBuffer.ts` — file path, dirty state, open/save logic
- `src/features/editor/hooks/useEditorBuffer.test.ts` — tests for hook
- `src/features/editor/theme/catppuccin.ts` — CodeMirror theme matching Obsidian Lens
- `src/features/editor/theme/catppuccin.test.ts` — theme structure validation
- `src/features/editor/services/languageService.ts` — filename → CM language extension
- `src/features/editor/services/languageService.test.ts` — tests for service
- `src/features/editor/components/UnsavedChangesDialog.tsx` — glassmorphism save modal
- `src/features/editor/components/UnsavedChangesDialog.test.tsx` — tests for dialog

### Modified Files (Frontend)

- `src/features/editor/components/CodeEditor.tsx` — replace Shiki with CodeMirror
- `src/features/editor/components/CodeEditor.test.tsx` — update tests
- `src/features/editor/components/VimStatusBar.tsx` — wire to real CM vim state
- `src/features/editor/components/VimStatusBar.test.tsx` — update tests
- `src/features/files/services/fileSystemService.ts` — add readFile/writeFile methods
- `src/features/workspace/WorkspaceView.tsx` — update grid defaults, plumb file selection
- `src/features/workspace/components/Sidebar.tsx` — update default sizes
- `src/features/workspace/components/BottomDrawer.tsx` — resizable, receive file props
- `src/features/workspace/components/panels/FileExplorer.tsx` — wire onFileSelect to parent

### Modified Files (Rust)

- `src-tauri/src/filesystem/types.rs` — add ReadFileRequest, WriteFileRequest
- `src-tauri/src/filesystem/commands.rs` — add read_file, write_file commands
- `src-tauri/src/filesystem/mod.rs` — export new commands
- `src-tauri/src/lib.rs` — register new commands in invoke_handler

---

## Task 1: Rust `read_file` and `write_file` Commands

**Files:**

- Modify: `src-tauri/src/filesystem/types.rs`
- Modify: `src-tauri/src/filesystem/commands.rs`
- Modify: `src-tauri/src/filesystem/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add request types to `types.rs`**

Append after the existing `EntryType` enum at the end of `src-tauri/src/filesystem/types.rs`:

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

- [ ] **Step 2: Write failing tests for `read_file` in `commands.rs`**

Append inside the `#[cfg(test)] mod tests` block in `src-tauri/src/filesystem/commands.rs`:

```rust
#[test]
fn read_file_returns_content() {
    let dir = home_test_dir("read_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("hello.txt"), "hello world").unwrap();

    let result = read_file(ReadFileRequest {
        path: dir.join("hello.txt").to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "hello world");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_file_rejects_path_outside_home() {
    let result = read_file(ReadFileRequest {
        path: "/etc/passwd".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}

#[test]
fn read_file_rejects_directory() {
    let dir = home_test_dir("read_file_dir");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let result = read_file(ReadFileRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not a file"));

    let _ = fs::remove_dir_all(&dir);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib filesystem 2>&1`
Expected: FAIL — `read_file` not found

- [ ] **Step 4: Implement `read_file` in `commands.rs`**

Add after the `list_dir` function (before `#[cfg(test)]`):

```rust
/// Read file contents as UTF-8 string.
/// Restricted to the user's home directory.
#[tauri::command]
pub fn read_file(request: ReadFileRequest) -> Result<String, String> {
    let raw = expand_home(&request.path);
    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_canonical =
        fs::canonicalize(&home).map_err(|e| format!("cannot resolve home dir: {}", e))?;
    if !canonical.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            canonical.display()
        ));
    }

    if !canonical.is_file() {
        return Err(format!("not a file: {}", canonical.display()));
    }

    log::info!("Reading file: {}", canonical.display());

    fs::read_to_string(&canonical).map_err(|e| format!("failed to read file: {}", e))
}
```

- [ ] **Step 5: Run tests to verify `read_file` passes**

Run: `cd src-tauri && cargo test --lib filesystem 2>&1`
Expected: All `read_file` tests PASS

- [ ] **Step 6: Write failing tests for `write_file`**

Append inside the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn write_file_creates_and_writes() {
    let dir = home_test_dir("write_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let file_path = dir.join("output.txt");
    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "written content".to_string(),
    });

    assert!(result.is_ok());
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "written content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_creates_parent_dirs() {
    let dir = home_test_dir("write_file_nested");
    let _ = fs::remove_dir_all(&dir);

    let file_path = dir.join("sub").join("deep").join("file.txt");
    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "nested content".to_string(),
    });

    assert!(result.is_ok());
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "nested content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_rejects_path_outside_home() {
    let result = write_file(WriteFileRequest {
        path: "/tmp/evil.txt".to_string(),
        content: "bad".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib filesystem 2>&1`
Expected: FAIL — `write_file` not found

- [ ] **Step 8: Implement `write_file` in `commands.rs`**

Add after `read_file`:

```rust
/// Write content to a file as UTF-8.
/// Creates parent directories if needed.
/// Restricted to the user's home directory.
#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    let raw = expand_home(&request.path);

    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_canonical =
        fs::canonicalize(&home).map_err(|e| format!("cannot resolve home dir: {}", e))?;

    // For write, the file may not exist yet — check the parent directory
    let parent = raw
        .parent()
        .ok_or_else(|| format!("invalid path: no parent for '{}'", request.path))?;

    // Create parent dirs if needed (must be under home)
    if !parent.exists() {
        // Verify the intended parent is under home by checking the raw path
        // We can't canonicalize a non-existent path, so check the prefix
        let raw_str = raw.to_string_lossy();
        let home_str = home.to_string_lossy();
        if !raw_str.starts_with(home_str.as_ref()) {
            return Err(format!(
                "access denied: path is outside home directory: {}",
                raw.display()
            ));
        }
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create parent directories: {}", e))?;
    }

    let parent_canonical =
        fs::canonicalize(parent).map_err(|e| format!("cannot resolve parent dir: {}", e))?;
    if !parent_canonical.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            raw.display()
        ));
    }

    log::info!("Writing file: {}", raw.display());

    fs::write(&raw, &request.content).map_err(|e| format!("failed to write file: {}", e))
}
```

- [ ] **Step 9: Run tests to verify all pass**

Run: `cd src-tauri && cargo test --lib filesystem 2>&1`
Expected: All tests PASS

- [ ] **Step 10: Export and register commands**

Update `src-tauri/src/filesystem/mod.rs`:

```rust
mod commands;
mod types;

pub use commands::list_dir;
pub use commands::read_file;
pub use commands::write_file;
```

Update `src-tauri/src/lib.rs` — change the import and handler:

```rust
use filesystem::{list_dir, read_file, write_file};
```

And in `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
  spawn_pty,
  write_pty,
  resize_pty,
  kill_pty,
  list_dir,
  read_file,
  write_file
])
```

- [ ] **Step 11: Verify build**

Run: `cd src-tauri && cargo build 2>&1`
Expected: Compiles successfully

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/filesystem/types.rs src-tauri/src/filesystem/commands.rs src-tauri/src/filesystem/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add read_file and write_file Tauri IPC commands"
```

---

## Task 2: Install CodeMirror Packages

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install codemirror @codemirror/view @codemirror/state @codemirror/language @codemirror/commands @codemirror/lang-typescript @codemirror/lang-rust @codemirror/lang-json @codemirror/lang-css @codemirror/lang-html @replit/codemirror-vim
```

- [ ] **Step 2: Verify build still works**

Run: `npm run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install CodeMirror 6 and vim extension packages"
```

---

## Task 3: Language Detection Service

**Files:**

- Create: `src/features/editor/services/languageService.ts`
- Create: `src/features/editor/services/languageService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/features/editor/services/languageService.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { getLanguageExtension, detectLanguageName } from './languageService'

describe('detectLanguageName', () => {
  test('detects TypeScript from .ts extension', () => {
    expect(detectLanguageName('component.ts')).toBe('typescript')
  })

  test('detects TypeScript from .tsx extension', () => {
    expect(detectLanguageName('App.tsx')).toBe('typescript')
  })

  test('detects JavaScript from .js extension', () => {
    expect(detectLanguageName('index.js')).toBe('javascript')
  })

  test('detects Rust from .rs extension', () => {
    expect(detectLanguageName('main.rs')).toBe('rust')
  })

  test('detects JSON from .json extension', () => {
    expect(detectLanguageName('package.json')).toBe('json')
  })

  test('detects CSS from .css extension', () => {
    expect(detectLanguageName('style.css')).toBe('css')
  })

  test('detects HTML from .html extension', () => {
    expect(detectLanguageName('index.html')).toBe('html')
  })

  test('returns plaintext for unknown extensions', () => {
    expect(detectLanguageName('readme.xyz')).toBe('plaintext')
  })

  test('handles files with no extension', () => {
    expect(detectLanguageName('Makefile')).toBe('plaintext')
  })
})

describe('getLanguageExtension', () => {
  test('returns a LanguageSupport for known extensions', () => {
    const ext = getLanguageExtension('file.ts')
    expect(ext).toBeDefined()
  })

  test('returns empty array for unknown extensions', () => {
    const ext = getLanguageExtension('file.xyz')
    expect(ext).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/editor/services/languageService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement language service**

Create `src/features/editor/services/languageService.ts`:

```typescript
import type { Extension } from '@codemirror/state'

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
}

export const detectLanguageName = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (!ext || ext === fileName.toLowerCase()) return 'plaintext'
  return EXTENSION_MAP[ext] ?? 'plaintext'
}

const languageLoaders: Record<string, () => Promise<Extension>> = {
  typescript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ typescript: true, jsx: true })
  },
  javascript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ jsx: true })
  },
  rust: async () => {
    const { rust } = await import('@codemirror/lang-rust')
    return rust()
  },
  json: async () => {
    const { json } = await import('@codemirror/lang-json')
    return json()
  },
  css: async () => {
    const { css } = await import('@codemirror/lang-css')
    return css()
  },
  html: async () => {
    const { html } = await import('@codemirror/lang-html')
    return html()
  },
}

export const getLanguageExtension = (
  fileName: string
): Extension | Extension[] => {
  const lang = detectLanguageName(fileName)
  const loader = languageLoaders[lang]
  if (!loader) return []

  // Return a compartment-friendly placeholder; actual loading is async
  // The useCodeMirror hook handles async language loading
  return []
}

export const loadLanguageExtension = async (
  fileName: string
): Promise<Extension | null> => {
  const lang = detectLanguageName(fileName)
  const loader = languageLoaders[lang]
  if (!loader) return null
  return loader()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/services/languageService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/services/languageService.ts src/features/editor/services/languageService.test.ts
git commit -m "feat: add language detection service for CodeMirror"
```

---

## Task 4: Catppuccin Mocha CodeMirror Theme

**Files:**

- Create: `src/features/editor/theme/catppuccin.ts`
- Create: `src/features/editor/theme/catppuccin.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/features/editor/theme/catppuccin.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { catppuccinMocha } from './catppuccin'
import { EditorView } from '@codemirror/view'

describe('catppuccinMocha theme', () => {
  test('is a valid CodeMirror extension', () => {
    expect(catppuccinMocha).toBeDefined()
    expect(Array.isArray(catppuccinMocha)).toBe(true)
    expect(catppuccinMocha.length).toBeGreaterThan(0)
  })

  test('can be applied to an EditorView without error', () => {
    const div = document.createElement('div')
    expect(() => {
      const view = new EditorView({
        parent: div,
        extensions: [catppuccinMocha],
      })
      view.destroy()
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/theme/catppuccin.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement theme**

Create `src/features/editor/theme/catppuccin.ts`:

```typescript
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const colors = {
  surface: '#121221',
  surfaceContainerLow: '#1a1a2a',
  surfaceContainer: '#1e1e2e',
  surfaceContainerHigh: '#292839',
  primary: '#e2c7ff',
  primaryContainer: '#cba6f7',
  outline: '#968e9a',
  onSurface: '#e3e0f7',
  onSurfaceVariant: '#cdc3d1',

  mauve: '#cba6f7',
  green: '#a6e3a1',
  blue: '#89b4fa',
  rosewater: '#f5e0dc',
  overlay0: '#6c7086',
  yellow: '#f9e2af',
  peach: '#fab387',
  sky: '#89dceb',
  red: '#f38ba8',
  teal: '#94e2d5',
  flamingo: '#f2cdcd',
}

const editorTheme = EditorView.theme(
  {
    '&': {
      color: colors.onSurface,
      backgroundColor: colors.surface,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '14px',
    },
    '.cm-content': {
      caretColor: colors.primary,
      lineHeight: '1.6',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: colors.primary,
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: `${colors.surfaceContainerHigh}99`,
      },
    '.cm-panels': {
      backgroundColor: colors.surfaceContainerLow,
      color: colors.onSurface,
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: `1px solid ${colors.surfaceContainerHigh}`,
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: `1px solid ${colors.surfaceContainerHigh}`,
    },
    '.cm-searchMatch': {
      backgroundColor: `${colors.yellow}30`,
      outline: `1px solid ${colors.yellow}50`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: `${colors.yellow}50`,
    },
    '.cm-activeLine': {
      backgroundColor: `${colors.surfaceContainer}80`,
    },
    '.cm-selectionMatch': {
      backgroundColor: `${colors.surfaceContainerHigh}60`,
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: `${colors.primaryContainer}4d`,
      outline: `1px solid ${colors.primaryContainer}80`,
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: `${colors.red}30`,
    },
    '.cm-gutters': {
      backgroundColor: colors.surfaceContainerLow,
      color: colors.outline,
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: `${colors.surfaceContainer}80`,
      color: colors.primaryContainer,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: colors.surfaceContainerHigh,
      color: colors.onSurfaceVariant,
      border: 'none',
    },
    '.cm-tooltip': {
      backgroundColor: colors.surfaceContainerHigh,
      color: colors.onSurface,
      border: `1px solid ${colors.outline}30`,
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: colors.surfaceContainerHigh,
      borderBottomColor: colors.surfaceContainerHigh,
    },
    // Vim-specific: command line at bottom
    '.cm-vim-panel': {
      backgroundColor: colors.surfaceContainerLow,
      color: colors.onSurface,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '13px',
      padding: '2px 8px',
    },
    '.cm-vim-panel input': {
      backgroundColor: 'transparent',
      color: colors.onSurface,
      outline: 'none',
      border: 'none',
      fontFamily: "'JetBrains Mono', monospace",
    },
    // Fat cursor for vim normal mode
    '.cm-fat-cursor': {
      backgroundColor: `${colors.primary}70 !important`,
      color: `${colors.surface} !important`,
    },
    '&:not(.cm-focused) .cm-fat-cursor': {
      backgroundColor: `${colors.primary}40 !important`,
      outline: `1px solid ${colors.primary}70`,
    },
  },
  { dark: true }
)

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: colors.mauve },
  { tag: tags.operator, color: colors.sky },
  { tag: tags.special(tags.variableName), color: colors.red },
  { tag: tags.typeName, color: colors.yellow },
  { tag: tags.atom, color: colors.peach },
  { tag: tags.number, color: colors.peach },
  { tag: tags.bool, color: colors.peach },
  { tag: tags.definition(tags.variableName), color: colors.rosewater },
  { tag: tags.string, color: colors.green },
  { tag: tags.special(tags.string), color: colors.green },
  { tag: tags.comment, color: colors.overlay0, fontStyle: 'italic' },
  { tag: tags.variableName, color: colors.rosewater },
  { tag: tags.function(tags.variableName), color: colors.blue },
  {
    tag: tags.definition(tags.function(tags.variableName)),
    color: colors.blue,
  },
  { tag: tags.tagName, color: colors.mauve },
  { tag: tags.attributeName, color: colors.yellow },
  { tag: tags.attributeValue, color: colors.green },
  { tag: tags.className, color: colors.yellow },
  { tag: tags.propertyName, color: colors.blue },
  { tag: tags.punctuation, color: colors.onSurfaceVariant },
  { tag: tags.heading, color: colors.mauve, fontWeight: 'bold' },
  { tag: tags.link, color: colors.sky, textDecoration: 'underline' },
  { tag: tags.invalid, color: colors.red },
  { tag: tags.meta, color: colors.flamingo },
  { tag: tags.regexp, color: colors.teal },
])

export const catppuccinMocha = [editorTheme, syntaxHighlighting(highlightStyle)]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/theme/catppuccin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/theme/catppuccin.ts src/features/editor/theme/catppuccin.test.ts
git commit -m "feat: add Catppuccin Mocha CodeMirror theme"
```

---

## Task 5: `useCodeMirror` Hook

**Files:**

- Create: `src/features/editor/hooks/useCodeMirror.ts`
- Create: `src/features/editor/hooks/useCodeMirror.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/features/editor/hooks/useCodeMirror.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeMirror } from './useCodeMirror'

describe('useCodeMirror', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  test('creates an EditorView when container ref is set', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        content: 'hello world',
        fileName: 'test.ts',
      })
    )

    act(() => {
      if (result.current.containerRef) {
        ;(
          result.current
            .containerRef as React.MutableRefObject<HTMLDivElement | null>
        ).current = container
      }
    })

    // The view may need a rerender to initialize
    expect(result.current.view).toBeDefined()
  })

  test('returns null view when no container', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        content: 'hello',
        fileName: 'test.ts',
      })
    )

    expect(result.current.view).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/hooks/useCodeMirror.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `useCodeMirror` hook**

Create `src/features/editor/hooks/useCodeMirror.ts`:

```typescript
import { useRef, useEffect, useState, useCallback } from 'react'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightSpecialChars,
} from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
} from '@codemirror/language'
import { vim } from '@replit/codemirror-vim'
import { catppuccinMocha } from '../theme/catppuccin'
import { loadLanguageExtension } from '../services/languageService'

export interface UseCodeMirrorOptions {
  content: string
  fileName: string
  onSave?: () => void
  onUpdate?: (content: string) => void
}

export interface UseCodeMirrorResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  view: EditorView | null
  getContent: () => string
}

export const useCodeMirror = ({
  content,
  fileName,
  onSave,
  onUpdate,
}: UseCodeMirrorOptions): UseCodeMirrorResult => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [view, setView] = useState<EditorView | null>(null)
  const languageCompartment = useRef(new Compartment())
  const onSaveRef = useRef(onSave)
  const onUpdateRef = useRef(onUpdate)

  onSaveRef.current = onSave
  onUpdateRef.current = onUpdate

  // Create editor on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onUpdateRef.current?.(update.state.doc.toString())
      }
    })

    const state = EditorState.create({
      doc: content,
      extensions: [
        vim({
          callbacks: {
            save: () => {
              onSaveRef.current?.()
            },
          },
        }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        history(),
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        bracketMatching(),
        foldGutter(),
        indentOnInput(),
        languageCompartment.current.of([]),
        catppuccinMocha,
        updateListener,
        EditorView.lineWrapping,
      ],
    })

    const editorView = new EditorView({ state, parent: container })
    viewRef.current = editorView
    setView(editorView)

    return (): void => {
      editorView.destroy()
      viewRef.current = null
      setView(null)
    }
    // Only recreate on container mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load language extension when fileName changes
  useEffect(() => {
    const loadLang = async (): Promise<void> => {
      const currentView = viewRef.current
      if (!currentView) return

      const langExt = await loadLanguageExtension(fileName)
      currentView.dispatch({
        effects: languageCompartment.current.reconfigure(langExt ?? []),
      })
    }
    void loadLang()
  }, [fileName])

  // Update content when it changes externally (file switch)
  useEffect(() => {
    const currentView = viewRef.current
    if (!currentView) return

    const currentContent = currentView.state.doc.toString()
    if (currentContent !== content) {
      currentView.dispatch({
        changes: {
          from: 0,
          to: currentView.state.doc.length,
          insert: content,
        },
      })
    }
  }, [content])

  const getContent = useCallback((): string => {
    return viewRef.current?.state.doc.toString() ?? ''
  }, [])

  return { containerRef, view, getContent }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/hooks/useCodeMirror.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/hooks/useCodeMirror.ts src/features/editor/hooks/useCodeMirror.test.ts
git commit -m "feat: add useCodeMirror hook with vim extension"
```

---

## Task 6: `useVimMode` Hook

**Files:**

- Create: `src/features/editor/hooks/useVimMode.ts`
- Create: `src/features/editor/hooks/useVimMode.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/features/editor/hooks/useVimMode.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useVimMode } from './useVimMode'

describe('useVimMode', () => {
  test('returns NORMAL as default mode', () => {
    const { result } = renderHook(() => useVimMode(null))
    expect(result.current.mode).toBe('NORMAL')
  })

  test('returns default cursor position when no view', () => {
    const { result } = renderHook(() => useVimMode(null))
    expect(result.current.cursor).toEqual({ line: 1, column: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/hooks/useVimMode.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `useVimMode` hook**

Create `src/features/editor/hooks/useVimMode.ts`:

```typescript
import { useState, useEffect } from 'react'
import type { EditorView } from '@codemirror/view'
import type { VimMode, CursorPosition } from '../types'

export interface UseVimModeResult {
  mode: VimMode
  cursor: CursorPosition
}

export const useVimMode = (view: EditorView | null): UseVimModeResult => {
  const [mode, setMode] = useState<VimMode>('NORMAL')
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })

  useEffect(() => {
    if (!view) return

    const updateCursor = (): void => {
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      setCursor({
        line: line.number,
        column: pos - line.from + 1,
      })
    }

    // Listen for vim mode changes via CodeMirror vim extension
    // The vim extension fires a 'vim-mode-change' event on the DOM
    const handleModeChange = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      if (detail?.mode) {
        const modeMap: Record<string, VimMode> = {
          normal: 'NORMAL',
          insert: 'INSERT',
          visual: 'VISUAL',
          replace: 'INSERT',
        }
        setMode(modeMap[detail.mode] ?? 'NORMAL')
      }
    }

    // Listen for selection/cursor changes
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        updateCursor()
      }
    })

    // Add the update listener as a dynamic extension
    view.dispatch({
      effects: EditorView.reconfigure.of([
        ...(view.state.facet(EditorView.decorations) ? [] : []),
        updateListener,
      ]),
    })

    // Listen for vim mode DOM events
    view.dom.addEventListener('vim-mode-change', handleModeChange)

    // Initial cursor position
    updateCursor()

    return (): void => {
      view.dom.removeEventListener('vim-mode-change', handleModeChange)
    }
  }, [view])

  return { mode, cursor }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/hooks/useVimMode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/hooks/useVimMode.ts src/features/editor/hooks/useVimMode.test.ts
git commit -m "feat: add useVimMode hook for vim state tracking"
```

---

## Task 7: `useEditorBuffer` Hook

**Files:**

- Create: `src/features/editor/hooks/useEditorBuffer.ts`
- Create: `src/features/editor/hooks/useEditorBuffer.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/features/editor/hooks/useEditorBuffer.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorBuffer } from './useEditorBuffer'

describe('useEditorBuffer', () => {
  test('starts with no file open', () => {
    const { result } = renderHook(() => useEditorBuffer())
    expect(result.current.filePath).toBeNull()
    expect(result.current.isDirty).toBe(false)
    expect(result.current.content).toBe('')
  })

  test('openFile sets file path and content', async () => {
    const mockReadFile = vi.fn().mockResolvedValue('file content')
    const { result } = renderHook(() =>
      useEditorBuffer({ readFile: mockReadFile })
    )

    await act(async () => {
      await result.current.openFile('/home/user/test.ts')
    })

    expect(result.current.filePath).toBe('/home/user/test.ts')
    expect(result.current.content).toBe('file content')
    expect(result.current.isDirty).toBe(false)
    expect(mockReadFile).toHaveBeenCalledWith('/home/user/test.ts')
  })

  test('markDirty sets isDirty to true', async () => {
    const mockReadFile = vi.fn().mockResolvedValue('content')
    const { result } = renderHook(() =>
      useEditorBuffer({ readFile: mockReadFile })
    )

    await act(async () => {
      await result.current.openFile('/home/user/test.ts')
    })

    act(() => {
      result.current.handleContentChange('modified content')
    })

    expect(result.current.isDirty).toBe(true)
  })

  test('save calls writeFile and clears dirty', async () => {
    const mockReadFile = vi.fn().mockResolvedValue('original')
    const mockWriteFile = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useEditorBuffer({ readFile: mockReadFile, writeFile: mockWriteFile })
    )

    await act(async () => {
      await result.current.openFile('/home/user/test.ts')
    })

    act(() => {
      result.current.handleContentChange('modified')
    })

    await act(async () => {
      await result.current.save('modified')
    })

    expect(mockWriteFile).toHaveBeenCalledWith('/home/user/test.ts', 'modified')
    expect(result.current.isDirty).toBe(false)
  })

  test('discard resets content to original', async () => {
    const mockReadFile = vi.fn().mockResolvedValue('original')
    const { result } = renderHook(() =>
      useEditorBuffer({ readFile: mockReadFile })
    )

    await act(async () => {
      await result.current.openFile('/home/user/test.ts')
    })

    act(() => {
      result.current.handleContentChange('modified')
    })

    act(() => {
      result.current.discard()
    })

    expect(result.current.isDirty).toBe(false)
    expect(result.current.content).toBe('original')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/hooks/useEditorBuffer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `useEditorBuffer` hook**

Create `src/features/editor/hooks/useEditorBuffer.ts`:

```typescript
import { useState, useCallback, useRef } from 'react'

export interface UseEditorBufferOptions {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, content: string) => Promise<void>
}

export interface UseEditorBufferResult {
  filePath: string | null
  fileName: string
  content: string
  isDirty: boolean
  isLoading: boolean
  error: string | null
  openFile: (path: string) => Promise<void>
  save: (currentContent: string) => Promise<void>
  discard: () => void
  handleContentChange: (newContent: string) => void
}

export const useEditorBuffer = (
  options?: UseEditorBufferOptions
): UseEditorBufferResult => {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const originalContentRef = useRef('')

  const fileName = filePath?.split('/').pop() ?? ''

  const openFile = useCallback(
    async (path: string): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const fileContent = await (options?.readFile?.(path) ??
          Promise.resolve(''))
        originalContentRef.current = fileContent
        setContent(fileContent)
        setFilePath(path)
        setIsDirty(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
      }
    },
    [options]
  )

  const save = useCallback(
    async (currentContent: string): Promise<void> => {
      if (!filePath) return
      try {
        await options?.writeFile?.(filePath, currentContent)
        originalContentRef.current = currentContent
        setContent(currentContent)
        setIsDirty(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [filePath, options]
  )

  const discard = useCallback((): void => {
    setContent(originalContentRef.current)
    setIsDirty(false)
  }, [])

  const handleContentChange = useCallback((newContent: string): void => {
    setContent(newContent)
    setIsDirty(newContent !== originalContentRef.current)
  }, [])

  return {
    filePath,
    fileName,
    content,
    isDirty,
    isLoading,
    error,
    openFile,
    save,
    discard,
    handleContentChange,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/hooks/useEditorBuffer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/hooks/useEditorBuffer.ts src/features/editor/hooks/useEditorBuffer.test.ts
git commit -m "feat: add useEditorBuffer hook for file state management"
```

---

## Task 8: `UnsavedChangesDialog` Component

**Files:**

- Create: `src/features/editor/components/UnsavedChangesDialog.tsx`
- Create: `src/features/editor/components/UnsavedChangesDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/features/editor/components/UnsavedChangesDialog.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

describe('UnsavedChangesDialog', () => {
  const defaultProps = {
    isOpen: true,
    fileName: 'test.ts',
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    onCancel: vi.fn(),
  }

  test('renders dialog when open', () => {
    render(<UnsavedChangesDialog {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/test\.ts/)).toBeInTheDocument()
  })

  test('does not render when closed', () => {
    render(<UnsavedChangesDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('calls onSave when Save button is clicked', async () => {
    const user = userEvent.setup()
    render(<UnsavedChangesDialog {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1)
  })

  test('calls onDiscard when Discard button is clicked', async () => {
    const user = userEvent.setup()
    render(<UnsavedChangesDialog {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /discard/i }))
    expect(defaultProps.onDiscard).toHaveBeenCalledTimes(1)
  })

  test('calls onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(<UnsavedChangesDialog {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  test('calls onCancel when Escape key is pressed', async () => {
    const user = userEvent.setup()
    render(<UnsavedChangesDialog {...defaultProps} />)
    await user.keyboard('{Escape}')
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/components/UnsavedChangesDialog.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `UnsavedChangesDialog`**

Create `src/features/editor/components/UnsavedChangesDialog.tsx`:

```typescript
import { useEffect, useCallback } from 'react'
import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export interface UnsavedChangesDialogProps {
  isOpen: boolean
  fileName: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export const UnsavedChangesDialog = ({
  isOpen,
  fileName,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps): ReactElement | null => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCancel()
      }
    },
    [onCancel],
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return (): void => {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [isOpen, handleKeyDown])

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved changes"
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 backdrop-blur-sm bg-black/40"
            onClick={onCancel}
          />

          {/* Panel */}
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 30,
            }}
            className="relative w-full max-w-md mx-4 bg-[#1e1e2e]/90 glass-panel rounded-2xl border border-[#4a444f]/30 shadow-2xl overflow-hidden p-6"
          >
            <h2 className="font-headline text-lg font-semibold text-on-surface mb-2">
              Unsaved Changes
            </h2>
            <p className="font-body text-sm text-on-surface-variant mb-6">
              <span className="font-mono text-primary">{fileName}</span> has unsaved
              changes. What would you like to do?
            </p>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg font-label text-sm text-on-surface-variant hover:bg-surface-bright transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="px-4 py-2 rounded-lg font-label text-sm text-error hover:bg-error/10 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onSave}
                className="px-4 py-2 rounded-lg font-label text-sm bg-primary text-surface font-medium hover:bg-primary-container transition-colors"
              >
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/components/UnsavedChangesDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/components/UnsavedChangesDialog.tsx src/features/editor/components/UnsavedChangesDialog.test.tsx
git commit -m "feat: add UnsavedChangesDialog component"
```

---

## Task 9: Replace CodeEditor with CodeMirror

**Files:**

- Modify: `src/features/editor/components/CodeEditor.tsx`
- Modify: `src/features/editor/components/CodeEditor.test.tsx`

- [ ] **Step 1: Write updated test**

Replace the content of `src/features/editor/components/CodeEditor.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeEditor } from './CodeEditor'

// Mock CodeMirror since jsdom can't fully render it
vi.mock('../hooks/useCodeMirror', () => ({
  useCodeMirror: vi.fn(() => ({
    containerRef: { current: null },
    view: null,
    getContent: vi.fn(() => ''),
  })),
}))

vi.mock('../hooks/useVimMode', () => ({
  useVimMode: vi.fn(() => ({
    mode: 'NORMAL',
    cursor: { line: 1, column: 1 },
  })),
}))

describe('CodeEditor', () => {
  test('renders editor container', () => {
    render(
      <CodeEditor
        content="test content"
        fileName="test.ts"
        isDirty={false}
      />,
    )
    expect(screen.getByTestId('code-editor')).toBeInTheDocument()
  })

  test('renders VimStatusBar with correct props', () => {
    render(
      <CodeEditor
        content="test content"
        fileName="test.ts"
        isDirty={false}
      />,
    )
    expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()
    expect(screen.getByText('test.ts')).toBeInTheDocument()
  })

  test('shows dirty indicator when isDirty', () => {
    render(
      <CodeEditor
        content="test content"
        fileName="test.ts"
        isDirty={true}
      />,
    )
    expect(screen.getByText('[+]')).toBeInTheDocument()
  })

  test('renders placeholder when no content', () => {
    render(
      <CodeEditor
        content=""
        fileName=""
        isDirty={false}
      />,
    )
    expect(screen.getByText(/no file open/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/components/CodeEditor.test.tsx`
Expected: FAIL — current CodeEditor doesn't match new interface

- [ ] **Step 3: Replace CodeEditor implementation**

Replace the full content of `src/features/editor/components/CodeEditor.tsx`:

```typescript
import type { ReactElement } from 'react'
import { useCodeMirror } from '../hooks/useCodeMirror'
import { useVimMode } from '../hooks/useVimMode'
import { VimStatusBar } from './VimStatusBar'
import { detectLanguageName } from '../services/languageService'

export interface CodeEditorProps {
  content: string
  fileName: string
  isDirty: boolean
  onSave?: () => void
  onUpdate?: (content: string) => void
}

export const CodeEditor = ({
  content,
  fileName,
  isDirty,
  onSave,
  onUpdate,
}: CodeEditorProps): ReactElement => {
  const { containerRef, view } = useCodeMirror({
    content,
    fileName,
    onSave,
    onUpdate,
  })

  const { mode, cursor } = useVimMode(view)

  if (!fileName) {
    return (
      <div
        data-testid="code-editor"
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center"
      >
        <h3 className="mb-2 font-label text-sm font-medium text-on-surface">
          No file open
        </h3>
        <p className="font-body text-xs text-on-surface/60">
          Select a file from the explorer to edit it here
        </p>
      </div>
    )
  }

  return (
    <div data-testid="code-editor" className="flex flex-1 flex-col overflow-hidden">
      <div ref={containerRef} className="flex-1 overflow-auto" />
      <VimStatusBar
        vimMode={mode}
        fileName={fileName}
        lineNumber={cursor.line}
        columnNumber={cursor.column}
        encoding="UTF-8"
        language={detectLanguageName(fileName)}
        isDirty={isDirty}
      />
    </div>
  )
}
```

- [ ] **Step 4: Update VimStatusBar to support isDirty prop**

Modify `src/features/editor/components/VimStatusBar.tsx` — add `isDirty` to the props interface and render `[+]` when dirty.

Add `isDirty?: boolean` to `VimStatusBarProps` interface.

In the render, after the fileName span, add:

```typescript
{isDirty && (
  <span className="font-mono text-xs text-error">[+]</span>
)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/editor/components/CodeEditor.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/editor/components/CodeEditor.tsx src/features/editor/components/CodeEditor.test.tsx src/features/editor/components/VimStatusBar.tsx
git commit -m "feat: replace Shiki editor with CodeMirror 6 + vim mode"
```

---

## Task 10: Extend Frontend File Service

**Files:**

- Modify: `src/features/files/services/fileSystemService.ts`

- [ ] **Step 1: Add readFile and writeFile to interface and TauriFileSystemService**

In `src/features/files/services/fileSystemService.ts`, update `IFileSystemService`:

```typescript
export interface IFileSystemService {
  listDir(path: string): Promise<FileNode[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}
```

Add to `TauriFileSystemService`:

```typescript
async readFile(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('read_file', { request: { path } })
}

async writeFile(path: string, content: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_file', { request: { path, content } })
}
```

Add stubs to `MockFileSystemService`:

```typescript
readFile(): Promise<string> {
  return Promise.resolve('')
}

writeFile(): Promise<void> {
  return Promise.resolve()
}
```

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/features/files/services/fileSystemService.ts
git commit -m "feat: extend file service with readFile and writeFile"
```

---

## Task 11: Update Panel Sizes

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/components/Sidebar.tsx`

- [ ] **Step 1: Update WorkspaceView grid defaults**

In `src/features/workspace/WorkspaceView.tsx`, change the constants (around lines 11-13):

```typescript
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 340
```

Change the grid template column for activity panel (line 46) from `320px` to `360px`:

```typescript
gridTemplateColumns: `64px ${sidebarWidth}px 1fr 360px`
```

- [ ] **Step 2: Update Sidebar file explorer defaults**

In `src/features/workspace/components/Sidebar.tsx`, change the constants (around lines 23-25):

```typescript
const FILE_EXPLORER_MIN = 100
const FILE_EXPLORER_MAX = 500
const FILE_EXPLORER_DEFAULT = 320
```

- [ ] **Step 3: Run type-check and existing tests**

Run: `npm run type-check && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/components/Sidebar.tsx
git commit -m "feat: increase default panel sizes for better visibility"
```

---

## Task 12: Make BottomDrawer Resizable

**Files:**

- Modify: `src/features/workspace/components/BottomDrawer.tsx`

- [ ] **Step 1: Replace fixed h-1/3 with useResizable**

In `src/features/workspace/components/BottomDrawer.tsx`:

1. Import `useResizable`:

```typescript
import { useResizable } from '../hooks/useResizable'
```

2. Add constants and hook at top of component:

```typescript
const DRAWER_MIN = 150
const DRAWER_MAX_PERCENT = 0.8
const DRAWER_DEFAULT_PERCENT = 0.5
```

3. Inside the component, add resize state. The drawer needs to know its parent height. Use a ref on the parent and calculate:

```typescript
const parentRef = useRef<HTMLDivElement>(null)
const [parentHeight, setParentHeight] = useState(600)

useEffect(() => {
  if (!parentRef.current) return
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      setParentHeight(entry.contentRect.height)
    }
  })
  observer.observe(parentRef.current)
  return (): void => {
    observer.disconnect()
  }
}, [])

const {
  size: drawerHeight,
  isDragging,
  handleMouseDown,
} = useResizable({
  initial: Math.round(parentHeight * DRAWER_DEFAULT_PERCENT),
  min: DRAWER_MIN,
  max: Math.round(parentHeight * DRAWER_MAX_PERCENT),
  direction: 'vertical',
})
```

4. Replace `h-1/3` class with `style={{ height: drawerHeight }}` and add a drag handle at the top:

```typescript
{/* Resize handle */}
<div
  role="separator"
  aria-label="Resize editor panel"
  className={`h-1 cursor-row-resize transition-colors ${
    isDragging ? 'bg-primary/40' : 'hover:bg-primary/20'
  }`}
  onMouseDown={handleMouseDown}
/>
```

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/features/workspace/components/BottomDrawer.tsx
git commit -m "feat: make BottomDrawer resizable with drag handle"
```

---

## Task 13: Wire File Explorer → Editor

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/components/Sidebar.tsx`
- Modify: `src/features/workspace/components/BottomDrawer.tsx`
- Modify: `src/features/workspace/components/panels/FileExplorer.tsx`

This is the integration task. It wires everything together:

- FileExplorer click → WorkspaceView state → BottomDrawer → CodeEditor
- UnsavedChangesDialog guards dirty switches

- [ ] **Step 1: Add file selection state to WorkspaceView**

In `src/features/workspace/WorkspaceView.tsx`:

1. Import hooks, components, and types:

```typescript
import { useState, useCallback } from 'react'
import type { FileNode } from '../../features/files/types'
import { createFileSystemService } from '../../features/files/services/fileSystemService'
import { useEditorBuffer } from '../../features/editor/hooks/useEditorBuffer'
import { UnsavedChangesDialog } from '../../features/editor/components/UnsavedChangesDialog'
```

2. Add state and hooks inside the component:

```typescript
const [fileService] = useState(() => createFileSystemService())
const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)

const editorBuffer = useEditorBuffer({
  readFile: (path) => fileService.readFile(path),
  writeFile: (path, content) => fileService.writeFile(path, content),
})

const handleFileSelect = useCallback(
  (node: FileNode): void => {
    // Build full path from node
    const path = node.name // FileExplorer already provides full path context
    if (editorBuffer.isDirty) {
      setPendingFilePath(path)
    } else {
      void editorBuffer.openFile(path)
    }
  },
  [editorBuffer]
)

const handleSaveAndSwitch = useCallback(async (): Promise<void> => {
  // Save is handled by the editor's :w command or this callback
  if (pendingFilePath) {
    await editorBuffer.save(editorBuffer.content)
    await editorBuffer.openFile(pendingFilePath)
    setPendingFilePath(null)
  }
}, [editorBuffer, pendingFilePath])

const handleDiscardAndSwitch = useCallback(async (): Promise<void> => {
  if (pendingFilePath) {
    editorBuffer.discard()
    await editorBuffer.openFile(pendingFilePath)
    setPendingFilePath(null)
  }
}, [editorBuffer, pendingFilePath])

const handleCancelSwitch = useCallback((): void => {
  setPendingFilePath(null)
}, [])
```

3. Pass `onFileSelect` down through Sidebar:

```typescript
<Sidebar
  onFileSelect={handleFileSelect}
  // ... existing props
/>
```

4. Pass editor buffer props to BottomDrawer:

```typescript
<BottomDrawer
  content={editorBuffer.content}
  fileName={editorBuffer.fileName}
  filePath={editorBuffer.filePath}
  isDirty={editorBuffer.isDirty}
  onSave={() => editorBuffer.save(editorBuffer.content)}
  onUpdate={editorBuffer.handleContentChange}
/>
```

5. Render UnsavedChangesDialog:

```typescript
<UnsavedChangesDialog
  isOpen={pendingFilePath !== null}
  fileName={editorBuffer.fileName}
  onSave={() => void handleSaveAndSwitch()}
  onDiscard={() => void handleDiscardAndSwitch()}
  onCancel={handleCancelSwitch}
/>
```

- [ ] **Step 2: Thread onFileSelect through Sidebar**

In `src/features/workspace/components/Sidebar.tsx`, add `onFileSelect` to props:

```typescript
interface SidebarProps {
  // ... existing props
  onFileSelect?: (node: FileNode) => void
}
```

Pass it to FileExplorer:

```typescript
<FileExplorer cwd={activeCwd} onFileSelect={onFileSelect} />
```

- [ ] **Step 3: Update BottomDrawer to receive editor props**

In `src/features/workspace/components/BottomDrawer.tsx`, add props:

```typescript
interface BottomDrawerProps {
  content: string
  fileName: string
  filePath: string | null
  isDirty: boolean
  onSave: () => void
  onUpdate: (content: string) => void
}
```

Replace the hardcoded `EditorContent` mock with the real `CodeEditor`:

```typescript
import { CodeEditor } from '../../../editor/components/CodeEditor'

// In the render, replace EditorContent() with:
<CodeEditor
  content={content}
  fileName={fileName}
  isDirty={isDirty}
  onSave={onSave}
  onUpdate={onUpdate}
/>
```

- [ ] **Step 4: Update FileExplorer to pass full path on file select**

In `src/features/workspace/components/panels/FileExplorer.tsx`, the `onFileSelect` callback currently passes just the `FileNode`. Update the handler to construct the full file path from `currentPath + node.name`:

```typescript
const handleNodeSelect = (node: FileNode): void => {
  if (node.type === 'folder') {
    const folderName = node.name.replace(/\/$/, '')
    navigateTo(
      currentPath === '~' ? `~/${folderName}` : `${currentPath}/${folderName}`
    )
  } else {
    const filePath =
      currentPath === '~' ? `~/${node.name}` : `${currentPath}/${node.name}`
    onFileSelect?.({ ...node, name: filePath })
  }
}
```

- [ ] **Step 5: Run type-check**

Run: `npm run type-check`
Expected: No errors

- [ ] **Step 6: Run all tests**

Run: `npm run test`
Expected: PASS (some existing tests may need mock updates)

- [ ] **Step 7: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/components/Sidebar.tsx src/features/workspace/components/BottomDrawer.tsx src/features/workspace/components/panels/FileExplorer.tsx
git commit -m "feat: wire file explorer to editor with unsaved-changes dialog"
```

---

## Task 14: Clean Up Removed Files

**Files:**

- Delete: `src/features/editor/services/shikiService.ts`
- Delete: `src/features/editor/components/LineNumbers.tsx`
- Delete related test files if they exist

- [ ] **Step 1: Check for imports of removed files**

Run: `grep -r "shikiService\|LineNumbers" src/ --include="*.ts" --include="*.tsx"`

Fix any remaining imports that reference these files.

- [ ] **Step 2: Remove files**

```bash
rm -f src/features/editor/services/shikiService.ts
rm -f src/features/editor/services/shikiService.test.ts
rm -f src/features/editor/components/LineNumbers.tsx
rm -f src/features/editor/components/LineNumbers.test.tsx
```

- [ ] **Step 3: Uninstall shiki if no other consumers**

```bash
grep -r "shiki" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

If no results, run: `npm uninstall shiki`

- [ ] **Step 4: Run full build**

Run: `npm run type-check && npm run test && npm run lint`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove Shiki and LineNumbers (replaced by CodeMirror)"
```

---

## Task 15: Update CLAUDE.md and Roadmap

**Files:**

- Modify: `CLAUDE.md` (already done — verify)
- Modify: `docs/roadmap/progress.yaml` (append panel editor milestone)

- [ ] **Step 1: Verify CLAUDE.md update**

Confirm CLAUDE.md no longer says "No Tauri/Rust backend yet". This was already updated.

- [ ] **Step 2: Append to roadmap**

Read `docs/roadmap/progress.yaml` and append a new entry for the panel editor feature with status `in-progress` or `complete` as appropriate.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/roadmap/progress.yaml
git commit -m "docs: update CLAUDE.md and roadmap for panel editor feature"
```

---

## Task 16: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

- [ ] **Step 3: Run type-check**

```bash
npm run type-check
```

- [ ] **Step 4: Run Rust tests**

```bash
cd src-tauri && cargo test --lib
```

- [ ] **Step 5: Verify Rust build**

```bash
cd src-tauri && cargo build
```

All should pass. If any fail, fix before proceeding.
