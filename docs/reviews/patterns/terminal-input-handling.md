---
id: terminal-input-handling
category: terminal
created: 2026-04-09
last_updated: 2026-06-25
ref_count: 3
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

### 5. Engine-scroll wheel handling must not suppress native scroll without a sender

- **Source:** github-codex-connector | PR #617 round 1 | 2026-06-25
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** `TerminalTextSurface` prevented the browser's native wheel behavior even when no engine scroll sender was registered. Plain-text or non-Ghostty renderers could therefore lose native scrolling without any backend scroll request replacing it.
- **Fix:** The non-mouse-tracking wheel path now returns without `preventDefault()` when no scroll sender is installed. A regression test asserts native wheel behavior is left alone in that configuration.
- **Commit:** same commit as this entry

### 6. Programmatic paste paths must share input snap behavior

- **Source:** github-codex-connector | PR #617 round 1 | 2026-06-25
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** Keyboard and DOM paste events snapped the engine viewport back to the live tail before emitting input, but programmatic `paste(text)` bypassed that helper. Context-menu or shortcut paste flows could write while the Ghostty viewport stayed in history.
- **Fix:** `TerminalTextSurface.paste(text)` now calls the same snap helper before emitting data. A regression test covers programmatic paste after an engine scroll into history.
- **Commit:** same commit as this entry

### 7. Wheel-down to live tail must clear scrollback state

- **Source:** github-claude | PR #617 round 1 | 2026-06-25
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** Wheel-up set `scrolledUp`, but wheel-down did not clear it. After a user scrolled back down, the next keystroke could still send an unnecessary snap-to-bottom request.
- **Fix:** Positive engine-scroll wheel deltas now clear `scrolledUp`. A regression test scrolls up, scrolls down, then verifies keyboard input does not issue another snap request.
- **Commit:** same commit as this entry

### 8. DOM page-wheel deltas must map to viewport rows

- **Source:** github-claude | PR #617 round 1 | 2026-06-25
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** `DOM_DELTA_PAGE` wheel events were treated like pixel deltas, so a page-scroll event rounded down and fell back to a one-row scroll. Users configured for page scrolling would see barely any movement.
- **Fix:** Page-mode wheel deltas now multiply by the current viewport row count. A regression test pins one page tick to the surface's row count.
- **Commit:** same commit as this entry

### 9. Mouse-tracking wheel forwarding must ignore zero vertical deltas

- **Source:** github-claude | PR #617 round 1 | 2026-06-25
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** Mouse-tracking mode encoded every wheel event, so horizontal-only trackpad gestures with `deltaY === 0` became spurious wheel-down events for TUIs.
- **Fix:** The mouse-tracking branch now suppresses zero-vertical-delta wheel events without emitting mouse bytes. A regression test asserts no data is sent for that case.
- **Commit:** same commit as this entry

### 10. Downward wheel deltas do not prove the terminal is back at the live tail

- **Source:** github-claude | PR #617 round 2 | 2026-06-25
- **Severity:** HIGH
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** Clearing `scrolledUp` on any positive wheel delta treated a partial downward scroll as if the viewport had returned to the live tail. A subsequent keypress could then skip the snap-to-bottom request, leaving typed input hidden behind history.
- **Fix:** The wheel handler now only sets `scrolledUp` on upward movement and leaves clearing to the input snap path. A regression test covers the partial wheel-down case and verifies keyboard input still snaps to the live tail.
- **Commit:** same commit as this entry

### 11. Engine-scroll wheel bursts must be coalesced before backend dispatch

- **Source:** github-claude | PR #617 round 2 | 2026-06-25
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts`
- **Finding:** The wheel handler sent one `scroll_pty` request per browser wheel event while also suppressing native browser scroll. Fast momentum gestures could overflow the backend's bounded scroll channel and strand the viewport at an intermediate history position.
- **Fix:** Engine-scroll wheel deltas now accumulate and flush once per animation frame, reducing backend queue pressure while preserving a single authoritative engine scroll. Disposal cancels any pending frame, and a regression test asserts burst coalescing.
- **Commit:** same commit as this entry
