---
id: react-lifecycle
category: react-patterns
created: 2026-04-09
last_updated: 2026-06-07
ref_count: 14
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
