# Ghostty Terminal Review Batches

Date: 2026-06-16

Branch family: `umbrella/ghostty-terminal-investigation`

## Purpose

The Ghostty exploration should continue as small, reviewable PRs. Each batch
should remove one kind of xterm coupling or prove one adapter boundary. Do not
bundle renderer experiments, keyboard behavior, E2E bridge behavior, and
comment-only cleanup into the same PR.

The production default remains xterm until a real Ghostty adapter is explicitly
selected behind a reviewed switch.

## Review Rules

- One runtime behavior change per PR.
- Keep xterm as the default renderer until the Ghostty path is opt-in.
- Every runtime decoupling PR needs a fake or non-xterm terminal test.
- Keep xterm adapter internals in `xtermInstance.ts` and adapter tests.
- Treat `.xterm-*` DOM selectors outside the adapter as legacy compatibility
  fallbacks, not primary integration points.
- Do not mix broad comment/test wording cleanup with runtime logic unless the
  same lines are already touched by the behavior change.

## Batch 1: Terminal Focus Ownership

Branch: `codex/ghostty-terminal-focus-ownership`

Scope:

- Mark the terminal renderer host with a generic terminal focus scope.
- Replace `usePaneShortcuts` checks for `.xterm-helper-textarea` with the
  renderer-neutral focus scope helper.
- Extend fake-terminal coverage to prove `Body` exposes the focus scope without
  relying on an xterm DOM class.

Why this is its own batch:

Keyboard shortcut capture is user-facing behavior. Keeping it isolated makes it
easy to review whether the pass-through and reclaim behavior is unchanged.

Validation:

- `npx vitest run src/features/terminal/terminalFocusScope.test.ts src/features/terminal/hooks/usePaneShortcuts.test.ts src/features/terminal/components/TerminalPane/Body.fake-terminal.test.tsx`
- `npm --ignore-scripts run lint`
- `npm --ignore-scripts run format:check`
- `npx tsc -b --pretty false`

## Batch 2: E2E Buffer Fallback Boundary

Scope:

- Keep `TerminalViewportReader` as the primary E2E buffer source.
- Make the remaining `.xterm-rows` path in `src/lib/e2e-bridge.ts` explicit as
  a legacy DOM fallback.
- Ensure tests cover a renderer with no xterm DOM rows and a stale DOM rows
  fallback case.

Why this is separate:

Automation buffer reads affect CI and E2E diagnostics. They should not be
reviewed together with keyboard shortcut behavior.

## Batch 3: Burner Popup Terminal Focus Language

Scope:

- Rename xterm-specific comments and test fixture names in
  `BurnerTerminalPopup` to generic terminal language.
- Keep behavior unchanged unless a real focus-scope bug is found.

Why this is separate:

Most of this batch is wording and test fixture cleanup. It is useful, but it
should not obscure runtime behavior changes.

## Batch 4: Workspace Shortcut and Terminal Zone Residue

Scope:

- Update remaining workspace shortcut tests and comments that describe terminal
  focus as xterm-specific.
- Preserve the current guards that avoid stealing terminal and CodeMirror input.

Why this is separate:

These files are adjacent to several global keyboard shortcuts. Even if the
changes are mostly comments and fixtures, they deserve a small review surface.

## Batch 5: Renderer Selection and Ghostty Adapter Spike

Scope:

- Add an explicit opt-in renderer selection path via
  `VITE_TERMINAL_RENDERER`.
- Prototype a second adapter only behind that selection path.
- Decide whether the prototype consumes frontend string chunks or requires a
  raw-byte PTY path first.

Selection contract:

- The app still defaults to the registered `xterm` renderer.
- A non-empty `VITE_TERMINAL_RENDERER` value must match a registered renderer
  adapter id.
- Unknown renderer ids fail during terminal instance creation instead of
  silently falling back to xterm.
- This selector does not claim Ghostty support by itself; it only creates the
  reviewed switch needed before a real Ghostty adapter can be added.

Why this comes last:

The earlier batches make the app less xterm-shaped without claiming Ghostty
support. A Ghostty adapter should start only after the generic contracts, focus
ownership, E2E reads, and keyboard behavior are reviewed.

## Non-goals For These Batches

- Do not set `TERM=xterm-ghostty` while xterm remains the default renderer.
- Do not replace xterm production behavior in the cleanup batches.
- Do not move PTY ownership out of the backend sidecar as part of renderer
  cleanup.
- Do not claim Ghostty support until a real adapter exists and is opt-in.
