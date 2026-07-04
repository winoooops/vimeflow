# Ghostty Burner Side Pane Spike

> Update: the follow-up discussion rejected consuming Vimeflow split-layout slots.
> The current direction is a nested per-pane burner inside the native Ghostty
> surface. See `HANDOFF.md`.

## Why This Exists

The old burner terminal is a React dialog containing the xterm `Body`. That cannot reliably sit above the native Ghostty `NSView`, and making it another overlay terminal repeats the native layering problem we just paid down.

The current Ghostty bridge gives Vimeflow one native Ghostty surface per React shell pane:

- `GhosttyBody` measures the React pane and sends bounds to Electron.
- `electron/ghostty-native-parent.ts` keys native surfaces by `sessionId:paneId`.
- `GhosttyElectronBridge.swift` creates one `TerminalView` plus one `InMemoryTerminalSession` per surface.
- PTY input/output still belongs to Vimeflow's backend; Ghostty only renders and captures terminal input.

The initial reliable fallback was a Vimeflow pane, not a floating popup. That
was later rejected because it changes the user's chosen layout.

## External Check

Ghostty the app supports native windows, tabs, and splits, but that is app-level UI. The Swift package we use exposes `TerminalView`, `TerminalController`, `TerminalSurfaceOptions`, and `InMemoryTerminalSession`; it does not expose a host-side "spawn split inside this terminal view" API in our current bridge. Sources checked:

- Ghostty feature docs: https://ghostty.org/docs/features
- GhosttyKit Swift package page: https://swiftpackageregistry.com/Lakr233/libghostty-spm
- libghostty roadmap notes: https://mitchellh.com/writing/libghostty-is-coming

## Options

### Option A: Vimeflow Side Pane, Rejected For Current Direction

Clicking the burner button creates or reveals a normal shell pane in the same Vimeflow session. The pane uses the existing Ghostty native renderer because it is just another `TerminalPane`.

Implementation shape:

- Reuse `useBurnerTerminals` lifecycle rules: ephemeral PTY, no agent bridge, cwd alignment, foreground cue, hide does not kill until we decide otherwise.
- Add a small pane marker, likely `pane.burnerHostPaneId?: string`, instead of a new renderer kind. It is still a shell pane.
- Add a session helper such as `openBurnerSidePane(target)` that:
  - spawns an ephemeral PTY at the target cwd,
  - appends a shell pane with the burner marker and restore data,
  - places it in the next slot, preferring a vertical side slot,
  - activates the burner pane or keeps focus on host depending on design.
- Header displays a compact `BURNER` chip and linked host info.
- Existing `SplitView` and native Ghostty surface creation do the layout and rendering.

Why this is the shortest good path:

- No new native split API.
- No overlay terminal.
- No second terminal renderer.
- Works with xterm fallback because it still uses `TerminalPane`.

### Option B: Native Overlay Terminal Window, Not Recommended

Render the burner terminal in the native overlay/menu `BrowserWindow`.

Rejected for v1:

- It is another terminal-over-terminal overlay.
- Focus, shortcuts, resize, and shutdown are harder than a pane.
- It keeps the UI split between React overlay rules and native Ghostty layer rules.

### Option C: True Ghostty Internal Split, Blocked

Ask Ghostty/libghostty to split inside one native surface.

Blocked for v1:

- Our bridge has no command for this.
- The current Swift package usage is one `TerminalView` per `InMemoryTerminalSession`.
- This would require upstream/package API discovery or a new native wrapper model.

### Option D: tmux/zellij Inside The Pane, Not Product UI

Run a terminal multiplexer inside the host PTY.

Rejected for product UX:

- It changes user shell state.
- It does not integrate with Vimeflow pane headers, status, cwd sync, or lifecycle.
- It is a user workaround, not our burner feature.

## Recommended Interaction

The burner button should become "open side burner".

When closed:

- Header action shows the existing terminal icon.
- Tooltip/copy: "Open side burner".

When side burner exists:

- Host header shows a small live cue: `BURNER x1`.
- Burner pane header shows `BURNER`, host pane title, cwd sync state, close/hide action.
- Status bar counts it as a burner, not as an agent pane.

When user clicks burner again:

- If side burner exists and is hidden by layout: reveal it.
- If visible: focus it.
- Killing should remain explicit through close for now.

## HTML Demo

Open:

```sh
open docs/exploration/2026-07-04-ghostty-burner-side-pane/index.html
```

The demo compares the three viable presentation directions and defaults to the recommended side-pane model.

## Claude Design Prompt Draft

Use this if we choose Option A:

```text
Design the Vimeflow Ghostty burner terminal as an in-canvas side pane, not a floating dialog.

Context:
- Vimeflow owns the multi-pane layout in React.
- Ghostty renders one native terminal surface per Vimeflow shell pane.
- The burner is an ephemeral shell linked to a host pane. It should feel temporary, fast, and lower-commitment than an agent pane, but it must still be a real pane so it appears above/inside the Ghostty-native canvas correctly.
- Existing visual language: compact terminal pane headers, monospace labels, theme tokens, no heavy borders, tonal depth, shell accent for burner state.

Please design:
1. The host pane header when a burner side pane is available/running.
2. The burner side pane header.
3. The split layout behavior when the burner opens from a single pane and when it opens from an existing split layout.
4. The close/hide affordance and cwd sync cue.
5. Empty, running, and exited burner states.

Constraints:
- No modal popup.
- No React overlay terminal.
- No separate AppKit menu UI.
- Keep the top header compact.
- Prefer a right-side vertical burner pane unless the current layout makes a bottom pane clearly better.
- Make the burner visually distinct but not as important as an agent pane.

Deliver a concise visual spec with spacing, labels, state changes, and interaction notes.
```
