---
id: react-lifecycle
category: react-patterns
created: 2026-04-09
last_updated: 2026-05-06
ref_count: 3
---

# React Lifecycle

## Summary

React effects with async work or subscriptions must handle cleanup and guard
against state updates after unmount. Effect dependency arrays must be minimal
to avoid unintended re-runs (e.g., PTY respawning on every cwd change).

## Findings

### 1. PTY respawns on every cwd update via OSC 7

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/useTerminal.ts`
- **Finding:** PTY spawn effect depends on `cwd`, so any directory change kills the running session and spawns a new one
- **Fix:** Decoupled spawning from cwd — treat cwd as initial spawn parameter stored in a ref
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`

### 2. State updates after unmount in PTY spawn flow

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/useTerminal.ts`
- **Finding:** `setDebugInfo()` called even when `isMountedRef.current` is false, triggering React warnings
- **Fix:** Gated all state updates (including debug) behind `isMountedRef` guard
- **Commit:** `2fc3fa2 feat: Xterm Terminal Core - TauriTerminalService IPC bridge (#34)`

### 3. Unstable `fileSystemService` instance triggers reloads that overwrite in-progress edits

- **Source:** github-claude | PR #38 round 1 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `WorkspaceView` created a new `fileSystemService` on every render via `const fileSystemService = createFileSystemService()`. CodeEditor's file-loading effect listed `fileSystemService` in its deps, so every WorkspaceView re-render (including each keystroke) triggered a fresh `readFile` → `updateContent`, overwriting the user's in-progress edits with stale disk content.
- **Fix:** Memoize with `useMemo(() => createFileSystemService(), [])` so the reference is stable across renders.
- **Commit:** `dd4fc02 fix: address Codex review round 1 findings`

### 4. `requestAnimationFrame` callback calls methods on destroyed EditorView

- **Source:** github-claude | PR #38 round 8 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** After creating the EditorView, the `setContainer` callback scheduled an rAF to call `view.requestMeasure()` and `view.focus()`, with no guard that the view was still alive when the frame fired. Rapid unmounts (hot reload, StrictMode double-invoke, tab switches) could destroy the view between schedule and fire, calling methods on a destroyed instance. CodeMirror currently no-ops after destroy but this is not a stable public contract.
- **Fix:** Add a `viewRef.current === view` liveness guard inside the rAF callback.
- **Commit:** `3e0304f fix: address Claude review round 8 findings`

### 5. `initialContentRef` updated async via useEffect — empty editor on first file open

- **Source:** github-claude | PR #38 round 9 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** `initialContentRef` was updated via `useEffect`, which runs AFTER the commit phase. React invokes `setContainer` during commit when the new container div is attached — on the first file-open transition, the effect had not fired, so `setContainer` read the stale ref value (empty string) and created the EditorView with an empty document. One frame later `updateContent` filled it in, producing a visible blank flash.
- **Fix:** Update the ref synchronously in the render body (`initialContentRef.current = initialContent`). Ref mutations during render are allowed for this "latest value" pattern — `setContainer` (running during commit) will always read the value written during the matching render.
- **Commit:** `3aa2c5d fix: address Claude review round 9 findings`

### 6. `handleFileSelect` not memoized — unstable reference passed 4 levels deep

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleFileSelect` was a plain arrow function passed 4 levels deep (WorkspaceView → Sidebar → FileExplorer → FileTree → FileTreeNode), creating a new reference on every WorkspaceView render — which happens on every keystroke because `editorBuffer.currentContent` is state. No current render waste because the intermediate components aren't memoized, but the unstable reference would silently defeat any future `React.memo` adoption on the subtree.
- **Fix:** Wrap in `useCallback` with deps on the `isDirty` slice and `openFileSafely` identity. Matches the pattern used by every other handler in the file.
- **Commit:** `0c8f0ac fix: address Claude review round 12 findings`

### 7. `Math.max` accumulator in agent-turn listener freezes turn count after transcript restart on same PTY

- **Source:** github-codex-connector | PR #122 round 1 | 2026-05-01
- **Severity:** MEDIUM (P2)
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** `setStatus({ numTurns: Math.max(prev.numTurns, nextTurns) })` made `numTurns` monotonic across the entire workspace session. When a new `claude` invocation runs on the same PTY, its first `agent-turn` payloads arrive as `1, 2, ...` — but the UI keeps showing the prior run's higher count because Math.max never accepts a lower value. Stale/inflated turn totals after watcher replacement or agent restart, with no visible signal to the user that the underlying transcript has reset. The accompanying co-located test (`'keeps max numTurns when transcript replay emits older counts'`) was guarding against an out-of-order replay scenario that never actually occurs — the watcher reads JSONL sequentially via filesystem-watch offset, so intra-run events are inherently monotonic. The defensive Math.max was protecting against a phantom case while breaking the real one.
- **Fix:** Conditional reset on lower `nextTurns`: `nextTurns < prev.numTurns ? nextTurns : Math.max(prev.numTurns, nextTurns)`. A drop is interpreted as a transcript-restart signal and the lower value wins; otherwise Math.max keeps the count monotonic against the (non-existent in practice but cheap to retain) replay edge case. Test updated from `'keeps max numTurns…'` to `'resets numTurns when a lower count signals a transcript restart on the same session'`, asserting the new semantics. The signal is implicit (lower count = restart) rather than carried by an explicit run-id; if false-positive resets ever surface they should be addressed by threading a runId through the agent-turn payload, not by reverting the conditional.
- **Commit:** _(see git log for the round-1 fix commit)_

### 8. `useCallback` deps list `filteredResults.length` while closure captures the full `filteredResults` array

- **Source:** github-claude | PR #159 round 1 | 2026-05-05
- **Severity:** LOW
- **File:** `src/features/command-palette/hooks/useCommandPalette.ts`
- **Finding:** `navigateUp` and `navigateDown` close over `filteredResults` (the full array reference) but declared only `filteredResults.length` in their `useCallback` dep arrays. Currently harmless because both callbacks only read `filteredResults.length` inside their bodies, but `react-hooks/exhaustive-deps` would flag the missing dep, and any future contributor adding item-level access (e.g. reading `filteredResults[index]` to compute the next highlight) would silently inherit a stale-closure bug — the array reference baked into the closure would lag behind the latest `useMemo` result whenever `filteredResults` rebuilt with the same length.
- **Fix:** Replaced `[filteredResults.length]` with `[filteredResults]` in both callbacks. Re-creation cost is negligible for these small closures, and the dep now matches what the callback actually closes over, so a future item-level read inherits no stale-closure surprise.
- **Commit:** _(see git log for the round-1 fix commit)_

### 9. `cancelRename` reset of double-fire guard re-enables stale post-Escape `onBlur` to fire `onRename` with user-typed text

- **Source:** github-claude | PR #174 round 16 | 2026-05-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/hooks/useRenameState.ts`
- **Finding:** The committedRef double-fire guard (introduced in cycle 13 to block the trailing onBlur after Enter→commit unmounts the input) was being RESET to `false` in `cancelRename` so that the next rename session could begin clean. But Escape calls `cancelRename` synchronously inside `onKeyDown`, queuing `setIsEditing(false)` → React batches and unmounts the input on flush → the browser fires native `blur` on the detached input → React dispatches the synthetic `onBlur` using the **previous render's** `commitRename` closure, which still captures the user's typed `editValue`. With `committedRef = false` the guard does NOT fire, `commitRename` runs, finds `trimmed !== session.name`, and calls `onRename(id, userTypedText)` — silently renaming the session despite the explicit Escape intent. The existing double-fire test calls `commitRename()` twice directly, NOT `cancelRename()` then `commitRename()`, and jsdom does not fire native blur on DOM removal, so the regression was invisible until a Claude review caught it by static analysis of the closure capture.
- **Fix:** Set `committedRef.current = true` in `cancelRename` (single character). The "next rename session starts clean" invariant is preserved because `beginEdit` already unconditionally resets the guard to `false` — that's what makes a fresh rename session work, not the reset in cancel. Added regression test that simulates the Escape+stale-blur path by calling `cancelRename()` then `commitRename()` and asserting `onRename` was not invoked. Code-review heuristic: a guard ref that protects against stale-closure re-entry must be armed by _both_ commit AND cancel paths, NOT just commit; future-state cleanup belongs in `beginEdit` (the "I'm starting a fresh editing session" gesture), not in the cancel/commit terminal states.
- **Commit:** _(see git log for the cycle-16 fix commit on PR #174)_
