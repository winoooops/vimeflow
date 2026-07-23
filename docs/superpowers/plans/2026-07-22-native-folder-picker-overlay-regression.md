# Native folder picker overlay regression

## Symptom

Opening **Browse** from the native-overlay New session dialog could put the
dialog back above the still-open macOS folder picker. Clicking the picker then
hit the overlay backdrop and closed the New session dialog.

## Boundary measurements

Captured from an isolated Electron dev run with native Ghostty and native
overlays enabled:

- Owner renderer viewport: `inner=1400×900`, `outer=1400×900`
- Overlay renderer viewport: `inner=1400×900`, `outer=1400×900`
- New session panel DOM rect: `x=420, y=135, width=560, height=680`
- Electron workspace/content bounds: `x=804, y=332, width=1400, height=900`
- Overlay frame applied from `parent.getContentBounds()`: `x=804, y=332,
width=1400, height=900`
- Native `NSOpenPanel` frame: `x=1064, y=558, width=880, height=448`

The overlay correctly became hidden when Browse suspended it. A same-surface
payload refresh then called `showInactive()` and restored the `screen-saver`
window level, placing it back over the `NSOpenPanel`.

## Fix and verification

`NativeOverlayController.openMenuSurface` now renders same-surface refreshes
without showing a suspended overlay. Only the existing resume IPC restores its
window level and pointer input.

Verified that the overlay renderer stayed `visibilityState=hidden` before and
after a forced layout payload refresh while the `NSOpenPanel` remained
on-screen. The controller regression test covers the same suspend → refresh →
resume sequence.
