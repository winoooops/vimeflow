# Ghostty Renderer Pivot Retrospective — Resume-Lag Investigation → Renderer-Owned WASM

> **Date:** 2026-06-26
> **Scope:** A multi-day investigation into slow codex-session **resume** on the Ghostty terminal path. It opened as a render-perf bug, was localized layer-by-layer through a chain of micro-benchmarks, and resolved into an **architecture pivot**: move the Ghostty VT out of the Rust sidecar and into the renderer as WASM (`@wterm/ghostty`), crossing the Electron boundary with **raw PTY bytes only**. Implemented by Codex in **PR #626** — `feat(terminal): Run Ghostty VT in renderer WASM` (branch `feature/vim-231-renderer-wasm`, base `feature/ghostty-wasm-integration`; implementation diff was 40 files, +2114/−415 before this retro was added). Touches VIM-231 (resume lag), VIM-236 (renderer-owned WASM), VIM-237 (agent-status replay coalescing), VIM-235 (dirty-delta, deferred).
> **Outcome:** The full-viewport snapshot-over-IPC model is eliminated. The WASM path is **dark-launched** behind `VITE_RENDERER_GHOSTTY_WASM=1`; xterm.js stays the production default. The investigation also surfaced two things the pivot does **not** resolve — an orthogonal _launch-environment_ cause of the specific resume lag, and a _reattach/reload_ survivability gap the pivot newly introduces. Predecessor: [`2026-05-27-terminal-rendering-investigation.md`](2026-05-27-terminal-rendering-investigation.md).

## TL;DR

"codex resume is slow on the Ghostty path" looked like one render bug. It was a stack of independent layers, and untangling them took **measurement, not hypothesis** — a fresh micro-benchmark at each step, several of which refuted a plausible guess (including one of mine and one of Codex's).

| Layer probed                | What was measured                                                                                                        | Verdict                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Frontend DOM render         | renderer probe: parse/ingest/paint ≈ 1 ms/frame                                                                          | fast — ruled out                                                    |
| The freeze                  | synchronous `vt_write` drained the whole burst before the post-drain flush → cadence collapsed to ~1 fps                 | **fixed**: flush on the frame clock _inside_ the drain (`4636b029`) |
| A 6 s main-process block    | `[ipc-drain]` probe: the sidecar stdout drain was always < 30 ms                                                         | **refuted** Codex's "unbounded drain" hypothesis                    |
| "slow vs native" throughput | `ghostty.rs` micro-bench: full-viewport snapshot ≈ **140–180 KB JSON/frame, 17–21× amplification**                       | **the architecture problem** → VIM-236                              |
| Row-delta to shrink it      | measured: a **1-line scroll dirties 100 % of viewport rows** (viewport-relative dirty)                                   | won't help the flood; deferred → VIM-235                            |
| Non-blocking emit (P0)      | `try_emit_json` drop-on-full; measured **zero drops / zero backpressure** on this workload                               | correct hardening, **not** the lever                                |
| codex's per-step drip       | `[pty-read]` `read_ms` vs `send_ms`: reader **waits on `read()`**, send ≈ 0                                              | codex self-paces; our pipeline is not the throttle                  |
| The startup handshake       | codex queries DA1/CPR/kitty **once**; libghostty answers all via `on_pty_write`                                          | DA1 responder helped ~26 %, still not the lever                     |
| `TERM=xterm-ghostty`        | broke terminfo apps (vim/less); drip unchanged                                                                           | **reverted**                                                        |
| The launch environment      | `BASH_ENV`/`ENV` make every non-interactive shell child codex spawns re-source `init.sh` (a `tr\|grep\|tr` PATH rewrite) | strong, **unconfirmed**, **orthogonal to #626**                     |

The durable result is not any single fix. It is that the chain of measurements localized **two** independent causes — an architectural one (snapshot IPC amplification, the basis for the pivot) and an environmental one (the shell-init tax, which the pivot does not touch) — and that the architectural finding led to a _decision_ (renderer-owned VT) rather than another patch.

## What #626 actually implements (grounded)

The old "libghostty Rust" model — libghostty-vt in the Rust sidecar, shipping a rows+cells JSON snapshot per frame — lived on the `rust-libghostty-vt` lineage (commit `7cd08bd5`), **not** in this PR's base. #626 sits on `feature/ghostty-wasm-integration`, a plain-PTY-byte backend, and moves the VT into the renderer:

- **WASM core + adapter** — `wtermGhosttyTerminal.ts:52-118`: `createWtermGhosttyTerminal` is async — awaits fonts, dynamically `import()`s `@wterm/dom` + `@wterm/ghostty`, `GhosttyCore.load({ scrollbackLimit: 10000 })` fetches/instantiates `ghostty-vt.wasm` (419 KB), then `new WTerm(...)` + `init()`. `GhosttyCore` owns grid/cursor/scrollback/alt-screen/bracketed-paste/cursor-keys in WASM heap; **no React state mirrors it**. The adapter conforms to a new `TerminalIo` seam.
- **Anti-double-paint by construction** — `wtermGhosttyTerminal.test.ts:100-137` proves 120 synchronous `write()`s flush 120 raw writes into the core but schedule **exactly one** rAF, and `destroy()` cancels the pending frame. This is the structural answer to the VIM-231 double-paint that rAF-over-snapshot could never _guarantee_.
- **Raw-byte transport** — `commands.rs:1182-1194`: each PTY chunk is base64-encoded into a new `data_bytes_base64` field; `desktopTerminalService.ts:25-40` decodes to `Uint8Array` (`rawData`); `useTerminal.ts:263-281` uses `rawData ?? data`. `byte_len` is the authoritative cursor unit. `base64 = "0.22"` added to `Cargo.toml`; **no Rust VT/snapshot code was removed (none was on this base)**.
- **Renderer selection / fallback** — `terminalRendererMode.ts:3-12`: `'ghostty-wasm'` only for `'1'`/`'true'`, else `'xterm'` (opt-out-of-the-experiment). `Body.tsx:665-715`: a `disposed`-guarded mount effect; on any init error it **silently** `setActiveRendererMode('xterm')`.
- **OSC7 moved to the renderer** — `osc7.ts:9-74`: a new **streaming** `createOsc7CwdExtractor` (cross-chunk buffer, split-`ESC]7;` handling, both terminators, 8192-byte cap), sharing `applyOsc7Cwd` with the xterm `registerOscHandler(7)` path.
- **Agent-status replay coalescing (VIM-237)** — `events.rs:95-195` (`ReplayActivity` accumulator), `transcript.rs` codex `267-296` / claude `303-332` (one-shot `replay_done` gate at `on_caught_up`), `useAgentStatus.ts:848-902` (single `agent-replay-summary` listener, dedup seeded from `recentToolCalls` only). Codex + Claude Code only.

## What worked

### Measurement gated the architecture decision — and refuted two confident guesses

The pivot was not chosen because "WASM feels more native." It was chosen because a Rust micro-bench (`ghostty.rs`, run behind `#[ignore]`) put a hard number on the model: a full-viewport snapshot serializes to **~180 KB JSON, 17–21× the input bytes**, every frame. That single number reframed the work from "make the snapshot faster" to "stop shipping the snapshot." The same discipline killed two plausible patches before they shipped: an `[ipc-drain]` probe showed the sidecar stdout drain was never the 6 s block (refuting Codex's hypothesis), and a dirty-row count showed a 1-line scroll dirties **100 %** of viewport rows, killing the row-delta idea (VIM-235) before any protocol work. The lesson from the predecessor retro held again: _a fix written before the mechanism is confirmed is a guess wearing a fix's clothes._

### The wterm boundary is the right one, and Codex picked the cleanest seam

The architecturally correct insight — borrowed from wterm via the VIM-236 spike — is "send **bytes**, not the rendered framebuffer." #626 honors it precisely: the only thing crossing the boundary is raw PTY bytes; the VT/grid/cursor/scrollback live where the renderer can read them synchronously. The `TerminalIo` interface (`useTerminal.ts:5-15`) is a genuinely narrow seam — xterm's `Terminal` satisfies it **structurally with zero adapter**, so no xterm-specific logic leaked into the hook, and either renderer drives the same code path.

### Codex's review rigor is visible in the diff

Three review-round corrections are baked in and worth naming: the renderer flag was fixed to default **opt-out** (the first cut defaulted unknown values to the experiment); the frontend dedup was narrowed to seed from `recentToolCalls` **only, not** `activeToolCall.toolUseId` (including it made the live completion a false duplicate) — which exactly mirrors `ReplayActivity::record_completed`'s contract; and the `write` callback's "accepted, not rendered" semantics are **documented in the interface JSDoc** rather than hidden. The OSC7 extractor is a refactor (shared `applyOsc7Cwd`), not a duplicate parser.

### Dark-launch behind a flag with xterm intact

Shipping the whole VT pivot behind `VITE_RENDERER_GHOSTTY_WASM=1`, prod-off, with xterm.js as the untouched default, is the right risk posture for a 419 KB WASM dependency that changes where terminal state lives.

## Friction points

### A lot of motion before the decision

P0 (non-blocking emit), the DA1/CPR/DSR responder, `TERM=xterm-ghostty`, the reverted "coalesce/drop-frames" — several of these were built, measured, and either kept-as-hardening or reverted. Two (`TERM`, coalesce) actively _broke or regressed_ before being pulled. The investigation was correct in the end, but the early stretch had the same guess-measure-revert rhythm the predecessor retro warned about. The redeeming difference this time: each attempt left a **measurement** behind, so the reverts were cheap and the dead ends stayed dead.

### The pivot doesn't fix the symptom that started it — and that's not in the PR

The specific "codex resume drips over 30 s" turned out to be, with high but **unconfirmed** confidence, the `BASH_ENV`/`ENV` shell-init tax: every non-interactive shell codex (and its MCP servers) spawns re-runs `init.sh`'s `tr|grep|tr` PATH rewrite — Claude-statusline plumbing useless to codex, applied unconditionally because the bridge is enabled before the agent is known. That is a **launch-environment** problem, orthogonal to the renderer. #626 changes the rendering boundary; it does nothing about the per-subprocess tax. So the user-visible resume lag and the architecture pivot are **two separate tracks that got conflated** under one VIM-231 banner, and only one of them is in #626.

### Moving state into the renderer reopened the exact resume scenario — lossily

This is the most important honest line in the retro. With the VT now in the renderer, **reattach/reload survivability is unproven and partly broken**: the restore/attach drain (`useTerminal.ts:~393-405`) replays `restore.replayData` + buffered events as **strings** via `terminal.write(data)` — it does **not** pass `rawData`. `rawData` is **live-only**. So a _restored_ session feeds the byte-native WASM VT lossy UTF-8, and renderer-owned state does not survive a full renderer reload without rehydration through that lossy path. The pivot was motivated by fixing _resume_; its current resume story is the weakest part of it.

### Always-on base64 double-transmit taxes 100 % of users for a dark-launch feature

Rust emits **both** `data` (lossy string) and `data_bytes_base64` (~33 % inflation) for every chunk, on both paths. The `skip_serializing_if = "Option::is_none"` never fires (always `Some`), and the default xterm path ignores `rawData` entirely — so the base64 blob is pure per-frame waste shipped to everyone, to avoid a second IPC event type.

### Scope: two large features in one PR

The VIM-237 agent-status coalescing is ~700 lines Rust + ~500 lines TS — nearly as large as the WASM pivot — bundled into the same PR. It also started as **parallel branch work**: the same coalescing was independently committed on the `feature/vim-231` lineage this session (`464c1c4b`) and later folded into #626 as `0d44904e`. That resolves the divergence for this PR, but it is still a useful warning: two correct implementations of one feature, on two lineages, is duplicated effort and a merge hazard.

### Silent fallback hides asset-pipeline failure

If `ghostty-vt.wasm` (fetched via `new URL(..., import.meta.url)`) isn't copied to the build output, or WASM load fails, init throws and `Body.tsx:701-703` **silently** falls back to xterm with no telemetry or user signal — a broken feature is indistinguishable from a disabled one.

## What we'd do differently

1. **Separate the symptom track from the architecture track up front.** "Resume is slow" (launch-env / `BASH_ENV`) and "the snapshot boundary is wrong" (the pivot) are different problems. Conflating them under VIM-231 cost cycles chasing render-side fixes (DA1, TERM) for a shell-spawn problem. Triage by _where the time is spent_ (reader `read_ms` was the tell: codex self-pacing, not us) before choosing a track.
2. **Confirm the cheap hypothesis before the expensive one.** The `BASH_ENV` tax has a 10-second, zero-rebuild confirmation (`env -u BASH_ENV -u ENV` then time shell spawns). It should have been run before — not after — investing in a renderer rewrite, because if it fully explains the symptom, the rewrite is justified on _architecture_ grounds but not on _this bug_.
3. **Design the reattach/reload contract before moving state into the renderer.** The byte-vs-string restore path is the load-bearing gap. Renderer-owned VT needs a defined rehydration story (raw replay bytes, or a backend grid snapshot for cold reload) decided in the spec, not discovered in review.
4. **Don't ship a per-frame cost to 100 % of users for a 0 %-enabled feature.** Gate `data_bytes_base64` on the active renderer (or a per-session capability), or use a distinct event — the dark-launch should be free for the default path.
5. **Split the PR.** Renderer pivot and agent-status coalescing are independent; one review surface each. And pick the branch lineage up front so the agent-status work isn't built twice.
6. **Make WASM-init failure observable.** Replace the silent xterm fallback with at least a logged/telemetered signal so "the feature didn't turn on" is diagnosable.

## Deferrals tracked

- **`BASH_ENV`/`ENV` subprocess tax (unconfirmed).** Strong, converged, file-located (`commands.rs:262-263` exports them; `bridge.rs:183-196` is the per-invocation `tr|grep|tr`). Confirmation test: `env -u BASH_ENV -u ENV codex resume <id>` vs plain. Fix sketch: repoint the interactive `--rcfile`/`ZDOTDIR` hooks at the already-set `$VIMEFLOW_AGENT_INIT` and drop the global `BASH_ENV`/`ENV` export (the shim PATH inherits to children via the interactive shell). **Not in #626.**
- **Reattach / renderer-reload for the WASM path.** The restore drain feeds lossy strings; `rawData` is live-only. Needs a raw-byte (or backend-snapshot) rehydration path. Highest-priority follow-up for the pivot.
- **WASM clipboard + context menu.** `useTerminalClipboard` gets `xtermTerminal = null` on the wasm path; copy/paste/`pasteImage` no-op while the menu still renders (`Body.tsx:1108-1141`).
- **Live theme switching** on the wasm path — `applyTheme` is one-shot at mount; no `themeService` subscription.
- **`data_bytes_base64` waste** — always-`Some`, ignored by the default path.
- **Kimi + OpenCode replay coalescing** — VIM-237 covers Codex + Claude Code only; the other two still flood per-line on resume.
- **Generated binding freshness.** `AgentReplaySummaryEvent` is `#[cfg_attr(test, derive(ts_rs::TS))]`, while `src/bindings/*.ts` are generated and ignored except for the hand-maintained barrel `index.ts`. Stale local generated files can miss `activeToolCall`; `npm run type-check` regenerates them before checking and currently passes.
- **Row-delta dirty-delta (VIM-235)** — measured useless for scroll/flood; only helps in-place output. Backlog, not part of this work.

## Pointers

- PR: **#626** — `feat(terminal): Run Ghostty VT in renderer WASM` (branch `feature/vim-231-renderer-wasm`)
- Linear: **VIM-236** (renderer-owned Ghostty WASM), **VIM-231** (codex resume lag), **VIM-237** (agent-status replay coalescing), **VIM-235** (dirty-row delta), **VIM-139** (Ghostty migration tracker)
- Session commits on the `feature/vim-231` lineage: `4636b029` (`perf(terminal):` mid-drain freeze fix + VIM-231 rate-floor, not in #626), `464c1c4b` (`feat(agent-status):` replay coalescing, later folded into #626 as `0d44904e`)
- Deps: `@wterm/ghostty` / `@wterm/dom` `^0.3.0` (`ghostty-vt.wasm` 419 KB); Rust `base64 = "0.22"`
- Verification listed on the PR: `generate:bindings`, `type-check:generated`, `backend:build`, `VITE_RENDERER_GHOSTTY_WASM=1 npm run electron:dev` reaches ready. This retro move was also checked with `npm run type-check -- --pretty false`. Manual smoke still open: codex-resume flood on the WASM path, multi-pane, **renderer reload / reattach**, scrollback / alt-screen / selection-copy / resize, mouse / clipboard / bracketed-paste / terminal queries.
- Predecessor retro: [`2026-05-27-terminal-rendering-investigation.md`](2026-05-27-terminal-rendering-investigation.md)
- Memory anchor for the investigation mechanics: `ghostty-engine-driven-scroll` (the snapshot flat-string model, the `vt_write`-drain freeze, the refuted dead-ends, and why row-delta/coalesce don't fix the flood).
