# Agent Status Native Overlay Verification

## Root Cause

Agent activity details were interactive DOM tooltips. A renderer DOM portal
cannot paint above Ghostty's parented AppKit `NSView`, so the card disappeared
where it crossed the terminal. The collapsed context and cache labels had the
same z-order problem, but are passive text tooltips.

The existing two-window NativeOverlay split remains the solution:

- activity details use the interactive surface window with a narrow,
  serializable activity payload;
- context and cache labels use the passive tooltip window, matching pane-header
  tooltips.

## Real Ghostty Check

Run on macOS with:

```bash
VIMEFLOW_REMOTE_DEBUGGING_PORT=9225 VITE_E2E=1 \
  VITE_GHOSTTY_NATIVE_MACOS_PARENT=1 VITE_NATIVE_OVERLAY=1 \
  npm run electron:dev -- --port 5177
```

Measured values from the renderer and Electron window:

- renderer viewport: `inner=1400x900`, `outer=1400x900`, DPR `2`;
- Electron content bounds: `{ x: 804, y: 332, width: 1400, height: 900 }`;
- active Ghostty DOM rect: `{ x: 768.328, y: 85, width: 341.664, height: 340 }`;
- rounded native bounds sent to main: `{ x: 768, y: 85, width: 342, height: 340 }`;
- AppKit frame applied by `toGhosttyScreenFrame`: `{ x: 1572, y: 417, width: 342, height: 340 }`;
- activity row rect: `{ x: 1141, y: 706, width: 234, height: 67 }`;
- native activity card rect: `{ x: 753, y: 676.5, width: 384, height: 126.297 }`.

The activity card crossed the live Ghostty rect and remained visible in a full
macOS screenshot. The main renderer contained no local dialog. Clicking Copy
produced the expected clipboard text and feedback; moving outside closed the
surface.

Physical pointer checks against the collapsed rail showed `Context: 84%` and
`Current cache rate: 50%` visibly composited over the live Ghostty pane. As a
control, `/Applications/Vimeflow 3.app` (built before this change) created the
same context label in its main renderer, but Ghostty covered it. This confirms
the renderer-to-passive-window transport, rather than local tooltip styling,
is the behavior that fixes the collapsed labels.
