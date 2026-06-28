---
id: terminal-input-handling
category: terminal
created: 2026-04-09
last_updated: 2026-06-28
ref_count: 4
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

### 4. Command rename path bypassed pane-title validation before terminal injection

- **Source:** github-codex-connector | PR #265 | 2026-05-24
- **Severity:** P2
- **File:** `src/features/workspace/commands/buildWorkspaceCommands.ts` + `src/features/sessions/utils/sanitizeTitle.ts`
- **Finding:** The `:rename-pane` command path wrote the trimmed raw argument into `userLabel` without the validation used by the chord modal. Control characters and overlong titles could persist locally; for agent panes, frontend state could diverge from the backend-sanitized `/rename` value.
- **Fix:** Route command rename arguments through `validateTitle` before any local label or backend rename write. Control characters and over-200-byte titles are rejected consistently; valid whitespace is collapsed before both local and agent rename calls. Regression tests cover control-character rejection, byte-length rejection, and sanitized whitespace.
- **Commit:** _(see git log for the PR #265 review-fix commit)_

### 5. Clipboard image paste had no payload size cap

- **Source:** github-claude | PR #618 round 1 | 2026-06-24
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/useTerminalClipboard.ts`
- **Finding:** `pasteImageIfAvailable` converted the top clipboard image to a data URL and pasted it into the PTY without checking byte size. Large screenshots can expand to multi-megabyte base64 input, freezing the terminal and overflowing coding-agent context windows.
- **Fix:** Added a 512 KB pre-encoding cap for clipboard image paste, clears the image-paste affordance when exceeded, surfaces an error through `onPasteError`, and covers the rejection path with a regression test.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Native Ghostty panes bypassed restore replay and command-submit tracking

- **Source:** github-codex-connector | PR #630 round 1 | 2026-06-28
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/GhosttyBody.tsx`
- **Finding:** The native Ghostty body attached live PTY output but did not replay `restoredFrom` output and did not surface main-process native input through the terminal command-submit path. Restored panes could appear blank until new output, and `/clear` or `/resume` typed into a native pane bypassed workspace reset logic.
- **Fix:** Forwarded `restoredFrom` and `onCommandSubmit` into `GhosttyBody`, replayed historical and buffered output into the native surface, and mirrored native input from Electron main through a backend event that the renderer tracks with the same command-line parsing rules as xterm.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Native Ghostty output bypassed cwd parsers

- **Source:** github-codex-connector | PR #630 round 2 | 2026-06-28
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/GhosttyBody.tsx`
- **Finding:** Native Ghostty panes forwarded PTY bytes into the native view but did not run the renderer's OSC 7 and agent cwd-hint parsing path. After `cd` or worktree-changing agent output, pane cwd, git status, and burner cwd stayed at the launch directory while native mode was active.
- **Fix:** Passed `onCwdChange` into `GhosttyBody`, parsed native PTY output for OSC 7 and text cwd hints before forwarding the unchanged bytes to Ghostty, and added a component regression test for OSC 7 output.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. Native Ghostty restore drain ignored PTY byte cursors

- **Source:** github-codex-connector | PR #630 round 4 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/GhosttyBody.tsx`
- **Finding:** The native Ghostty restore path replayed restored buffered bytes and registered a pane-ready drain without using `offsetStart` and `byteLen`. If live subscription output and the mount-time drain overlapped, the native surface could receive the same PTY byte range twice.
- **Fix:** Added a cursor initialized from `replayEndOffset`, threaded byte offsets through native output callbacks and pane-ready drains, and skipped any restored, live, or drained event whose `offsetStart` is behind the cursor.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
