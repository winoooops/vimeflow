# Terminal Renderer Abstraction Retrospective

Date: 2026-06-15

Worktree: `/Users/winoooops/projects/vimeflow/worktrees/ghostty-terminal-investigation`

## Current Status

The terminal UI now has a renderer abstraction boundary in front of xterm.
Application code uses `TerminalInstance`, `TerminalSurface`,
`TerminalParser`, `TerminalViewportReader`, and `TerminalFitController`.

The xterm-specific details are concentrated in:

- `src/features/terminal/components/TerminalPane/xtermInstance.ts`
- adapter-oriented tests that mock `@xterm/*`

The implementation passed:

- `npx eslint ...`
- focused `npx vitest run ...`
- `npx tsc -b --pretty false`

There are no current compile or test blockers from the abstraction work.

## What Changed

### 1. xterm Imports Are Guarded

`eslint.config.js` now blocks production imports from `@xterm/*` outside the
xterm adapter. This prevents new app logic from binding directly to xterm.

Tests and `src/test/**` remain excluded because they still use mocks and global
setup.

### 2. TerminalSurface Was Trimmed

The first abstraction pass placed OSC parsing and viewport text reads on
`TerminalSurface`. That was too xterm-shaped.

The second pass split the contract:

- `TerminalSurface`: visual terminal lifecycle, focus, writes, resize, selection,
  clipboard, key handling, theme application
- `TerminalParser`: terminal control-sequence hooks such as OSC handlers
- `TerminalViewportReader`: visible text extraction for automation and diagnostics
- `TerminalFitController`: container fit behavior
- `TerminalRendererHandle`: adapter-owned renderer cleanup

This is a better split because parser and buffer access are not inherently the
same responsibility as rendering.

### 3. E2E Bridge Had Hidden xterm Coupling

`src/lib/e2e-bridge.ts` previously read `terminal.buffer.active` directly from
xterm when canvas/WebGL left `.xterm-rows` empty.

That was a real coupling leak. It now calls
`entry.viewportReader.readVisibleText()` instead. The xterm adapter implements
that by walking xterm's active buffer; a future adapter can provide its own
viewport reader without changing E2E code.

### 4. Body Can Run Against a Non-xterm Contract

`Body.fake-terminal.test.tsx` proves `Body` can mount, register OSC 7, pass the
surface to `useTerminal`, emit cwd changes, and clean up using a fake
`TerminalInstance` with no xterm imports.

This is the strongest proof so far that the boundary is not just a type alias
over xterm.

## Findings

### App Logic Was Cleaner Than Tests

The runtime code could be moved behind the interface fairly directly. The tests
were more tightly coupled to xterm constructors and addon behavior.

This is not necessarily bad: xterm adapter behavior still needs direct tests.
But Body-level tests should gradually move away from asserting xterm constructor
details. Those assertions now belong in `xtermInstance.test.ts`.

### OSC 7 Is a Parser Concern, Not a Renderer Concern

The cwd tracking logic depends on terminal control sequence parsing, not on
visual rendering. Treating it as `TerminalParser` makes the next adapter design
clearer.

For a Ghostty/libghostty-vt path, this is important because the parser may be
native/Rust-owned while the visual surface may be DOM/canvas/WebView-owned.

### String-based PTY Data Is Still a Future Constraint

The frontend still works with string chunks. That is fine for xterm's current
integration, but a Ghostty parser path may want raw bytes to preserve encoding
and control sequence fidelity.

This is not a blocker for the abstraction PR, but it is likely a future design
decision before a serious Ghostty prototype.

### Theme Shape Is Still xterm-biased Internally

The app-level bridge now sends `TerminalTheme` to the terminal surface. The xterm
adapter converts it with `toXtermTheme`.

This is acceptable. A future adapter can map the same project-level theme to its
own palette format.

### Renderer Fallback Logic Is Adapter-owned Now

WebGL, Canvas2D, DOM fallback, and WebGL context-loss behavior are no longer in
`Body`. That is the right ownership boundary. `Body` should not know whether the
adapter uses WebGL, a native view, a canvas, or something else.

## Current Blockers

No hard blockers for opening a PR for this abstraction work.

Known non-blocking issues:

- `useTerminal.test.ts` still emits existing React `act(...)` warnings. Tests
  pass, but the warnings are noisy.
- Some Body tests still mock `@xterm/*`. This is allowed by the guard because
  tests are excluded, but it is still a coupling smell. Adapter-specific checks
  should continue moving into `xtermInstance.test.ts`.
- `createTerminalInstance()` still delegates to xterm. This PR creates the seam;
  it does not implement a Ghostty adapter.
- A real Ghostty prototype will need a decision on string chunks vs raw byte
  streams.

## Suggested PR Framing

The PR should be framed as an abstraction and containment change, not as a
Ghostty implementation.

Recommended title:

`Extract terminal renderer abstraction around xterm`

Recommended scope:

- introduce renderer-neutral terminal contracts
- isolate xterm construction and addons in an adapter
- route Body, hooks, theme bridge, and E2E buffer reads through the contracts
- add lint guard against direct production xterm imports
- add fake terminal contract test proving Body is not hard-bound to xterm

Do not claim Ghostty support yet.

## Recommended Next Steps After Review

1. Move remaining Body tests that assert xterm constructor/addon details into
   adapter-level tests.
2. Decide whether `TerminalParser` should stay frontend-side or become a bridge
   to backend/native parser events.
3. Design a raw-byte PTY path for any serious Ghostty/libghostty-vt prototype.
4. Add a second experimental adapter only after the abstraction PR is reviewed.
