---
name: run-ghostty-dev
description: Run, debug, and read logs from the Vimeflow Ghostty native terminal dev build, isolated from the installed production app. Use when launching the dev app, testing/verifying the ghostty renderer, reproducing a terminal render/scroll/input bug, reading dev logs, or when the live dev window seems to show stale/old code. Trigger phrases include "run the ghostty build", "launch vimeflow dev", "test the ghostty renderer", "debug the terminal", "scroll/render bug in ghostty", "open the app to test", "read the dev logs", "why is the dev window showing old code".
version: 1.0.0
author: winoooops
tags:
  - electron
  - ghostty
  - terminal
  - dev
  - debugging
---

# Run & Debug the Ghostty Native Dev Build

How to launch the Vimeflow dev app on the **Ghostty native** render path, keep it
isolated from any installed production app, and read its logs reliably. Distilled
from a long VIM-216 debugging session that burned many cycles on environment traps.

## TL;DR

```bash
npm run dev:ghostty
```

That wrapper (`scripts/dev-ghostty.sh`) sets the opt-in Ghostty env, points Electron
at an **isolated userData dir**, and runs `electron:dev`. Launch it as a background
task so you can read its bridged logs from the task's stdout.

## The non-negotiables (each one cost hours)

1. **Use `electron:dev`, never `npx vite --mode electron`.** `electron:dev` regenerates
   the ts-rs bindings and builds the Rust sidecar first; the bare vite command skips
   both and can run against a stale backend.

2. **Ghostty is opt-in.** The renderer registry defaults to **xterm.js**. The native
   path only activates with:
   - `VITE_TERMINAL_RENDERER=ghostty`
   - `VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER=native`
     Without them you are testing xterm, not the ghostty code — its render artifacts
     (ghosting, etc.) are NOT your ghostty changes.

3. **Isolate userData from the installed app — this is the big one.** A production
   `/Applications/Vimeflow.app` and the dev build BOTH default to the same `vibm`
   Electron userData dir. Run dev while production is open and Electron fights over
   the shared Local Storage lock (or single-instance behaviour hands your launch off
   to the already-open production window) — so the dev window **silently shows
   production's built code, not your dev server's**. Symptom: your edits/`console`
   probes never appear even though vite serves them. Fix: the wrapper exports
   `VIMEFLOW_USER_DATA_DIR` (honored by `electron/sandbox.ts` → Electron
   `--user-data-dir`), giving dev its own dir.

4. **Never kill or touch `/Applications/Vimeflow.app`** (or its `vibm` dir / cache).
   It's the user's running app. Only ever stop the _dev_ instance, identified by
   `--user-data-dir=<your isolated dir>`.

## Reading logs

- Run `npm run dev:ghostty` as a **background task**; read its output file.
- The renderer console is bridged to stdout as `[renderer:info] [vimeflow:<ns>] …`.
- **For debug telemetry, log from the MAIN process** (`electron/*.ts`, e.g.
  `electron/ghostty-render-state-main.ts`). Main-process `console.info` goes
  **straight to stdout** and `vite-plugin-electron` **restarts Electron** when a main
  file changes, so it always runs. Renderer-side probes are unreliable: HMR does NOT
  full-reload deep non-component modules (the driver/surface), so renderer edits often
  don't reach the running window without a manual restart.

## When the dev window shows stale code

In order of likelihood:

1. You're looking at the **production** window, not the isolated dev one (see #3).
2. A stale dev `vite` is squatting port **5173** — Electron always loads the renderer
   from 5173, so an old server serves old modules. Confirm the listener on 5173 is
   _your_ current vite; if not, stop the stale one and relaunch.
3. Renderer HMR didn't reload a deep module — **restart** the dev instance (fresh
   import) rather than relying on HMR.
4. Stale Electron HTTP/Code cache in the userData dir — delete the isolated dir's
   `Cache` / `Code Cache` and relaunch (safe: never the `vibm` production dir).

## The debug loop that worked

`suspect → instrument the right boundary → restart → read stdout → verify → repeat`.
Instrument at **component boundaries** (main-process snapshot read, driver, surface)
and dedupe logs (log only on state change) so a per-frame path doesn't flood. The
decisive signal for the VIM-216 scroll bug came from a deduped main-process log of
`isAltScreen` + `scrollbackRowCount` — which proved Claude Code runs on the **alt
screen** (no terminal scrollback), while shell/codex use the normal buffer.

## Stopping the dev instance safely

Target only the isolated dev, e.g.:

```bash
pkill -f 'user-data-dir=<your isolated dir>'      # the dev Electron
pkill -f 'ghostty-verify/node_modules/.bin/vite --mode electron'   # the dev vite
```

Never match on `vibm` or `Vimeflow.app`.
