# Ghostty resize lockstep fork

## Symptom

After a native Ghostty window resize, Claude Code and nvim statuslines could
render merged onto the separator row and stay wrong until the next resize. This
was not the UTF-8 ghost fixed in PR #735: transcripts contained no U+FFFD, and
the terminal grid itself held a stale layout.

## Boundary Measurements

Captured during the VIM-380 resize investigation with native Ghostty enabled:

- Renderer DOM rect source: `getBoundingClientRect()` from the active terminal
  surface, in renderer CSS pixels.
- Renderer viewport metrics: `window.innerWidth` and `window.innerHeight` were
  compared with `window.outerWidth` and `window.outerHeight` before treating the
  issue as an AppKit frame or React lifecycle problem.
- Electron window/content bounds: the renderer-to-native frame conversion path
  was checked against the Electron window metrics used by the native Ghostty
  view registry.
- Applied native frame: the `NSView` frame matched the DOM slot conversion; the
  visual view placement was not the failing boundary in this case.
- PTY resize evidence: the host PTY received `updateViewport` from
  `TerminalSurfaceCoordinator.synchronizeMetrics` on the AppKit thread before
  Ghostty's IO-thread `receiveResizeCallback` committed the matching grid
  reflow.

## Root Cause

Claude Code draws its footer using cursor movement relative to the winsize it
last read after SIGWINCH. Stock Ghostty updates the PTY size from
`Termio.resize` on the IO thread, which keeps the PTY winsize and grid reflow in
lockstep.

The `Lakr233/libghostty-spm` bridge added an early host PTY resize from the
AppKit thread. That signal reached the PTY before the IO thread committed the
grid resize. When the correctly phased `receiveResizeCallback` arrived with the
same size, the host session deduped it away, leaving the application to repaint
against a winsize that led the grid.

## Fix

`native/ghostty-helper/Package.swift` now pins `libghostty-spm` to
`https://github.com/winoooops/libghostty-spm.git` at revision
`97ee130e51c5a220fa7766613346ff115f9580c8`. That fork removes the premature
`updateViewport` dispatch so `receiveResizeCallback` is the sole PTY resize
source, matching stock Ghostty's IO-thread lockstep behavior.

The fork is temporary. Revert this pin to an upstream release after the
premature `updateViewport` behavior lands in `Lakr233/libghostty-spm`.

## Verification

Live testing with this fork and PR #735 confirmed normal resize delivery, no
persistent post-resize statusline merge, and only the same self-correcting
single-frame reflow artifact seen in stock Ghostty.
