# PTY winsize atomicity — engine-side TIOCSWINSZ via fd passing

**Status**: codex-approved (6 review rounds, 2026-07-29)
**Branch**: `fix/pty-winsize-atomicity` (worktree off `main` @ `7b6b05a9`)
**Scope**: macOS native-Ghostty panes only. xterm.js / Linux path untouched.

## Problem

During continuous divider drags on a streaming codex pane, the bottom composer
visibly jumps. Grid-truth sampling (diag spec, 2026-07 campaign) proved the
terminal state is correct at rest: composer offset-from-bottom = 2 in
1062/1067 samples. The one anomaly is the smoking gun — a sample taken 116ms
after a resize step showed the composer 26 rows off-bottom. That is the
**per-step transient**: the engine reflows the grid at the new size first,
and the TUI's corrective repaint only lands after SIGWINCH round-trips.

- Gentle steps (1.2s apart): one ~20–50ms transient per step, barely visible.
- Continuous drag: transients chain end-to-end → the sustained jumping.

Stock Ghostty is immune **by construction**: its `Termio.resize` applies
`TIOCSWINSZ` on the IO thread in the same beat as the grid reflow, so the
transient is only the TUI's own repaint latency (a few ms, sub-frame).

Our host-managed architecture cannot match that today. The winsize travels:

```
engine IO thread → Swift resizeCallback → cc addon → Electron main (JS)
  → sidecar IPC → Rust PtyState::resize → ioctl(TIOCSWINSZ)
```

Every hop is asynchronous; the total is the 20–50ms transient. Three
mitigation attempts confirmed no knob on this path fixes it: surface throttle
tuning (56/96ms), PTY throttle 0ms, and `presentsWithTransaction` all failed.
This is an architecture gap, not a tuning gap.

## Fix

Apply winsize **synchronously at the engine boundary**, exactly where stock
does it.

- **fd source**: `ManagedSession.master` (`crates/backend/src/terminal/state.rs:147`);
  `MasterPty::as_raw_fd()` is Unix-only and returns `Option` — treat `None`
  as "feature unavailable, stay on the async path".
- **ioctl hook**: the cc addon's `OnResize`
  (`native/ghostty-parent/ghostty_native_parent.cc:353`) and
  `OnSecondaryResize` (`:397`), **before** their nonblocking JS enqueue —
  not in Swift, and not in the fork. The fork's host-managed callback already
  runs from `HostManaged.resize` _before_ Ghostty's grid resize (documented
  in the pinned fork), so an ioctl here lands winsize-before-reflow —
  stock-identical ordering with **zero fork changes**.
- **Rust's shared ioctl** lives in `PtyState::resize` (`state.rs:537`),
  called from `resize_pty_inner` (`commands.rs:509`). Note:
  `resize_pty_inner` does _no_ other bookkeeping — there is no bookkeeping
  to preserve; the async resize IPC simply stops mattering for sessions in
  `NATIVE_ACTIVE` (below).

### Ownership state machine (per session, per role)

"fd arrived" is NOT "native writer is healthy". Explicit states, with the
exact cross-channel message sequence:

```
RUST_OWNED ─fd sent─▶ PENDING ─bindPty─▶ BOUND* ─native-ready─▶ NATIVE_ACTIVE
    ▲                                  (native writes;                │
    │                                   Rust still writes)            │
    └◀─ release{…rows,cols} + release-ack + flush ◀── RELEASING ◀─────┘
                             (keeps writing + recording until release-ack;
                              only a failed fd stops writing)
```

**Invariant: at every instant at least one side ioctls.** Ownership
transitions therefore **overlap** — duplicates during transitions are
explicitly permitted and bounded (a repeated TIOCSWINSZ with the same size
is benign); zero-writer windows are forbidden by construction, not by ack
timing.

**Activation sequence** (overlap-ordered; acks confirm, they never gate the
writer that is starting):

1. Rust sends `{sessionId, generation, leaseId, fd}`; the addon parks it in
   a pending map keyed by `(sessionId, generation, leaseId)` — no slot
   binding yet. `leaseId` is a Rust-side monotonic counter, fresh per
   transfer; every subsequent message about this binding carries it.
2. Electron main calls `bindPty(handle, role, sessionId, generation, leaseId)`
   (new addon export) where it already resolves `sessionId:paneId` to a
   handle; the fd moves from pending map to the slot. **The slot starts
   ioctling immediately** — Rust is still ioctling too; both writers
   overlap.
3. The addon sends `native-ready {sessionId, generation, leaseId, role}`;
   on receipt Rust stops ioctling for that lease and replies `activate-ack`
   (confirmation/telemetry only). A lost `native-ready` or ack merely
   extends the duplicate window; it can never create a gap.

**Release sequence** (teardown, remount, ioctl error) — make-before-break,
mirroring activation:

1. Under the slot mutex the slot enters `RELEASING`: it **keeps ioctling**
   and keeps recording the latest size. The only exception is an actually
   failed ioctl, which gets a bounded gap of one transport hop — it cannot
   write, by definition.
2. The addon sends `release {sessionId, generation, leaseId, rows, cols}`
   with the last size it was asked to apply, **retried (idempotent by
   lease) until acknowledged** — a dropped ack on a healthy channel must
   not strand the session. On receipt Rust reacquires ownership for that
   lease (clears its skip flag first, then applies the release size via
   `PtyState::resize`) and replies `release-ack`.
3. Only after `release-ack` does the slot stop ioctling and close the fd,
   then **flush** the newest size recorded during `RELEASING` through the
   ordinary JS path — now Rust-owned, so it is applied. This closes the
   race where a newer resize reaches Rust before the release and would
   otherwise be skipped, and the older snapshotted release size would win.
4. **Channel breakage is not a release** — the exchange cannot complete on
   a dead transport. On transport EOF/error: Rust immediately reclaims all
   leases (resumes ioctling everywhere); the addon closes all slots and
   pending entries without awaiting acks. Both sides act unilaterally; the
   overlap invariant holds because Rust reclaims before or concurrently
   with the addon stopping.
5. Tests cover paused/lost acks, ack retry, and cross-channel reordering
   explicitly.

**Staleness**: messages are validated against `(generation, leaseId)`. The
lease distinguishes two bindings of the _same_ PTY generation (remount /
surface recreation), so a delayed `release` from the old surface cannot
clear ownership of, or restore an obsolete winsize onto, the replacement
binding. Overlapping remounts additionally serialize: a new `request-fd`
for a session is answered once the previous lease is **retired**, defined
as exactly one of: the addon received `release-ack`, or transport loss.
There is no third conclusion — release is retried until acked, and Rust
acks every idempotent receipt, so a dropped ack is recovered by the next
retry and can only delay, never block, reacquisition. (Rust's skip flag is
cleared on the _first_ release receipt, so continued retries never prolong
skipping.)

**Re-acquisition**: after release/teardown, a recreated surface has no fd.
Electron main sends `request-fd {sessionId}`; Rust dups and re-sends with
the current generation and a fresh lease, re-entering activation step 1.
**Exit cleanup rides the transport exclusively** as
`detach {sessionId, generation, leaseId}` — there is no `pty-exit`-driven
native cleanup hook (the existing `PtyExitEvent` carries no generation and
stays untouched), so a delayed exit can never close a newer binding.

**Pending-map hygiene**: descriptors that never reach a slot are still owned
resources (RAII). A pending entry is closed and removed on: stale or
duplicate delivery for its key, `bindPty` failure, `detach` for its session,
and transport shutdown. The Phase 2 leak test includes the never-bound case.

### Surface object model (finding 2)

There is no `surfaceId`. Electron keys pane state by `sessionId:paneId`
(`electron/ghostty-native-parent.ts:432`); the cc side holds a
`SurfaceHandle` that can own **two** sessions — primary (`OnResize`) and
secondary/burner (`OnSecondaryResize`). Therefore: **two fd slots on
`SurfaceHandle`, keyed by role**, each bound to `{session generation}`,
each independently replaceable/removable, and each callback only ioctls its
own role's slot. Secondary replacement (burner swap) rebinds only the
secondary slot.

Binding is an explicit control-plane operation, not inferred from the fd
message: received descriptors are retained by
`(sessionId, generation, leaseId)` in the pending map, and
`bindPty(handle, role, sessionId, generation, leaseId)` — called
where Electron main already resolves `sessionId:paneId` to a handle — joins
session-owned transport state to handle-owned native state. No new registry
abstraction in Electron.

> **Phase 2 implementation note**: the JS-facing `bindPty` signature is
> `(surface, role, sessionId)` — generation and lease live purely between
> Rust and the addon (Electron main never sees them), so the addon resolves
> the pending entry by session id. Safe because Rust serializes to one
> active lease per session and a superseding delivery closes the older
> pending fd. The spec tuple still governs every wire message and staleness
> check. Likewise `request-fd` is sent by the addon (from inside `bindPty`
> when no pending fd exists) rather than by Electron main — same wire
> message, one fewer API surface.

### Transport bootstrap (finding 3)

`spawnSidecar` (`electron/sidecar.ts:488`) exposes only stdio 0–2 today, and
the addon loads lazily after spawn. Phase 1 changes:

1. A small addon transport initializer (new cc export) creates the
   `AF_UNIX` socketpair **before** sidecar spawn; the addon owns the parent
   end for its lifetime.
2. `spawnSidecar` passes the child end explicitly as `stdio[3]`; both
   processes close the end they don't own after spawn. Inheriting via
   `stdio[3]` clears close-on-exec on that descriptor, and the backend
   spawns many ordinary subprocesses — so Rust sets `FD_CLOEXEC` on fd 3
   **first thing in bootstrap**, before any subprocess can spawn, with a
   test proving an exec'd child cannot observe it (an inherited endpoint
   would wedge EOF/channel-failure detection).
3. Rust sends `{sessionId, generation, leaseId, fd}` via
   `sendmsg`+`SCM_RIGHTS` — no `role`: Rust doesn't know it; Electron owns
   the role and supplies it in `bindPty`
   using **libc** (already a direct dependency — `Cargo.toml:56`; `nix` is
   not).
4. The cc receiver sets `FD_CLOEXEC` on the received descriptor immediately
   after `recvmsg` (sender-side CLOEXEC does not transfer).
5. Feature-detect: if the socketpair can't be established or the addon is
   absent (Linux/dev), everything stays `RUST_OWNED` — today's behavior.

Kill switch: `VIMEFLOW_PTY_FD_DIRECT=0` disables fd passing entirely.
Default ON once Phase 5 passes.

### Teardown and concurrency (finding 4)

`resetSurfaceScopedCaches` only resets theme/keybinding caches — it is not a
lifecycle hook for this. Instead:

- One **ownership mutex** per fd slot protects ioctl-vs-close: the IO-thread
  callback and the close path serialize, eliminating the fd-number-reuse
  ioctl hazard.
- Cleanup routes: surface teardown, secondary removal/replacement, PTY exit,
  window close, surface recreation — each triggers release-to-Rust then
  close. PTY exit is cleaned up via the transport `detach` message only
  (`pty-exit` today only broadcasts to renderers, `electron/main.ts:760`,
  and stays that way — it carries no generation and must not drive native
  cleanup).
- Release is idempotent by `(generation, leaseId)`; double-release is a
  no-op.

## Does this affect other coding agents?

Yes — **all native-ghostty panes** (claude, codex, kimi, opencode, plain
shells) switch to atomic winsize. The effect is strictly toward stock-Ghostty
semantics for every one of them:

- **codex**: the target — composer transient collapses to codex's own repaint
  latency (few ms).
- **claude**: keeps its 96ms per-surface resize throttle (that gates _when_
  the engine applies a resize; this change only makes the winsize ride each
  applied resize atomically). Expected neutral-to-better; reducing the
  throttle later is out of scope here.
- **kimi**: its flicker is upstream pi-tui fullRender (kimi-code#2324),
  orthogonal; expected neutral.
- **shells / burner terminals**: neutral-to-better; the secondary fd slot
  gives burners the same atomic path. Kernel delivers SIGWINCH to the
  foreground process group regardless of which process holds the dup, so
  agent-observable behavior is unchanged.

The per-agent A/B in Phase 5 verifies each of these instead of assuming.

## Phases

Each phase lands compiling + tested before the next starts.

**Phase 1 — fd transport spike (Rust + cc, no UI).**
Socketpair-before-spawn bootstrap (above); libc `sendmsg`/`recvmsg` with
`SCM_RIGHTS`; receiver CLOEXEC. Proof test: open a real PTY in a Rust
integration test, transfer the fd, ioctl from the receiver, assert the owner
reads the new size via `TIOCGWINSZ` and the child observes SIGWINCH.

**Phase 2 — per-session wiring + state machine.**
Attach flow sends `{sessionId, generation, leaseId, fd}`; electron
main resolves
to the `SurfaceHandle` role slot. Implement the overlap-ordered state
machine (PENDING / BOUND / NATIVE_ACTIVE / RELEASING) with lease-stamped
messages. Lifecycle cleanup on all five teardown routes. Tests: handover
ordering, lost/paused acks, cross-channel reordering, native-failure
fallback with RELEASING flush, same-generation remount with stale release,
secondary replacement, generation reuse, leak assertion including
never-bound pending entries, at-least-one-writer at every instant.

**Phase 3 — ioctl at `OnResize`/`OnSecondaryResize`.**
Synchronous `ioctl(fd, TIOCSWINSZ)` under the slot mutex whenever the slot
holds a healthy bound fd — states `BOUND`, `NATIVE_ACTIVE`, and `RELEASING`
(matching the make-before-break overlap; only a failed fd stops writing) —
before the JS enqueue. No fork changes (callback ordering already
winsize-before-reflow).

**Phase 4 — single-writer in Rust.**
`PtyState::resize` consults Rust's own per-lease ownership flag (set on
`native-ready`, cleared by `release` or transport loss); skip ioctl while
native-owned (still updates any cached rows/cols used for reattach). The
JS→Rust `resize_pty` invocation is **retained on every path** — it is the
fallback channel and the RELEASING flush target; for native-owned sessions
it is metadata-only (Rust skips the ioctl). Only the PTY-side
leading+trailing throttle (`GHOSTTY_RESIZE_THROTTLE_MS`,
ghostty-native-parent.ts) is bypassed for native-owned sessions — a
metadata-only message needs no coalescing, and delaying it would stale the
cached dimensions.

**Phase 5 — validation.**

- **Native monotonic timestamps** (callback-entry → ioctl-return) prove the
  sub-frame bound; the archived ~34ms diag spec cannot measure <5ms — it is
  retained only as visual regression ("the 20–50ms anomaly class is gone").
- Manual continuous-drag A/B by the operator: codex streaming + fast drag
  (the original repro), plus claude / kimi / shell / burner spot checks.
- Full e2e terminal suite green (the #746 specs cover remount + resize
  coherence; they do not exercise fd ownership — the Phase 2 tests do).
- Sweep stray Electron/backend processes after runs.

### Validation protocol

The instrumentation lives in `ApplyPtySlotWinsize` and reports to the
Electron process's stderr. Three lines matter:

| Line                                                            | Meaning                                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fd broker: native owns winsize for <session> (gen N, lease N)` | The handshake completed; the addon holds the fd.                                                                                                                              |
| `vimeflow: winsize ioctls=N mean=… max=… buckets(…)`            | The native path is carrying real resizes, with the latency distribution. Emitted on the first sample, then every 128, then a `winsize final` tally when the transport closes. |
| `vimeflow: winsize ioctl exceeded the sub-frame bound: …us`     | Never expected. One of these is a regression of the whole design.                                                                                                             |

**Liveness first.** Bootstrap failure degrades to the async path _by
design_, so a run with no `native owns winsize` line and no `winsize
ioctls` line proves nothing about the fix — it measured the old code.
Confirm both lines before judging any A/B.

**Operator A/B** (`npm run dev` on this branch, watching the terminal
Electron was launched from):

1. Start a codex pane and give it work that streams for a while.
2. Drag the pane divider continuously and quickly, back and forth.
3. Read the `winsize` summary: every bucket should sit in `<100us` /
   `<1ms`; `>=5ms` must be 0.
4. Watch the composer: it should stay pinned to the bottom the way stock
   Ghostty's does, instead of floating up and resettling per step.
5. Repeat for claude (alt-screen, 96ms surface throttle), kimi, a plain
   shell, and a burner pane — the change is global, so each gets a look.
6. Control run: `VIMEFLOW_PTY_FD_DIRECT=0 npm run dev` reproduces the old
   behavior on demand (no handshake line, no ioctl line).

### Results

**The bound holds under a real continuous drag.** Operator run on this
machine, native path confirmed live (`native owns winsize` present), codex
streaming while the divider was dragged back and forth:

```
vimeflow: winsize ioctls=128 mean=36us max=144us buckets(<100us/<1ms/<5ms/>=5ms)=121/7/0/0 failures=0
vimeflow: winsize ioctls=256 mean=38us max=444us buckets(<100us/<1ms/<5ms/>=5ms)=243/13/0/0 failures=0
```

256 samples, mean **38µs**, worst **444µs**, **nothing above 1ms**. The
20–50ms transient this design set out to remove is gone by three orders of
magnitude, and every sample sits well inside one 16.7ms frame. (Cold-launch
first resize measured 285µs; warm single samples 16–24µs.)

### Out of scope: the residual blank-flash

A second, unrelated artifact survives: during a fast drag the resized pane's
terminal content momentarily goes blank for ~2 frames and then repaints.
Frame-by-frame it is clearly a different failure from the composer float —
the content does not move, it disappears and returns, and only in the pane
being dragged (its sibling pane and vimeflow's own DOM chrome keep painting
in the very same frame). It is **not caused by this work**:

| Ruled out                                                | Evidence                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| This design (fd passing, single writer)                  | Reproduces on `343a8e2f`, which predates the entire campaign — and _worse_ there                      |
| The fork's settle-refresh / throttle / coherence patches | Reproduces on a pure upstream `libghostty-spm` build with none of them                                |
| Vimeflow's compositor or DOM layer                       | The sibling pane and the DOM status bar paint normally in the same frame                              |
| Vimeflow at all                                          | Stock Ghostty.app resizing a codex session shows the same jumping (smoother at a constant drag speed) |

What remains points at codex's own clear-and-repaint on SIGWINCH over a
large primary-screen transcript, together with the engine's reflow damage —
the same family as the earlier gray-band, whose genesis also reproduced in
stock Ghostty. Tracked separately; this spec's scope ends at winsize
atomicity, which is measured and met.

**Default state.** The feature has been on by default since Phase 1;
`VIMEFLOW_PTY_FD_DIRECT=0` is the opt-out. There is no flag to flip at
the end of Phase 5 — only the decision to leave it on.

## Risks

| Risk                                                  | Mitigation                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| fd leak (pane close, sidecar restart, Electron crash) | CLOEXEC both sides (receiver sets after recvmsg); five-route cleanup; leak assertion in Phase 2 tests |
| zero-writer window during handover/failure            | make-before-break overlap on both transitions; bounded duplicates permitted; at-least-one-writer test |
| dropped ack stranding a session                       | idempotent release retry; acks confirm, never gate a starting writer                                  |
| ioctl against a reused fd number                      | per-slot ownership mutex serializing ioctl vs close                                                   |
| stale messages after remount/generation change        | generation carried in every message; stale drops                                                      |
| ioctl blocking the engine IO thread                   | TIOCSWINSZ on a pty master is microsecond kernel work; timestamped in Phase 5                         |
| bootstrap failure on some setup                       | feature-detect → stay RUST_OWNED + one warning log; never worse than today                            |
| Linux/dev xterm path regression                       | untouched by design; e2e suite proves it                                                              |

## Out of scope

- Reducing claude's 96ms throttle (follow-up experiment after this lands).
- Upstreaming to Lakr233 (fork PR pack remains parked).
- kimi flicker (upstream kimi-code#2324).
