#!/usr/bin/env bash
# Launch the Ghostty native dev build, ISOLATED from any installed production app.
#
# Why this exists
# ---------------
# The dev build and an installed /Applications/Vimeflow.app share the default
# "vibm" Electron userData dir. If you run dev while the production app is open,
# the two fight over the same Local Storage lock (or Electron's single-instance
# behaviour hands the launch off to the already-open production window), so the
# dev window silently shows production's code instead of yours. Pointing dev at
# its OWN userData dir makes the two fully independent — and means you must NEVER
# kill the production app just to test dev.
#
# The renderer defaults to xterm.js; the Ghostty native path is opt-in via the
# two VITE_ vars below. Always go through electron:dev (regenerates bindings +
# builds the Rust sidecar + vite); never run `npx vite --mode electron` directly.
#
# Usage:
#   npm run dev:ghostty                          # normal launch
#   VIMEFLOW_USER_DATA_DIR=/path npm run dev:ghostty   # custom isolated dir
#
# Reading logs: run this as a background task; the renderer console bridges to
# stdout as `[renderer:info]`. For reliable debug telemetry, log from the MAIN
# process (electron/*.ts) — it goes straight to stdout and survives the renderer's
# flaky HMR. See .claude/skills/run-ghostty-dev/SKILL.md.
set -euo pipefail

export VITE_TERMINAL_RENDERER="${VITE_TERMINAL_RENDERER:-ghostty}"
export VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER="${VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER:-native}"
export VIMEFLOW_USER_DATA_DIR="${VIMEFLOW_USER_DATA_DIR:-${TMPDIR:-/tmp}/vimeflow-dev-userdata}"

mkdir -p "$VIMEFLOW_USER_DATA_DIR"

echo "[dev-ghostty] renderer=$VITE_TERMINAL_RENDERER driver=$VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER"
echo "[dev-ghostty] userData=$VIMEFLOW_USER_DATA_DIR (isolated from the installed app)"
echo "[dev-ghostty] launching electron:dev ..."

exec npm run electron:dev
