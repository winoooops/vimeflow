# NativeOverlay Ghostty Scope

## Must Use NativeOverlay

- Terminal layout display menu.
- Terminal context menu.
- Pane rename floating input.
- Command palette and shared `Dialog` surfaces that cover the workspace.
- Terminal-pane GitRefChip popover, after the simple menu smoke works.
- Burner popup / layout creator modal, after `Dialog` support exists.

## Stay Local

- Diff toolbar popovers, dropdowns, and tooltips.
- Editor/file context menus.
- Sidebar/session-list/card menus.
- Dock/editor internal controls unless they are shown above terminal pixels.

## Outliers To Clean Later

- Hand-written menus such as editor/files context menu, reading style menu, DockTab compact menu, and session card menu.
- These are not M9 blockers unless they overlap Ghostty.

## Native Web Overlay Finding

- Do not use Electron/AppKit `Menu.popup` as the Ghostty overlay fallback. It proved that a native surface can appear above the Ghostty `NSView`, but it creates a second menu implementation outside React and would make styling, behavior, actions, tests, and accessibility drift.
- The failed P1 path was not a terminal context-menu routing problem. The Ghostty native right-click event reached React, the rect was serializable, and main sent a render request. The two real failures were the old readiness race, where main sent `native-overlay:render` before registering the pending `native-overlay:ready` waiter, and the `WebContentsView` host losing z-order to an AppKit sibling `NSView`.
- The selected P2 path keeps the menu web-driven: main creates a transparent top-level `BrowserWindow`, loads the serializable overlay document through the existing preload bridge, syncs that window to the parent content bounds, enables hit testing while open, and hides/disables hit testing when closed.
- Real Ghostty `NSView` E2E on macOS passed for P2 with `VITE_GHOSTTY_NATIVE_MACOS_PARENT=1`: the OS screenshot pixel probe confirmed the web overlay menu painted above the live Ghostty native pane, and the selected action routed back to React exactly once.
- The old fake magenta `NSView` test was useful during discovery, but the regression test now targets the real Ghostty path directly. Do not switch to AppKit `NSMenu` as a fallback.

## Goal-Driven Layering Loop

Goal: find the smallest React-driven transport that can paint above a macOS native `NSView` mounted like Ghostty.

The regression fixture now uses the real Ghostty native pane. Earlier fake colored `NSView` probes were discovery tools only; they cannot prove the final Ghostty window hierarchy.

### Candidate Patterns

| ID  | Pattern                                                                       | Why It Exists                                                                                                                                                                                                                                               | Test Status                    | Decision                                                                                 |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| P0  | Existing local React DOM plus native-surface occlusion                        | BrowserPane already hides/shrinks native `WebContentsView` surfaces behind workspace overlays. This proves the current overlay stack, but hiding Ghostty is not enough for transparent overlay space because the terminal should stay visible behind menus. | Existing BrowserPane E2E only. | Reference pattern, not final Ghostty menu transport.                                     |
| P1  | Transparent `WebContentsView` overlay re-added to `BrowserWindow.contentView` | Electron documents that re-adding the same `View` makes it topmost. This is the current NativeOverlay prototype.                                                                                                                                            | Failed fake `NSView` E2E.      | Reject for Ghostty/AppKit `NSView`; the fake view stayed above the menu.                 |
| P2  | Transparent top-level `BrowserWindow` carrying web overlay                    | Electron can place this separate transparent window above the parent content bounds while keeping the overlay web/IPC-driven. This is not AppKit `NSMenu`.                                                                                                  | Passed real Ghostty E2E.       | Selected.                                                                                |
| P3  | Native AppKit child-window ordering bridge                                    | Same web overlay window as P2, but with native `NSWindow.addChildWindow(..., ordered: .above)` coordination if Electron window ordering becomes insufficient.                                                                                               | Not needed.                    | Keep out until P2 fails on a real macOS/Ghostty runtime.                                 |
| P4  | Native AppKit sibling z-order bridge                                          | Explicitly reorder the Ghostty container and an Electron overlay host with `NSView.addSubview(..., positioned: .above/.below, relativeTo:)`.                                                                                                                | Not started.                   | Test only if public Electron `View`/child-window ordering cannot beat the fake `NSView`. |
| P5  | Unified native host for Ghostty plus a web overlay view                       | Put both surfaces under one native owner that controls their relative order.                                                                                                                                                                                | Not started.                   | Last resort; larger native surface refactor.                                             |

### Rejected Patterns

- AppKit `NSMenu` / Electron `Menu.popup`: rejected because the menu is not React-driven.
- Sending arbitrary `ReactNode` over IPC: rejected because NativeOverlay payloads must stay serializable.
- DOM-only E2E fixture: rejected because it cannot reproduce AppKit `NSView` z-order.

### Loop Checklist

For each viable candidate:

1. Launch E2E with the real Ghostty native-parent feature flag.
2. Open a NativeOverlay probe menu at a known rect over the real Ghostty pane.
3. Assert with a full-screen screenshot/pixel probe that the web menu is above the native Ghostty view.
4. Assert click/action/close still routes back to React exactly once.
5. Record result in this table before trying the next candidate.

### Result Log

- P1 failed with `npx cross-env VITE_E2E=1 wdio tests/e2e/core/wdio.conf.ts --spec tests/e2e/core/specs/native-overlay-layering.spec.ts`: the menu request was accepted, but the screenshot probe still saw the fake magenta `NSView` above the overlay sample point.
- P2 first passed with a fake `NSView`, then passed against real Ghostty after switching the host from `WebContentsView` to a transparent top-level `BrowserWindow` and raising it with `setAlwaysOnTop(true, 'screen-saver')`.
- The earlier real-Ghostty failure was a test false negative: `screencapture -l <mainWindowId>` captures only the parent window, not the separate overlay window. The current test uses full-screen capture plus parent content-bounds mapping.

Sources:

- Electron `View.addChildView`: re-adding an existing child makes it topmost.
- Electron `BrowserWindow` / `BaseWindow`: child windows are documented as staying above the parent.
- Apple `NSView.addSubview(_:positioned:relativeTo:)`: inserts a view above or below sibling views.
