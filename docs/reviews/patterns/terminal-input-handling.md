---
id: terminal-input-handling
category: terminal
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Terminal Input Handling

## Summary

Terminal input processing must handle multi-character input (paste), control
characters (backspace, delete), and line ending variants (CR, LF, CRLF).
Processing char-by-char with proper buffer mutation prevents ghost characters,
double execution, and paste failures.

## Findings

### 1. Backspace does not update the input buffer

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** Backspace handler emits visual `\b \b` but never removes the last character from `session.inputBuffer` — deleted characters still execute
- **Fix:** Added buffer mutation on backspace with empty-buffer guard
- **Commit:** `6a312b3 fix: terminal rendering, WebGL, backspace, and progress tracker (#33)`

### 2. Pasted text with newline never executes

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** `write()` only checks `data === '\r'` for Enter — multi-char paste containing newlines falls through to regular character path
- **Fix:** Process `data` per character, handling control chars individually
- **Commit:** `6a312b3 fix: terminal rendering, WebGL, backspace, and progress tracker (#33)`

### 3. CRLF input executes command twice

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** `\r` and `\n` treated as independent Enter events — `\r\n` paste triggers two command executions
- **Fix:** Normalize input by replacing `\r\n` with `\n` before processing, or track previous char to skip `\n` after `\r`
- **Commit:** `6a312b3 fix: terminal rendering, WebGL, backspace, and progress tracker (#33)`
