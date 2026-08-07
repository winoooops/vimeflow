---
id: ipc-resource-bounds
category: security
created: 2026-07-05
last_updated: 2026-08-06
ref_count: 12
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

### 6. Legacy Ghostty helper callbacks dropped sidecar invoke rejections

- **Source:** github-claude | PR #667 round 6 | 2026-07-05
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-helper.ts`
- **Finding:** The legacy Ghostty helper path still used fire-and-forget
  `sidecar.invoke` calls for helper input and resize events. If the sidecar was
  unavailable or rejected mid-session, ordinary typing and resizing could
  produce repeated unhandled promise rejections in Electron's main process.
- **Fix:** Added the same nonblocking `invokeSidecar` wrapper used by the
  native parent controller and routed legacy helper input/resize invokes through
  it. Added regression coverage for rejected input and resize invokes.
- **Commit:** same commit as this entry

### 7. Swift Ghostty input length conversion could trap

- **Source:** github-claude | PR #667 round 8 | 2026-07-05
- **Severity:** MEDIUM
- **File:** `native/ghostty-helper/Sources/GhosttyElectronBridge/GhosttyElectronBridge.swift`
- **Finding:** Native Ghostty input converted `Data.count` to `Int32` with a trapping initializer. A single oversized input buffer could crash the Electron main process instead of failing gracefully.
- **Fix:** Guard `data.count <= Int(Int32.max)` before entering the C callback path.
- **Commit:** same commit as this entry

### 8. Native Ghostty writes narrowed byte lengths without bounds

- **Source:** github-claude | PR #667 round 8 | 2026-07-05
- **Severity:** LOW
- **File:** `native/ghostty-parent/ghostty_native_parent.cc`
- **Finding:** `Write` and `WriteSecondary` cast JS string byte lengths from `size_t` to `int` without checking `INT_MAX`, allowing oversized writes to wrap and be dropped with no visible error.
- **Fix:** Reject oversized primary and secondary writes with JS-visible errors before passing lengths to the Swift bridge.
- **Commit:** same commit as this entry

### 9. Settings and aliases IPC accepted unbounded valid-shaped payloads

- **Source:** github-claude | PR #672 round 1 | 2026-07-08
- **Severity:** MEDIUM
- **File:** `crates/backend/src/runtime/ipc.rs`
- **Finding:** The save-settings and save-aliases IPC handlers accepted
  renderer-provided strings and collections without size limits. A renderer bug
  or compromised renderer could submit very large valid JSON and force the
  backend to hold and persist oversized payloads.
- **Fix:** Added Rust-side payload validators for settings strings, custom
  keybinding counts and lengths, alias counts, and alias field lengths, then
  invoked them at the IPC boundary and cache write path with regression tests.
- **Commit:** same commit as this entry

### 10. Accent slider queued full settings saves for every drag tick

- **Source:** github-claude | PR #672 round 2 | 2026-07-09
- **Severity:** MEDIUM
- **File:** `src/features/settings/components/panes/AppearancePane.tsx`
- **Finding:** The accent hue range input called the settings provider's
  persisted `update()` on every drag event, enqueueing many full settings IPC
  saves and disk writes for intermediate values the user did not settle on.
- **Fix:** Split preview state from persisted state for the slider and commit
  only on pointer release, key release, or blur. Added a regression test that
  multiple drag changes do not save until the final value is committed.

### 11. Delegated reviewer findings need a display bound

- **Source:** github-claude | PR #677 round 2 | 2026-07-09
- **Severity:** MEDIUM
- **File:** `src/features/diff/hooks/useAgentReview.ts`
- **Finding:** A single valid `agent-review` event could contain an unbounded findings array, and every delegated reviewer finding was rendered as a diff annotation without a reviewer-specific ceiling. A malfunctioning or prompt-injected reviewer could flood the diff UI with thousands of rows.
- **Fix:** Added a per-event reviewer finding cap and collapse overflow into one review-level note that reports how many findings were omitted. Regression coverage asserts only the capped number of annotations is rendered and the overflow note is retained.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. Transcript recovery must cap matches per requested nonce

- **Source:** github-codex-connector | PR #702 round 1 | 2026-07-18
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`
- **Finding:** The transcript recovery scanners returned every completed reply
  or review event whose nonce was in the requested set. If a transcript repeated
  a matching completion for the same nonce, one pending frontend correlation
  could still serialize many recovered events into the IPC response.
- **Fix:** Track remaining requested nonces during recovery and remove a nonce
  after its first recovered event, bounding each recovery response to at most
  one event per requested nonce. Applied the same guard to Codex and Claude Code
  reply/review recovery and extended regression tests with duplicate completed
  rows.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. Durable review-state IPC needs aggregate cache bounds

- **Source:** local-codex | VIM-346 local review | 2026-07-18
- **Severity:** MEDIUM
- **File:** `crates/backend/src/review_state.rs`
- **Finding:** A per-record size cap still allowed the renderer to create an
  unlimited number of repository/owner records. Every write cloned and
  serialized the entire store, so repeated valid requests could exhaust memory
  or disk and stall sidecar IPC; startup also read the whole file without a
  size check.
- **Fix:** Bound the aggregate record count and serialized store size, reject an
  oversized file before reading it, filter oversized malformed siblings, and
  leave unsupported or oversized durable files untouched.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 14. Native Ghostty pane epochs need IPC shape validation

- **Source:** github-codex-connector | PR #744 round 1 | 2026-07-27
- **Severity:** P2 / MEDIUM
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** The native parent IPC pane payload accepted any optional `epoch`
  value even though the destroy guard compares epochs by primitive identity.
  A malformed renderer payload could store an object epoch, causing later
  destroy requests to compare unequal and retain native surfaces until the cap
  is reached.
- **Fix:** Required `epoch` to be absent or a non-empty string in the shared pane
  payload validator and added regression coverage for object and empty-string
  epochs at the update/destroy IPC boundary.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 15. Renderer-controlled PTY session IDs need length bounds before fd transport

- **Source:** github-claude | PR #761 round 3 | 2026-07-30
- **Severity:** HIGH
- **File:** `crates/backend/src/terminal/commands.rs`, `crates/backend/src/terminal/fd_transport.rs`
- **Finding:** `spawn_pty` accepted any length of otherwise valid `session_id`,
  but the fd-transport wire protocol serializes that id into a fixed 4096-byte
  datagram and asserted the payload length. A renderer-supplied oversized id
  could panic the broker send path after PTY resources had already been created.
- **Fix:** Added a 128-byte session-id cap at the spawn/update IPC validation
  boundary before PTY allocation, and changed fd-transport sends to return
  `InvalidInput` instead of asserting on oversized payloads. Added regression
  coverage for both the spawn boundary and transport send helpers.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 16. Native PTY transport sends must not block synchronous IPC paths

- **Source:** github-claude | PR #761 round 4 | 2026-07-30
- **Severity:** HIGH
- **File:** `native/ghostty-parent/ghostty_native_parent.cc`
- **Finding:** `bindPty` could complete a pending fd bind by sending the
  `native-ready` datagram through a blocking socket syscall while still inside
  the global PTY protocol mutex on the Electron main thread. A stalled sidecar
  or full socket buffer could freeze the UI and hold up all other PTY protocol
  operations behind the same mutex.
- **Fix:** Split the bind state transition from outbound delivery so
  `CompletePtyBindLocked` queues the ready datagram while locked and callers
  send after the critical section. The transport send now uses `MSG_DONTWAIT`,
  so peer backpressure degrades to a logged failed datagram instead of an
  unbounded block.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 17. Native addon fd validation accepted NaN as a spawn descriptor

- **Source:** github-claude | PR #761 round 6 | 2026-07-30
- **Severity:** LOW
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** The PTY fd transport bootstrap rejected `undefined` and negative fd values but did not require the addon result to be an integer, so `NaN` could pass the `< 0` check and fail later inside child-process spawn with less clear fallback behavior.
- **Fix:** Require `Number.isInteger(transportFd)` before accepting the descriptor and extend bootstrap fallback coverage with a `NaN` addon result.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 18. Kimi recovery retained an unbounded transcript history in memory

- **Source:** local-codex | Kimi hunk-review local review | 2026-08-01
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/kimi/transcript.rs`
- **Finding:** The recovery scanner bounded individual JSONL lines but accumulated every completed 32 KiB turn before filtering requested nonces, allowing a large wire to allocate excessive memory and block the sidecar recovery IPC.
- **Fix:** Read at most the newest 128 KiB from each of at most 256 retained paths, keep at most 512 completed turns, and cap same-nonce reply recovery at the newest 128 events. Added tail-window and ordering regressions.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 19. Agent-attention dedupe keys crossed IPC unbounded

- **Source:** github-claude | PR #772 round 1 | 2026-08-02
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`, `crates/backend/src/agent/adapter/claude_code/hooks.rs`
- **Finding:** Codex and Claude attention events reused provider request/tool IDs as IPC dedupe keys without applying the length bound already used by the sibling OpenCode path.
- **Fix:** Added 256-character dedupe-key truncation in both adapters and regression tests proving oversized IDs are bounded before event emission.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 20. Native notification-center action validators drifted from renderer payloads

- **Source:** github-codex-connector | PR #772 round 2 | 2026-08-02
- **Severity:** HIGH
- **File:** `electron/native-overlay.ts`
- **Finding:** The notification-center native overlay validator rejected empty
  item arrays and omitted the renderer-supplied `actions.close` field. A normal
  live update after the last notification was dismissed could reject the native
  render and leave a stale overlay behind the DOM fallback, while the close
  action crossed IPC without the same length bound as sibling action IDs.
- **Fix:** Allowed bounded empty notification item arrays, added `close` to the
  main-process action type and validator, and covered both the empty-update and
  oversized-close-action cases in native overlay tests.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. Notification dedupe keys crossed IPC unbounded

- **Source:** github-codex-connector | PR #788 round 1 | 2026-08-06
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/notification.rs`
- **Finding:** Provider-controlled request, turn, and tool IDs were retained
  twice in each watcher's dedupe cache and then emitted over IPC without a
  length bound. A stream of maximum-size valid records could retain tens of
  megabytes per watcher.
- **Fix:** Truncate dedupe keys to 256 Unicode characters at the shared watcher
  emission path before caching or event construction, and apply the same helper
  to the separate Kimi completion emitter. Added regression coverage for both
  storage and IPC emission.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
