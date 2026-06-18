---
id: terminal-dom-rendering
category: terminal
created: 2026-06-18
last_updated: 2026-06-18
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
