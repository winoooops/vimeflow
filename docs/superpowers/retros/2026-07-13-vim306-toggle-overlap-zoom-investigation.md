# VIM-306: Sidebar-Toggle / Traffic-Light Overlap Investigation Retrospective

## TL;DR

The packaged macOS build showed the sidebar toggle **overlapping** the native
traffic-light buttons; dev was always fine. After chasing three plausible
code-level theories to dead ends, the real cause turned out to be **runtime
profile state, not code**: a persisted Chromium **per-origin page zoom of
`-0.5` (~91%)** on the `app://` origin. The toggle is DOM (`left: 82px`) so it
scales with page zoom (`≈ 75px`); the native traffic lights are OS-drawn at
`x:16` and do **not** zoom — so at <100% they collide. The app had no in-app
zoom reset, so a stray `Cmd+-` / pinch got stuck permanently.

Fix (`electron/main.ts`, 10 lines): this window is an app shell, not a
zoomable page — lock zoom to 100% on every load (which also clears the
already-persisted value) and disable pinch-zoom.

```js
void win.webContents.setVisualZoomLevelLimits(1, 1)
win.webContents.on('did-finish-load', () => {
  win.webContents.setZoomLevel(0)
})
```

## What worked

### Diagnostics that were deliberately not the fix

Each theory got a temporary, throwaway probe (main-process `getWindowButtonPosition`
logging, a renderer effect logging the inset math), added and later stripped.
The probes _falsified_ theories instead of confirming a favorite, which is what
kept moving the investigation forward.

### Measuring reality instead of trusting the constant

Every code path measured identical between dev and packaged
(`reserveWindowControls=true`, `inset=82`, `toggleRectLeft=82`, native buttons
`{x:16,y:13}`). That equality is what ruled out the whole class of "the code
computes a different inset" theories and forced the search toward runtime
state.

### The user's reframe: "measure the host, not the spawns"

The breakthrough was noticing that _every_ app the investigation spawned was
correct, while only the user's already-running instance was wrong. That is the
signature of **persisted profile state**, not a code branch.

### One build proving cause and fix together

A single packaged build with a temporary `VIM306_FORCE_ZOOM` env hook produced
both screenshots: forced `-0.5` → `devicePixelRatio 1.826` → overlap; locked →
`devicePixelRatio 2.0` → correct. Cause and remedy demonstrated in the same
artifact.

## Friction points

### Test isolation masked the bug

Every diagnostic launch passed `--user-data-dir=/tmp/...` to avoid disturbing
the running app. A fresh profile has no persisted zoom — so the isolation that
protected the user's session was _exactly_ what hid the bug. Lesson: when
"every fresh launch is fine but the installed one isn't," reproduce against the
**real** (or a copied) profile, not an isolated one.

### Three wrong theories before the right one

1. `navigator.userAgentData.platform` empty-string `??` trap flipping the inset
   to 0 — disproved because ⌘ shortcuts work in prod (same detection path).
2. `trafficLightPosition` not honored in packaged — disproved:
   `getWindowButtonPosition()` returned `{x:16,y:13}` in both.
3. The renderer inset diverging — disproved: identical in both.

All three were _measurable_, and measuring them was cheap; the cost was
emotional attachment to theory #1, which looked right for two rounds.

### The wrong measurement tool for zoom

`getBoundingClientRect()` returns CSS pixels, which are zoom-invariant — it
reported `82` regardless of zoom, briefly making zoom look innocent. The real
tell is `window.devicePixelRatio` (drops to `2 × 1.2^level`, e.g. `1.826` at
`-0.5`), or `webContents.getZoomFactor()` in main.

### Packaged-build ergonomics

`open`/LaunchServices detaches stdout (diagnostics had to be written to a file),
and `--remote-debugging-port` (CDP) is blocked in the packaged build — so live
DOM inspection of the real instance was not possible.

## What we'd do differently

- When a bug is "packaged-only" or "installed-only" but the code is provably
  identical, suspect **persisted profile state first** (userData `Preferences`,
  `Local State`, macOS Saved Application State) before re-reading the code.
- Reproduce against the real profile early; treat `--user-data-dir` isolation as
  something that can _hide_ state-dependent bugs.
- Reach for `devicePixelRatio` / `getZoomFactor`, not layout rects, when a
  DOM-vs-native alignment drifts.

## Deferrals tracked

- **Latent platform-detection `??` bug.** `isMacPlatform()` and
  `derivePaneShortcutModifier` use `(uad?.platform ?? navigator.platform)`; `??`
  does not fall through on an empty string, which Electron/macOS can report.
  Never actually fired here (the machine always read `"macOS"`), so it was
  **deliberately left out of this PR** to keep the fix minimal. Candidate
  follow-up: source the platform from the main process (`process.platform`) via
  the preload bridge and stop re-deriving it in the renderer.

## Pointers

- Fix: [`electron/main.ts`](../../../electron/main.ts) — `createWindow`, zoom lock.
- Issue: [VIM-306](https://linear.app/vimeflow/issue/VIM-306) — align left sidebar/titlebar in packaged Ghostty build.
- Persisted state observed at: `~/Library/Application Support/vibm/Preferences` → `partition.per_host_zoom_levels`.
- Related: [`2026-05-27-terminal-rendering-investigation.md`](./2026-05-27-terminal-rendering-investigation.md) (another "diagnostic that is not the fix" investigation).
