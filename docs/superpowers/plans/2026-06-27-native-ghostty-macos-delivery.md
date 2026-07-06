# Native Ghostty macOS Delivery Status

Date: 2026-06-27
Worktree: `/Users/winoooops/projects/vimeflow/worktrees/ghostty-native-macos-runtime`
Branch: `spike/ghostty-native-macos-runtime`

Status update: shipped into the main product path. Packaged macOS arm64 builds
now bundle the built-in `libghostty-spm` SwiftPM bridge, `libGhosttyElectronBridge.dylib`,
and `ghostty_native_parent.node`; the parented Ghostty `NSView` is the macOS
terminal backbone. The Rust sidecar still owns PTYs, and xterm.js remains the
Linux/dev/native-failure fallback.

## Goal

Make native Ghostty the normal macOS terminal path for Vimeflow, with xterm kept as the Linux/non-macOS fallback.

The product path is the parented macOS `NSView` addon route. The WTerm/libghostty-wasm renderer, custom WebGL renderer, and floating Swift helper window are no longer the delivery path.

Current shipped shape:

- `native/ghostty-helper` pins `Lakr233/libghostty-spm` and builds the Swift bridge.
- `native/ghostty-parent/ghostty_native_parent.cc` parents the Ghostty surface into Electron.
- `scripts/package-electron.mjs` builds and smokes the native parent for `mac-arm64`.
- `electron-builder.yml` bundles `dist-native/ghostty-parent` into packaged mac resources.
- `electron/ghostty-native-parent.ts` enables native Ghostty by default for packaged macOS and keeps the opt-in flag for dev/e2e.

## Delivery Shape

### Phase 0: Spec and acceptance matrix

- Write the formal implementation spec from this plan using the Lifeline planner flow.
- Keep the Chinese HTML technical note updated with the final architecture, limitations, and manual observations.
- Treat the success criteria below as the release contract for the native Ghostty path.

### Phase 1: Productize parent-host behind a flag

- Keep the SwiftPM Ghostty bridge in its production native directory, `native/ghostty-helper`; it has already moved out of `docs/exploration`.
- Keep the parent `NSView` addon as the only product runtime path.
- Keep the Swift helper only as a smoke/debug artifact, not as product runtime.
- Make Electron main own native surface lifecycle: create, bounds update, focus, resize, PTY data, and destroy.
- Replace the current single-surface controller with a pane/session registry so split panes can be native at the same time.
- Keep xterm fallback automatic when native is unavailable or fails to create.

### Phase 2: Packaging and CI

- Wire the native parent build into macOS packaging.
- Bundle `.node`, Swift dylib, and libghostty-related runtime artifacts into the packaged mac app.
- Resolve packaged artifacts from `process.resourcesPath`, while keeping a dev path for local runs.
- Add a macOS CI smoke that builds the native parent, requires the addon, checks `otool -L`, and validates packaging inputs.
- Document current signing/notarization limits and the follow-up needed for nested native artifacts.

### Phase 3: macOS default

- Add one runtime selector: `VIMEFLOW_TERMINAL_RENDERER=auto|xterm|ghostty-native`.
- Default `auto` to native Ghostty on packaged macOS once Phase 1 and Phase 2 pass.
- Default `auto` to xterm on Linux and non-macOS.
- Keep xterm as an explicit escape hatch for development and release fallback.

## Success Criteria Mapping

| ID   | Success criteria              | Required evidence                                                                                                                                                                  |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC-1 | No snapshot tunnel jam        | Native path sends raw PTY bytes into Ghostty; no per-frame JSON snapshot is generated for the native path; dense transcript replay stays interactive.                              |
| SC-2 | Real native Ghostty is active | Debug evidence or `lsof` shows `ghostty_native_parent.node` and `libGhosttyElectronBridge.dylib` loaded; powerline, box drawing, truecolor, and Nerd Font glyphs render correctly. |
| SC-3 | Resize is stable              | Split and window resize keep the native surface aligned with the pane; resize forwards to the backend only when cols/rows change; no click-through or overlay drift.               |
| SC-4 | Multi-pane lifecycle works    | Two split panes can render, focus, resize, and close independently; closing a pane destroys its native surface without killing unrelated panes.                                    |
| SC-5 | Fallback is safe              | Missing addon, missing dylib, create failure, or non-macOS runtime falls back to xterm without a blank terminal or duplicate PTY.                                                  |
| SC-6 | Agent workflow remains intact | Claude, Codex, Kimi, and OpenCode status, cwd updates, command-submit tracking, replay/restore, and PTY exit/error UI behave the same as the xterm path.                           |
| SC-7 | Packaged mac app works        | `npm run electron:build:mac:arm64` produces an app that can launch a native Ghostty terminal from packaged resources.                                                              |
| SC-8 | Maintenance is explicit       | SwiftPM pins are committed, native build inputs are documented, macOS CI covers native load, and the HTML technical note records update steps and known limits.                    |

## Verification Plan

### Unit and integration

- Terminal renderer resolver chooses native only for macOS when available, and xterm otherwise.
- Terminal body renders the Ghostty body for native and xterm body for fallback.
- Parent controller validates pane bounds, input, PTY data, resize, focus, and destroy payloads.
- Pane registry rejects stale pane events and suppresses duplicate resize events.
- Native create failure falls back to xterm without creating a second PTY.

### Native smoke

- `npm run ghostty:native-parent:build`
- Node addon load smoke with `require(...)`.
- `otool -L` on the addon and Swift dylib to catch unresolved or repo-local load paths.
- `lsof -p <Electron pid>` during dev run to prove the addon and dylib are loaded.

### Manual smoke

- Launch dev app with native enabled.
- Verify shell prompt, typing, Enter, Ctrl-C, Ctrl-D, arrows, Option-arrow, Cmd-K, paste, and multiline paste.
- Resume Codex/Claude sessions and verify agent status updates still flow.
- Resize window and split panes from small to large and large to small.
- Open, switch, and close multiple panes.
- Verify copy, paste, selection, app blur/refocus, Cmd-Tab, and terminal focus.
- Run dense colored output and long agent transcript replay.
- Disable native and verify xterm fallback still behaves as before.

### Packaging smoke

- Run `npm run electron:build:mac:arm64`.
- Launch the packaged mac app.
- Confirm native Ghostty loads from packaged resources.
- Confirm `VIMEFLOW_TERMINAL_RENDERER=xterm` forces fallback.

## In Scope

- macOS native Ghostty parent addon.
- Electron main/native bridge lifecycle.
- Renderer/native terminal selection.
- Packaging for macOS.
- macOS CI smoke.
- Existing xterm fallback preservation.
- Chinese HTML technical note update.

## Out of Scope

- Linux native Ghostty.
- WTerm/libghostty-wasm renderer fixes.
- Custom WebGL terminal renderer.
- Full Ghostty renderer port.
- Rewriting the Rust PTY backend.
- Removing xterm fallback.

## Goal-Driven Prompt

```text
/goal Achieve a phased delivery path that makes native Ghostty the normal macOS terminal path for Vimeflow while preserving xterm as the Linux/non-macOS fallback, starting from `/Users/winoooops/projects/vimeflow/worktrees/ghostty-native-macos-runtime`, the current `spike/ghostty-native-macos-runtime` branch, `docs/superpowers/plans/2026-06-27-native-ghostty-macos-delivery.md`, and the Linear project `Ghostty Terminal Migration` with VIM-139 as the parent tracker, VIM-183 as the completed native-macOS decision, VIM-236 as the canceled WTerm/libghostty-wasm path, VIM-231 as the snapshot-flood historical root cause, and VIM-242/VIM-243/VIM-244 as the active M6/M7/M8 delivery issues. Confirm the result is valid using the plan file, the relevant Linear issue descriptions/comments/statuses, an updated Chinese HTML technical note, targeted unit/integration tests for renderer selection, fallback, pane registry, resize suppression, and native lifecycle, native smoke evidence from `npm run ghostty:native-parent:build`, addon load and `otool -L`, manual Electron evidence that real Ghostty renders shell and coding-agent sessions, and a packaged macOS smoke from `npm run electron:build:mac:arm64`. Preserve the existing Rust PTY backend, backend IPC contracts, xterm fallback, Linux/non-macOS behavior, terminal session semantics, agent observability for Claude/Codex/Kimi/OpenCode, and current split-pane model; do not continue WTerm/libghostty-wasm renderer fixes, custom WebGL terminal work, or the floating Swift helper as product runtime. Use only the current Vimeflow repository/worktree, the Linear issues named above as context and handoff targets, and files directly related to native Ghostty macOS hosting, Electron main/preload integration, terminal renderer selection, packaging, CI, tests, and docs; avoid unrelated refactors, destructive git operations, dependency additions beyond the existing native Ghostty stack, pushes, PR creation, or broad Linear edits unless explicitly requested. Do not commit anything until the user explicitly finishes final code review and asks for a commit; keep new files visible to git diff via tracking/intent-to-add rather than leaving them hidden as untracked files. Between iterations, choose the next step by first reading the current plan and Linear issue handoff, then proving the current parent `NSView` addon path and fallback behavior, then productizing the smallest shared lifecycle path, then adding the smallest test or smoke that would fail for the specific regression, then broadening to packaging and CI only after the dev native path is stable. At the end of each meaningful work slice, update the active Linear issue with a concise status comment covering evidence gathered, commands run, decisions made, remaining risks, and the next recommended issue or milestone. If blocked, or if no effective path remains, stop and report in both the chat and the active Linear issue the files inspected, native/Electron/Ghostty APIs checked, commands run, smoke evidence gathered, current blocker, and the exact missing API, design decision, signing credential, or permission needed to continue.
```
