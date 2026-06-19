---
id: terminal-dom-rendering
category: terminal
created: 2026-06-18
last_updated: 2026-06-19
ref_count: 0
---

# Terminal DOM Rendering

## Summary

The terminal renderer translates a buffered text/runs model into DOM rows for display. Because selection and clipboard operations read from the rendered DOM, the visual representation must preserve semantic whitespace (notably newlines) in a way that survives `Selection.toString()`. Block-level row elements alone are not always enough; an explicit, selectable newline character in the DOM prevents copied multi-line output from collapsing into a single line.

## Findings

### 1. Preserve newlines when rendering selectable rows

- **Source:** github-codex-connector | PR #534 round 2 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts` L671
- **Finding:** `createOutputFragments` split buffered text on `\n` and created a new `display: block` row for each line, but it did not insert any newline text into the DOM. `TerminalTextSurface.getSelection()` returned `Selection.toString()`, so selecting or copying `hello\nworld` produced `helloworld`.
- **Fix:** In `appendNewline`, append a zero-font-size span containing a newline text node to the current row before pushing the next row. The span contributes a selectable newline without affecting the row's visual height.
- **Commit:** same commit as this entry

### 2. Cache measured terminal character width across fit() calls

- **Source:** github-claude | PR #534 round 5 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts` L479
- **Finding:** `measureCharacterWidth` appended a probe span, forced `getBoundingClientRect()`, and removed the span on every `fit()` call. During continuous pane/window resize this repeated a synchronous layout read for a font metric that is stable for the surface lifetime.
- **Fix:** Added a nullable `cachedCharacterWidth` instance field. `measureCharacterWidth` returns the cached value after the first successful measurement; the cache is not invalidated because `TERMINAL_FONT_FAMILY` and `TERMINAL_FONT_SIZE` are constants for the surface.
- **Commit:** same commit as this entry

### 3. Translate snapshot columns to text offsets

- **Source:** github-codex-connector | PR #553 round 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/ghosttyVtRenderSnapshot.ts` L35
- **Finding:** When a VT snapshot row contains wide or combining characters before the cursor, the snapshot helper treated the parser's terminal-cell column as a raw UTF-16 string offset by clamping against `row.length` and returning that value directly, which placed the cursor inside wide characters or between combining marks.
- **Fix:** Reused `TerminalDisplayBuffer`'s cell-width mapping by exporting `findTextOffsetForCellColumn` and consuming it in `readSnapshotCursorOffset`; the helper advances through zero-width combining marks so the cursor offset lands after the complete grapheme cluster. Added unit tests for wide characters and combining marks.
- **Commit:** same commit as this entry
