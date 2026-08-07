# Notification native-overlay verification

Date: 2026-07-31

Branch: `feature/vim-411-in-app-notifications`
Runtime: macOS arm64, Electron dev, `VITE_GHOSTTY_NATIVE_MACOS_PARENT=1`, `VITE_NATIVE_OVERLAY=1`

## Geometry evidence

- Renderer viewport: `window.innerWidth=1400`, `window.innerHeight=900` CSS px.
- Electron outer viewport: `window.outerWidth=1400`, `window.outerHeight=900` points.
- Main window: origin `(804, 332)`, size `1400×900` points.
- Native overlay window: same origin and size as its parent, `(804, 332)`, `1400×900` points.
- Toast-stage island DOM rect: `(512, 10, 368×24)` CSS px.
- Native notification panel rect in the overlay renderer: `(476, 38, 440×125.25)` CSS px.
- Four visible Ghostty pane DOM rects, and therefore the rounded native frames passed to `setFrame`: `(282, 85, 410×340)`, `(700, 85, 410×340)`, `(282, 495, 410×340)`, and `(700, 495, 410×340)`.

The renderer CSS-pixel and AppKit point spaces were 1:1 in this run. The overlay panel began below the 44px top chrome, overlapped the first-row native Ghostty surfaces, and remained visible and clickable above them. The first notification row received its visible focus ring when the native window opened.

## Paths exercised

- XTerm: background semantic event → toast → local 440px panel.
- Native Ghostty: background semantic event → renderer-owned toast → native `notification-center` overlay panel.
- Themes: Catppuccin and Flexoki.
- Responsive/motion: 760×800 renderer viewport with `prefers-reduced-motion: reduce`.

The native path used the existing `Popover` transport and did not add a second overlay implementation. OSC 7 remained cwd-only; BEL/OSC 9/777 share the terminal notification scanner and are covered by the XTerm and Ghostty component suites.
