# Kimi plan-usage fetch: in the Rust sidecar, not the Electron main process

**Date:** 2026-06-14
**Status:** Accepted
**Scope:** how the kimi `/usages` plan-usage call (5-hour + weekly limits) is made and where the api_key lives. Does **not** change the AgentAdapter contract or the unified `RateLimits` model. VIM-122.

## Context

Vimeflow surfaces each agent's 5-hour / weekly rate limits in the agent-status card (`StatusSnapshot.rate_limits` → `AgentStatusEvent` → `useAgentStatus`). For Claude Code and Codex CLI this is a **pure local-file read** — the agent CLI already made whatever network call and persisted the limit numbers into an artifact Vimeflow then parses:

| Agent           | Where Vimeflow reads usage from                                                                                                                                                                                                       | Vimeflow makes a network call? |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Claude Code** | the **statusline JSON** Claude Code feeds its status program — has a `rate_limits` field (`claude_code/statusline.rs`)                                                                                                                | ❌ reads local stdin JSON      |
| **Codex CLI**   | the **rollout JSONL** — the `token_count` event carries `rate_limits.primary`/`secondary`, which the Codex CLI lifted from API **response headers** and wrote into its own session file (`codex/mod.rs` `latest_account_rate_limits`) | ❌ reads local JSONL           |
| **Kimi**        | **nothing on disk** — kimi-code's `wire.jsonl` has token counts but **no plan-usage limits anywhere** (confirmed by binary + live probe)                                                                                              | ✅ must call `/usages` itself  |

Kimi is the one agent where we can't piggyback on a local artifact the CLI already wrote. The only source of truth for kimi's 5h/weekly limits is the live `GET ${base}/usages` endpoint, which requires sending the user's kimi api_key to `api.kimi.com`. That single fact drives both this decision and the kimi-only consent gate (see Known risks).

The question: **where does that outbound call live** — the Rust sidecar (which produces `StatusSnapshot`) or the Electron main process (already network-capable Node)?

## Options considered

1. **A — Rust sidecar adapter fetches `/usages`.** A sync HTTP GET on the supervisor's background thread fills `StatusSnapshot.rate_limits`, the same path Claude Code and Codex CLI already populate.
2. **B — Electron main process fetches `/usages`.** Node async `fetch` in `electron/main.ts`, emitting kimi usage to the renderer on a separate channel, no new Rust dependency.

## Decision

**Option A — the Rust sidecar adapter.** codex independently reached the same verdict when asked to weigh the freeze/blast-radius/security/consistency trade-offs.

## Justification

1. **Blast radius, not "freeze," is the real differentiator.** Neither option freezes the UI: B's `fetch` is non-blocking async I/O, and A's sync `ureq` runs on a background thread, never the main loop. But the Electron **main** process is the single-threaded IPC / window / lifecycle hub — a bug there (bad retry loop, unhandled rejection, parse panic) shares that hub's event loop, and a main-process crash takes the **whole app** down. The same failure in the sidecar's background thread only degrades **kimi usage freshness**; the sidecar is restartable and the renderer survives.
2. **The api_key is provider-adapter credential material — it belongs in the sidecar.** Main should stay a bridge/lifecycle process, not become an agent-secret holder. A keeps the key out of the renderer and out of a new main-process channel; B would put it in the process that owns every window and IPC route.
3. **A reuses the unified model; B forks it.** `StatusSnapshot.rate_limits` already exists, is already copied into `AgentStatusEvent` by `stamp_snapshot`, and is already consumed by `useAgentStatus`. The kimi `/usages` parser (`kimi/usage.rs`) already maps the response into the same `RateLimits` type. A is "one fetch + one cached field" on existing rails; B is a second transport, a second lifecycle, and a second security boundary for the same data.
4. **Failure isolation is structural in A.** With request/read timeouts, backoff, and a bounded shutdown path, a hung kimi API call cannot stall anything the user sees — it just keeps the last cached value.

## Alternatives rejected

### Option B — Electron main `fetch` (rejected)

Chosen only to avoid a Rust dependency. Rejected because the dependency is the smaller cost: one HTTP+TLS client in the sidecar is cheaper than splitting provider rate-limit state across two transports, two lifecycles, and two security boundaries — and it would relocate a credential into the process least appropriate to hold it (the IPC/window hub). The "no new dep" win is real but local; the architectural cost is global.

## Known risks & mitigations

- **New dependencies (the actual cost of A).** PR 2 adds **two** crates to `crates/backend`, which until now is local-file-only:
  - a sync HTTP+TLS client (**`ureq`**, rustls + bundled webpki roots — deterministic, no system-cert dependency), the **first outbound network call** in the backend; and
  - a **`toml`** parser, because the api_key + base_url live in `<kimi_home>/config.toml` under `[providers."managed:kimi-code"]`, and that file carries **other** providers (`search`, `fetch`) each with their own `api_key` — a hand-rolled scan would grab the wrong key, so section-scoped TOML parsing is required for correctness, not convenience.
  - **MSRV (decided: bump).** `Cargo.toml` aspired to `rust-version = 1.77.2` (and pins `url < 2.5` to hold it). CI builds on `dtolnay/rust-toolchain@stable`, so neither dep breaks CI, but `ureq`+rustls's closure needs newer Rust, so PR 2 **raises `rust-version`** to the real floor rather than keep a fiction. The `url < 2.5` pin stays (it guards an unrelated idna/ICU churn, not the MSRV number). Rejected: switching to `native-tls` to preserve 1.77.2 — a system-libssl dependency is a worse cost than an honest MSRV bump on a stable-only CI.
- **Consent gate (kimi-only, decided: global + persisted).** Because A makes Vimeflow itself the party transmitting the key, the fetch is **opt-in**, default OFF, and the poller only calls `/usages` while consent is ON. Claude Code and Codex CLI need no such gate — they never leave the local disk. The grant is **global and persisted** (consent once, every kimi card shows usage — the data is account-wide anyway), with revoke in Settings; rejected per-pane consent as needless re-granting for the same account-level data. Implemented as a **process-global flag** in `agent::kimi_usage_consent` (read by every kimi locator, written by the `set_kimi_usage_consent` IPC, persisted to `app_data_dir/kimi-usage-consent.json`, loaded at startup) — deliberately _not_ threaded through `AttachContext`, whose contract is "immutable attach-time facts"; consent is a mutable app-wide setting, not an attach fact. The backend half ships in this PR-piece (the IPC makes the fetch path reachable); the kimi-only gate UI is the follow-up.
- **PII in the response.** `/usages` returns `userId` / `region` / `membership`. Only the limit numbers map into `RateLimits`; the rest is dropped at the parse boundary (`kimi/usage.rs`) and never logged. The api_key is never logged either.
- **Request cadence.** To bound outbound calls, the fetch is triggered on **main-agent turn boundaries only** — a new user `turn.prompt` in `agents/main/wire.jsonl`. Sub-agent turns (sibling `agents/agent-*/wire.jsonl`) do **not** trigger a fetch, so a delegation-heavy session doesn't hammer the endpoint. Trade-off: usage can lag during a long sub-agent run, refreshing when control returns to main — acceptable, since 5h/weekly windows move slowly.

## References

- `docs/kimi/kimi-usage-api.md` — endpoint, auth (api_key + mandatory `kimi-code/<ver>` UA), live response shape, `RateLimits` mapping.
- `crates/backend/src/agent/adapter/kimi/usage.rs` — the `/usages` → `RateLimits` parser (dep-free, tested).
- `crates/backend/src/agent/adapter/codex/locator.rs` `latest_account_rate_limits` — the established "derive rate-limits out-of-band, merge in `decode`" pattern A mirrors.
- VIM-122 (usage card), VIM-123 (reset-time in the shared bar).
