---
id: codemirror-integration
category: editor
created: 2026-04-10
last_updated: 2026-04-10
ref_count: 0
---

# CodeMirror 6 + Vim Integration

## Summary

CodeMirror 6 is a modular editor — almost every feature you'd expect from a
"normal" editor (history, selection rendering, a specific language) has to be
explicitly added as an extension. The `@replit/codemirror-vim` package adds
vim emulation on top but inherits the same "nothing by default" philosophy,
plus it installs its own high-precedence theme that hides the native browser
selection. Any frontend dev touching the editor needs to understand which
extension is load-bearing for which feature, how `EditorView` lifecycle
interacts with React, and how the cm5→cm6 bridge the vim extension uses
affects event/command routing.

## Findings

### 1. Editor not mounted on first file open — callback ref pattern required

- **Source:** local-debugging | PR #38 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** `useCodeMirror` created the `EditorView` inside a `useEffect` whose only dep was `containerRef`. Since ref objects never change identity, the effect only ran once — at initial mount, when CodeEditor was still showing the "No file selected" branch and the container div didn't exist yet. When a file was later selected, the container div appeared but the view was never created. First click showed nothing; only switching tabs (which unmounted/remounted the component) made it appear.
- **Fix:** Switch to a callback ref pattern. `useCodeMirror` returns a `setContainer` function that CodeEditor attaches to the div via `ref={setContainer}`. The callback fires when the div actually mounts, creating the EditorView at the right moment. Ref-based pattern also handles unmount (node → null) for cleanup.
- **Commit:** `cc17251 fix(editor): wire vim state, visual selection, and editor lifecycle`

### 2. View recreated on every content change — vim state resets, `i`/`o` don't work

- **Source:** local-debugging | PR #38 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** `initialContent` was in the `useEffect` dep array. Every file load → new `fileContent` → effect fires → `view.destroy()` → new EditorView with new content. Vim state (mode, cursor position, registers) reset every time. Typing `i` appeared to do nothing because the view was being destroyed and recreated between keypresses. Also caused cursor to jump to position 0 on every external content update.
- **Fix:** Create the view ONCE when the container mounts. For language swaps, use a `Compartment` and `view.dispatch({ effects: compartment.reconfigure(newLanguage) })`. For content updates, expose an `updateContent(newContent)` method that dispatches a `changes` transaction without recreating the view. `initialContent` becomes a "captured at mount time" value via `initialContentRef`.
- **Commit:** `cc17251 fix(editor): wire vim state, visual selection, and editor lifecycle`

### 3. Vim mode tracker polled the wrong property — always showed NORMAL

- **Source:** local-debugging | PR #38 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useVimMode.ts`
- **Finding:** Initial implementation polled `(view as any).cm.vim.mode` every 100ms. The vim extension doesn't expose mode state there — it stores it on `cm.state.vim` and emits a `vim-mode-change` event via `cm.signal` when it changes. Polling the wrong property always returned undefined, so the status bar always displayed NORMAL even when the user was in INSERT or VISUAL mode.
- **Fix:** Use `getCM(view)` from `@replit/codemirror-vim` (the documented public API) to get the cm5 wrapper, then subscribe via `cm.on('vim-mode-change', handler)`. Normalize the mode strings (`replace` → INSERT, `visual*` → VISUAL). Remove the polling loop entirely.
- **Commit:** `cc17251 fix(editor): wire vim state, visual selection, and editor lifecycle`

### 4. Visual mode has no visible selection — `hideNativeSelection` + missing `drawSelection()`

- **Source:** local-debugging | PR #38 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.ts`, `src/features/editor/theme/catppuccin.ts`
- **Finding:** Pressing `v` entered VISUAL mode (status bar updated) but no selection was visible. The vim extension installs a high-precedence `hideNativeSelection` theme that sets `.cm-vimMode .cm-line { ::selection { background-color: transparent !important } }` to kill the native browser selection pseudo-element. Without the `drawSelection()` extension, CodeMirror 6 doesn't render its own `.cm-selectionBackground` layer either — so vim visual mode had no visible representation at all.
- **Fix:** Add `drawSelection()` to the extensions array. Also boost the selection background color in the theme from the barely-visible surface-high tint to `primary` at 25% opacity so the selection stands out.
- **Commit:** `cc17251 fix(editor): wire vim state, visual selection, and editor lifecycle`

### 5. Missing `history()` extension — vim `u` undo silently no-ops

- **Source:** github-claude | PR #38 round 13 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** CodeMirror 6 does not include history by default — it must be explicitly added via `history()` from `@codemirror/commands`. The vim extension's `u`/`ctrl-r` handlers delegate to CodeMirror's `undo()`/`redo()` commands, which silently return `false` when no `HistoryField` exists in the state. Pressing `u` in NORMAL mode did nothing. Every user discovers this on their first typo.
- **Fix:** Add `history()` to the extensions array.
- **Commit:** `3999b50 fix: address Claude review round 13 findings`

### 6. Language extension not memoized — `Compartment.reconfigure` on every keystroke

- **Source:** github-claude | PR #38 round 9 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** `getLanguageExtension(fileName)` was called on every CodeEditor render without memoization. Every factory call returned a fresh Extension object, so the `language` prop identity changed on every keystroke (typing flows: onContentChange → setCurrentContent → re-render → new language object). `useCodeMirror`'s language-update effect treated the new reference as a real change and called `Compartment.reconfigure()` on every keypress — resetting the incremental parser and causing visible syntax-highlighting flicker.
- **Fix:** Wrap `getLanguageExtension(fileName)` in `useMemo` keyed on `fileName` so the reference is stable across keystrokes and only rebuilt when the open file actually changes.
- **Commit:** `3aa2c5d fix: address Claude review round 9 findings`

### 7. Vim `:w` registered via undocumented internal API — silent no-op

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** Initial `:w` wiring used `(view as any).cm.vim.defineEx('write', 'w', ...)`. `Vim.defineEx` is actually a STATIC method on the `Vim` object exported from `@replit/codemirror-vim`, not a property of the cm5 wrapper — `cm.vim` is undefined. The `if (cm?.vim)` guard silently skipped the registration block, so `:w` either silently no-oped or hit the library's default `:w` handler (which may not be wired to anything). No automated test caught it.
- **Fix:** Use the public static API: `import { Vim } from '@replit/codemirror-vim'; Vim.defineEx('write', 'w', () => onSaveRef.current())`. Register once at module load, not per-mount.
- **Commit:** `077c87f fix: address Claude review round 2 findings`

### 8. `Vim.defineEx` registered per-mount overwrites handler closure — wrong editor saves

- **Source:** github-claude | PR #38 round 7 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** `Vim.defineEx` writes into a GLOBAL registry shared across every `@replit/codemirror-vim` instance. Initial fix called it inside `setContainer` — every mount overwrote the handler closure. With two simultaneous `<CodeEditor>` instances (split panes, comparison view), editor A's `:w` would silently route through editor B's save callback, saving the wrong file's content to the wrong path.
- **Fix (round 7):** Use a module-level `activeVimSave` slot, register the ex-command once at module load, dispatch through the slot.
- **Fix (round 7 follow-up):** Replace the single slot with `WeakMap<EditorView, () => void>` keyed by view identity. The `Vim.defineEx` handler receives the cm5 wrapper; read `cm.cm6` to recover the `EditorView` and look up its save callback. Multi-editor `:w` routing is now correct.
- **Commit:** `1545491 fix: address Claude review round 7 findings`

### 9. Double `readFile` IPC — editor and buffer both fetch, causing spurious dirty state

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** `WorkspaceView.openFileSafely` called `editorBuffer.openFile(path)` which read the file to populate `originalContent`/`currentContent`. CodeEditor separately ran its OWN `loadFile` effect on `filePath` changes, issuing a SECOND independent `readFile` to populate its internal `fileContent` state. Both IPC round-trips, never correlated. If a running coding agent wrote to the file between the two reads, `originalContent ≠ currentContent` and the buffer appeared dirty even though the user hadn't typed anything. A save in that state would overwrite the agent's concurrent writes.
- **Fix:** Remove CodeEditor's internal `loadFile` effect and make it presentational — accept `content` as a prop, sourced from `editorBuffer.currentContent`. The single owning buffer does all reads. Echo-back from user edits (typing → onContentChange → buffer state → content prop → updateContent) is a no-op because `useCodeMirror.updateContent` short-circuits on equal content.
- **Commit:** `967c25f fix: address Claude review round 4 findings`

### 10. Empty file doesn't clear CodeMirror buffer — stale content visible

- **Source:** local-debugging | PR #38 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** The content-sync effect bailed out via `if (!fileContent) return`, so opening a zero-byte file (or a file that became empty) never called `updateContent`. The editor kept showing the previous file's content, and subsequent `:w` could overwrite the wrong file contents.
- **Fix:** Gate on `loadedFilePath === null` instead of content truthiness. Empty files still trigger an `updateContent('')` that correctly clears the buffer.
- **Commit:** `cc17251 fix(editor): wire vim state, visual selection, and editor lifecycle`
