# Ghostty Split API Exploration — Burner as a Nested Native Pane

2026-07-03 · Package under test: `Lakr233/libghostty-spm` **1.2.7** (rev `2b0e1b9d`, pinned by `native/ghostty-helper/Package.resolved`, source materialized at `/tmp/libghostty-spm-src`) · Markdown mirror of `ghostty-split-api-technical-note.html` (bilingual); this file is the review handoff for codex.

## Verdict

- **Option A (Ghostty-internal split) is dead.** libghostty-spm exposes no host-controllable split API, and recompiling cannot restore one — the split layout engine was never in the library (see Addendum).
- **Option B (two TerminalViews, host-owned layout) is viable.** Two independent `TerminalView` + `InMemoryTerminalSession` pairs coexist safely inside one `EmbeddedGhosttySurface` NSView — provided **each gets its own `TerminalController`**.

## Q1 — No split API in the package

The only split-related public symbol is `TerminalSurfaceContext.split` (`Sources/GhosttyTerminal/Surface/TerminalSurfaceContext.swift:8`) → `GHOSTTY_SURFACE_CONTEXT_SPLIT`, a **creation-time hint** to the VT engine (key-binding routing). It does not make Ghostty own a split layout. `TerminalView`/`AppTerminalView`, `TerminalController`, `TerminalSurface`, `InMemoryTerminalSession`, `TerminalViewState`, `TerminalSurfaceView` — none expose pane/layout APIs. The package builds upstream Ghostty with `zig build -Dapp-runtime=none` (`Script/build-ghostty.sh:62-64`).

## Addendum — Recompiling doesn't help (verified upstream v1.2.3)

Everything split-related in the **full** `include/ghostty.h` (the untrimmed API real Ghostty.app links) is an *action*: `GHOSTTY_ACTION_NEW_SPLIT` / `GOTO_SPLIT` / `RESIZE_SPLIT` / `EQUALIZE_SPLITS` / `TOGGLE_SPLIT_ZOOM` plus four functions like `ghostty_surface_split()`. In the core:

```zig
// upstream src/apprt/embedded.zig:1843 (v1.2.3)
export fn ghostty_surface_split(ptr: *Surface, direction: apprt.action.SplitDirection) void {
    _ = ptr.app.performAction(.{ .surface = &ptr.core_surface }, .new_split, direction) catch ...
}
```

It fires `.new_split` **back out to the host's action callback**. The core never lays out two surfaces (one surface = one view = one Metal layer). The actual split engine (`SplitTree.swift`, surface arrangement, dividers, focus traversal) is Swift **application source** under `macos/` in the ghostty repo — not library code behind any build flag. **Option B is not a workaround; it is the same role Ghostty.app itself plays**, with the split tree capped at two children.

## Q2 — Two-TerminalView coexistence constraints

| Constraint | Evidence | Impact |
|---|---|---|
| **One `TerminalController` per view** (BLOCKING) | `TerminalController.swift:59-60`, `TerminalSurfaceCoordinator.swift:138` | `onWakeup`/`shouldProcessWakeup` are single-slot closures; `rebuildIfReady()` overwrites them — a shared controller silences the earlier view's render loop. |
| Avoid `TerminalController.shared` | `TerminalController.swift:46` | Convenience singleton; naive use triggers the constraint above. |
| Process-global init/rendering (SAFE) | `TerminalController.swift:300`, `AppTerminalView.swift:13` | `ghostty_init` one-shot guarded; per-controller `ghostty_app_t`; per-view `CAMetalLayer`; per-coordinator main-queue tick, no shared display link. |

Vimeflow already follows the pattern: `EmbeddedGhosttySurface` uses `private lazy var controller = TerminalController()` (`GhosttyElectronBridge.swift:201`).

## Codex verification — round 1 (split-API verdict)

`agrees = true`. Two refinements: (1) tick pump is per-coordinator (MSDisplayLink imported but never shared); (2) `retainedBridges` (`TerminalController+Config.swift:64`) lets one controller fan out config updates to multiple surfaces — does not lift the single-slot wakeup constraint.

## Codex verification — round 2 (risks + spike order)

Adversarial pass over the Risks and Spike order sections against the actual code. Verdicts: R2/R4/R6 **confirmed**; R1/R3/R5 **incomplete** — corrections folded into the risk list below. Codex surfaced **four missing HIGH risks** (R7–R10 below) and a refined spike order (folded into "Spike order").

## Change map (Option B)

Pipeline: `GhosttyBody.tsx` → `nativeGhosttyClient.ts` → `preload.ts` → `electron/ghostty-native-parent.ts` (surfaces keyed `` `${sessionId}:${paneId}` ``) → `native/ghostty-parent/ghostty_native_parent.cc` (N-API, tsfns) → `GhosttyElectronBridge.swift` (`EmbeddedGhosttySurface`: container NSView + TerminalView + InMemoryTerminalSession).

Identity: `sessionId` = ptyId (NOT the layout session id — `GhosttyBody.tsx:193`). Burner adds `childId: 'primary' | 'burner'` + `burnerPtyId`. The main-process paneKey must **not** include `childId` (burner shares its parent's surface state entry).

Ordered minimal plan (native-first):

1. **Swift `GhosttyElectronBridge.swift`** — optional `burnerTerminalView`/`burnerSession`/`burnerCallbacks` (own `TerminalController` each); `enum BurnerPlacement { right, bottom }`; `layoutChildren()` splitting `container.bounds` by ratio, called from `setFrame`; new `@_cdecl` exports `vimeflow_ghostty_add_burner_child` / `remove_burner_child` / `write_burner` / `focus_burner`; fix `shortcutMonitor.handleKeyDown` (line 441) to match firstResponder against either view.
2. **N-API `ghostty_native_parent.cc`** — load the 4 new dylib symbols in `EnsureBridge()`; `BurnerContext` struct with its own tsfns (input/resize/focus), separate from the primary `SurfaceHandle` for independent teardown; `AddBurnerChild`/`RemoveBurnerChild`/`WriteBurner`/`FocusBurner`; extend `ReleaseSurfaceCallbacks` to drain burner tsfns.
3. **`electron/ghostty-native-channels.ts`** — add `GHOSTTY_NATIVE_ADD_BURNER` / `GHOSTTY_NATIVE_REMOVE_BURNER`; write/focus/destroy reuse existing channels with a `childId` field.
4. **`electron/ghostty-native-shared.ts`** — `childId?: 'primary' | 'burner'` on `GhosttyNativePaneRequest`; new `GhosttyNativeAddBurnerRequest { burnerPtyId, placement, ratio }`.
5. **`electron/ghostty-native-parent.ts`** — `GhosttyNativeSurfaceState.burnerPtyId`; add/remove IPC handlers; `sendData`/`focus` branch on `childId`; burner `onInput`/`onResize` route `write_pty`/`resize_pty` with **`burnerPtyId`**; `destroySurface` also removes the burner child.
6. **`electron/preload.ts`** — expose `addBurnerChild`/`removeBurnerChild` invokes.
7. **`src/features/terminal/nativeGhosttyClient.ts`** — `childId` on `NativeGhosttyPaneRef`; `NativeGhosttyAddBurnerRequest`; helpers per the existing enabled/disabled-sentinel pattern.
8. **React `GhosttyBody.tsx` + `useBurnerTerminals.ts`** — `childId` prop threaded into `paneRef` and the `ghostty-native-input`/`-focus` event filters (lines 574-634); the hook's `renderNode` popup block (lines 537-575) replaced by native attach/detach calls from `show()`/`hide()`.

Keep: the entire `useBurnerTerminals` PTY state machine (ephemeral spawn, `paneKey`, show/toggle/hide, cwd align VIM-81, OSC 7 tracking, foreground cue VIM-71, self-exit VIM-62, reconcile/kill, boot reap, `Mod+; \`` chord, header signals). Retire: `BurnerTerminalPopup/index.tsx` in full; the hook's `renderNode` block; `{burnerTerminalNode}` at `WorkspaceView.tsx:3031`; re-evaluate the `burnerTerminalOpen` occlusion registration (`WorkspaceView.tsx:2541-2545`).

## Risks, ranked (verified by codex round 2)

- **R1 (HIGH) — PTY identity mis-routing.** The burner's `onInput` must call `write_pty` with `burnerPtyId`, never `state.pane.sessionId` — otherwise burner keystrokes are injected into the primary (agent) PTY. Codex round 2: `resize_pty` shares the same identity path (`electron/ghostty-native-parent.ts:518-525`) — route **both** write and resize through the burner context. Mitigation: separate callback context (`BurnerContext`) end-to-end; integration test typing into the burner asserting the primary PTY saw nothing.
- **R2 (HIGH) — Teardown ordering.** `GhosttyBody` unmount cleanup calls destroy unconditionally (line 691). A burner destroy with missing/misrouted `childId` must map to `removeBurnerChild`, never `destroySurface` — or the still-live primary dies. Mitigation: main-process branch on `childId` with default-deny for surfaces that have a burner.
- **R3 (HIGH) — Shortcut/focus gating.** The window-level `shortcutMonitor` checks firstResponder against the primary view only (Swift:441-453; digits guard :475-480 — corrected by codex round 2). With the burner focused, Cmd+digit pane-switching is silently swallowed; key routing can drop events. The context menu is also primary-only (Swift:425-438), and Electron emits rename with `state.pane` (`ghostty-native-parent.ts:574-577`) — rename/context callbacks must carry child identity. Mitigation: extend every firstResponder check to "descendant of primary or burner view"; same for the context-menu monitor.
- **R4 (MED) — Split-geometry divergence.** Two renderer-driven `update` paths plus the 120 ms resize quiet window (`NATIVE_RESIZE_TRACKING_QUIET_MS`, `GhosttyBody.tsx:68`) can briefly disagree → gap/overlap; overlapping sibling NSViews break hit-testing. Mitigation: **let Swift own the split** — one bounds source (the existing per-pane `update`), `layoutChildren()` computes both integer-rounded sub-rects; also satisfies the "nested divider must be native/AppKit" requirement.
- **R5 (MED) — Pending-data race.** Main buffers PTY output in `pendingData` when no surface exists yet (`ghostty-native-parent.ts:367-377`, flush at `:643-655`); the burner needs equivalent buffering between its PTY spawn and `addBurnerChild` arrival. Codex round 2: the renderer's `registerPending` buffer drains only when a mounted Body calls `onPaneReady` (`usePtyBufferDrain.ts:60-78`, `BurnerTerminalPopup/index.tsx:365-374`) — with the popup gone, the burner needs a new drain owner (see R7).
- **R6 (LOW) — tsfn lifecycle leak.** If `BurnerContext` holds its own tsfns, the primary `SurfaceHandle` finalizer must also release them (release sites today: `ReleaseSurfaceCallbacks` `ghostty_native_parent.cc:378-418`, explicit destroy `:590-599`, finalizer `:363-375`). Mitigation: drain burner tsfns in both `RemoveBurnerChild` and `ReleaseSurfaceCallbacks`/`FinalizeSurface`.

Added by codex round 2:

- **R7 (HIGH) — Burner output has no subscriber.** Native output forwarding is owned by the mounted `GhosttyBody` (`GhosttyBody.tsx:637-657`) — a role the popup Body currently plays for the burner (`useBurnerTerminals.ts:537-574`). Retiring the popup without a replacement leaves burner PTY output going nowhere. Mitigation: a forwarder owned by `useBurnerTerminals` on native attach — `service.onData(burnerPtyId)` → `sendNativeGhosttyData(childId: 'burner')` — draining the `registerPending` buffer into it.
- **R8 (HIGH) — Hide must not become destructive.** Today `hide()` keeps the popup Body mounted (`display:none`), so shell + scrollback survive. The library frees surface state on coordinator teardown (`TerminalSurfaceCoordinator.swift:311-323`, though `AppTerminalView` survives plain window detach — `AppTerminalView+Lifecycle.swift:52-67`, `:96-99`). Implementing native hide as remove/destroy kills scrollback. Mitigation: hide = AppKit `isHidden` on the burner view (view + session alive); `removeBurnerChild` reserved for kill.
- **R9 (HIGH) — Callback-context use-after-free.** Swift's `CallbackBox` holds the raw C++ context pointer (`GhosttyElectronBridge.swift:75-82`) and invokes it on input/resize (`:101-119`); C++ casts it back in the trampolines (`ghostty_native_parent.cc:177-184`). Freeing the `BurnerContext` before the Swift child is destroyed is a UAF, not just a leak. Mitigation: `RemoveBurnerChild` destroys the Swift child first, then releases tsfns/context; mirror the primary's atomic `released` flag.
- **R10 (HIGH) — Child frames in the wrong coordinate space.** `setFrame` y-flips renderer coordinates via `parentHeight` for the container (`GhosttyElectronBridge.swift:261-275`); the primary then fills `container.bounds` (`:277`). Child sub-rects must be computed in the container's *local* bounds — a second parent-height y-flip misplaces the burner. Mitigation: `layoutChildren()` computes sub-rects purely from `container.bounds`.

## Spike order (revised per codex round 2)

1. **Swift-only spike first**: extend `GhosttyNativeMacosSmoke` (today it proves exactly one `TerminalView` — `GhosttyNativeMacosSmoke.swift:121-135`) to exercise **add/remove of a second view with its own controller**, plus hide-vs-remove semantics — proves rendering, focus, input isolation, and scrollback survival before touching any IPC.
2. **C++ N-API next, with its smoke**: new symbols/contexts/finalizers in `ghostty_native_parent.cc` (exports today are only the old five — `:604-619`), updating `scripts/smoke-ghostty-native-parent.js` (currently checks only create/setFrame/write/focus/destroy — `:14-28`) **before** any Electron work. Build/codesign pipeline already exists (`scripts/build-ghostty-native-parent.js:43-88`).
3. Then Electron main (childId routing, burner output forwarding, pending-buffer tests) → preload/native client → React hook swap — keeping the `useBurnerTerminals` PTY lifecycle untouched, replacing only the presentation layer. No Rust bindings regen unless Rust command/types change.
4. Remaining open questions are design, not feasibility: focus-on-open policy, close-vs-hide semantics, user-toggleable placement.
