# Ghostty Burner Nested Pane Handoff

Product baseline: built-in native Ghostty via `libghostty-spm` has shipped as
the packaged macOS terminal backbone. This handoff only covers the follow-up
burner terminal nested inside that surface; it does not revisit the base
terminal renderer choice.

## Current Decision

The burner terminal should not consume Vimeflow split-layout slots.

The old burner popup cannot reliably work above native Ghostty, but turning the burner into a normal Vimeflow pane would break user layouts. A user with six panes could accidentally create six more burner panes, which defeats the point of a temporary per-pane shell.

The target model is:

```text
Vimeflow TerminalPane
└─ AppKit EmbeddedGhosttySurface
   ├─ primary shell
   └─ optional burner shell, max 1
```

The burner is nested inside the host terminal pane. It is not a global Vimeflow pane, not a React popup, and not another BrowserWindow overlay.

## Architecture Question

There are two possible native implementations:

### Preferred If Exposed: One Ghostty Instance With Two Ghostty Panes

```text
EmbeddedGhosttySurface
└─ one Ghostty terminal/surface/controller
   ├─ primary Ghostty pane
   └─ burner Ghostty pane
```

This is cleaner because Ghostty would own focus, layout, and terminal-pane rendering internally. Vimeflow would send higher-level commands:

- `openBurner`
- `writePrimary`
- `writeBurner`
- `focusPrimary`
- `focusBurner`
- `closeBurner`

Blocker: our current `GhosttyTerminal` usage exposes one `TerminalView` with one `InMemoryTerminalSession`. We have not found a split-pane API exposed through the current Swift package/bridge.

### Fallback If No Ghostty Split API: One AppKit Wrapper With Two TerminalViews

```text
EmbeddedGhosttySurface
├─ primary TerminalView + primary InMemoryTerminalSession
└─ optional burner TerminalView + burner InMemoryTerminalSession
```

This still keeps the burner nested inside the pane and above React, but Vimeflow/AppKit owns the tiny two-child layout. Keep this deliberately small:

- max two terminal children total
- primary plus optional burner only
- right split by default
- bottom split only for narrow host panes
- no recursive pane tree
- no arbitrary layout engine

## Why Existing Paths Are Rejected

- **React popup:** hidden under Ghostty native `NSView`.
- **Native BrowserWindow overlay with xterm:** repeats focus/shutdown/z-order complexity and still gives us a second terminal UI path.
- **Normal Vimeflow split pane:** pollutes the user's layout and scales badly when every pane can have a burner.
- **tmux/zellij inside the user's PTY:** mutates user shell state and does not integrate with Vimeflow lifecycle, cwd sync, headers, or status.

## Current Code To Read

- `src/features/terminal/hooks/useBurnerTerminals.ts`
  - owns existing ephemeral PTY lifecycle, cwd align, foreground cue, and hide-vs-kill behavior.
- `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
  - old popup presentation to retire for Ghostty.
- `src/features/terminal/components/TerminalPane/GhosttyBody.tsx`
  - React-to-native bounds, output forwarding, native frame lifecycle.
- `src/features/terminal/nativeGhosttyClient.ts`
  - renderer API shape for native Ghostty update/data/focus/destroy.
- `electron/ghostty-native-parent.ts`
  - one native surface per `sessionId:paneId`, PTY input/resize/focus routing.
- `native/ghostty-helper/Sources/GhosttyElectronBridge/GhosttyElectronBridge.swift`
  - `EmbeddedGhosttySurface`, currently one `TerminalView` and one `InMemoryTerminalSession`.
- `native/ghostty-parent/ghostty_native_parent.cc`
  - C/N-API bridge. Will need child routing if we add burner inside the surface.

## Next Experiment

1. Inspect `libghostty-spm`/`GhosttyTerminal` source for any real host-controlled split-pane API.
2. If such API exists, spike one `EmbeddedGhosttySurface` with primary plus burner internal Ghostty panes.
3. If not, spike the fallback: two `TerminalView`s inside one `EmbeddedGhosttySurface`.
4. Keep current burner PTY lifecycle, but stop rendering `BurnerTerminalPopup` in native Ghostty mode.
5. Add routing IDs for terminal child:

```ts
type GhosttyChild = 'primary' | 'burner'
```

Then route:

- native input -> `write_pty` for the matching PTY id
- native resize -> `resize_pty` for the matching PTY id
- app output -> primary or burner `receive`
- focus events -> active child state

## Minimal API Shape To Spike

Renderer to Electron:

```ts
interface NativeGhosttyPaneRef {
  sessionId: string
  paneId: string
}

interface NativeGhosttyBurnerAttachRequest extends NativeGhosttyPaneRef {
  burnerSessionId: string
  cwd: string
  placement: 'right' | 'bottom'
}
```

Native bridge concepts:

```swift
enum GhosttyChild {
    case primary
    case burner
}
```

Do not add arbitrary child counts or layout trees in the spike.

## UI State Needed

Host header:

- small `BURNER` cue when burner exists
- running foreground cue when burner has active command
- no layout-slot count changes

Nested burner header/chrome:

- compact `BURNER` identity
- linked host pane title or cwd
- sync cwd action
- close/hide action

Terminal area:

- primary remains dominant
- burner is visibly secondary
- nested divider must be native/AppKit, not React over the Ghostty pixels

## Resolved 2026-07-03: No Ghostty Split API — Fallback Is the Path

Source inspection of `libghostty-spm` 1.2.7 (rev `2b0e1b9d`), independently re-verified with `codex exec`. Full findings, change map, and risks: [`ghostty-split-api-technical-note.html`](./ghostty-split-api-technical-note.html) (bilingual EN/中文).

- **No host-controllable split API exists.** `TerminalSurfaceContext.split` is only a surface-creation hint (`GHOSTTY_SURFACE_CONTEXT_SPLIT`, key-binding routing). Ghostty's real split machinery (SplitTree etc.) lives in the app runtime layer, which the package compiles out (`-Dapp-runtime=none`). The "Preferred If Exposed" option is dead, not pending.
- **Recompiling cannot restore it** (verified against upstream ghostty v1.2.3). The full embedded C API's split surface is action-request plumbing only: `ghostty_surface_split()` just fires `.new_split` back out to the host's action callback (`src/apprt/embedded.zig:1843`); the actual split engine (`SplitTree.swift`, surface arrangement) is Swift application source under `macos/` — not library code behind any build flag. Hosting two views is the same role Ghostty.app itself plays, so the fallback is architecturally faithful, not a workaround.
- **The fallback (two `TerminalView`s in one `EmbeddedGhosttySurface`) is confirmed viable**, with one hard rule: each `TerminalView` needs its **own `TerminalController`** — `onWakeup`/`shouldProcessWakeup` are single-slot closures, so a shared controller silences the earlier view. `EmbeddedGhosttySurface` already creates a per-surface controller (`GhosttyElectronBridge.swift:201`), so the burner just adds a second controller + view + session.
- Recommended spike order: Swift-only second `TerminalView` in `GhosttyNativeMacosSmoke` first, then bridge/N-API/IPC per the change plan in the technical note.

## Implementation Status

- **Milestone 1: Swift-only smoke is complete.** `ghostty-native-macos-smoke` can show, hide, remove, and resize a second native `TerminalView` inside one container. The smoke keeps the child role generic as `secondary`, even though the first product use is the burner.
- **Milestone 2: Native bridge API is in progress.** `GhosttyElectronBridge` now owns an optional secondary child inside `EmbeddedGhosttySurface`, with a separate `TerminalController`, `InMemoryTerminalSession`, input callback, resize callback, focus callback, and AppKit divider. The C++ addon exposes `addSecondary`, `setSecondaryVisible`, `writeSecondary`, `focusSecondary`, and `removeSecondary`; the native-parent smoke checks those exports.
- **Next: Electron and renderer wiring.** Add child-aware IPC and renderer calls so product code can attach the burner PTY to the secondary native child. This must preserve hide-vs-remove semantics and route burner input/resize/output by the burner PTY id, never by the primary pane session id.

## Open Questions

- Should opening burner focus the burner immediately or keep focus in primary until user clicks it?
- Should close kill the burner PTY, or should close hide and a separate action kill?
- Should placement be automatic only, or user-toggleable right/bottom?

## Updated Claude Design Prompt

```text
Design Vimeflow's Ghostty burner terminal as a nested per-pane terminal, not a React popup and not a Vimeflow layout pane.

Architecture:
- Each Vimeflow TerminalPane owns one native AppKit EmbeddedGhosttySurface.
- That surface contains the primary terminal and, optionally, one burner terminal.
- The burner is an ephemeral shell linked to the host pane.
- It must not consume the user's global Vimeflow split layout slots.
- It must visually feel temporary and secondary while still being a real terminal.

Please design:
1. Host pane header when a burner exists, is focused, is running, or is idle.
2. The nested burner strip/header/chrome inside the terminal pane.
3. Right-side vs bottom nested placement behavior.
4. Cwd sync, close/hide, and foreground-running cues.
5. Narrow pane behavior.

Constraints:
- Max one burner per host pane.
- No modal popup.
- No BrowserWindow overlay.
- No global Vimeflow pane insertion.
- No arbitrary nested layout tree.
- Keep the main pane header compact.
- Use existing Vimeflow theme tokens and shell accent.

Deliver a concise visual spec with states, spacing, labels, and interaction notes.
```
