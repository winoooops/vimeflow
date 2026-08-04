# OSC 9;4 Pane Progress — Design

**Status:** Draft for final plan review.

**Linear:** [VIM-281](https://linear.app/vimeflow/issue/VIM-281) · parent [VIM-279](https://linear.app/vimeflow/issue/VIM-279)

**Delivery branch:** `feature/vim-281`, based on `feature/vim-411-notification-watcher` so the progress work includes the notification pipeline whose OSC routing it refines.

## 1. Context, evidence, and scope

VIM-281 adds a small pane-header working indicator for terminal programs that emit ConEmu/Ghostty progress reports through `OSC 9;4`. It is an enhancement to Vimeflow's existing session state presentation, not a replacement for `Pane.status` or agent lifecycle detection. Progress answers “is this PTY reporting active work, and optionally how far along is it?” while `Pane.status` continues to answer the broader process/agent lifecycle question.

The August 3 pilot ran real operations inside a real PTY and recorded the following result:

| Producer                                                   | Current Vimeflow environment | With `TERM_PROGRAM=ghostty` and a compatible version |
| ---------------------------------------------------------- | ---------------------------: | ---------------------------------------------------: |
| Claude Code 2.1.220                                        |                    0 reports |               active/indeterminate and clear reports |
| Kimi Code 0.31.1                                           |                    0 reports |           indeterminate keepalives and clear reports |
| Codex CLI 0.146.0                                          |                    0 reports |                                            0 reports |
| OpenCode 1.18.11                                           |                    0 reports |                                            0 reports |
| Vite dev/build, Vitest, electron-builder, Cargo/rustc 1.95 |                    0 reports |               0 reports in the tested configurations |

Shipping useful progress for Claude Code and Kimi (2 of the 4 supported coding agents) is accepted. Vimeflow will not infer progress from human-readable build/test output for tools that do not emit the protocol.

### Goals

- Parse live `OSC 9;4` reports once at the Rust PTY source-of-truth, including reports split across arbitrary read boundaries and terminated by either `BEL` or `ST`.
- Emit a typed, PTY-scoped progress event without removing or rewriting bytes in the terminal stream.
- Keep one ephemeral current value per `ptyId`, survive React pane remounts, and clear stale state deterministically.
- Reserve the `OSC 9;4` namespace from generic terminal-attention notifications while preserving ordinary `BEL`, `OSC 9`, and `OSC 777` behavior.
- Render a subtle two-pixel indicator at the bottom of the pane header for determinate, indeterminate, error, and paused states.
- Advertise Ghostty compatibility only when the sidecar successfully claimed and started Vimeflow's native Ghostty transport.

### Non-goals

- Text-output parsers for Vite, Vitest, electron-builder, Cargo, Codex, or OpenCode.
- A generic OSC framework, global state library, persistence format, progress history, aggregate workspace progress, Dock/taskbar progress, or percentage label.
- Wiring the libghostty progress delegate. The pinned library already exposes it, but that path would be macOS-only and duplicate the Rust parser.
- Changing `Pane.status`, agent notification eligibility, or notification-center presentation.

### Chosen approach

The Rust `read_pty_output` loop observes every live raw chunk once before UTF-8 publication and replay. A small stateful parser attached there recognizes progress and emits `pty-progress`; the parser does not alter the bytes passed into the existing `RingBuffer`, lossy UTF-8, and `pty-data` path. This preserves the current `offsetStart`/`byteLen` cursor contract without claiming a new binary-transparent IPC transport.

Because the renderer still receives those bytes, the existing terminal-attention boundaries use one shared namespace predicate: an OSC 9 payload beginning with the exact protocol discriminator `4;` is progress, not attention. The predicate does not validate states or percentages; full protocol validation remains in Rust. The native scanner consumes the sequence's terminating `BEL` as part of the OSC frame, and the xterm OSC handler returns handled without publishing attention.

Malformed inputs inside the reserved `9;4;...` namespace emit neither progress nor attention. They still follow the unchanged existing terminal-output path. A bare `OSC 9;4` without the following semicolon remains ordinary OSC 9 content, matching Ghostty's parser behavior rather than claiming the namespace too broadly. If a reserved frame exceeds the scanner's memory bound before termination, the notification scanner enters a zero-growth discard-until-`BEL`/`ST` state; that terminator closes the malformed OSC frame and is not reinterpreted as a standalone bell.

The installed PTY FD broker is a spawn-time capability signal, not proof that a particular pane surface has attached successfully. The backend installs it only after `VIMEFLOW_PTY_FD_TRANSPORT=1` is present, inherited fd 3 is valid, and broker startup succeeds. A later per-pane native-surface failure can fall back to xterm after its child environment is immutable; Vimeflow still parses and presents OSC progress in that fallback, but the environment cannot be renegotiated for that already-running PTY.

### Rejected approaches

1. **Strip progress bytes in Rust.** This removes the notification collision but makes Rust rewrite the PTY byte stream, complicates replay offsets, and prevents the terminal emulator from observing a valid control sequence.
2. **Parse separately in xterm and libghostty.** This duplicates behavior across providers, requires replay guards, and leaves Linux/dev semantics different from packaged macOS.
3. **Promote the interactive prototype parser.** The prototype assumes complete readable inputs and exists only as a UX/pilot tool. Production reuses its state mapping and real captured sequences as test vectors, not its parser code or UI controls.

## 2. Backend protocol, event, and capability contract

### Streaming parser ownership

Add a focused `crates/backend/src/terminal/progress.rs` module and create one `OscProgressParser` inside each `read_pty_output` task. `push(&[u8])` observes the same live raw chunk that is subsequently passed unchanged to `publish_pty_chunk`; it returns zero or more normalized reports in input order. No parser state belongs in the global PTY cache, ring buffer, renderer, or libghostty bridge.

The parser is an ASCII control-sequence state machine, not a regex over decoded strings:

1. Search for the `ESC ]` OSC introducer while retaining a trailing `ESC` across chunks.
2. Match the exact `9;4;` prefix incrementally. Once another OSC identifier is known not to match, ignore that OSC frame until its terminator rather than searching inside its payload.
3. Collect only the small progress payload until `BEL` or `ESC \`. Both bytes of `ST` may arrive in different reads.
4. Bound candidate storage at 256 bytes. On overflow, stop accumulating and discard parser state through the frame's terminator; PTY output publication continues normally.
5. Parse a terminated candidate into one report or no report. Unknown states, invalid provided percentages, missing terminators, and oversized frames emit nothing and never panic.

The normalized state vocabulary follows the pinned Ghostty contract:

| Protocol state | Event state     | Percentage behavior                                                                  |
| -------------: | --------------- | ------------------------------------------------------------------------------------ |
|            `0` | `remove`        | Always `null`; clears current progress.                                              |
|            `1` | `normal`        | Numeric value is clamped to `0..100`; absent value follows Ghostty's default of `0`. |
|            `2` | `error`         | Optional numeric value is clamped to `0..100`; otherwise `null`.                     |
|            `3` | `indeterminate` | Always `null`.                                                                       |
|            `4` | `paused`        | Optional numeric value is clamped to `0..100`; otherwise `null`.                     |

An explicitly present but nonnumeric percentage is malformed and emits no event. Extra fields after a valid numeric value are malformed rather than silently becoming a second protocol. The implementation should copy neither the prototype parser nor Ghostty's general OSC parser; the table and captured sequences are the compatibility contract Vimeflow tests.

### Typed event

Add the serializable Rust contract alongside the existing PTY events:

```text
PtyProgressEvent {
  session_id: String,
  state: remove | normal | error | indeterminate | paused,
  value: u8 | null,
}
```

The event name is `pty-progress`; generated TypeScript uses `sessionId`, `state`, and `value`. `sessionId` is the backend PTY identity and is called `ptyId` only after it enters pane-facing frontend code. A report is emitted before the corresponding `pty-data` publication from the same read. Repeated reports are not deduplicated in Rust: Kimi's repeated indeterminate frames refresh the frontend inactivity deadline.

The parser runs only in the live `read_pty_output` loop. `list_sessions` history and `get_pty_replay` return the existing terminal stream but never synthesize `pty-progress`, so renderer restore cannot resurrect stale progress. EOF and cancellation use the existing `pty-exit` lifecycle rather than adding a second backend clear event.

### Spawn-time capability normalization

The backend always keeps its existing terminal contract:

```text
TERM=xterm-256color
COLORTERM=truecolor
```

It then normalizes the variables that currently leak nondeterministically from the terminal used to launch Electron:

- When `PtyState` has a running FD broker, set `TERM_PROGRAM=ghostty` and `TERM_PROGRAM_VERSION=1.3.2` on each PTY child. Version `1.3.2` documents the compatibility level of the pinned `libghostty-spm-shaders` revision `633a7889fd4d6fabf0f480253b409561c8c3342c`.
- Otherwise, remove inherited `TERM_PROGRAM` and `TERM_PROGRAM_VERSION` from the child environment. This makes Finder, another terminal, and ordinary xterm development launches deterministic.

This reuses the existing verified capability path: `spawnSidecarWithPtyTransport` creates the FD transport only for the native Ghostty runtime, `claim_inherited_transport` validates fd 3, and `start_fd_broker` records successful startup in `PtyState`. Checking broker presence avoids advertising Ghostty when the marker exists but fd claim or broker startup failed. No spawn request field, renderer setting, or user-supplied environment exception is added.

## 3. Frontend state, notification isolation, and presentation

### Per-PTY store

`DesktopTerminalService` extends its existing centralized event listener with `pty-progress` and owns the ephemeral progress map and inactivity timers. This service instance is already created once by `WorkspaceView` and shared with every pane, so it survives pane/layout remounts without adding Workspace-level rerenders, prop drilling, or a global state dependency.

The terminal-service contract gains:

```text
getProgress(sessionId) -> PtyProgress | undefined
onProgress(callback(sessionId, progress | undefined)) -> Promise<unsubscribe>
```

`PtyProgress` contains `state` and `value`; it does not duplicate the PTY id used as the map key. `DesktopTerminalService`, `MockTerminalService`, and their tests implement the same observable contract.

For every backend event, the service applies these rules:

- `remove`: cancel that PTY's timer, delete its map entry, and notify subscribers only if an entry existed.
- Any other state: replace the entry and restart one 15-second timer. A repeated identical Kimi keepalive restarts the timer without notifying React subscribers or forcing a rerender.
- Timer expiry: delete and publish `undefined` if the entry still owns that timer.
- `pty-exit`: clear progress before publishing the existing exit callback, so no exited PTY retains a visible or timer-owned indicator.
- `dispose`: clear every timer, map entry, and progress callback along with the existing backend listeners.

`usePtyProgress(service, ptyId)` is a small pane-facing hook. It seeds from `getProgress`, registers the filtered callback, then reads `getProgress` again after subscription setup to close the render-to-effect race. Its cleanup handles unmount before the asynchronous subscription resolves. `TerminalPane` calls the hook and passes only the selected value to `Header`; no progress prop travels through `WorkspaceView`, `TerminalZone`, or `SplitView`.

### Notification namespace routing

`src/features/terminal/notifications.ts` exports one narrow predicate equivalent to `payload.startsWith('4;')`. Both existing renderer boundaries reuse it:

- `TerminalAttentionScanner` skips an OSC 9 payload in that namespace. Its existing OSC framing ensures a terminating `BEL` belongs to the frame rather than becoming a standalone bell. For an oversized reserved frame, it retains no payload but stays in discard-until-terminator mode.
- xterm's existing `registerOscHandler(9)` returns `true` without calling `emitTerminalAttention` for that namespace. Other OSC 9 payloads and all OSC 777 payloads keep their current behavior.

This predicate is routing, not parsing: `4;9;garbage` is suppressed as malformed progress at the notification boundary but rejected by the Rust parser. A bare payload `4` remains an ordinary OSC 9 notification. Standalone `BEL` remains attention, including Kimi's existing ambiguous-BEL fallback when it is outside an OSC frame.

Event ordering cannot recreate the collision. Rust may emit `pty-progress` before publishing the corresponding `pty-data`, but renderer notification suppression depends only on the OSC namespace, not on whether progress state has arrived.

### Header indicator

`Header` reuses the shared `@/components/ProgressBar`; VIM-281 does not introduce another progress-bar primitive. Add only the missing shared variants needed by this real consumer: a two-pixel `hairline` height and square `none` radius.

The bar is absolutely positioned across the header's bottom edge and does not change header geometry:

| State                  | Visual treatment                                                            | Accessible value                                           |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `normal` with value    | Agent accent, determinate width with a short CSS width transition.          | `aria-valuenow` from `0..100`.                             |
| `normal` without value | Full-width, low-opacity pulse.                                              | `Terminal progress; in progress`.                          |
| `indeterminate`        | Full-width, low-opacity pulse in the agent accent.                          | `Terminal progress; in progress`.                          |
| `error`                | Error tone; determinate when a value exists, otherwise pulsing.             | `Terminal progress; error`, plus percentage when present.  |
| `paused`               | Warning tone; determinate when a value exists, otherwise a static full bar. | `Terminal progress; paused`, plus percentage when present. |

The shared component supplies `role="progressbar"`, label, minimum, maximum, and optional current value. It is not an `aria-live` region, so frequent Kimi keepalives do not interrupt a screen reader. `motion-reduce:animate-none` disables pulsing and `motion-reduce:transition-none` disables width animation. There is no percentage text, tooltip, click target, or native Ghostty overlay: the header is renderer DOM outside the native terminal surface.

## 4. Delivery sequence, verification, and acceptance

Implementation follows vertical TDD slices. Each slice begins with the smallest failing behavior test, implements only the contract needed to pass it, and runs its targeted suite before the next slice. VIM-281 does not execute from this design/planning branch until the final plan is approved.

### Slice 1 — Backend parser and event

1. Add parser unit tests in the new `crates/backend/src/terminal/progress.rs` for the pilot's real Claude/Kimi frames, all five states, percentage clamp, `BEL` and `ST`, every possible single split point, the split between `ESC` and `\`, back-to-back frames, ordinary text, non-progress OSC, malformed values, unknown states, and the 256-byte overflow path.
2. Implement the bounded state machine and normalized Rust state/report types.
3. Add `PtyProgressEvent` in `crates/backend/src/terminal/types.rs`, its emitter in `events.rs`, and scan each successful live read in `commands.rs` before calling the unchanged `publish_pty_chunk`.
4. Add read-loop tests proving progress event order and PTY attribution while the original `pty-data` payload and raw offset accounting still include the OSC bytes. Prove replay emits no progress.
5. Derive native compatibility from a successfully installed `PtyState` FD broker. Test a small environment-configuring function with native capability true/false, including removal of inherited `TERM_PROGRAM` values on false.
6. Run `npm run generate:bindings` after the Rust type is final and verify the generated `PtyProgressEvent`/state imports compile.

Gate: `cargo test --manifest-path crates/backend/Cargo.toml terminal::progress` plus the targeted terminal command/event tests pass; malformed or oversized input cannot panic, allocate without bound, alter published terminal bytes, or emit progress.

### Slice 2 — Service lifecycle and notification isolation

1. Extend `ITerminalService`, `DesktopTerminalService`, and `MockTerminalService` with the typed progress contract. Add `pty-progress` to the same memoized listener setup as existing PTY events.
2. Use Vitest fake timers to drive per-PTY replace/remove, identical keepalive refresh without callback, independent timers for two PTYs, 15-second expiry, `pty-exit` clear, `dispose` clear, and unsubscribe behavior.
3. Add `usePtyProgress.test.tsx` for existing-value hydration, an event between first render and subscription completion, PTY-id changes, and unmount before asynchronous setup resolves.
4. Add namespace tests in `notifications.test.ts`: valid and malformed reserved progress with both terminators, every split boundary, overflow followed later by `BEL`/`ST`, bare `OSC 9;4`, ordinary OSC 9/777, and standalone `BEL`.
5. Extend the xterm `Body` and native `GhosttyBody` tests to prove progress never publishes terminal attention while ordinary attention and restore suppression remain unchanged.

Gate: one PTY's exit/timeout cannot clear or refresh another PTY, no timer or callback survives service disposal, and no `OSC 9;4;...` frame can create a notification record—including when its `BEL` terminator arrives in a later chunk.

### Slice 3 — Header presentation and end-to-end proof

1. Add the `hairline` and `none` variants to `src/components/ProgressBar.tsx` with focused primitive tests.
2. Wire `usePtyProgress` into `TerminalPane` and render the shared bar from `Header`. Add header tests for hidden/remove, determinate width, indeterminate/error/paused treatments, ARIA attributes, absence of `aria-live`, and reduced-motion classes.
3. Start an xterm E2E in `tests/e2e/terminal/specs/pty-progress.spec.ts` by printing real control sequences from a shell. Assert an indeterminate bar appears, a determinate update changes it, clear removes it, a background pane produces no notification badge, and exiting a pane removes its progress without disturbing another pane.
4. Add native macOS coverage to the already-listed `ghostty-runtime.spec.ts`: verify the same shell-emitted frames drive renderer header DOM while the native surface remains usable. Extend `pane-environment.spec.ts` to prove Ghostty identity is present only in the native-transport run.
5. Manually pilot installed Claude Code and Kimi in native Ghostty, recording active/clear behavior and ensuring neither progress keepalives nor their OSC `BEL` terminators enter the notification island.

Gate: the shared header bar behaves identically for xterm fallback and native Ghostty, progress never overlays the native `NSView`, reduced motion is static, and exiting one session leaves no orphan timer or state capable of changing another pane.

### macOS CI prerequisite and PR readiness

The native Ghostty runtime cannot be exercised on the current development machine. Before opening VIM-281's implementation PR, the epic base branch `feature/vim-411-notification-watcher` must contain an `.github/workflows/e2e.yml` `pull_request.branches` entry for itself. The current workflow accepts only PRs targeting `main` or `feature/ghostty-native-macos-runtime`; changing that filter inside VIM-281 would not bootstrap its own `pull_request` event because the base branch supplies the workflow definition. Land this as a separate CI-only prerequisite on the epic base.

Open VIM-281 as a Draft PR targeting the epic base. Draft status does not suppress the repository's `pull_request` workflows. Keep it draft while the macOS runner executes `E2E Ghostty terminal smoke (macOS)` and `Native Ghostty macOS Smoke`; fix failures and push again while still draft. Convert the PR to Ready for review only after those macOS jobs and the ordinary Linux/code-quality gates are green. The automated native case emits real OSC sequences through a native Ghostty pane; it does not claim to authenticate or run Claude/Kimi on the GitHub-hosted runner.

### Files expected to change

The implementation should stay near these existing owners; exact generated binding filenames follow `ts-rs` output:

- `crates/backend/src/terminal/{mod.rs,progress.rs,types.rs,events.rs,commands.rs}` and co-located Rust tests.
- `src/bindings/` generated progress event/state files and index exports.
- `src/features/terminal/types/index.ts` and `services/{terminalService.ts,desktopTerminalService.ts}` with their sibling tests.
- `src/features/terminal/hooks/usePtyProgress.ts` and `.test.tsx`.
- `src/features/terminal/notifications.ts`, `Body.tsx`, and `GhosttyBody.tsx` with existing sibling tests.
- `src/components/ProgressBar.tsx` and `.test.tsx`.
- `src/features/terminal/components/TerminalPane/{index.tsx,Header.tsx}` and their existing tests.
- `tests/e2e/terminal/specs/{pty-progress.spec.ts,pane-environment.spec.ts}`.
- `.github/workflows/e2e.yml` to inject inherited identity sentinels into the existing macOS Ghostty E2E step; the separate epic-base prerequisite owns only the PR branch filter.

No `WorkspaceView`, `TerminalZone`, `SplitView`, session model, agent adapter, libghostty Swift/C bridge, dependency manifest, or persistence file should change unless implementation discovers a demonstrated contract mismatch and updates this design first.

### Full verification

Before opening the Draft PR, run the platform-independent/local gate:

```bash
cargo test --manifest-path crates/backend/Cargo.toml
npm run generate:bindings
npm run test:coverage
npm run lint
npm run type-check
npm run build
npm run test:e2e:terminal
```

The configured 80% coverage floor remains mandatory. The Draft PR's macOS runner then runs `npm run test:e2e:build:generated:ghostty` and `npm run test:e2e:terminal:ghostty:run` through `.github/workflows/e2e.yml`. The PR records xterm and native macOS evidence separately because capability advertisement intentionally differs between them.

### Acceptance criteria

- Claude Code and Kimi receive deterministic native Ghostty capability and produce visible progress in the pilot operations; unsupported producers remain silent without heuristics.
- Valid progress is attributed to exactly one `sessionId`, stored independently, and never restored from PTY replay.
- `remove`, 15 seconds of inactivity, `pty-exit`, and service disposal clear state and timers.
- Progress OSC bytes continue through the existing terminal output path and offsets; progress extraction is observational.
- Valid, malformed, split, and oversized `OSC 9;4;...` frames never become terminal-attention notifications; ordinary `BEL`, OSC 9, and OSC 777 still do.
- Header presentation covers all protocol states, honors reduced motion and progressbar semantics, and adds no percentage text or interactive surface.
- xterm fallback and native Ghostty pass the same application-state behavior tests; only native transport advertises Ghostty identity.
- The implementation PR remains Draft until the existing macOS Ghostty E2E and native smoke jobs pass, then becomes Ready for review.

### Deferred work

- Producer support beyond tools that already emit OSC 9;4.
- Build/test log inference, user-authored progress matchers, protocol configuration, and arbitrary OSC extensions.
- Workspace/tab aggregation, history/persistence, a visible numeric label, Dock/taskbar integration, and system notifications.
- Replacing `TERM_PROGRAM=ghostty` with a future first-class `TERM_PROGRAM=vimeflow` after upstream producers recognize it.
- libghostty delegate wiring. Reconsider only if a future native-only consumer needs Ghostty's parsed callback for behavior that the shared Rust event cannot provide.
