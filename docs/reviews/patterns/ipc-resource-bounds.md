---
id: ipc-resource-bounds
category: security
created: 2026-07-05
last_updated: 2026-07-05
ref_count: 0
---

# IPC Resource Bounds

## Summary

Electron main-process IPC boundaries and local helper protocols must bound both
payload shape and resource cost. Shape validators that recursively walk arrays,
records, or framed streams still allow denial-of-service bugs when they accept
unlimited valid-looking collections. Fire-and-forget callbacks that cross into a
sidecar or helper also need local rejection handling so a broken dependency does
not become repeated unhandled main-process failures.

## Findings

### 1. Native-overlay IPC validators accepted unbounded payload collections

- **Source:** github-claude | PR #667 round 2 | 2026-07-05
- **Severity:** MEDIUM
- **File:** `electron/native-overlay.ts`
- **Finding:** The native overlay validators walked menu items, sections,
  command-palette results, new-session layouts/panes/commands, and theme
  variables without array or object-size caps. A renderer bug or compromised
  renderer could send a very large valid-shaped payload and block Electron's
  main process during synchronous validation and render dispatch.
- **Fix:** Added reusable maximum lengths for overlay arrays and theme variable
  records, then rejected oversized open requests with `accepted: false` before
  creating overlay windows. Added regression tests for oversized menu item and
  theme variable collections.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Ghostty helper stdout could grow unbounded before a frame header

- **Source:** github-claude | PR #667 round 2 | 2026-07-05
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-helper.ts`
- **Finding:** The helper stdout buffer accumulated chunks while searching for
  the first `\r\n\r\n` header terminator. If the helper emitted malformed
  non-protocol output, the main process could grow memory and repeatedly rescan
  accumulated data before any framed body limit applied.
- **Fix:** Reused the existing `MAX_FRAME_BYTES` ceiling while searching for the
  first header delimiter and shut down the helper when malformed pre-header
  output exceeds it. Added a test that verifies the helper is killed and can be
  respawned after the oversized malformed output.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. Ghostty helper error paths left broken helper state cached

- **Source:** github-claude | PR #667 round 2 | 2026-07-05
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-helper.ts`
- **Finding:** `stdin.on('error')` and `helper.on('error')` logged failures but
  left the cached helper, pane, window, stdout, and resize state intact. If an
  `EPIPE` or process error was not followed by `exit`, later writes could keep
  targeting a broken helper until app restart.
- **Fix:** Extracted the helper-state reset logic and reused it from stdin
  errors, process errors, exits, and explicit shutdown. Added regression coverage
  proving a stdin error clears the cache and the next update spawns a replacement
  helper.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Native Ghostty callbacks dropped sidecar invoke rejections

- **Source:** github-claude | PR #667 round 2 | 2026-07-05
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** Native input and resize callbacks used fire-and-forget sidecar
  invokes. If the sidecar was disabled, crashed, or rejected mid-session,
  ordinary typing and resizing could produce repeated unhandled promise
  rejections in the Electron main process.
- **Fix:** Added a nonblocking `invokeSidecar` wrapper that awaits inside a
  fire-and-forget async body and catches/logs failures locally. Updated primary
  and secondary native input/resize callbacks to use it, with a regression test
  for rejected input and resize invokes.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Renderer-supplied pane identities must not allocate unbounded native surfaces

- **Source:** github-codex-connector | PR #667 round 5 | 2026-07-05
- **Severity:** HIGH
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** The native Ghostty parent accepted any non-empty `sessionId` and `paneId`, and each unique pair could create a retained pane state and eventually a real AppKit surface. A renderer loop could exhaust main-process native resources with valid-shaped payloads.
- **Fix:** Added a conservative `MAX_SURFACES` cap before creating new pane state, while preserving existing pane updates. Regression coverage fills the cap with unique pane ids and asserts the overflow request is rejected before native allocation.
- **Commit:** same commit as this entry
