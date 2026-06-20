# opencode adapter — observability v1 implementation plan

Date: 2026-06-20
Spec: `docs/superpowers/specs/2026-06-20-opencode-adapter-design.md` (codex-reviewed)
Branch model: all milestones land as PRs into the umbrella branch `feat/opencode-support`; the final `feat/opencode-support → main` PR is gated on human verification.

## Definition of done (every PR)

Green, repo-wide, before the PR is opened:

- `cargo test --manifest-path crates/backend/Cargo.toml` (backend) — note: re-run `npm run generate:bindings` + prettier afterward; `cargo test` re-emits ts-rs bindings unformatted.
- `npm run lint` (eslint, repo-wide) · `npm run format:check` (prettier, repo-wide) · `npm run type-check` (tsc) · `npm test` (vitest).
- Each PR is self-contained, builds green, and is independently reviewable. Body carries `Part of VIM-<epic>` (not `Closes`) + the milestone's `VIM-<sub>`. Labels: `auto-review`, `auto-approve`.

## Sequencing

```
M1 ─┬─▶ M2 ─┐
    └─▶ M3 ─┴─▶ M4 ─▶ M5 ─▶ M6
```

M1 is the foundation (enum + frontend unions compile). M2 (plugin/DTO/fixtures) and M3 (locator) only need M1. M4 (decoder) needs the DTOs (M2) + types (M3). M5 (streamer + wiring) needs M3+M4. M6 (frontend branding) needs M1. Implemented strictly in order M1→M6 for the sequential-PR loop.

---

## M1 — Backend registration scaffold + frontend type plumbing

**Goal:** `AgentType::Opencode` exists end-to-end; opencode is detected and dispatched to `NoOpAdapter` (via the `other =>` fallback); the whole tree compiles and all enumeration guards/tests pass. No adapter behavior yet.

**Depends on:** none.

**Files (backend):**

- `crates/backend/src/agent/types.rs` — add `Opencode` variant to `AgentType` (after `Kimi`).
- `crates/backend/src/agent/config.rs` — `AGENT_SPECS` entry `{ Opencode, display_name: "opencode", binary_names: &["opencode"], home_subdir: Some(".local/share/opencode") }`; update `registry_covers_every_agent_type` (compile-time match **and** runtime loop) + `agent_type_for_binary_maps_canonical_names`.
- `crates/backend/src/agent/detector.rs` — `detects_opencode` test.

**Files (frontend, minimal — keep tree compiling):**

- `src/features/agent-status/types/index.ts`, `src/features/sessions/types/index.ts` — add `'opencode'` to the three unions.
- `src/features/agent-status/utils/agentStatusModel.ts` (`AGENT_TYPE_MAP` `opencode: 'opencode'`) + test.
- `src/features/sessions/utils/groupSessionsFromInfos.ts` (`KNOWN_AGENT_TYPES`).
- `src/features/sessions/utils/agentForSession.ts` (`AGENT_BY_SESSION_TYPE` — map `'opencode'` to a temporary `'shell'` AgentId until M6 adds the registry entry) + test.

**Work:** add the variant; satisfy `spec_for` (AGENT_SPECS) + both exhaustiveness checks; regenerate bindings (`npm run generate:bindings` then prettier); **verify the emitted wire string in `src/bindings/AgentType.ts` is literally `"opencode"`** (spec §9 gate) and align all frontend literals to it.

**Acceptance:** `cargo test` green (exhaustiveness + detector + binary-map); `npm run type-check`/`lint`/`test` green; `src/bindings/AgentType.ts` contains `"opencode"`. Running `opencode` in a pane is detected as an agent (NoOp adapter — no live status yet).

**Model:** Sonnet (mechanical enumeration) + Opus 4.6 to verify the wire-string/bindings gate.

---

## M2 — Bridge plugin + wire DTOs + auto-install + fixtures

**Goal:** the opencode-side bridge plugin exists and is auto-installed; the Rust wire DTOs round-trip the bridge JSONL; sanitized fixtures exist.

**Depends on:** M1.

**Files (new):**

- `crates/backend/src/agent/adapter/opencode/mod.rs` — `pub mod` declarations only (sub-modules added across M2–M5); add `pub mod opencode;` to `adapter/mod.rs`.
- `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts` — the bridge plugin (spec §4.1): `event` + `tool.execute.*` hooks, whitelist, line schema, per-session + index routing carrying `pid` (`process.pid`), data minimization (arg preview, output excerpt ≤2 KiB, `0600`), try/catch. Header `// vimeflow-bridge-version: 1`.
- `crates/backend/src/agent/adapter/opencode/install.rs` — `ensure_bridge_installed(plugins_dir: &Path)` (idempotent, version-gated; source via `include_str!`); `bridge_dir()` deriving `$VIMEFLOW_OPENCODE_BRIDGE_DIR ?? ${XDG_DATA_HOME:-~/.local/share}/vimeflow/opencode-bridge`.
- `crates/backend/src/agent/adapter/opencode/transcript_dto.rs` — `OpencodeLineDto` (flat, lenient), `OpencodeKind` enum (`event`/`tool.before`/`tool.after`, `#[serde(other)]`), `OpencodeEventType` enum (`#[serde(other)]`), index-row DTO. `serde_helpers::lenient_*` on every scalar.
- `crates/backend/src/agent/adapter/opencode/fixtures/sample_bridge.jsonl`, `sample_index.jsonl` — authored, sanitized (session.created/updated, message.updated user, step-finish, tool.before/after bash, session.idle).

**Work:** write the plugin (mirror the verified probe shapes); embed + install with a unit test writing into a temp `plugins_dir` and asserting idempotency + version-gating; DTO serde round-trip tests over the fixtures.

**Acceptance:** `cargo test` green (install idempotency, DTO round-trip, `bridge_dir()` literal-default test matching the plugin's rule); a `lenient_*` test proves a type-drifted field degrades to `None` not error; an unknown event type does not poison the line.

**Model:** Opus 4.8 (the plugin TS + the install/version semantics are the highest-judgment piece); Sonnet for fixtures.

---

## M3 — `OpenCodeLocator` + `types.rs` + path validator

**Goal:** given a PTY attach, resolve the correct `<sessionID>.jsonl` via `index.jsonl`, pid-first.

**Depends on:** M1, M2 (uses `bridge_dir()` + index DTO).

**Files (new):**

- `crates/backend/src/agent/adapter/opencode/types.rs` — `default_opencode_home()` (registry plumbing) + re-export `bridge_dir()`; `OPENCODE_CONTEXT_WINDOW_SIZE` const placeholder (`0` ⇒ unknown).
- `crates/backend/src/agent/adapter/opencode/locator.rs` — `OpenCodeLocator { bridge_root, agent_pid, pty_start, resolved: Arc<Mutex<Option<(String, PathBuf)>>> }`; `impl StatusSourceLocator::locate` — read `index.jsonl`; **match `pid == agent_pid` first**, else newest `directory == cwd` && `time >= pty_start − slack`; cache; retry/backoff for the startup window. `validate_transcript_path_with_root(raw, &bridge_root)` (NUL → canonicalize → under root → `*.jsonl`).

**Work:** mirror `kimi/locator.rs` shared-state + retry; the resolution strategy is index-based (simpler than Kimi's proc-fd). Gate on `proc_root` = irrelevant (filesystem only).

**Acceptance:** tests — pid match wins over a same-cwd newer session; cwd+freshness fallback when no pid match; stale row rejected by freshness; missing index/file ⇒ not-yet-ready (retry, not fatal); path validator rejects traversal/NUL/non-jsonl; `bridge_root` literal-default test.

**Model:** Opus 4.6 (locator logic + the disambiguation invariant).

---

## M4 — `StateDecoder` (fold) + parser

**Goal:** fold a `<sessionID>.jsonl` into a `StatusSnapshot`.

**Depends on:** M2 (DTOs), M3 (types).

**Files (new):**

- `crates/backend/src/agent/adapter/opencode/parser.rs` — `parse_bridge_snapshot(raw: &str) -> StatusSnapshot`: fold lines; model/version/agent from latest `session.created/updated` `info`; token totals from `info.tokens`; current-step usage from latest `step-finish` `tokens`; `cost` from `info.cost`; `rate_limits` safe default; `context_window_size = 0`; `usage_fetched = false`. Tolerate missing/partial-trailing lines.

**Work:** mirror `codex/parser.rs::parse_rollout_snapshot` fold shape; `serde(other)`/`lenient_*` throughout.

**Acceptance:** tests over `sample_bridge.jsonl` — snapshot has correct model/version/tokens/cost; missing/invalid JSON line tolerated; absent step-finish ⇒ usage zero, not panic; safe defaults for context-window/rate-limits.

**Model:** Opus 4.6.

---

## M5 — `TranscriptStreamer` + `OpencodeTranscriptDecoder` + wire the bindings arm

**Goal:** tail the bridge JSONL into activity + test-run events; assemble `OpenCodeAdapter`; dispatch it.

**Depends on:** M3, M4.

**Files (new + modify):**

- `crates/backend/src/agent/adapter/opencode/transcript.rs` — `start_tailing(...)` (mirror `codex/transcript.rs:190`); `OpencodeTranscriptDecoder { events, session_id, cwd, in_flight: by callID, num_turns, last_cwd, emitter: TestRunEmitter, replay_done }` impl `TranscriptDecoder`. Map per spec §4.4: user `message.updated` ⇒ turn; `tool.before`/tool pending|running ⇒ start; `tool.after`/completed ⇒ done; tool error ⇒ failed; bash `tool.after` ⇒ shared `claude_code::test_runners` (`match_command`/`maybe_build_snapshot`/`TestRunEmitter`, cwd = session cwd); `session.idle`/`status`/`step-finish` ⇒ status refresh; cwd change ⇒ `AgentCwdEvent`. `on_caught_up` **idempotent** (gate on `replay_done`).
- `crates/backend/src/agent/adapter/opencode/mod.rs` — `OpenCodeAdapter { locator: Arc<OpenCodeLocator> }` + `with_locator`; impl `TranscriptPathSource` (`static_hint` from `static_transcript_hint`, `dynamic_hint` None), `StateDecoder` (delegates parser), `TranscriptPathValidator`, `TranscriptStreamer`, and the `AgentAdapter` facade (UFCS delegation).
- `crates/backend/src/agent/adapter/bindings.rs` — named `AgentType::Opencode` arm: build **one** `Arc<OpenCodeLocator>` (bridge-root via `bridge_dir()`, `agent_pid`, `pty_start`), share into `bindings.locator` + `OpenCodeAdapter::with_locator(locator.clone())`; call `ensure_bridge_installed` for the user's `~/.config/opencode/plugins` at attach; `opencode_ctx` test helper + dispatch tests.

**Acceptance:** tests — user message ⇒ one turn; tool before/after ⇒ start/done once (deduped by callID); tool error ⇒ failed; bash test command ⇒ test-run snapshot; non-test bash ⇒ no snapshot; `on_caught_up` fired twice ⇒ no duplicate replay flush; `for_attach` dispatches `Opencode` to the real adapter (shared-Arc invariant: one locator instance). End-to-end: feeding `sample_bridge.jsonl` through the tail emits the expected event sequence.

**Model:** Opus 4.8 (the decoder state machine + the shared-Arc wiring are the trickiest, highest-review-risk code).

---

## M6 — Frontend registration & branding

**Goal:** opencode renders with its own identity in the sidebar/card/registry across all themes.

**Depends on:** M1.

**Files:**

- `src/agents/registry.ts` — `AGENTS.opencode` (id/name/short/glyph[single code point]/Icon/model + four `--color-agent-opencode-*` vars) + `agentTypeToRegistryKey` `case 'opencode'`; `registry.test.ts` (`ALL_AGENTS`, identity/icon/glyph).
- `src/agents/brandIcons.tsx` `export const Opencode` (BrandSvg, `fill=currentColor`) + `brandIcons.test.tsx` table entry.
- `src/features/sessions/utils/agentForSession.ts` — repoint `'opencode'` from `'shell'` (M1 temp) to `'opencode'` + test.
- `src/theme/types.ts` `AGENT_IDS` + `types.test.ts` exact-equality update; **all six** theme files (`obsidian-lens`, `flexoki`, `tokyo-night`, `dracula`, `gruvbox/gruvbox-dark`, `gruvbox/gruvbox-light`) gain `agents.opencode` (distinct accent, no collision); regenerate `src/theme/theme.css` (`npx tsx scripts/generate-theme-css.ts && npx prettier --write src/theme/theme.css`) to satisfy `themeCss.test.ts`.

**Acceptance:** `npm test` green (registry/icon/theme/types tests); `themeCss.test.ts` exact-equality holds; `type-check`/`lint`/`format:check` green; opencode renders with its accent + icon.

**Model:** Sonnet (mechanical, six-theme fan-out) + Opus 4.6 for the theme.css regen/equality gate + glyph/accent choice.

---

## Risks carried from the spec

- Wire-string verification is an **M1 gate** — do not hardcode frontend literals before confirming ts-rs emits `"opencode"`.
- The bridge-dir derivation rule must be **byte-identical** in the plugin (TS) and `bridge_dir()` (Rust) — covered by the literal-default tests in M2/M3.
- `ensure_bridge_installed` writes into the user's real `~/.config/opencode/plugins` only at attach (M5); all unit tests target a temp dir.
- Restart caveat (no live data until opencode relaunches with the bridge) is documented, not fixed in v1.
