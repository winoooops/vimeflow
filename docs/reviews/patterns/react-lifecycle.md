---
id: react-lifecycle
category: react-patterns
created: 2026-04-09
last_updated: 2026-05-07
ref_count: 4
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

### 10. Framer Motion `onReorder` inline closure captures stale `recentGroup` slice across mid-drag re-renders

- **Source:** github-claude | PR #174 round 17 | 2026-05-07
- **Severity:** LOW
- **File:** `src/features/workspace/components/Sidebar.tsx`
- **Finding:** `Reorder.Group`'s `onReorder` callback was an inline arrow closing over `recentGroup` computed at render time. The drag-and-drop machinery in Framer Motion can dispatch the callback across multiple frames during a single drag; if a session transitions from `running` to `completed` mid-drag, React re-renders Sidebar with a fresh `recentGroup` slice but Framer Motion may keep dispatching the _original_ closure that captured the pre-transition `recentGroup`. The resulting `onReorderSessions([...reordered, ...staleRecentGroup])` either drops or duplicates the just-transitioned session for one frame, and a session-store that persists eagerly could write the stale array to disk before the next render's correction arrives. The bug is invisible in steady-state testing because session status transitions are rare during drags, but it's a real cross-frame closure freshness issue.
- **Fix:** Mirrored `recentGroup` into a ref synced via render-body assignment (`recentGroupRef.current = recentGroup` runs every render — cheaper than `useEffect` and runs synchronously, which is the standard React pattern for "always-latest" refs that don't need the commit-phase deferral). The `onReorder` callback now reads `recentGroupRef.current` instead of the closure-captured `recentGroup`. Code-review heuristic: any callback registered with a third-party machinery that may retain it across re-renders (drag-and-drop, gesture recognizers, intersection observers) must read mutable state through a ref, not through the closure-captured render-time snapshot — the closure freshness depends on whether the third-party re-subscribes on each render, which is an implementation detail you usually can't guarantee.
- **Commit:** _(see git log for the cycle-17 fix commit on PR #174)_

### 11. Detector EXIT_HOLD ping-pong against status-reset effect on completed sessions

- **Source:** github-codex-connector | PR #190 round 1 | 2026-05-09
- **Severity:** P1
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `useAgentStatus` intentionally keeps `isActive: true` for `EXIT_HOLD_MS = 5000 ms` after the agent process disappears. The bridge effect was writing that stale `agentType` back into `Session.agentType` even when the active session's status had already flipped to `completed`/`errored`. A separate reset effect forces `agentType: 'generic'` on completed/errored sessions. Result: under a re-render that retriggers the bridge, the two effects could ping-pong (detector type ↔ generic) for the EXIT_HOLD duration — visible chip flicker plus avoidable CPU churn. Even when the bridge's deps don't change in practice, the contract is wrong: a "live agent detected" write into an already-exited session is semantically incoherent.
- **Fix:** Added a derived `activeSessionStatus = sessions.find(s => s.id === activeSessionId)?.status` and gated the bridge with `if (activeSessionStatus !== 'running' && activeSessionStatus !== 'paused') return`. `sessions` is added to the bridge effect's deps via the derived scalar (string), avoiding sessions-array identity churn. Code-review heuristic: when two effects write to the same field under different conditions, the writes must be mutually exclusive — guard each by a non-overlapping predicate. "Live detection" and "session-exit reset" are mutually exclusive states; encode that with a status guard, not with implicit ordering.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #190)_

### 12. xterm `onResize` callback re-fits the addon, re-measuring the container that already triggered the event

- **Source:** github-claude | PR #190 round 1 | 2026-05-09
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/Body.tsx`
- **Finding:** Inside `newTerminal.onResize(({ cols, rows }) => { fitAddon.fit(); resizeRef.current(cols, rows) })`, the inner `fitAddon.fit()` is circular: `onResize` fires _because_ an upstream `fit()` already computed and applied the new col/row dimensions; the `cols`/`rows` delivered by the event are correct. Calling `fit()` again here re-measures the container (a DOM layout read) on every resize event — including during rapid sidebar drag or window resize at ~60 Hz. Pure overhead today; if xterm ever changes `fit()` to be non-idempotent under concurrent resize, this becomes a latent double-resize bug.
- **Fix:** Removed `fitAddon.fit()` from inside the `onResize` handler — kept the `width > 0` guard and the `resizeRef.current(cols, rows)` PTY notification. ResizeObserver and the explicit mount/session-running fits already cover all real resize triggers. Code-review heuristic: an event handler must never invoke the function whose side effects emitted that event — the loop is either circular (idempotent waste) or recursive (stack growth). Treat `onX` callbacks as observers only; rendering-side reactions belong elsewhere in the lifecycle.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #190)_

### 13. `lastActivityAt` not refreshed on PTY exit — RestartAffordance shows "ended X ago" since creation, not exit

- **Source:** github-claude | PR #190 round 2 | 2026-05-09
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** The `service.onExit` handler in `useSessionManager` writes `{ ...s, status: 'completed' }` but never refreshes `lastActivityAt`. Downstream, `RestartAffordance.tsx` renders `"ended ${formatRelativeTime(session.lastActivityAt)}"`, which therefore shows time since session creation rather than since exit. Visual artifact: a session that was created an hour ago and just exited reads "ended 1h ago" the moment its PTY dies — wrong by an order of magnitude. Class of bug: state-machine transition forgets to stamp the timestamp that downstream consumers treat as a transition boundary.
- **Fix:** Stamp `lastActivityAt = new Date().toISOString()` in the same `setSessions` map that flips status to `completed`. Idempotent (re-flipping a completed session re-stamps; in practice onExit fires once per session). Code-review heuristic: any state-transition handler that flips a session/state status field must also refresh whichever timestamp downstream consumers treat as the transition boundary — `status` and `<status>At` are paired writes.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #190)_

### 14. Always-render `+0 −0` deltas leak into the chrome when the working tree is clean OR data isn't fresh yet

- **Source:** github-claude | PR #190 cycle 4 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/HeaderMetadata.tsx`
- **Finding:** `HeaderMetadata` unconditionally rendered `+{added} −{removed}` plus the leading `·` separator regardless of values. The parent (`TerminalPane/index.tsx`) intentionally produces `{ added: 0, removed: 0 }` for two distinct cases: (a) `useGitStatus().filesCwd` is stale (still loading the new cwd's status after a session switch), and (b) the working tree is genuinely clean. Both cases displayed `· +0 −0` in the chrome, even though the conventional UI is "no delta = no segment". Same anti-pattern applies to any "metadata strip" that renders zero values inside a layout-stable slot.
- **Fix:** Wrapped the delta separator + ± spans in a `(added > 0 || removed > 0)` conditional. Audited every leading separator in the file: each `·` lives inside its segment's conditional so no lone-dot artifacts when adjacent segments are absent (e.g. branch null + deltas zero). Code-review heuristic: when a metadata strip composes optional segments with leading separators, every leading separator must be conditional on its OWN segment's presence — not on the strip-as-a-whole — to avoid stranded separators. Stable layout slots are nice but should not include "zero" text states; render nothing instead.
- **Commit:** _(see git log for the cycle-4 fix commit on PR #190)_

### 15. Hook clearing state in its disabled-guard branch makes downstream UI flash on every enable→disable→enable cycle

- **Source:** github-claude | PR #190 cycle 5 | 2026-05-09
- **Severity:** MEDIUM
- **File:** `src/features/diff/hooks/useGitBranch.ts`
- **Finding:** `useGitBranch`'s effect early-returned with `setBranch(null)` whenever `!enabled || !isValidCwd(cwd)`. Since `enabled = isActive` at the call site, every tab switch (active → inactive) cleared the branch label. Switching back triggered a fresh `git_branch` IPC; between reactivation and IPC resolve, the Header label was null → visible blank-then-flash on slow filesystems. The first attempted fix moved `setBranch(null)` from the guard into `fetchBranch` so deactivation didn't clear, but it still cleared at the START of every fetch — so re-activation (same cwd, fresh effect run because `enabled` is in the dep list) still flashed. Class of bug: clear-on-fetch-start instead of clear-on-cwd-change. The "actually changed cwd" signal must be tracked separately from "the effect ran".
- **Fix:** Introduced `lastFetchedCwdRef` (a `useRef<string | null>`). At the top of each `fetchBranch` invocation, capture `isNewCwd = lastFetchedCwdRef.current !== cwd` BEFORE the await. If new, clear the branch (a real cwd transition wants stale data blanked); if same, skip the clear (refresh / enabled-toggle re-fetches keep the old value visible until the IPC overwrites it). Update the ref after the clear decision so the next run sees a consistent "what we last fetched for" snapshot. Code-review heuristic: when "the effect ran" and "the inputs the effect cares about actually changed" diverge, encode the latter explicitly with a ref — relying on dep-list re-runs alone conflates the two and produces UX flicker for any consumer that reads in-between.
- **Commit:** _(see git log for the cycle-5 fix commit on PR #190)_

### 16. Restart-spawn cwd: using the OLD session's `workingDirectory` instead of the spawn-result canonical path causes silent agent-detection misses on symlinked dirs

- **Source:** github-claude | PR #190 cycle 5 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** `createSession` seeded `restoreData.cwd` and called `registerPtySession` with `result.cwd` — the canonical path Rust returns from `service.spawn`. `restartSession` for an Exited session used `cachedCwd = oldSession.workingDirectory` for both. On Linux/macOS monorepos with symlinked project directories, Rust canonicalizes on spawn while `oldSession.workingDirectory` retains the symlink; the PTY ends up registered at a path that diverges from what the Phase-4 agent detector observes (which reads canonical paths). Result: silent missed agent-type detection after restart on symlinked cwds.
- **Fix:** Tightened the local result annotation from `cwd?: string` to `cwd: string` (matching the actual IPC contract — Rust always returns a non-empty canonical absolute path). Replaced `cachedCwd` with `result.cwd` at the `restoreData` seed + `registerPtySession` call. createSession was already correct; restartSession is now consistent. Updated the F5 round-2/4 test mock to include `cwd` in the spawn result. Code-review heuristic: when two functions perform "the same write under slightly different prior conditions" (createSession vs restartSession), audit them for parameter-source consistency — using the same field name (`cwd`) sourced from different objects (`result` vs `oldSession`) is a common drift pattern that only surfaces on edge-case inputs (here, symlinks).
- **Commit:** _(see git log for the cycle-5 fix commit on PR #190)_
