# VIM-281 OSC 9;4 Pane Progress — Implementation Plan

**Status:** Draft for the user's final plan review. Do not implement from this plan until approved.

**Design:** `docs/superpowers/specs/2026-08-03-osc-progress-design.md`

**Branch:** `feature/vim-281`, based on `feature/vim-411-notification-watcher`.

Every task below starts with the smallest failing test, implements only enough to pass it, and runs the listed targeted command before the next task. Do not add text-output parsers, a generic OSC framework, `Pane.status` changes, libghostty delegate wiring, percentage text, persistence, or new dependencies. If implementation proves one of those necessary, stop and update the design first.

## CI prerequisite — land before implementation PR

The implementation PR targets `feature/vim-411-notification-watcher`, but `.github/workflows/e2e.yml` currently runs `pull_request` jobs only for base branches `main` and `feature/ghostty-native-macos-runtime`. A workflow change inside VIM-281 cannot enable its own opening event because the base branch supplies the PR workflow definition.

Before opening the VIM-281 Draft PR, land a separate CI-only change on `feature/vim-411-notification-watcher` adding that branch to `.github/workflows/e2e.yml` under `on.pull_request.branches`. Confirm the base branch now exposes the existing `E2E Ghostty terminal smoke (macOS)` job to child PRs. Do not fold this bootstrap change into VIM-281 or change the implementation PR's base to `main`.

## Phase 1 — Rust parser, event, and capability

### Task 1 — Specify the streaming parser in tests

**Files:**

- Create `crates/backend/src/terminal/progress.rs` with the parser types, a compiling stub, and its `#[cfg(test)]` module.
- Modify `crates/backend/src/terminal/mod.rs` immediately so the red test command compiles and runs the new module's tests.

Write failing tests for:

- Pilot captures: Claude `ESC ] 9;4;0; BEL`, `ESC ] 9;4;3; BEL`; Kimi `ESC ] 9;4;3 BEL` and clear.
- States: `0 → remove/null`, `1;42 → normal/42`, absent normal value `→ 0`, `1;150 → 100`, optional error/paused percentages, and indeterminate/null.
- Both `BEL` and `ESC \` (`ST`) terminators.
- One-byte-at-a-time input, every two-chunk split point, `ESC | \` split inside `ST`, and a trailing `ESC` before the next chunk's OSC introducer.
- Back-to-back reports and text/report/text ordering.
- Non-progress OSC frames, including a payload containing the text `9;4;`, are ignored through their terminator.
- Bare `OSC 9;4`, unknown states, nonnumeric percentages, extra fields, and unterminated candidates emit nothing.
- A reserved candidate over 256 bytes stops growing, discards through its terminator, and recovers for a following valid report.

Run the red check:

```bash
cargo test --manifest-path crates/backend/Cargo.toml terminal::progress
```

### Task 2 — Implement the bounded parser

**Files:**

- Modify `crates/backend/src/terminal/progress.rs`.

Implement one ASCII state machine with:

- incremental `ESC ] 9;4;` matching;
- ignore-until-terminator for other OSC frames;
- cross-chunk `BEL`/`ST` recognition;
- a 256-byte candidate ceiling and zero-growth discard state;
- normalization into `remove | normal | error | indeterminate | paused` plus optional clamped `u8` percentage.

The parser observes bytes only. It must not return filtered output, copy the prototype parser, or depend on decoded UTF-8.

Run:

```bash
cargo test --manifest-path crates/backend/Cargo.toml terminal::progress
```

### Task 3 — Add the typed backend event

**Files:**

- Modify `crates/backend/src/terminal/types.rs`.
- Modify `crates/backend/src/terminal/events.rs`.
- Extend their existing tests.

Tests first:

- `PtyProgressEvent` serializes to `sessionId`, `state`, and `value`.
- Rust `None` serializes as `value: null`.
- The emitter publishes under `pty-progress`.
- The event and state enum participate in the existing `ts-rs` export path.

Then add the event contract and emitter alongside `PtyDataEvent` and `PtyExitEvent`.

Run:

```bash
cargo test --manifest-path crates/backend/Cargo.toml terminal
```

### Task 4 — Parse only live PTY reads

**Files:**

- Modify `crates/backend/src/terminal/commands.rs` and its existing test module.

Tests first:

- A live chunk emits `pty-progress` before its corresponding `pty-data` event.
- Two PTYs attribute reports to their own `sessionId`.
- Repeated identical reports remain repeated backend events.
- The published `pty-data`, raw ring contents, `offsetStart`, and `byteLen` still include the OSC bytes.
- `list_sessions`/`get_pty_replay` over stored OSC bytes emit no progress event.
- EOF/cancellation relies on the existing `pty-exit`; it emits no separate progress-clear event.

Then create one `OscProgressParser` per `read_pty_output` task and call it on each successful raw read before the unchanged `publish_pty_chunk` call.

Run:

```bash
cargo test --manifest-path crates/backend/Cargo.toml terminal
```

### Task 5 — Normalize terminal identity from verified capability

**Files:**

- Modify `crates/backend/src/terminal/commands.rs` and its existing tests.
- Reuse `PtyState::fd_broker`; do not add an IPC field.

Tests first around a small environment-configuring function:

- Running FD broker: `TERM_PROGRAM=ghostty`, `TERM_PROGRAM_VERSION=1.3.2`, and the existing `TERM=xterm-256color`/`COLORTERM=truecolor`.
- No broker: inherited `TERM_PROGRAM` and `TERM_PROGRAM_VERSION` are removed.
- Merely setting `VIMEFLOW_PTY_FD_TRANSPORT` without a successfully installed broker does not advertise Ghostty.

Then make `spawn_pty_inner` derive capability from the installed broker and configure the child environment before spawn.

Run:

```bash
cargo test --manifest-path crates/backend/Cargo.toml
```

### Task 6 — Generate bindings

**Files:**

- Regenerate `src/bindings/` through the repository script.
- Modify the hand-maintained `src/bindings/index.ts` barrel to export the generated progress event and state; binding generation intentionally preserves this file.
- Modify `src/features/terminal/types/index.ts` only to re-export the generated progress types needed by the service.

Run:

```bash
npm run generate:bindings
npm run type-check
```

Phase 1 gate: the full backend suite is green; malformed input is bounded and panic-free; output and replay contracts remain unchanged.

## Phase 2 — Frontend service, hook, and notification routing

### Task 7 — Add the service-owned per-PTY store

**Files:**

- Modify `src/features/terminal/services/terminalService.ts` and its tests.
- Modify `src/features/terminal/services/desktopTerminalService.ts` and `.test.ts`.
- Modify `src/features/terminal/types/index.ts` if a frontend alias is useful.

With Vitest fake timers, write failing tests for:

- `getProgress(sessionId)` before/after a backend progress event.
- `remove` cancelling the timer, deleting state, and notifying `undefined` only when state existed.
- A non-remove event replacing state and starting one 15-second timer.
- An identical Kimi keepalive refreshing the deadline without notifying React subscribers.
- Independent state/timers for two PTYs.
- Timer expiry clearing only the entry that owns that timer.
- `pty-exit` clearing progress before the existing exit callback.
- `dispose` clearing all timers, entries, and callbacks.
- `onProgress` unsubscribe and listener-initialization failure cleanup.

Then:

- add `pty-progress` to `DesktopTerminalService.ensureListeners`;
- store `Map<sessionId, PtyProgress>` and one timer per session;
- add `getProgress`/`onProgress` to `ITerminalService`;
- give `MockTerminalService` the same observable behavior.

Run:

```bash
npm run test -- src/features/terminal/services
```

### Task 8 — Add the pane-scoped hook

**Files:**

- Create `src/features/terminal/hooks/usePtyProgress.ts`.
- Create `src/features/terminal/hooks/usePtyProgress.test.tsx`.

Tests first:

- Seed an already-stored value on first render.
- Do not lose an event between render and asynchronous subscription completion.
- Ignore another PTY's events.
- Re-seed and unsubscribe when `ptyId` changes.
- Unmount safely before subscription setup resolves.

Implement by reading `getProgress`, registering a filtered callback, and reading once more after setup to close the render/effect race. If unmount happens first, immediately dispose the eventual subscription without setting state.

Run:

```bash
npm run test -- src/features/terminal/hooks/usePtyProgress
```

### Task 9 — Reserve OSC 9;4 from terminal attention

**Files:**

- Modify `src/features/terminal/notifications.ts` and `.test.ts`.

Tests first:

- `4;3`, `4;1;42`, and malformed `4;9;garbage` payloads are recognized as the reserved namespace.
- Reserved frames with `BEL`/`ST`, every split boundary, and a terminator arriving later produce no attention.
- Oversized reserved frames retain no growing payload and consume the later terminator without a standalone-bell event.
- Bare payload `4`, ordinary OSC 9/777, and standalone `BEL` keep existing behavior.

Export one narrow `isProgressOsc9Payload` predicate using the exact `4;` discriminator. Apply it inside `TerminalAttentionScanner`; do not parse state/value in TypeScript.

Run:

```bash
npm run test -- src/features/terminal/notifications
```

### Task 10 — Apply routing at xterm and native edges

**Files:**

- Modify `src/features/terminal/components/TerminalPane/Body.tsx` and existing sibling tests.
- Modify `src/features/terminal/components/TerminalPane/GhosttyBody.tsx` and existing sibling tests.

Tests first:

- xterm's OSC 9 handler returns handled without `emitTerminalAttention` for the reserved namespace.
- Other OSC 9 and OSC 777 payloads still notify.
- Native live progress frames do not notify; ordinary attention still does.
- Existing restore/replay suppression remains unchanged.

Implement both boundaries with `isProgressOsc9Payload`; the Rust progress event's arrival order must not affect notification suppression.

Run:

```bash
npm run test -- src/features/terminal/components/TerminalPane
```

Phase 2 gate: one PTY cannot clear another; no timer/callback survives disposal; no `OSC 9;4;...` frame creates a notification record under any tested chunking.

## Phase 3 — Header UI and end-to-end proof

### Task 11 — Extend the shared ProgressBar minimally

**Files:**

- Modify `src/components/ProgressBar.tsx` and `.test.tsx`.

Tests first: add `hairline` as a two-pixel height and `none` as a square radius; prove existing variants remain unchanged. Add no new progress component and no indeterminate-specific API to the shared primitive.

Run:

```bash
npm run test -- src/components/ProgressBar
```

### Task 12 — Render progress from TerminalPane/Header

**Files:**

- Modify `src/features/terminal/components/TerminalPane/index.tsx` and existing tests.
- Modify `src/features/terminal/components/TerminalPane/Header.tsx` and existing tests.

Tests first:

- Missing/remove progress renders no bar and does not change header geometry.
- Normal with a value uses agent accent, determinate width, `aria-valuenow`, and a short width transition.
- Normal without a value and indeterminate use a full-width low-opacity pulse without `aria-valuenow`.
- Error with a value uses error tone, determinate width, percentage ARIA, and no pulse; error without a value uses error tone, no `aria-valuenow`, and pulses.
- Paused with a value uses warning tone, determinate width, percentage ARIA, and no pulse; paused without a value uses a static full warning bar and no `aria-valuenow`.
- `role="progressbar"`, label/min/max and state-specific value text are present; `aria-live`, percentage text, tooltip, and click handlers are absent.
- Reduced-motion classes disable pulse and width transition.

Then call `usePtyProgress(service, pane.ptyId)` in `TerminalPane` and pass only the selected value to `Header`. Render the existing `ProgressBar` absolutely at the header's bottom edge. Do not add progress props to `WorkspaceView`, `TerminalZone`, or `SplitView`.

Run:

```bash
npm run test -- src/features/terminal/components/TerminalPane
```

### Task 13 — Start with a real-sequence xterm E2E

**Files:**

- Create `tests/e2e/terminal/specs/pty-progress.spec.ts`.

Drive real shell output such as `printf '\033]9;4;3\007'` and assert:

- indeterminate appears;
- `normal 42 → normal 80` updates width;
- `remove` hides the bar;
- a background pane's progress creates no notification badge;
- exiting one pane removes only its state while another pane remains active.

Run the targeted red/green E2E:

```bash
npm run test:e2e:build
npm run test:e2e:terminal:run -- --spec tests/e2e/terminal/specs/pty-progress.spec.ts
```

### Task 14 — Verify native Ghostty and environment scope

**Files:**

- Extend `tests/e2e/terminal/specs/ghostty-runtime.spec.ts`.
- Extend `tests/e2e/terminal/specs/pane-environment.spec.ts`.
- Modify `.github/workflows/e2e.yml` so the existing macOS Ghostty E2E run step inherits `TERM_PROGRAM=outer-terminal` and `TERM_PROGRAM_VERSION=999`; do not add another macOS job.

Add coverage that the same shell-emitted reports update renderer header DOM while the native surface remains usable. Refactor `pane-environment.spec.ts` so its environment probe can read either the ordinary xterm buffer or the native Ghostty grid instead of skipping ordinary runs. Supply inherited sentinel values in both modes: ordinary xterm must report them absent, while native transport must replace them with `ghostty` and `1.3.2`. Keep the indicator in header DOM, never over the native `NSView`.

Run only the ordinary-mode assertion on the current machine, with explicit inherited values so removal is observable. The native assertion is delegated to the Draft PR's macOS runner.

```bash
npm run test:e2e:build
npx cross-env TERM_PROGRAM=outer-terminal TERM_PROGRAM_VERSION=999 npm run test:e2e:terminal:run -- --spec tests/e2e/terminal/specs/pane-environment.spec.ts
```

### Task 15 — Open Draft PR and require macOS Ghostty E2E

Push `feature/vim-281` and open a Draft PR targeting `feature/vim-411-notification-watcher`. Keep it draft while GitHub runs:

- `E2E Ghostty terminal smoke (macOS)`, including the native progress and environment cases from Task 14;
- `Native Ghostty macOS Smoke`;
- the Linux E2E and ordinary code-quality/test jobs.

The macOS environment test supplies inherited `TERM_PROGRAM=outer-terminal` and `TERM_PROGRAM_VERSION=999` in its workflow step, then asserts the native PTY sees `ghostty`/`1.3.2`. If either native job fails, download its diagnostics, fix on the same branch, and push while the PR remains draft. Mark the PR Ready for review only after all required jobs are green:

```bash
gh pr checks --watch
gh pr ready
```

Do not make readiness depend on running authenticated Claude/Kimi inside a GitHub-hosted runner; the automated native test validates their real OSC protocol frames through the production Ghostty runtime.

### Task 16 — Manual installed-agent pilot when a development Mac is available

On a development Mac with the installed agents and credentials, repeat the August pilot in packaged native Ghostty with Claude Code 2.1.220 and Kimi Code 0.31.1. Record active/clear indicator behavior and verify progress keepalives and OSC-terminating `BEL` never enter the notification island. This strengthens release evidence but does not block Draft-to-Ready when that machine is unavailable; the macOS CI runtime case is the required automated gate.

Phase 3 gate: xterm and native Ghostty share application-state behavior; reduced motion is static; session exit leaves no timer or cross-pane state orphan.

## Final verification

Run the complete local/platform-independent gate before opening the Draft PR:

```bash
cargo test --manifest-path crates/backend/Cargo.toml
npm run generate:bindings
npm run test:coverage
npm run lint
npm run type-check
npm run build
npm run test:e2e:terminal
```

The configured 80% coverage floor is mandatory. The macOS commands run in the Draft PR through `.github/workflows/e2e.yml`; do not attempt them on the current non-macOS machine. Commits must be atomic, use the repository's Conventional Commit format, and include `Co-Authored-By: codex <codex@openai.com>` exactly once. Any need to touch `WorkspaceView`, `TerminalZone`, `SplitView`, session models, agent adapters, the libghostty Swift/C bridge, dependencies, or persistence means the design contract has changed; update the design before continuing.
