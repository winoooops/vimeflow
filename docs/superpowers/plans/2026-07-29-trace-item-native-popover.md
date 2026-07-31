# Trace item native popover debugging

## Symptom

Moving between trace items made the activity card disappear and reappear. The
card also looked as though it were below Ghostty because terminal glyphs were
visible through it.

## Root cause

- Activity cards use the full-content-bounds interactive native overlay
  `BrowserWindow`. Outside the card, that transparent window still captured the
  pointer, so the next trace row could not begin its hover until the old card
  closed.
- The overlay was already above Ghostty. The visual layering problem came from
  the card's translucent background: CSS backdrop filtering in the overlay
  renderer cannot blur the Ghostty `NSView` hosted by the parent window.

## Renderer and native measurements

Measured on macOS with the real native path (`nativePaneCount=1`,
`xtermCount=0`) and remote debugging enabled:

- Renderer viewport: `1400 × 900` CSS px
- Renderer outer size: `1400 × 900`; device pixel ratio: `2`
- Electron main/content window: `{ x: 804, y: 332, width: 1400, height: 900 }`,
  CoreGraphics layer `0`
- Terminal container DOM rect:
  `{ x: 272, y: 44, width: 848, height: 832 }`
- Native Ghostty pane DOM rect:
  `{ x: 282, y: 85, width: 828, height: 756.25 }`
- Rounded frame forwarded to AppKit:
  `{ x: 282, y: 85, width: 828, height: 756, parentHeight: 900 }`
- Activity card DOM rect:
  `{ x: 652, y: 153.5, width: 384, height: 93.046875 }`
- Native overlay window:
  `{ x: 804, y: 332, width: 1400, height: 900 }`, CoreGraphics layer `1000`
- Fixed card computed background: opaque `rgb(35, 35, 59)`

## Fix

The activity host enables Electron mouse passthrough with forwarded mouse-move
events while the pointer is outside the card and anchor, then restores normal
interaction when it returns. The native-hosted card uses an opaque surface;
the local DOM fallback keeps its glass treatment.
