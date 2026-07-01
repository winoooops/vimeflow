---
id: react-lifecycle
category: react-patterns
created: 2026-04-09
last_updated: 2026-06-27
ref_count: 64
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

### 17. Hook with stranded state mounts a per-instance global listener that fires N times in multi-instance layouts

- **Source:** github-claude | PR #199 cycle 1 | 2026-05-12
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/index.tsx`
- **Finding:** After 5b retargeted the visual focus marker from `useFocusedPane().isFocused` to `pane.active`, `TerminalPane` kept calling `useFocusedPane({ containerRef })` to retain `onTerminalFocusChange` for `Body`'s `onFocusChange` prop. The hook's state (`isFocused`) became dead — but its `useEffect` still attached a global `document.addEventListener('mousedown', ...)` listener per mount. xterm focus events set state to `true` via `onTerminalFocusChange`; the next out-of-pane click triggered `setIsFocused(false)` → a real `useState` transition → a React re-render scheduled per pane. In multi-pane SplitView (vsplit/hsplit/threeRight/quad) N panes attached N listeners and produced N spurious re-renders per global click. Class of bug: refactor that retains a hook call solely for a non-state side effect — the hook's lifecycle (state, effects, listeners) keeps running wastefully.
- **Fix:** Removed the `useFocusedPane` call entirely. `Body.onFocusChange` is optional and tracks xterm focus internally for cursor rendering, so dropping the outbound notification preserves xterm-focus behavior while eliminating the global listener. Deleted `useFocusedPane.ts` + `useFocusedPane.test.ts` (no remaining consumers in the codebase) and the now-orphaned `containerRef` declaration + wrapper-div `ref={containerRef}` binding. Code-review heuristic: when a refactor leaves a hook call whose return-value is only partially consumed, audit what the hook's lifecycle is still doing — state updates and effect attachments may have no visible consumer but still cost re-renders.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #199)_

### 18. Prefix-slice clamp drops the active pane in production when DEV invariant relaxes

- **Source:** github-codex-connector | PR #199 cycle 2 | 2026-05-12
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** SplitView clamped via `session.panes.slice(0, layout.capacity)` and protected the invariant with `if (import.meta.env.DEV && panes.length > capacity) throw`. The DEV throw catches the case in fixtures + dev builds, but in production builds the silent prefix slice can drop the active pane whenever pane order and active index diverge (post-shrink, restored inconsistent state, etc.). Result: rendered grid shows an inactive pane while the real active PTY is hidden; `useAgentStatus(activePane?.ptyId)` and per-pane `useGitBranch`/`useGitStatus` follow the hidden active pane, so the visible-but-inactive pane and the agent-status panel point at different PTYs — a state where the user cannot reach the pane that's actually receiving terminal input. Class of bug: DEV-only invariant assertions paired with naive production fallbacks leave a silent failure mode in the actual ship target.
- **Fix:** Extracted `selectVisiblePanes(panes, capacity)` as an exported pure helper inside `SplitView.tsx`. When the active pane's index in `panes` is `>= capacity`, the helper replaces the LAST visible slot with the active pane so focus/agent/cwd signals stay reachable. Otherwise returns the prefix slice unchanged. SplitView calls `selectVisiblePanes` in place of inline `.slice(...)`. DEV throw retained for early-warning during fixtures. Added 5 unit tests on the pure helper covering in-bounds slice, active-already-inside, last-slot replacement, exact-capacity-index, and the defensive no-active-pane fallback. Code-review heuristic: when a render-path has a DEV-only assertion, audit the production fallback for the same invariant — a release build with the assertion silenced should still produce a usable UI, not a different-than-intended one.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #199)_

### 19. Hook-hoist refactor lost the joint invariant that justified an unguarded array access

- **Source:** github-claude | PR #236 cycle 1 | 2026-05-20
- **Severity:** MEDIUM
- **File:** `src/features/command-palette/CommandPalette.tsx`
- **Finding:** Hoisting `useCommandPalette` out of `CommandPalette.tsx` and into `WorkspaceView` turned `clampedSelectedIndex` and `filteredResults` from internally-derived state into independent props. The activeDescendantId expression `filteredResults[clampedSelectedIndex].id` was preserved verbatim from the pre-hoist code because the hook still guarantees the joint invariant `clampedSelectedIndex === -1 ⟺ filteredResults.length === 0`. Inside the hook, the invariant was automatic; across the prop boundary, it became an unstated contract — any future caller wiring `CommandPalette` directly (without `useCommandPalette`) can supply a mismatched pair (e.g. `clampedSelectedIndex=0`, `filteredResults=[]`) and crash the workspace error boundary with `TypeError: Cannot read properties of undefined (reading 'id')`. Class of bug: when a component's internal invariant gets externalized into prop space, the expressions that depended on the encapsulated form must be re-defended at the new boundary.
- **Fix:** Guarded the lookup: compute `activeCommand = clampedSelectedIndex >= 0 ? filteredResults[clampedSelectedIndex] : undefined` first, then return `activeCommand ? \`command-${activeCommand.id}\` : undefined`. A mismatched-pair input now degrades to "no active descendant" instead of crashing. Added a regression test in `CommandPalette.test.tsx` that drives the unsafe input (`filteredResults: [], clampedSelectedIndex: 0`) and asserts the input has no `aria-activedescendant` attribute. Code-review heuristic: when a hook moves up a level via the controlled-component pattern, sweep every expression in the component that depended on co-derived state for an implicit invariant — and either defend it at the new prop boundary or encode the invariant in the type signature.
- **Commit:** same commit as this entry

### 20. Positional wrapper keys migrate state when keyed children move

- **Source:** github-codex-connector | PR #263 | 2026-05-25
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/components/toolbar/PriorityPlus.tsx`
- **Finding:** `PriorityPlus` wrapped each keyed toolbar chip in a `<div key={index}>`. When a chip was inserted or removed before stateful controls such as dropdowns, React reused the wrapper at the same index for a different logical child, allowing open/active state to migrate to the wrong chip.
- **Fix:** Key wrapper nodes from each child's stable React key, falling back to the index only for unkeyed children. Added a regression test with a stateful keyed child that preserves state when another child is inserted before it.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 29. Single-subscription invariant test weakened after derived-props refactor

- **Source:** github-claude | PR #352 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.subscription.test.tsx`
- **Finding:** The old test used reference-equality (`toBe`) to prove a single `useAgentStatus()` call site: both `AgentStatusPanel` and `SidebarStatusHeader` received the SAME object from a mock that returns a fresh object per call. After VIM-66 refactored `AgentStatusCard` to receive derived props (`title`, `state`) instead of the raw `agentStatus` object, the reference-equality probe was retired and replaced with `expect(useAgentStatus).toHaveBeenCalled()`. That assertion passes whether the hook is called once or five times per render, so a future child component adding its own `useAgentStatus()` call would go undetected — creating duplicate Tauri event listeners and possible stale-state divergence. The per-component `AgentStatusCard.test.tsx` guards only the card in isolation, not the broader tree.
- **Fix:** Replaced the presence-only assertion with a count-level guarantee pinned to `useGitStatus` call count. Both hooks are lifted once-per-render in `WorkspaceView` and neither is called by children in this test setup, so the counts must match. Added `vi.mocked(useAgentStatus).mockClear()` in `beforeEach` so the count starts fresh per test. If a future child adds a `useAgentStatus()` call, the counts diverge and the test fails.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 25. Sticky title state survives PTY restart because `replacementPane` spreads `...oldPane`

- **Source:** github-codex-connector | PR #317 cycle 2 | 2026-05-31
- **Severity:** P2
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** `restartSession` builds the replacement pane with `...oldPane`, so the new PTY inherits `agentTitleSource: 'user-renamed'`, `agentTitle`, and `userLabel` from the old pane. In that state the `agent-session-title` guard (see §24) drops every subsequent `ai-generated` title from the new agent session, leaving the old pane title stuck after restart unless the user manually renames again. The pane replacement is a genuine lifecycle reset — a new PTY, new PID, new `restoreData`, and `agentType` already resets to `'generic'` — but the title fields were carried forward silently.
- **Fix:** Explicitly set `agentTitle: undefined`, `agentTitleSource: undefined`, and `userLabel: undefined` on the `replacementPane` object so the new PTY starts with a blank title slate. The user's explicit rename is ephemeral (documented non-goal: "no persistence beyond what the agent persists"), so clearing on restart is consistent with the design. Added a regression test that seeds a pane with `user-renamed` title and label, restarts the session, and asserts all three fields are undefined on the replacement pane. Code-review heuristic: when replacing an entity via object spread (`{ ...old, newProp }`), enumerate every field that MUST NOT survive the replacement — spread is "copy everything by default"; lifecycle resets need "start fresh by default".

### 21. Responsive coercion display state overwrote the saved user preference

- **Source:** github-claude | PR #263 follow-up | 2026-05-25
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** The diff toolbar displayed coerced `unified` mode while the pane was too narrow for split view, but its change handler still wrote directly to the saved `diffStyle` state. Clicking the already-active `unified` segment permanently replaced a saved `split` preference, so widening the pane did not restore split view.
- **Fix:** Track `paneWidth=0` as an unmeasured sentinel, derive forced-unified display state only after measurement, and ignore the no-op `unified` write while split is merely being coerced. Added a regression test that clicks forced-unified at narrow width and verifies split returns when the pane widens.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 22. Layout measurements must compare coordinates from the same origin

- **Source:** github-claude | PR #263 follow-up | 2026-05-25
- **Severity:** HIGH
- **File:** `src/features/diff/components/toolbar/PriorityPlus.tsx`
- **Finding:** PriorityPlus used `container.clientWidth` with `lastVisible.offsetLeft + offsetWidth` to reserve space for the overflow chip. In the docked diff panel, the wrapper's `offsetParent` is a positioned ancestor outside the toolbar, so the item coordinate included the file-list offset while the container width did not. The toolbar hid one extra chip whenever overflow started.
- **Fix:** Measure both the container and last visible item with `getBoundingClientRect()` and subtract viewport-relative `right` values. Added a regression test that simulates a toolbar offset by the file list and proves the last fitting chip stays visible.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 23. Index-into-data reset effect missed the same-collection shrink case

- **Source:** github-claude + github-codex-connector | PR #284 | 2026-05-27
- **Severity:** HIGH
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** `focusedHunkIndex` was reset to 0 only on `[selectedFilePath, selectedFileStaged]` change. Staging/discarding a hunk reloads the SAME file with fewer hunks (path + staged unchanged), so the reset never fired — the stale index pointed out of range, the hunk counter rendered an invalid value (e.g. "3/2", with no `Math.min` clamp unlike the sibling file counter), and per-hunk stage/unstage/discard silently no-op'd via the `focusedHunk === null` guard until the user manually navigated. The reset effect's dependency set covered file-identity changes but not the equivalent "the indexed collection shrank under a held index" case.
- **Fix:** Added a clamp effect keyed on `hunkCount` (`setFocusedHunkIndex((prev) => Math.min(prev, hunkCount - 1))`) plus a derived `clampedHunkIndex` (`hunkCount > 0 ? Math.min(focusedHunkIndex, hunkCount - 1) : 0`) used for the focused hunk, `selectedLines`, and the toolbar counter — so the single render between the shrink and the effect firing also stays in range. Lesson: when state holds an index/cursor into a refetchable collection, the clamp must key on the collection length, not only on the identity that selected it. Regression test: focus the last of 3 hunks, reload the same file with 2 hunks, assert the counter clamps to "2/2" (never "3/2") and `selectedLines` stays non-null.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 24. Sticky-source guard with title-equality bypass silently downgraded the protected source on a same-title re-emit

- **Source:** github-claude + github-codex-connector | PR #317 cycle 1 | 2026-05-30
- **Severity:** MEDIUM / P2
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** The cycle-0 fix introduced a sticky guard in the `agent-session-title` listener: when `pane.agentTitleSource === 'user-renamed'`, subsequent `ai-generated` events were supposed to be ignored so a user-typed rename couldn't be silently overwritten by Claude's later auto-summary or Codex's transient `read_thread_name` clear. The ai-generated branch carried a `payload.title !== pane.agentTitle` discriminator intended to let "idempotent" same-title ai-generated events pass through harmlessly. "Pass through" meant the listener fell through to the standard write at lines 589–594, which unconditionally set `agentTitleSource: nextSource` where `nextSource = 'ai-generated'` — silently downgrading the protected state. After that downgrade, the next ai-generated event with a different title was no longer blocked, defeating the entire guard. Triggered cleanly by the Codex sequence the cycle-0 commit message itself described: `session_index.jsonl` rewrite → transient empty-title clear (blocked by the guard) → watcher re-reads the persisted title with no pending rename claim → emits `ai-generated` with the user's title → discriminator says "same as agentTitle, let through" → source downgrades to `ai-generated` → next Claude auto-summary clobbers. Class of bug: a guard whose predicate references the very state it's supposed to protect lets the state be flipped by any event the guard was supposed to swallow — the protection only survives until the FIRST "harmless" let-through.
- **Fix:** Dropped the `payload.title !== pane.agentTitle` clause. The guard now blocks ALL `ai-generated` events whenever `agentTitleSource === 'user-renamed'`, regardless of title value. A same-title ai-generated re-emit is now a no-op (state already matches, source stays `'user-renamed'`); a different-title ai-generated event is blocked. Also restructured the guard to check `source` before `cleared`, so the documented `user-renamed + empty` lifecycle-reset escape hatch falls through to the standard cleared path instead of being trapped (see [[documentation-accuracy]] §74). Added regression tests covering (a) same-title ai-generated followed by a different-title ai-generated and (b) the lifecycle-reset path. Code-review heuristic: when a guard's predicate references the state it's supposed to protect, every "let through harmlessly" branch must guarantee the protected state is NOT written by the downstream code — otherwise the gate opens itself on the first such event.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 26. Treat exited agents as shell in the sidebar card

- **Source:** github-codex-connector | PR #352 round 1 | 2026-06-06
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** When an agent exits but the PTY remains open, `useAgentStatus` sets `agentExited: true`/`isActive: false` while retaining `agentType` and the final metrics during its 5s exit-hold window. Because `sidebarCardIsShell` only looked at `agentType`, that scenario rendered the fused card as an agent card with stale model/rate-limit data instead of the SHELL placeholder.
- **Fix:** Changed `const sidebarCardIsShell = !agentStatus.agentType` to `const sidebarCardIsShell = !agentStatus.agentType || !agentStatus.isActive` so an inactive agent (including the post-exit hold window) renders the shell placeholder.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 27. Exited-agent shell guard must check `agentExited` during the exit-hold window

- **Source:** github-codex-connector + local refinement | PR #352 round 3 | 2026-06-06
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The prior round-1 fix added `!agentStatus.isActive` to `sidebarCardIsShell`, but during the 5s exit-hold window `isActive` remains `true` while `agentExited` is `true`. The card therefore continued to render stale model/rate-limit data instead of the SHELL placeholder.
- **Fix:** Added `|| agentStatus.agentExited` to the `sidebarCardIsShell` derivation so the shell placeholder shows immediately when an agent exits, even during the exit-hold window where `isActive` has not yet flipped to false.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 28. forwardRef component optional props trigger `react/require-default-props` after removing `defaultProps`

- **Source:** local-codex (CI failure) | PR #352 round 3 | 2026-06-06
- **Severity:** HIGH
- **File:** `src/features/workspace/components/SidebarToggle.tsx`
- **Finding:** Removing deprecated `defaultProps` from a `forwardRef` component caused ESLint `react/require-default-props` errors because the rule cannot see destructuring defaults through `forwardRef`. The CI Code Quality Check job failed. All defaults were already handled via destructuring, so re-adding `defaultProps` would reintroduce the React 18.3 deprecation warning.
- **Fix:** Added the repository-standard `/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */` comment at the top of the file, matching the convention used in six other forwardRef files in the repo.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 26. retryTimerRef forward reference in mount-lifecycle cleanup

- **Source:** github-claude | PR #381 round 2 | 2026-06-07
- **Severity:** LOW
- **File:** `src/features/sessions/hooks/usePushWorkspaceGrouping.ts`
- **Finding:** `retryTimerRef` is used in the mount-lifecycle `useEffect` cleanup but declared 17 lines later. The forward reference is invisible to ESLint and TypeScript; a future early return or conditional before the ref declaration would produce a silent cleanup bug where the orphaned timer is never cleared on unmount.
- **Fix:** Moved `retryTimerRef`, `latestDrainRef`, and `lastPushedJsonRef` to immediately after `mountedRef` (before the first `useEffect`), eliminating the forward reference and making the declaration order match the runtime initialization order.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 27. Service-swap effect omits timer cancel; new-backend push delayed up to 5s

- **Source:** github-claude | PR #381 round 4 | 2026-06-07
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/usePushWorkspaceGrouping.ts`
- **Finding:** The `[service]` effect only cleared `lastPushedJsonRef`. If an IPC failure had armed `retryTimerRef`, rerendering with a new service queued the same snapshot but the drain gate saw `pendingJson === retryTargetJsonRef.current` and waited for the old 5s timer. During that window the restarted backend could have no grouping cache, so a crash/reload would fragment restored multi-pane sessions.
- **Fix:** In the `[service]` effect, clear any existing retry timer via `clearTimeout`, reset `retryTimerRef` to null, and reset `retryTargetJsonRef` to null alongside `lastPushedJsonRef` so the current snapshot drains immediately to the new service.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 28. localStorage write inside a React functional state updater

- **Source:** github-claude | PR #395 round 1 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** `appendPaneCacheReading` called `writeCacheHistory` (a `localStorage` writer) from inside the functional `setSessions` updater. React state updaters are expected to be pure; in StrictMode they can be invoked twice, and any non-idempotent side effect creates a durability/state-consistency hazard. Even though the current write was mostly idempotent, future additions of timestamps, counters, or interrupted render paths could persist history that React never committed.
- **Fix:** Moved the `writeCacheHistory` call outside the updater. The callback now reads the target pane from `sessionsRef.current`, computes the next `cacheHistory` array with `pushCacheReading`, writes to `localStorage` once, then calls `setSessions` with a pure updater that only maps the in-memory state. The updater no longer touches `localStorage` and is safe under StrictMode double-invocation.
- **Commit:** _(PR #395 round 1)_

### 30. Derived sidebarCardState computed every render but voided by AgentStatusCard

- **Source:** github-claude | PR #421 round 2 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`, `src/features/workspace/components/AgentStatusCard.tsx`
- **Finding:** `sidebarCardState` was computed through a 5-branch ternary over `activityPanelStatus` and `agentStatus.isActive` on every render, then passed as `state={sidebarCardState}` to `AgentStatusCard` where it was immediately discarded via `void state`. No state-driven visual output existed in the card, so the computation served no purpose and misled the component interface.
- **Fix:** Removed `sidebarCardState` computation from `WorkspaceView`, removed the `state` prop from `AgentStatusCardProps`, and updated co-located tests to match the new prop contract.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 31. `useNativeSurface` returns a fresh `NativeSurfaceState` object on every render

- **Source:** github-claude | PR #467 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/overlays/useNativeSurface.ts`
- **Finding:** The hook synchronously called `getNativeSurfaceState` in render, and `nativeSurfaceStateFrom` always allocated a fresh object and `occludingOverlayIds` array. Consumers that used the returned state in `useEffect`, `useMemo`, or `useCallback` dependency arrays would re-run on every parent re-render, even when occlusion had not changed. A naive `useMemo` with `[getNativeSurfaceState, id, owner, belowPlane, getRect]` did not work in this codebase because the overlay stack uses a `latestDescriptorRef` pattern: overlay descriptors are stored once and read through refs on subsequent renders, so the `overlays` array reference (and therefore `getNativeSurfaceState`) does not change when an overlay's rect or other mutable content changes.
- **Fix:** Compute the state every render so the latest ref-based overlay descriptor values are observed, but keep a `useRef` to the previous result and return the previous object when descriptor identity, occlusion flag, and `occludingOverlayIds` content are unchanged. This preserves referential stability for dependency arrays without breaking the ref-based content-update path.
- **Commit:** _(PR #467 round 1)_

### 32. `nativeSurfaceStates` snapshot freezes occlusion on geometry changes

- **Source:** github-claude + github-codex-connector | PR #467 round 2 | 2026-06-15
- **Severity:** MEDIUM / P2
- **File:** `src/features/workspace/overlays/OverlayStackProvider.tsx`
- **Finding:** Pre-aggregated `nativeSurfaceStates` was computed by a `useMemo` keyed on `[nativeSurfaces, overlays]`, which only update when descriptors are registered or unregistered. `useOverlayRegistration` stores a stable `getRect` callback that reads from `latestDescriptorRef`, so moving or resizing an already-open `intersects` overlay does not change the descriptor arrays. The snapshot therefore kept the occlusion values from the last registration moment and would silently expose stale `occluded`/`occludingOverlayIds` to any context consumer reading `nativeSurfaceStates`.
- **Fix:** Removed `nativeSurfaceStates` from `OverlayStackSnapshot` and the context value, leaving `getNativeSurfaceState(descriptor)` as the only public occlusion API. It evaluates the live `getRect` callbacks during each consumer's render, so geometry changes are always reflected. Added JSDoc explaining the design choice and updated the provider test to read live state via `getNativeSurfaceState` instead of the removed snapshot field.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 33. `occludingOverlayIds` order depends on Map insertion order, breaking referential stability after re-registration

- **Source:** github-codex-connector | PR #467 round 5 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/overlays/OverlayStackProvider.tsx` and `src/features/workspace/overlays/useNativeSurface.ts`
- **Finding:** `occludingOverlayIds` was derived by filtering `Array.from(overlayDescriptors.values())` and mapping to ids, preserving the underlying `Map` insertion order. `useOverlayRegistration` unregisters and re-registers an overlay whenever any of its logical descriptor fields change; a re-registered overlay moves to the tail of the `Map`, so a semantically identical set of occluders could produce a different positional array. `areOcclusionStatesEqual` compared ids positionally, so the reordering caused `useNativeSurface` to replace its cached `NativeSurfaceState` even though visibility had not changed, defeating the referential-stability contract.
- **Fix:** Sorted the `occludingOverlayIds` array alphabetically in `nativeSurfaceStateFrom` before returning the state. Added a regression test that registers two occluding overlays, re-registers one by changing a non-occlusion prop, and asserts the id order remains deterministic.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 34. Registered overlay descriptor exposes stale `isOpen`/`nativeOcclusion` for one frame

- **Source:** github-claude | PR #467 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/overlays/useOverlayRegistration.ts`
- **Finding:** `latestDescriptorRef.current` was updated during render, but the descriptor stored in the provider captured `isOpen` and `nativeOcclusion` from the previous effect registration. Between render and the layout-effect re-registration, `getNativeSurfaceState` read stale logical fields, producing a one-frame native-surface visibility error during overlay open/close or `nativeOcclusion` policy transitions.
- **Fix:** Changed the registered descriptor to read `isOpen`, `nativeOcclusion`, and `getRect` through `latestDescriptorRef.current` — `isOpen` and `nativeOcclusion` as getters and `getRect` as a callback — so the provider map always observes the latest render values before the effect re-registers.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 35. useNativeSurface: unconstrained useLayoutEffect causes layout reads every commit

- **Source:** github-claude | PR #474 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/workspace/overlays/useNativeSurface.ts`
- **Finding:** The dep-array-less `useLayoutEffect` (lines 78-92) runs after every React commit for every mounted `BrowserPane`. When an `'intersects'`-type overlay is open (pane-rename or workspace-banners), each commit calls `getBoundingClientRect()` on the overlay element (`document.querySelector(...)`) and on `contentRef.current`. During pane-rename, every keystroke is a commit, producing 2 forced layout reads per browser pane per keystroke. The `areOcclusionStatesEqual` guard correctly prevents render cascades, so only the reads accumulate. With multiple panes the reads are proportional. Fix: skip the re-check when no open `'intersects'` overlay is registered, reducing DOM reads to zero during the common `'global'`-only case.
- **Fix:** Added an early return in the post-commit useLayoutEffect when no open intersecting overlay is registered, eliminating layout reads in the global-only case.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 36. useNativeSurface: bare eslint-disable on unbounded effect lacks rationale

- **Source:** github-claude | PR #474 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/workspace/overlays/useNativeSurface.ts`
- **Finding:** The second `useLayoutEffect` captures `overlays`, `getNativeSurfaceState`, `id`, `owner`, `belowPlane`, and `getRect` but lists no deps so it runs after every commit. The `// eslint-disable-next-line react-hooks/exhaustive-deps` suppresses the warning without naming which variables are deliberately unlisted or why each is safe.
- **Fix:** Extended the suppress comment to name the stable refs (`overlays/getNativeSurfaceState/getRect`) and explain that the effect must run every commit for rect re-evaluation.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 37. `checkSelectedFile` existence probe re-runs on every git-watch poll

- **Source:** github-claude | PR #510 round 5 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The `checkSelectedFile` effect in `WorkspaceView.tsx` listed `gitStatus.files` and `gitStatus.filesCwd` in its dependency array. With `watch: true`, `useGitStatus` emits a fresh `files` array reference on every poll, so the effect re-ran continuously even when nothing about the open file had changed. Each run reset `selectedEditorFileExists` to `null` and called `fileSystemService.readFile(editorBuffer.filePath)`, repeatedly transferring full file contents over IPC and transiently clearing the `DELETED` crumb state for deleted untracked buffers.
- **Fix:** Introduced `buildSelectedFileGitKey` in `editorFileLifecycleStatus.ts` to derive a stable primitive key from the selected file's path, git cwd, repo root, and matching `ChangedFile` status/staging. The `checkSelectedFile` effect now depends on that key instead of the raw arrays, so the probe only runs when the selected file's relevant git state actually changes.

### 38. Ref mutation + store write inside setStatus updater breaks React StrictMode

- **Source:** github-claude | PR #456 round 1 | 2026-06-15
- **Severity:** HIGH
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** `seenToolUseIdsRef.current.has/add` and `writeStatusSeenToolUseIds` were called inside the functional `setStatus` updater. React 18 StrictMode double-invokes state updaters with the same `prev` in development, so the first invocation mutated the ref and the second invocation treated the legitimate tool call as a duplicate, returning `prev` unchanged.
- **Fix:** Hoisted the ref mutation and store write out of the updater into the listener closure before `setStatus`, capturing the `duplicate` boolean so both StrictMode invocations see the same value. The updater now only computes the next state from `prev`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 39. Move seen-tool ID writes out of the state updater

- **Source:** github-codex-connector | PR #456 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** The functional updater for tool-call completion state mutated `seenToolUseIdsRef` before computing the new state. Under React StrictMode the updater can run twice, so the second invocation saw the ID as already seen and dropped the completed tool call from counts and the recent-calls list.
- **Fix:** Same change as entry 37: computed the duplicate decision and persisted the seen set outside the updater, keeping the updater pure and StrictMode-safe.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 40. Fragile newline separator in effect dependency signature

- **Source:** github-claude | PR #459 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatusHotLoading.ts`
- **Finding:** `plannedPtyIds.join('\n')` and `.split('\n')` assumed PTY IDs never contain newlines. A future backend ID containing `\n` would split into phantom tokens and refresh wrong panes.
- **Fix:** Replaced the join/split signature with `JSON.stringify({ activePtyId, visiblePtyIds })` and parsed it inside the effect. JSON escapes any special characters, making the dependency string robust.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 41. Hook pre-plans then coordinator re-plans

- **Source:** github-claude | PR #459 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useAgentStatusHotLoading.ts`
- **Finding:** The hook called `planVisibleStatusRefreshes` to build a stable effect dep, then passed the planned IDs to `refreshVisibleAgentStatusPanes`, which called the same planner again. The double-planning is idempotent today but creates silent coupling if the algorithm evolves.
- **Fix:** Removed the hook's pre-planning; it now serializes the raw `{ activePtyId, visiblePtyIds }` request as the effect dep and lets the coordinator do all planning internally.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 42. Hot-loading scope should match SplitView visibility

- **Source:** github-codex-connector (P2) | PR #459 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `visibleAgentStatusPtyIds` was derived from every shell pane in the active session, so hidden panes still received prefetches and warm snapshots after shrinking to a lower-capacity layout. The background-work boundary diverged from the UI visibility boundary.
- **Fix:** Replaced the all-panes filter with `selectVisiblePanes(session.panes, LAYOUTS[session.layout].capacity)` so hot-loading targets exactly the panes rendered by `SplitView`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 43. Scroll-anchor compensation inferred prepend from list length

- **Source:** github-claude + github-codex-connector (P2) | PR #464 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- **Finding:** The prepend detector compared `feedEvents.length` to a stored count. When the capped activity feed replaced its oldest row (total length unchanged) or appended rows at the bottom, the detector produced false negatives/positives. The compensation amount also relied on total `scrollHeight` growth, which is zero when an equal-height row drops off the bottom.
- **Fix:** Replaced the count heuristic with first-event identity (`feedEvents[0]?.id`). Measured the new first row's `offsetHeight` with `CSS.escape` and used it as the compensation delta, falling back to `scrollHeightDelta` when the row is not rendered.
- **Commit:** see `git blame` / `git log` on this line

### 44. Batch prepends compensated by only the first inserted row height

- **Source:** github-codex-connector (P2) | PR #464 round 2 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- **Finding:** The round-1 fix computed `prependDelta = firstRowHeight > 0 ? firstRowHeight : scrollHeightDelta`. When hot-loading delivered multiple new activity rows in one snapshot, the viewport adjusted by one row instead of the total inserted height, causing visible content jump and undermining scroll-stability.
- **Fix:** Prefer total positive `scrollHeightDelta` for growing prepends and fall back to the measured first-row height only when the container does not grow. Added a regression test that stubs `offsetHeight` to a single-row value while growing `scrollHeight` by several rows' worth, asserting the viewport compensates by the full delta.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 45. quad layout: two useSplitDivider instances for same boundary cause render loop

- **Source:** github-claude | PR #526 round 1 | 2026-06-18
- **Severity:** HIGH
- **File:** `src/features/terminal/components/SplitView/SplitDividers.tsx` L69-94
- **Finding:** `DIVIDER_SPECS.quad` registered `vdiv0` and `vdiv1` as separate specs with the same `{ trackAxis: 'cols', trackIndex: 0 }`. Each spec rendered its own `SplitDividerHandle`, so two independent `useSplitDivider` instances controlled the same boundary. `useElasticContainer` captures `initialPercent` at mount, so the non-dragged segment kept a stale 50/50 size; after a drag committed, the sibling's commit effect wrote the old ratio back, creating an oscillating `setState` loop.
- **Fix:** Replaced the two per-segment specs with a single `vcol` spec whose `gridAreas: ['vdiv0', 'vdiv1']` renders both DOM segments from one shared `useSplitDivider` binding.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 46. Share the quad column divider binding

- **Source:** github-codex-connector (P2) | PR #526 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitDividers.tsx` L92
- **Finding:** The second vertical segment in the `quad` layout created another `useSplitDivider` for the same `cols` boundary instead of sharing the first segment's binding. Dragging one segment updated `initialRatios` while the sibling's committed `size` remained at the old 50/50 value, so its commit effect snapped the column split back.
- **Fix:** Collapsed both vertical segments into one `DividerHandleSpec` with `gridAreas: ['vdiv0', 'vdiv1']` rendered from a single binding.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 47. Remount divider handles on layout changes

- **Source:** github-codex-connector (P2) | PR #526 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitDividers.tsx` L154
- **Finding:** Handles reused the same `spec.id` key across layouts (e.g. `hdiv` in `hsplit`/`threeRight`/`quad`, `vdiv` in `vsplit`/`threeRight`). Because `useElasticContainer` captures `initialPercent` at mount, switching layouts reused the existing instance and its old pixel size, which the commit effect then stored into the new layout's ratio.
- **Fix:** Scoped the `SplitDividerHandle` key to the current layout with `key={`${layout}-${spec.id}`}`, forcing a remount and fresh mount-time state on every layout change.

### 48. Duplicate divider bindings write conflicting CSS vars for the same logical boundary

- **Source:** github-codex-connector | PR #528 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitDividers.tsx`
- **Finding:** In `quad` and `grid3x2` layouts, two visual divider segments represent the same logical column boundary (`trackAxis: 'cols'`, same `trackIndex`). Each segment created its own `useSplitDivider` instance, and each instance's commit-size effect wrote the same `--split-cols-*` CSS variables. Dragging one segment updated parent state, but the untouched segment's effect re-ran with its stale `size` and overwrote the live ratio, making the resize snap back or become inconsistent.
- **Fix:** Group divider specs by `(trackAxis, trackIndex)` and create exactly one `useSplitDivider` binding per logical boundary. Render every visual segment in the group from that shared binding so all handles read the same live `size` and no two effects compete for the same CSS vars.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 49. Unstable `initialRatios` dependency recreates `writeRatio` and triggers sibling divider feedback loop

- **Source:** github-claude | PR #528 round 2 | 2026-06-18
- **Severity:** HIGH
- **File:** `src/features/terminal/components/SplitView/useSplitDivider.ts` L58-78
- **Finding:** `writeRatio` listed `initialRatios` in its `useCallback` deps. In `quad` and `grid3x2` layouts, sibling dividers on the same axis share the axis ratios; committing one divider created a new `ratios` array reference, which was passed as `initialRatios` to all sibling handles. Each sibling's `writeRatio` was recreated, firing its commit effect with a stale `size` from `useElasticContainer`, producing wrong track weights and an infinite state oscillation that ended in React's "Maximum update depth exceeded" crash.
- **Fix:** Store `initialRatios` in a ref (`initialRatiosRef`) updated synchronously during render, and read `initialRatiosRef.current` inside `writeRatio`. Removed `initialRatios` from the `useCallback` deps so `writeRatio` stays stable across sibling commits.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 50. Conditional child unmount leaves parent state stale

- **Source:** github-claude, github-codex-connector | PR #535 round 1 | 2026-06-18
- **Severity:** LOW / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx` L2365-2379
- **Finding:** `LayoutDisplayMenu` is rendered only when `activeSession` exists. If the active session closes while the menu is open, the menu unmounts without `MenuRoot` calling `onOpenChange(false)`, leaving `isLayoutDisplayMenuOpen` stuck `true`. On macOS this permanently removes `vf-app-drag-region` from the top chrome, making the title bar undraggable until the menu is mounted and closed again.
- **Fix:** Added a `useEffect` in `WorkspaceView` that resets `isLayoutDisplayMenuOpen` to `false` whenever `activeSession` becomes `undefined`, restoring the drag region when the menu unmounts. Added a regression test that removes the active session while the menu is open and asserts the drag region returns.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 51. Unstable `customPaneLayouts` default invalidates `useMemo` on every render

- **Source:** github-claude | PR #542 round 1 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/usePushWorkspaceGrouping.ts` L124-134
- **Finding:** The destructuring default `customPaneLayouts = []` created a new array every time callers omitted the option. Because `customPaneLayouts` was listed in the `useMemo` dependency array, the workspace shape and its structural JSON signature were recomputed on every render even when the semantic input had not changed.
- **Fix:** Introduced a module-scope `EMPTY_CUSTOM_PANE_LAYOUTS: readonly PaneLayoutDefinition[] = []` constant and used it as the destructuring default. The array reference is now stable across renders, so omitted layouts no longer trigger `buildWorkspaceShape` and `structuralSignature` recomputation.
- **Commit:** same commit as this entry

### 52. LayoutSwitcher rebuilds layout lookup Map on every render

- **Source:** github-claude | PR #546 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx` L33-37
- **Finding:** `LayoutSwitcher` created `const layoutById = new Map(layouts.map(...))` and `const layoutIds = layouts.map(...)` on every render. Because the component re-renders on every active-session change, fresh Map and array references prevented any downstream `React.memo` or `useMemo` that depended on those identities from firing.
- **Fix:** Wrapped both `layoutIds` and `layoutById` in `useMemo(() => ..., [layouts])` so the references stay stable across unrelated re-renders.
- **Commit:** same commit as this entry

### 53. Custom layout save/delete reads stale `customPaneLayouts` closure

- **Source:** github-claude | PR #569 round 1 | 2026-06-20
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx` L1265-1295
- **Finding:** `handleSaveCustomLayout` and `handleDeleteCustomLayout` called `setCustomPaneLayouts([...customPaneLayouts.filter(...), ...])`, reading `customPaneLayouts` from the `useCallback` closure. The deps array recreated the callback when the list changed, but concurrent or batched updates between renders could operate on a stale snapshot and silently drop an interleaved layout change.
- **Fix:** Switched both callbacks to the functional updater form `setCustomPaneLayouts(previous => ...)`. Also updated `useSessionManager`'s `setCustomPaneLayouts` wrapper to accept functional updaters and evaluate them inside the underlying `setCustomPaneLayoutsState` updater so the latest previous value is always used.
- **Commit:** same commit as this entry

### 54. `setSessions` called as a side effect inside a state updater

- **Source:** github-claude | PR #569 round 3 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts` L276-366
- **Finding:** `setCustomPaneLayouts` computed the preserved layouts and migrated sessions inside the `setCustomPaneLayoutsState` functional updater, calling `setSessions` from within that updater. React functional updaters must be pure and may be invoked more than once in Strict Mode or replayed under concurrent rendering, which could queue duplicate session transformations.
- **Fix:** Derived the next custom layout registry at top-level (using a `customPaneLayoutsRef` to read the current registry) and performed `setSessions` as a separate top-level functional update. The layout state still uses a direct `setCustomPaneLayoutsState(nextCustomLayouts)` call because the registry was already derived from the latest previous value.
- **Commit:** same commit as this entry

### 55. Open Dialog unmount leaves focus on document.body

- **Source:** github-claude | PR #548 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `src/components/Dialog.tsx` L183-204
- **Finding:** Focus restoration only ran when the controlled `open` prop transitioned from `true` to `false`. If a parent conditionally rendered `<Dialog open>` and removed the component while it was open, no cleanup restored the previously focused element, leaving keyboard focus on `document.body`.
- **Fix:** Added a dedicated `useEffect` with an empty dependency array whose cleanup restores `previousFocusRef.current` when `wasOpenRef.current` is true and `restoreFocus` is enabled. Captured `restoreFocus` in a ref so the cleanup closure sees the latest value. Added a co-located test that unmounts an open Dialog and asserts focus returns to the prior element.
- **Commit:** same commit as this entry

### 56. Per-instance document keydown listeners allow stacked dialogs to all process Escape

- **Source:** github-codex-connector | PR #548 round 2 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/components/Dialog.tsx` L220-250
- **Finding:** Each open `Dialog` registered its own `document.addEventListener('keydown', ...)` listener. When two or more dialogs were open, every instance processed the same `Escape` press, so pressing Escape could close the wrong layer or multiple layers at once. The same per-instance listener pattern also meant Tab focus-trapping ran in every open dialog, not just the topmost.
- **Fix:** Introduced a module-level LIFO `dialogStack` of open dialog layers. A single document listener reads the top layer on each `keydown`; Escape calls only the top layer's close handler and `stopImmediatePropagation()`, and Tab only traps focus inside the top layer's container. Each Dialog pushes its layer on open and removes it on close/unmount. Added regression tests covering (a) Escape closes only the topmost dialog, (b) Escape does not propagate to a lower dialog when the topmost is `dismissDisabled`, and (c) Escape does not propagate when the topmost has `closeOnEscape={false}`.
- **Commit:** same commit as this entry

### 57. Dialog layer registration reorders the stack on parent re-renders

- **Source:** github-codex-connector | PR #548 round 3 | 2026-06-19
- **Severity:** HIGH
- **File:** `src/components/Dialog.tsx` L266-291
- **Finding:** The layer-registration `useEffect` listed `requestClose` (which depends on `onOpenChange`) and `closeOnEscape` in its dependency array. Because parents often pass an inline `onOpenChange` callback, every parent re-render unregistered and re-registered an already-open lower dialog, pushing it to the top of the module-level `dialogStack`. In stacked modal use, Escape and Tab then targeted the background dialog instead of the visible top dialog.
- **Fix:** Captured `requestClose` and `closeOnEscape` in refs that are updated synchronously each render, and keyed the registration effect only to `open`. The layer's close handler now reads the latest ref values, so prop changes are honored without re-registering the layer and corrupting stack order. Added a regression test that re-renders a parent with two open dialogs and asserts Escape still closes only the topmost.
- **Commit:** same commit as this entry

### 58. Tool jar auto-fit effect re-ran on every count tick

- **Source:** github-claude | PR #576 round 1 | 2026-06-22
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/ToolCalls/ToolJarTile.tsx`
- **Finding:** The tile auto-fit `useLayoutEffect` depended on `data.count`, so every increment disconnected and recreated observers plus delayed measurement timers. The measured content width only changes when the count gains or loses a digit, making same-digit ticks unnecessary layout work.
- **Fix:** Derived `countDigits = String(data.count).length` and used that primitive in the dependency array. The effect still remeasures at digit boundaries and on tile size changes, but avoids churn for hot same-width count updates.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 59. Command palette active-row scroll used global document lookup

- **Source:** github-claude | PR #629 round 1 | 2026-06-27
- **Severity:** LOW
- **File:** `src/features/command-palette/components/CommandResults.tsx`
- **Finding:** `CommandResults` used `document.getElementById` inside an effect to find the selected option before calling `scrollIntoView`. That works for the current single palette instance, but it couples the scroll side effect to globally unique ids instead of the component's rendered subtree.
- **Fix:** Forwarded refs through `CommandResultItem`, stored row elements in a `CommandResults`-local ref map keyed by command id, and scrolled the selected row from that map. The option ids remain in place for ARIA, while the imperative scroll target is owned by React refs. Added a regression assertion that the scroll effect no longer calls `document.getElementById`.
- **Commit:** same commit as this entry
