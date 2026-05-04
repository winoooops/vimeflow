# Codex Adapter Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `CodexAdapter` against the existing `AgentAdapter` trait so a PTY running `codex` populates the same status panel as a Claude session, with status bar parity (model, context window, rate limits, durations) and a stub transcript tailer.

**Architecture:** A new `agent/adapter/codex/` module sibling to `claude_code/`. The adapter resolves its rollout JSONL via a `CodexSessionLocator` (SQLite-primary, FS-fallback, schema-driven DB discovery) and folds the JSONL into the existing `AgentStatusEvent` IPC shape via a Codex-private parser. The `AgentAdapter::status_source` trait method becomes fallible (`Result<StatusSource, BindError>`) and receives a richer `BindContext { session_id, cwd, pid, pty_start }`; `base::start_for` gets a bounded retry loop on transient `BindError::Pending`. Frontend changes are surgical: a `CostMetrics` override making `totalCostUsd: number | null`, plus null-aware rendering in `BudgetMetrics`.

**Tech Stack:** Rust 2021 edition (Tauri 2.x backend), `rusqlite` (new dep, bundled feature for the SQLite locator), `serde_json::Value` for the rollout parser, `tempfile` for locator tests, `tauri::test::mock_builder()` + `MockRuntime` for orchestration tests. TypeScript / React for three small frontend files.

**Spec:** `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` — read end to end before starting. Every locked decision in the spec is binding context for the tasks below.

**Predecessor ADR:** `docs/decisions/2026-05-03-claude-parser-json-boundary.md` — keep parser internals organized around domain functions; do **not** introduce shared `agent::adapter::json` helpers in this plan. Step 2 (refactor) is a separate follow-up.

---

## Pre-Flight

Before starting:

- Read the spec end to end. The plan below assumes its locked decisions, the discovered Codex CLI 0.128.0 facts, the field-by-field projection table, and the Fatal-precedence decision tree as binding context.
- Read `rules/CLAUDE.md`, `rules/rust/coding-style.md`, `rules/rust/testing.md`, `rules/common/design-philosophy.md`. The plan does not duplicate their guidance.
- Working directory: `/home/will/projects/vimeflow` (project root). All paths relative to that root.
- Implementation branch: a fresh `feat/codex-adapter-stage-2` cut from `main` after the spec PR (`feat/codex-adapter-stage-2-spec`) is merged. Do not pile implementation onto the spec branch — keep them reviewable separately.
- Confirm `cd src-tauri && cargo test --workspace --all-features` and `npm run test` are green before starting. Every task uses test stability as a gate.
- Confirm a real codex session has appeared in `~/.codex/sessions/` at least once on this machine — the integration tests in Tasks 9-10 use captured rollout fixtures and the dev-time sign-off in Task 17 needs a working `codex` CLI.

## Target File Structure

```
NEW                                         MODIFIED
───                                         ────────
src-tauri/Cargo.toml                        + rusqlite dep (bundled, RO)

src-tauri/src/agent/adapter/codex/          src-tauri/src/agent/adapter/types.rs
├── mod.rs          (CodexAdapter)            (+ BindContext, BindError)
├── locator.rs      (CodexSessionLocator)
├── parser.rs       (parse_rollout, fold)   src-tauri/src/agent/adapter/mod.rs
└── transcript.rs   (v1 stub)                 (trait sig, retry loop dispatch,
                                              CodexAdapter wired in for_type,
src-tauri/tests/fixtures/codex/               start_agent_watcher builds ctx)
├── rollout-minimal.jsonl
├── rollout-multi-turn.jsonl                src-tauri/src/agent/adapter/base/mod.rs
├── rollout-long-session.jsonl                (start_for becomes a retry loop)
├── rollout-info-null.jsonl
├── rollout-incomplete-trail.jsonl          src-tauri/src/agent/adapter/claude_code/mod.rs
└── rollout-malformed-mid.jsonl               (status_source signature update)

                                            src-tauri/src/agent/types.rs
                                              (CostMetrics.total_cost_usd:
                                               f64 → Option<f64>)

                                            src-tauri/src/agent/adapter/claude_code/statusline.rs
                                              (parse_cost_metrics returns
                                               Option<f64> on missing block)

                                            src-tauri/src/terminal/state.rs
                                              (ManagedSession.started_at
                                               + PtyState::get_started_at)

                                            src/features/agent-status/types/index.ts
                                              (CostMetrics override:
                                               totalCostUsd: number | null)

                                            src/features/agent-status/hooks/useAgentStatus.ts
                                              (preserve null through state)

                                            src/features/agent-status/components/BudgetMetrics.tsx
                                              (render null state for cost)

                                            src/features/agent-status/components/BudgetMetrics.test.tsx
                                              (+ null-cost test cases)
```

Total: 4 new Rust source files, 6 fixture files, 8 modified Rust source files, 4 modified TypeScript files. No new Tauri commands. No deletions.

---

## Task 1: Add `rusqlite` dependency (read-only, bundled)

**Goal:** Add the SQLite client crate before any locator code references it.

**Files:**

- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency.**

Edit `src-tauri/Cargo.toml`. In `[dependencies]`, immediately after the `regex = "1.10"` line, add:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

Rationale for `bundled`: ships the SQLite C source compiled into the binary, removing the system-`libsqlite3-dev` dev/runtime dependency. The locator only does read-only queries, so the small binary-size cost is acceptable.

- [ ] **Step 2: Verify build.**

Run:

```bash
cd src-tauri && cargo build --all-features
```

Expected: 0 errors. First build pulls and compiles bundled SQLite (~30-60s); subsequent builds are cached.

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(agent): add rusqlite dep (bundled, RO) for codex locator"
```

---

## Task 2: `ManagedSession.started_at` + `PtyState::get_started_at`

**Goal:** Add a `SystemTime` field captured at PTY spawn so the codex locator can gate SQLite queries by `pty_start`.

**Files:**

- Modify: `src-tauri/src/terminal/state.rs`

- [ ] **Step 1: Write the failing tests.**

Add to the `#[cfg(test)] mod tests` block at the bottom of `state.rs`:

```rust
#[test]
fn test_managed_session_started_at_recorded_at_construction() {
    use std::time::{Duration, SystemTime};

    let before = SystemTime::now();
    let session = test_session_with_started_at(SystemTime::now());
    let after = SystemTime::now();

    assert!(session.started_at >= before);
    assert!(session.started_at <= after);
    // Sanity: monotonic-ish across the construction window.
    assert!(after.duration_since(before).unwrap_or_default() < Duration::from_secs(1));
}

#[test]
fn test_pty_state_get_started_at_returns_some_after_insert() {
    let state = PtyState::new();
    let sid = "test-sid".to_string();
    let now = std::time::SystemTime::now();
    state.insert(sid.clone(), test_session_with_started_at(now));

    assert_eq!(state.get_started_at(&sid), Some(now));
}

#[test]
fn test_pty_state_get_started_at_returns_none_for_unknown_sid() {
    let state = PtyState::new();
    assert!(state.get_started_at(&"nonexistent".to_string()).is_none());
}
```

`test_session_with_started_at` is a test helper that constructs a `ManagedSession` with a given `started_at` value. If a similar helper already exists in the test module (e.g. one that builds a dummy `ManagedSession` for unit testing), extend it to take a `SystemTime`; otherwise add a small helper at the top of the test module:

```rust
fn test_session_with_started_at(started_at: std::time::SystemTime) -> ManagedSession {
    // Build a ManagedSession with mocked I/O fields. If the existing
    // tests in this file already use a helper of this shape, reuse it
    // and just thread `started_at` through.
    // ... existing fields ...
    ManagedSession {
        master: /* existing test stub */,
        writer: /* existing test stub */,
        child: /* existing test stub */,
        cwd: "/tmp".to_string(),
        generation: 0,
        ring: std::sync::Arc::new(std::sync::Mutex::new(crate::terminal::state::RingBuffer::new(1024))),
        cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        started_at,
    }
}
```

If `state.rs` lacks the test stubs for `master`/`writer`/`child` (likely — those are real PTY handles), the simplest approach is to factor the new behavior out into a tiny helper module that doesn't require a full `ManagedSession` to test, OR use `test_session_with_started_at` as a `#[cfg(test)]`-only constructor that takes those handles by `Box<dyn ...>` and lets each test pass its own stubs. Use whichever pattern the existing `state.rs` tests already follow.

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd src-tauri && cargo test --lib state::tests::test_managed_session_started_at -- --nocapture
cd src-tauri && cargo test --lib state::tests::test_pty_state_get_started_at -- --nocapture
```

Expected: compile errors — `started_at` is not a field on `ManagedSession`, `get_started_at` is not a method on `PtyState`.

- [ ] **Step 3: Add the field to `ManagedSession`.**

In `state.rs` at the `ManagedSession` struct declaration (currently around line 66), add the field after `cancelled`:

```rust
pub struct ManagedSession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    #[allow(dead_code)]
    pub cwd: String,
    pub generation: u64,
    pub ring: Arc<Mutex<RingBuffer>>,
    pub cancelled: Arc<AtomicBool>,
    /// Wall-clock time the PTY was spawned. Captured at construction
    /// time; used by the codex adapter to gate SQLite logs queries by
    /// `pty_start` so PID reuse and stale loaded threads cannot
    /// misbind. Read via `PtyState::get_started_at(session_id)`.
    pub started_at: std::time::SystemTime,
}
```

- [ ] **Step 4: Set `started_at` at every `ManagedSession` construction site.**

```bash
cd src-tauri && rg "ManagedSession\s*\{" src/
```

For each construction site, add `started_at: std::time::SystemTime::now(),` immediately before the closing brace. Common sites are inside `spawn_pty` and any test helpers. The compiler will flag any you miss after the next build.

- [ ] **Step 5: Add `PtyState::get_started_at`.**

Following the pattern of the existing `get_cwd` / `get_pid` methods (currently around line 233-239 of `state.rs`), add immediately after `get_cwd`:

```rust
/// Wall-clock time this session's PTY was spawned. Used by the codex
/// adapter to gate SQLite logs queries (PID reuse and stale-thread
/// disambiguation).
pub fn get_started_at(&self, session_id: &SessionId) -> Option<std::time::SystemTime> {
    let sessions = self.sessions.lock().expect("failed to lock sessions");
    sessions.get(session_id).map(|s| s.started_at)
}
```

- [ ] **Step 6: Run tests to verify they pass.**

```bash
cd src-tauri && cargo test --lib state::tests
```

Expected: all three new tests PASS. Also expected: zero regressions in the rest of `state::tests` — if you broke an existing helper, fix the helper.

- [ ] **Step 7: Commit.**

```bash
git add src-tauri/src/terminal/state.rs
git commit -m "feat(terminal): record ManagedSession.started_at + getter

Wall-clock SystemTime captured at PTY spawn; PtyState::get_started_at
exposes it for the codex adapter's BindContext."
```

---

## Task 3: `CostMetrics.total_cost_usd: f64 → Option<f64>` (Rust)

**Goal:** Bump the IPC type. Update Claude's parser to emit `None` when no cost block exists, `Some(0.0)` when the block exists but the field is missing, `Some(value)` when the field is present.

**Files:**

- Modify: `src-tauri/src/agent/types.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/statusline.rs`

- [ ] **Step 1: Write the failing test.**

Add to the existing `#[cfg(test)] mod tests` block in `claude_code/statusline.rs`:

```rust
#[test]
fn parse_cost_metrics_returns_none_when_cost_block_missing() {
    let json = r#"{}"#;
    let result = parse_statusline("pty-1", json).expect("should parse empty object");
    assert_eq!(result.event.cost.total_cost_usd, None);
}

#[test]
fn parse_cost_metrics_returns_some_zero_when_block_present_field_missing() {
    let json = r#"{ "cost": { "total_duration_ms": 100 } }"#;
    let result = parse_statusline("pty-2", json).expect("should parse cost block without cost field");
    assert_eq!(result.event.cost.total_cost_usd, Some(0.0));
}

#[test]
fn parse_cost_metrics_returns_some_value_when_field_present() {
    let json = r#"{ "cost": { "total_cost_usd": 0.42 } }"#;
    let result = parse_statusline("pty-3", json).expect("should parse cost.total_cost_usd");
    assert_eq!(result.event.cost.total_cost_usd, Some(0.42));
}
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd src-tauri && cargo test --lib parse_cost_metrics_returns_ -- --nocapture
```

Expected: compile errors (type mismatch — `Option<f64>` vs `f64`).

- [ ] **Step 3: Bump the type in `agent/types.rs`.**

Edit the `CostMetrics` struct (current location around line 92):

```rust
pub struct CostMetrics {
    /// Total cost in USD. `None` when the agent doesn't expose cost
    /// (e.g. Codex). `Some(0.0)` means "agent does expose cost,
    /// current value is 0".
    #[cfg_attr(test, ts(optional))]
    pub total_cost_usd: Option<f64>,
    /// Total session duration in milliseconds
    pub total_duration_ms: u64,
    /// Total API call duration in milliseconds
    pub total_api_duration_ms: u64,
    /// Total lines of code added
    pub total_lines_added: u64,
    /// Total lines of code removed
    pub total_lines_removed: u64,
}
```

`#[cfg_attr(test, ts(optional))]` makes ts-rs emit `totalCostUsd?: number` in dev-time codegen, but the runtime serialization is still `null` because we're not adding `#[serde(skip_serializing_if = "Option::is_none")]`. The frontend override (Task 4) handles the runtime shape explicitly.

- [ ] **Step 4: Update `parse_cost_metrics` in `statusline.rs`.**

Locate the function (currently around line 130). Update both the defaults block and the field read. Replace the body with:

```rust
fn parse_cost_metrics(value: &Value) -> CostMetrics {
    let defaults = CostMetrics {
        total_cost_usd: None,
        total_duration_ms: 0,
        total_api_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
    };

    if !has_cost(value) {
        return defaults;
    }

    CostMetrics {
        // Cost block present: report the field value if present, else
        // explicit Some(0.0). Distinguishes "agent exposes cost" from
        // "agent doesn't expose cost" (defaults branch above, where
        // total_cost_usd: None).
        total_cost_usd: Some(total_cost_usd(value)),
        total_duration_ms: total_duration_ms(value),
        total_api_duration_ms: total_api_duration_ms(value),
        total_lines_added: total_lines_added(value),
        total_lines_removed: total_lines_removed(value),
    }
}
```

`total_cost_usd(value)` (the existing helper that returns `f64` with `unwrap_or(0.0)`) stays unchanged — it's wrapped with `Some(...)` at the call site.

- [ ] **Step 5: Update other tests in `statusline.rs` that compare cost.**

```bash
cd src-tauri && rg "total_cost_usd" src/agent/adapter/claude_code/statusline.rs
```

Test expressions like `event.cost.total_cost_usd - 0.42).abs()` now need to unwrap or pattern-match on the Option. Replace with `event.cost.total_cost_usd.unwrap() - 0.42).abs()` for tests that assert on a present value, or `.is_none()` / `== Some(value)` for comparisons. Apply mechanically; the compiler errors guide the edits.

- [ ] **Step 6: Run all `statusline` tests to verify pass.**

```bash
cd src-tauri && cargo test --lib statusline
```

Expected: all PASS, including the three new ones from Step 1.

- [ ] **Step 7: Run the full backend test suite.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: PASS. If any other Rust call site depends on `cost.total_cost_usd` as `f64`, the compiler flags it — fix each by unwrapping or matching as appropriate.

- [ ] **Step 8: Regenerate ts-rs bindings.**

```bash
npm run generate:bindings
```

This runs `cd src-tauri && cargo test export_bindings` which writes ts-rs files into `src/bindings/`. The `CostMetrics.ts` binding will reflect the new `Option<f64>` shape (likely `totalCostUsd: number | null` or `totalCostUsd?: number` depending on ts-rs codegen — Task 4 overrides this on the frontend either way, but keeping the generated binding in sync avoids mystery diffs later).

- [ ] **Step 9: Commit.**

```bash
git add src-tauri/src/agent/types.rs \
        src-tauri/src/agent/adapter/claude_code/statusline.rs \
        src/bindings/CostMetrics.ts
git commit -m "feat(agent): CostMetrics.total_cost_usd: f64 -> Option<f64>

None when agent doesn't expose cost (Codex); Some(value) when
present; Some(0.0) when cost block exists but field is missing.
Frontend override + null rendering land in the next commit."
```

---

## Task 4: Frontend — `CostMetrics` override + null preservation + null rendering

**Goal:** Match the new IPC shape on the TypeScript side. Override the ts-rs binding for `CostMetrics`, preserve `null` through `useAgentStatus` state, and render the cost row visually distinct from `$0.00` in `BudgetMetrics`.

**Files:**

- Modify: `src/features/agent-status/types/index.ts`
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts`
- Modify: `src/features/agent-status/components/BudgetMetrics.tsx`
- Modify: `src/features/agent-status/components/BudgetMetrics.test.tsx`

- [ ] **Step 1: Write the failing test for null rendering.**

**Variant routing context:** `BudgetMetrics` (currently `BudgetMetrics.tsx:133-166`) routes to one of three variants based on which props are present:

- `SubscriberVariant` (when `rateLimits` is non-null) — no Cost cell. Shows rate-limit bars + API Time + Tokens. Renders for Claude Pro/Team **and all Codex sessions** (Codex always provides `rate_limits`).
- `ApiKeyVariant` (when `rateLimits` is null AND `cost` is non-null) — **the only variant that renders a Cost cell.** Used by Claude API-key auth.
- `FallbackVariant` (when both null) — tokens only.

So the null-cost handling targets `ApiKeyVariant` only. The crash scenario this prevents: a Claude API-key user on a pre-first-response session where the cost block hasn't been written yet, so `cost.totalCostUsd === null`. SubscriberVariant has no Cost cell to render, so Codex sessions don't need any null-rendering work — but ApiKeyVariant's `formatCost(cost.totalCostUsd)` would throw on null without this fix.

Open `src/features/agent-status/components/BudgetMetrics.test.tsx` and add:

```typescript
test('ApiKeyVariant renders cost as em-dash when totalCostUsd is null', () => {
  const cost = {
    totalCostUsd: null,
    totalDurationMs: 0,
    totalApiDurationMs: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  }
  render(
    <BudgetMetrics
      cost={cost}
      rateLimits={null} // ← null routes to ApiKeyVariant (cost is non-null object)
      totalInputTokens={0}
      totalOutputTokens={0}
    />
  )
  // ApiKeyVariant renders a Cost cell. With null totalCostUsd it
  // should show '—', not crash on `(null).toFixed(2)`.
  expect(screen.getByText('Cost')).toBeInTheDocument()
  expect(screen.getByText('—')).toBeInTheDocument()
  expect(screen.queryByText(/\$/)).toBeNull()
})

test('ApiKeyVariant renders cost with dollar sign when totalCostUsd is a number', () => {
  const cost = {
    totalCostUsd: 0.42,
    totalDurationMs: 0,
    totalApiDurationMs: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  }
  render(
    <BudgetMetrics
      cost={cost}
      rateLimits={null}
      totalInputTokens={0}
      totalOutputTokens={0}
    />
  )
  expect(screen.getByText('$0.42')).toBeInTheDocument()
})

test('SubscriberVariant unaffected by null totalCostUsd (codex path)', () => {
  // Codex sessions always go through SubscriberVariant — rateLimits
  // is always present and there's no Cost cell to render. The null
  // totalCostUsd MUST NOT crash this render.
  const cost = {
    totalCostUsd: null,
    totalDurationMs: 0,
    totalApiDurationMs: 5000,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  }
  render(
    <BudgetMetrics
      cost={cost}
      rateLimits={{ fiveHour: { usedPercentage: 8.0, resetsAt: 1777848985 } }}
      totalInputTokens={1000}
      totalOutputTokens={200}
    />
  )
  // No Cost cell in SubscriberVariant.
  expect(screen.queryByText('Cost')).toBeNull()
  // API Time still renders (uses totalApiDurationMs, not totalCostUsd).
  expect(screen.getByText(/5\.0s/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
npx vitest run src/features/agent-status/components/BudgetMetrics.test.tsx
```

Expected: at least the null-cost test fails, because the current `BudgetMetrics` reads `totalCostUsd` as a number and would either render `$null` or coerce it.

- [ ] **Step 3: Add the `CostMetrics` override.**

In `src/features/agent-status/types/index.ts`, immediately after the existing `AgentStatusEvent` override block (lines 14-26), add:

```typescript
// Runtime-accurate override for CostMetrics. Same pattern as the
// AgentStatusEvent override above: ts-rs generates required fields,
// but Rust Option<f64> serializes to null. Codex sessions always
// emit totalCostUsd: null because Codex doesn't expose USD cost;
// Claude sessions emit number when the cost block is present.
export interface CostMetrics {
  totalCostUsd: number | null
  totalDurationMs: number
  totalApiDurationMs: number
  totalLinesAdded: number
  totalLinesRemoved: number
}
```

Update the existing `import { CostMetrics } from '../../../bindings/CostMetrics'` (line 2) — delete that line. The local override now provides the type. Search the rest of the file for any consumers of the imported `CostMetrics` and confirm they pick up the local override.

If `AgentStatusEvent`'s override at line 24 says `cost: CostMetrics | null`, that's already correct and doesn't need editing — but the now-overridden `CostMetrics` brings the inner null shape.

- [ ] **Step 4: Update `useAgentStatus.ts` to preserve `null`.**

Find the cost block normalization (current location around line 333+ in `useAgentStatus.ts`):

```typescript
cost: p.cost
  ? {
      totalCostUsd: Number(p.cost.totalCostUsd),
      // ...
```

Change `Number(p.cost.totalCostUsd)` to:

```typescript
totalCostUsd: p.cost.totalCostUsd ?? null,
```

Rationale: `null ?? null === null` and `0.42 ?? null === 0.42`, so we preserve the runtime shape verbatim instead of coercing. Do **not** wrap with `Number(...)` — `Number(null) === 0`, which is exactly the bug we're fixing.

- [ ] **Step 5: Update `formatCost` in `BudgetMetrics.tsx` to handle null.**

Only `ApiKeyVariant` renders the Cost cell (currently `BudgetMetrics.tsx:108`). `SubscriberVariant` and `FallbackVariant` do not, so they need no changes. The smallest correct fix is to widen `formatCost`'s parameter type and handle null inside it.

Update the exported `formatCost` helper at `BudgetMetrics.tsx:12`:

```typescript
// Before
export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`

// After
export const formatCost = (usd: number | null): string =>
  usd === null ? '—' : `$${usd.toFixed(2)}`
```

`ApiKeyVariant`'s call site (`value={formatCost(cost.totalCostUsd)}`) now type-checks against `cost.totalCostUsd: number | null` from the override (Step 3). No call-site edit beyond this signature change.

Verify there are no other `formatCost` consumers that would break under the wider type:

```bash
grep -rn "formatCost" src/
```

If a consumer passes a guaranteed-non-null `number`, it still type-checks (assignable to `number | null`). If a consumer asserted a return string of length > 1 or similar, audit those — none exist today, but the grep is the gate.

- [ ] **Step 6: Run BudgetMetrics tests to verify they pass.**

```bash
npx vitest run src/features/agent-status/components/BudgetMetrics.test.tsx
```

Expected: all PASS, including the two new ones.

- [ ] **Step 7: Run useAgentStatus tests.**

```bash
npx vitest run src/features/agent-status/hooks/useAgentStatus.test.tsx
```

Expected: PASS. If a test asserts on `totalCostUsd: 0`, update it to assert on `null` for the no-cost case or to a real value for the present case.

- [ ] **Step 8: Run the full frontend test suite.**

```bash
npm run test
```

Expected: PASS. Lint should also stay clean: `npm run lint`.

- [ ] **Step 9: Commit.**

```bash
git add src/features/agent-status/types/index.ts \
        src/features/agent-status/hooks/useAgentStatus.ts \
        src/features/agent-status/components/BudgetMetrics.tsx \
        src/features/agent-status/components/BudgetMetrics.test.tsx
git commit -m "feat(agent-status): handle null totalCostUsd in BudgetMetrics

CostMetrics frontend override mirrors the new IPC shape;
useAgentStatus preserves null through state; BudgetMetrics renders
'—' instead of '\$0.00' when cost is null. Codex sessions will hit
this path; Claude sessions remain unaffected."
```

---

## Task 5: `BindContext` and `BindError` types

**Goal:** Add the new types to `agent/adapter/types.rs`. The trait change in Task 6 consumes them.

**Files:**

- Modify: `src-tauri/src/agent/adapter/types.rs`

- [ ] **Step 1: Write the file additions.**

Append to `adapter/types.rs` after the existing `ParsedStatus` struct:

```rust
use std::path::Path;
use std::time::SystemTime;

/// Bind-time context passed to `AgentAdapter::status_source`.
///
/// Codex's locator needs `pid` (to look up the codex thread in
/// SQLite) and `pty_start` (to gate that lookup so PID reuse and
/// stale loaded threads cannot misbind). Claude's status_source
/// ignores `pid` and `pty_start` and resolves purely from `cwd` +
/// `session_id`.
#[derive(Debug, Clone, Copy)]
pub struct BindContext<'a> {
    pub session_id: &'a str,
    pub cwd: &'a Path,
    pub pid: u32,
    pub pty_start: SystemTime,
}

/// Outcome of a `status_source` call.
///
/// `Pending` is transient — `base::start_for` retries within a
/// bounded budget (≤500ms total) before giving up. `Fatal` is
/// immediate; the orchestration layer surfaces it to the frontend
/// as `Err(String)` from `start_agent_watcher` and the existing
/// 2000ms detection re-poll picks up on the next pass.
#[derive(Debug, Clone)]
pub enum BindError {
    Pending(String),
    Fatal(String),
}

impl std::fmt::Display for BindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending(reason) => write!(f, "bind pending: {}", reason),
            Self::Fatal(reason) => write!(f, "bind fatal: {}", reason),
        }
    }
}

impl std::error::Error for BindError {}
```

Note the `use std::path::Path;` and `use std::time::SystemTime;` — add them at the top of the file with the existing `use std::path::PathBuf;` import.

- [ ] **Step 2: Verify build.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors. The types compile but have no callers yet.

- [ ] **Step 3: Add a Display-format pin test.**

In a `#[cfg(test)] mod tests` block at the bottom of `adapter/types.rs` (or extend the existing `display_tests` module if appropriate):

```rust
#[test]
fn bind_error_display_pending_format() {
    let e = BindError::Pending("logs row not yet committed".to_string());
    assert_eq!(e.to_string(), "bind pending: logs row not yet committed");
}

#[test]
fn bind_error_display_fatal_format() {
    let e = BindError::Fatal("permission denied on ~/.codex".to_string());
    assert_eq!(e.to_string(), "bind fatal: permission denied on ~/.codex");
}
```

Run:

```bash
cd src-tauri && cargo test --lib bind_error_display
```

Expected: PASS (two tests).

- [ ] **Step 4: Commit.**

```bash
git add src-tauri/src/agent/adapter/types.rs
git commit -m "feat(agent/adapter): add BindContext and BindError types

BindContext carries session_id/cwd/pid/pty_start so codex's locator
can gate SQLite queries; BindError separates transient Pending
(retried) from Fatal (surfaced)."
```

---

## Task 6: Make `AgentAdapter::status_source` fallible (no retry yet)

**Goal:** Change the trait signature to take `&BindContext` and return `Result<StatusSource, BindError>`. Update Claude's impl, the NoOp impl, the `start_agent_watcher` Tauri command, the inherent `start`, AND `base::start_for`'s signature — all in one coherent commit so the workspace compiles cleanly at the end. `start_for`'s body just calls `adapter.status_source(&ctx)?` once and proceeds (no retry); the bounded retry loop on `BindError::Pending` lands in Task 7 as a body-only change.

This task and Task 7 are intentionally split this way so each task ends in a green workspace. Combining them into one commit is also fine — but doing them across two commits with the trait change in one and the matching `base::start_for` change deferred to the second would leave Task 6 in a guaranteed compile-broken state.

**Files:**

- Modify: `src-tauri/src/agent/adapter/mod.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs`
- Modify: `src-tauri/src/agent/adapter/base/mod.rs`

- [ ] **Step 1: Update the trait declaration.**

In `agent/adapter/mod.rs`, replace the trait method:

```rust
// Before
fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource;

// After
fn status_source(
    &self,
    ctx: &crate::agent::adapter::types::BindContext<'_>,
) -> Result<StatusSource, crate::agent::adapter::types::BindError>;
```

(Or import the types at module-top so the call sites read clean: `use types::{BindContext, BindError};` then `fn status_source(&self, ctx: &BindContext) -> Result<StatusSource, BindError>;`.)

- [ ] **Step 2: Update `ClaudeCodeAdapter::status_source`.**

Open `agent/adapter/claude_code/mod.rs`. Replace the impl:

```rust
fn status_source(
    &self,
    ctx: &crate::agent::adapter::types::BindContext<'_>,
) -> Result<StatusSource, crate::agent::adapter::types::BindError> {
    Ok(StatusSource {
        path: ctx
            .cwd
            .join(".vimeflow")
            .join("sessions")
            .join(ctx.session_id)
            .join("status.json"),
        trust_root: ctx.cwd.to_path_buf(),
    })
}
```

`ctx.pid` and `ctx.pty_start` are intentionally unused — Claude's path projection doesn't need them.

- [ ] **Step 3: Update `NoOpAdapter::status_source`.**

In the same `agent/adapter/mod.rs`, find the existing `NoOpAdapter` impl. Replace:

```rust
fn status_source(
    &self,
    ctx: &crate::agent::adapter::types::BindContext<'_>,
) -> Result<StatusSource, crate::agent::adapter::types::BindError> {
    Ok(StatusSource {
        path: ctx
            .cwd
            .join(".vimeflow")
            .join("sessions")
            .join(ctx.session_id)
            .join("status.json"),
        trust_root: ctx.cwd.to_path_buf(),
    })
}
```

- [ ] **Step 4: Update `start_agent_watcher` to build a `BindContext`.**

Find the existing `start_agent_watcher` Tauri command (currently around line 124-144 in `agent/adapter/mod.rs`). Replace its body to assemble the context and pass it down:

```rust
#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AgentWatcherState>,
    pty_state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let cwd = pty_state
        .get_cwd(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let pid = pty_state
        .get_pid(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let pty_start = pty_state
        .get_started_at(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let agent_type = detect_agent(pid)
        .map(|(agent_type, _)| agent_type)
        .ok_or_else(|| format!("no agent detected in PTY session {}", session_id))?;

    let adapter = <dyn AgentAdapter<tauri::Wry>>::for_type(agent_type)?;
    adapter.start(
        app_handle,
        session_id,
        std::path::PathBuf::from(cwd),
        pid,
        pty_start,
        (*state).clone(),
    )
}
```

`adapter.start(...)` now takes `pid` and `pty_start` so it can build the `BindContext` for `start_for`. Update the inherent `impl<R> dyn AgentAdapter<R>` block accordingly:

```rust
pub fn start(
    self: Arc<Self>,
    app: AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: std::time::SystemTime,
    state: AgentWatcherState,
) -> Result<(), String> {
    base::start_for(self, app, session_id, cwd, pid, pty_start, state)
}
```

- [ ] **Step 5: Update `base::start_for` signature to accept `pid` + `pty_start`.**

In `src-tauri/src/agent/adapter/base/mod.rs`, find the existing `start_for` (currently at line 21):

```rust
// Before
pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source = adapter.status_source(&cwd, &session_id);
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;
    // ... rest unchanged
}

// After (this task — no retry yet)
pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: std::time::SystemTime,
    state: AgentWatcherState,
) -> Result<(), String> {
    let ctx = crate::agent::adapter::types::BindContext {
        session_id: &session_id,
        cwd: &cwd,
        pid,
        pty_start,
    };
    let source = adapter
        .status_source(&ctx)
        .map_err(|e| format!("{}", e))?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;
    // ... rest of existing body unchanged ...
}
```

The body change is minimal: build the `BindContext`, call the now-fallible `status_source`, surface any `BindError` as `Err(String)`. The `BindError` Display impl from Task 5 produces `"bind pending: ..."` / `"bind fatal: ..."` strings. Task 7 will replace the single-call site with a bounded retry loop.

- [ ] **Step 6: Update existing `noop_tests` for the new signature.**

In the existing `#[cfg(test)] mod noop_tests` block in `adapter/mod.rs`:

```rust
#[test]
fn status_source_uses_claude_shaped_path() {
    use std::time::SystemTime;
    let adapter = NoOpAdapter::new(AgentType::Aider);
    let cwd = PathBuf::from("/tmp/ws");
    let ctx = crate::agent::adapter::types::BindContext {
        session_id: "sid",
        cwd: &cwd,
        pid: 0,
        pty_start: SystemTime::UNIX_EPOCH,
    };
    let src = <NoOpAdapter as AgentAdapter<MockRuntime>>::status_source(&adapter, &ctx)
        .expect("noop status_source always Ok");
    assert_eq!(
        src.path,
        cwd.join(".vimeflow")
            .join("sessions")
            .join("sid")
            .join("status.json")
    );
    assert_eq!(src.trust_root, cwd);
}
```

- [ ] **Step 7: Run all tests.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: PASS. Any remaining compile errors are call sites of the old `status_source(cwd, sid)` shape elsewhere — update them to build a `BindContext` and unwrap the `Result`. Existing tests that construct a `BindContext` directly (e.g. the `noop_tests::status_source_uses_claude_shaped_path` test from Step 6 above) are pinned by this task; tests that drive `start_for` integration must now pass `pid` + `pty_start`.

- [ ] **Step 8: Commit.**

```bash
git add src-tauri/src/agent/adapter/mod.rs \
        src-tauri/src/agent/adapter/claude_code/mod.rs \
        src-tauri/src/agent/adapter/base/mod.rs
git commit -m "refactor(agent/adapter): status_source takes BindContext, returns Result

Trait surface change. Claude's impl ignores pid/pty_start and is
still infallible (Ok). NoOp likewise. start_agent_watcher pulls
pid + pty_start from PtyState and threads them through. start_for
retry on Pending lands in the next commit."
```

---

## Task 7: `base::start_for` retry loop on `BindError::Pending`

**Goal:** Bounded retry on transient bind failures (≤500ms total) without overlapping the frontend's 2000ms detection re-poll.

**Files:**

- Modify: `src-tauri/src/agent/adapter/base/mod.rs`

- [ ] **Step 1: Write the failing test.**

This test uses `tauri::test::mock_builder()` to construct an app and a mock adapter. The mock returns `BindError::Pending` for the first N calls then `Ok`. We assert the retry succeeds within budget.

In `agent/adapter/base/mod.rs` (or a sibling test module), add:

```rust
#[cfg(test)]
mod start_for_retry_tests {
    use super::*;
    use crate::agent::adapter::types::{BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant, SystemTime};
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::AppHandle;
    use tauri::Manager;

    struct PendingThenOkAdapter {
        calls: AtomicUsize,
        flip_after: usize,
        path: PathBuf,
    }

    impl AgentAdapter<MockRuntime> for PendingThenOkAdapter {
        fn agent_type(&self) -> crate::agent::types::AgentType {
            crate::agent::types::AgentType::Codex
        }
        fn status_source(
            &self,
            _ctx: &BindContext<'_>,
        ) -> Result<StatusSource, BindError> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst);
            if n < self.flip_after {
                Err(BindError::Pending(format!("attempt {}", n)))
            } else {
                Ok(StatusSource {
                    path: self.path.clone(),
                    trust_root: self.path.parent().unwrap().to_path_buf(),
                })
            }
        }
        fn parse_status(&self, _: &str, _: &str) -> Result<ParsedStatus, String> {
            Err("not used".to_string())
        }
        fn validate_transcript(&self, _: &str) -> Result<PathBuf, ValidateTranscriptError> {
            Err(ValidateTranscriptError::Other("not used".to_string()))
        }
        fn tail_transcript(
            &self,
            _: AppHandle<MockRuntime>,
            _: String,
            _: Option<PathBuf>,
            _: PathBuf,
        ) -> Result<TranscriptHandle, String> {
            Err("not used".to_string())
        }
    }

    #[test]
    fn start_for_retries_on_pending_then_succeeds_under_budget() {
        let app = mock_builder()
            .build(tauri::generate_context!())
            .expect("mock app build");
        // Use a temp file as the status_source target so path-trust passes.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        std::fs::write(&path, "").unwrap();

        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(PendingThenOkAdapter {
            calls: AtomicUsize::new(0),
            flip_after: 3,
            path: path.clone(),
        });

        let state = AgentWatcherState::new();
        app.manage(crate::agent::adapter::base::transcript_state::TranscriptState::default());

        let started = Instant::now();
        let result = start_for(
            adapter,
            app.handle().clone(),
            "test-sid".to_string(),
            dir.path().to_path_buf(),
            12345,
            SystemTime::now(),
            state.clone(),
        );
        let elapsed = started.elapsed();

        assert!(result.is_ok(), "start_for should succeed after retries: {:?}", result);
        assert!(
            elapsed < Duration::from_millis(900),
            "retry budget exceeded: {:?}",
            elapsed
        );
        // Frontend re-polls at DETECTION_POLL_MS=2000; budget MUST be well under that.
    }

    #[test]
    fn start_for_returns_err_when_pending_budget_exhausted() {
        let app = mock_builder()
            .build(tauri::generate_context!())
            .expect("mock app build");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");

        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(PendingThenOkAdapter {
            calls: AtomicUsize::new(0),
            flip_after: usize::MAX, // never succeeds
            path,
        });

        let state = AgentWatcherState::new();
        app.manage(crate::agent::adapter::base::transcript_state::TranscriptState::default());

        let started = Instant::now();
        let result = start_for(
            adapter,
            app.handle().clone(),
            "exhausted-sid".to_string(),
            dir.path().to_path_buf(),
            12345,
            SystemTime::now(),
            state,
        );
        let elapsed = started.elapsed();

        assert!(result.is_err(), "expected Err on exhausted retries");
        assert!(
            result.unwrap_err().contains("bind pending"),
            "error string should mention bind pending"
        );
        assert!(
            elapsed < Duration::from_millis(900),
            "retry budget exceeded on exhaustion path: {:?}",
            elapsed
        );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd src-tauri && cargo test --lib start_for_retry_tests
```

Expected: the `start_for_retries_on_pending_then_succeeds_under_budget` test FAILS at runtime — Task 6 left `start_for`'s body calling `status_source` exactly once, so the first `Pending` error returns `Err(...)` instead of retrying. The `start_for_returns_err_when_pending_budget_exhausted` test may pass for the wrong reason (single-call also returns Err), but the wall-clock assertion (`elapsed < 900ms`) is still meaningful — without a retry loop the call returns immediately, well under budget.

- [ ] **Step 3: Replace the single-call body with the retry loop.**

In `agent/adapter/base/mod.rs`, the `start_for` signature is unchanged from Task 6. Only the body changes — wrap the `status_source` call in a bounded retry. Add the imports + constants near the top of the file alongside existing imports:

```rust
use std::time::{Duration, Instant};

use crate::agent::adapter::types::BindError;

const BIND_RETRY_INTERVAL_MS: u64 = 100;
const BIND_RETRY_MAX_ATTEMPTS: u32 = 5;
```

Then replace the body of `start_for` (signature unchanged from Task 6):

```rust
pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: std::time::SystemTime,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source = resolve_status_source_with_retry(
        adapter.as_ref(),
        &session_id,
        &cwd,
        pid,
        pty_start,
    )?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;

    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd.display(),
        source.path.display()
    );

    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        source.path.display(),
        state.active_count(),
    );

    let handle =
        watcher_runtime::start_watching(adapter, app_handle, session_id.clone(), source.path)?;
    state.insert(session_id, handle);

    Ok(())
}

/// Bounded retry on `BindError::Pending`. Total budget is
/// BIND_RETRY_MAX_ATTEMPTS * BIND_RETRY_INTERVAL_MS = 500ms, well
/// under the frontend's DETECTION_POLL_MS=2000ms re-poll so a still-
/// in-flight start_agent_watcher cannot overlap a fresh re-poll.
fn resolve_status_source_with_retry<R: tauri::Runtime>(
    adapter: &dyn AgentAdapter<R>,
    session_id: &str,
    cwd: &std::path::Path,
    pid: u32,
    pty_start: std::time::SystemTime,
) -> Result<crate::agent::adapter::types::StatusSource, String> {
    let ctx = crate::agent::adapter::types::BindContext {
        session_id,
        cwd,
        pid,
        pty_start,
    };
    let started = Instant::now();
    let mut last_err: Option<BindError> = None;

    for _ in 0..BIND_RETRY_MAX_ATTEMPTS {
        match adapter.status_source(&ctx) {
            Ok(src) => return Ok(src),
            Err(BindError::Fatal(reason)) => return Err(format!("bind fatal: {}", reason)),
            Err(pending @ BindError::Pending(_)) => {
                last_err = Some(pending);
                std::thread::sleep(Duration::from_millis(BIND_RETRY_INTERVAL_MS));
            }
        }
    }

    log::warn!(
        "start_for: bind retry budget exhausted for session={} (elapsed={:?})",
        session_id,
        started.elapsed()
    );
    Err(format!(
        "{}",
        last_err.unwrap_or_else(|| BindError::Pending("no attempts".into()))
    ))
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd src-tauri && cargo test --lib start_for_retry_tests
```

Expected: both tests PASS within the 900ms wall-clock bound.

- [ ] **Step 5: Run the full backend suite.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: PASS. Pre-existing `start_for` integration tests may need their callers updated to pass `pid` + `pty_start`; the compiler flags those.

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/agent/adapter/base/mod.rs
git commit -m "feat(agent/adapter): bounded retry on BindError::Pending

start_for retries 5 times at 100ms intervals (500ms total) before
giving up with Err(String). Budget chosen well under frontend
DETECTION_POLL_MS=2000ms so a still-in-flight start cannot overlap
the next detection poll."
```

---

## Task 8: Codex module skeleton

**Goal:** Empty new files registered with the build, stubs only. Subsequent tasks fill the bodies.

**Files:**

- Create: `src-tauri/src/agent/adapter/codex/mod.rs`
- Create: `src-tauri/src/agent/adapter/codex/locator.rs`
- Create: `src-tauri/src/agent/adapter/codex/parser.rs`
- Create: `src-tauri/src/agent/adapter/codex/transcript.rs`
- Modify: `src-tauri/src/agent/adapter/mod.rs` (add `pub mod codex;`)

- [ ] **Step 1: Create the directory and file stubs.**

```bash
mkdir -p src-tauri/src/agent/adapter/codex
```

Then create each file with a single doc-comment line:

```rust
// src-tauri/src/agent/adapter/codex/mod.rs
//! Codex adapter — see docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md.

mod locator;
mod parser;
mod transcript;

pub(crate) use mod_decl::CodexAdapter;

mod mod_decl {
    /// Placeholder until Task 14 fills the body.
    pub struct CodexAdapter;
}
```

(The `mod_decl` indirection is a temporary scaffold so the parent module can `pub(crate) use codex::CodexAdapter` from the start; Task 14 replaces it with the real impl.)

```rust
// src-tauri/src/agent/adapter/codex/locator.rs
//! CodexSessionLocator — resolves a PTY's codex rollout JSONL via
//! schema-driven SQLite discovery + FS-scan fallback.
```

```rust
// src-tauri/src/agent/adapter/codex/parser.rs
//! Parser for codex's rollout JSONL.
//!
//! Folds session_meta + turn_context + event_msg lines into a single
//! AgentStatusEvent snapshot. Per the 2026-05-03 ADR, internals
//! organize around domain functions (latest_token_count,
//! task_completes); shared helpers stay private to this adapter.
```

```rust
// src-tauri/src/agent/adapter/codex/transcript.rs
//! Codex transcript tailer — v1 stub.
//!
//! Returns ValidateTranscriptError::Other / Err for both
//! validate_transcript and tail_transcript. Real tailer is a
//! follow-up spec.
```

- [ ] **Step 2: Register the new module.**

In `src-tauri/src/agent/adapter/mod.rs`, alphabetically next to `pub mod claude_code;`:

```rust
pub mod codex;
```

- [ ] **Step 3: Verify build.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add src-tauri/src/agent/adapter/codex/ src-tauri/src/agent/adapter/mod.rs
git commit -m "refactor(agent/adapter): scaffold codex adapter module

Empty stubs for codex/{mod,locator,parser,transcript}.rs. No callers
yet; Tasks 9-15 fill the bodies."
```

---

## Task 9: Codex parser — happy path

**Goal:** A working `parse_rollout(session_id, raw) -> Result<ParsedStatus, String>` for the single-turn case. Test fixture committed alongside.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/parser.rs`
- Create: `src-tauri/tests/fixtures/codex/rollout-minimal.jsonl`

- [ ] **Step 1: Capture a real minimal rollout as a fixture.**

The locked spec rollout shape is what we need. Copy a real session's first ~5 lines (or hand-author one matching the discovered shape). Write to `src-tauri/tests/fixtures/codex/rollout-minimal.jsonl`:

```jsonl
{"timestamp":"2026-05-03T21:56:49.215Z","type":"session_meta","payload":{"id":"019defd8-15a1-7401-9f4f-40fe52a1c590","timestamp":"2026-05-03T21:56:49.215Z","cwd":"/home/will/projects/vimeflow","originator":"codex_exec","cli_version":"0.128.0","source":"exec","model_provider":"openai"}}
{"timestamp":"2026-05-03T21:56:49.220Z","type":"turn_context","payload":{"turn_id":"019defd8-15c5-7d73-8c4d-599653436823","cwd":"/home/will/projects/vimeflow","model":"gpt-5.4","personality":"pragmatic","effort":"xhigh"}}
{"timestamp":"2026-05-03T21:56:49.225Z","type":"event_msg","payload":{"type":"task_started","turn_id":"019defd8-15c5-7d73-8c4d-599653436823","started_at":1777845409,"model_context_window":258400,"collaboration_mode_kind":"default"}}
{"timestamp":"2026-05-03T21:57:30.123Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":52685,"cached_input_tokens":51584,"output_tokens":2177,"reasoning_output_tokens":1854,"total_tokens":54862},"last_token_usage":{"input_tokens":52685,"cached_input_tokens":51584,"output_tokens":2177,"reasoning_output_tokens":1854,"total_tokens":54862},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":8.0,"window_minutes":300,"resets_at":1777848985},"secondary":{"used_percent":26.0,"window_minutes":10080,"resets_at":1778074288},"plan_type":"prolite"}}}
{"timestamp":"2026-05-03T21:57:30.500Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"019defd8-15c5-7d73-8c4d-599653436823","completed_at":1777845617,"duration_ms":208025,"time_to_first_token_ms":15165,"last_agent_message":"done"}}
```

- [ ] **Step 2: Write the failing happy-path test in `parser.rs`.**

Replace `parser.rs` body:

```rust
//! Parser for codex's rollout JSONL.

use crate::agent::adapter::types::ParsedStatus;
use crate::agent::types::{
    AgentStatusEvent, ContextWindowStatus, CostMetrics, CurrentUsage, RateLimitInfo, RateLimits,
};
use serde_json::Value;

/// Parse a rollout JSONL string into a single `AgentStatusEvent`
/// snapshot. Drops an incomplete trailing line silently; warn-logs
/// malformed non-final lines. Always sets `transcript_path: None`
/// for v1 — the codex transcript tailer is a follow-up.
pub fn parse_rollout(session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
    let mut state = CodexFoldState::default();
    let lines: Vec<&str> = raw.split('\n').collect();
    let trailing_complete = raw.ends_with('\n');

    for (idx, line) in lines.iter().enumerate() {
        let is_last = idx + 1 == lines.len();
        if line.is_empty() {
            continue;
        }
        if is_last && !trailing_complete {
            // Incomplete trailing line — codex is mid-flush. Drop silently.
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(value) => fold_event(&mut state, &value),
            Err(_) => log::warn!(
                "codex: skipping malformed rollout line for sid={}",
                session_id
            ),
        }
    }

    Ok(ParsedStatus {
        event: state.into_event(session_id),
        transcript_path: None,
    })
}

#[derive(Default)]
struct CodexFoldState {
    agent_session_id: String,
    cli_version: String,
    model: String,
    /// From event_msg.task_started; falls back into context_window_size
    /// until token_count.info delivers its own model_context_window.
    last_task_started_context_window: Option<u64>,
    /// Latest non-null token_count.info — `None` until first received.
    last_token_count_info: Option<TokenCountInfo>,
    /// Latest rate_limits block — `None` until first received.
    last_rate_limits: Option<RateLimits>,
    /// Sum of every observed task_complete.duration_ms.
    total_duration_ms: u64,
}

#[derive(Clone)]
struct TokenCountInfo {
    last_input_tokens: u64,
    last_output_tokens: u64,
    last_cached_input_tokens: u64,
    last_total_tokens: u64,
    model_context_window: u64,
}

impl CodexFoldState {
    fn into_event(self, session_id: &str) -> AgentStatusEvent {
        let context_window_size = self
            .last_token_count_info
            .as_ref()
            .map(|i| i.model_context_window)
            .or(self.last_task_started_context_window)
            .unwrap_or(0);

        let used_percentage = self.last_token_count_info.as_ref().and_then(|i| {
            if context_window_size == 0 {
                None
            } else {
                Some(clamp_percentage(
                    (i.last_total_tokens as f64 / context_window_size as f64) * 100.0,
                ))
            }
        });

        let remaining_percentage = used_percentage
            .map(|u| clamp_percentage(100.0 - u))
            .unwrap_or(100.0);

        let context_window = ContextWindowStatus {
            used_percentage,
            remaining_percentage,
            context_window_size,
            total_input_tokens: self
                .last_token_count_info
                .as_ref()
                .map(|i| i.last_input_tokens)
                .unwrap_or(0),
            total_output_tokens: self
                .last_token_count_info
                .as_ref()
                .map(|i| i.last_output_tokens)
                .unwrap_or(0),
            current_usage: self.last_token_count_info.as_ref().map(|i| CurrentUsage {
                input_tokens: i.last_input_tokens,
                output_tokens: i.last_output_tokens,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: i.last_cached_input_tokens,
            }),
        };

        let cost = CostMetrics {
            total_cost_usd: None,
            total_duration_ms: self.total_duration_ms,
            total_api_duration_ms: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
        };

        let rate_limits = self.last_rate_limits.unwrap_or(RateLimits {
            five_hour: RateLimitInfo {
                used_percentage: 0.0,
                resets_at: 0,
            },
            seven_day: None,
        });

        AgentStatusEvent {
            session_id: session_id.to_string(),
            agent_session_id: self.agent_session_id,
            model_id: if self.model.is_empty() {
                "unknown".to_string()
            } else {
                self.model.clone()
            },
            model_display_name: if self.model.is_empty() {
                "unknown".to_string()
            } else {
                self.model
            },
            version: self.cli_version,
            context_window,
            cost,
            rate_limits,
        }
    }
}

fn fold_event(state: &mut CodexFoldState, value: &Value) {
    let kind = value.get("type").and_then(Value::as_str);
    match kind {
        Some("session_meta") => absorb_session_meta(state, value.get("payload").unwrap_or(&Value::Null)),
        Some("turn_context") => absorb_turn_context(state, value.get("payload").unwrap_or(&Value::Null)),
        Some("event_msg") => {
            let payload = value.get("payload").unwrap_or(&Value::Null);
            match payload.get("type").and_then(Value::as_str) {
                Some("task_started") => absorb_task_started(state, payload),
                Some("task_complete") => absorb_task_complete(state, payload),
                Some("token_count") => absorb_token_count(state, payload),
                _ => {} // forward-compat: ignore unknown
            }
        }
        _ => {} // forward-compat: ignore unknown
    }
}

fn absorb_session_meta(state: &mut CodexFoldState, payload: &Value) {
    if let Some(s) = payload.get("id").and_then(Value::as_str) {
        state.agent_session_id = s.to_string();
    }
    if let Some(s) = payload.get("cli_version").and_then(Value::as_str) {
        state.cli_version = s.to_string();
    }
}

fn absorb_turn_context(state: &mut CodexFoldState, payload: &Value) {
    if let Some(s) = payload.get("model").and_then(Value::as_str) {
        state.model = s.to_string();
    }
}

fn absorb_task_started(state: &mut CodexFoldState, payload: &Value) {
    if let Some(n) = payload.get("model_context_window").and_then(Value::as_u64) {
        state.last_task_started_context_window = Some(n);
    }
}

fn absorb_task_complete(state: &mut CodexFoldState, payload: &Value) {
    if let Some(n) = payload.get("duration_ms").and_then(Value::as_u64) {
        state.total_duration_ms = state.total_duration_ms.saturating_add(n);
    }
}

/// Per the spec: when payload.info is null, fold rate_limits only;
/// preserve existing context-window/token state. Same rule symmetrically
/// for null rate_limits.
fn absorb_token_count(state: &mut CodexFoldState, payload: &Value) {
    if let Some(info) = payload.get("info") {
        if !info.is_null() {
            state.last_token_count_info = Some(parse_token_count_info(info));
        }
    }
    if let Some(rl) = payload.get("rate_limits") {
        if !rl.is_null() {
            state.last_rate_limits = Some(parse_rate_limits(rl));
        }
    }
}

fn parse_token_count_info(info: &Value) -> TokenCountInfo {
    let last = info.get("last_token_usage").unwrap_or(&Value::Null);
    TokenCountInfo {
        last_input_tokens: last.get("input_tokens").and_then(Value::as_u64).unwrap_or(0),
        last_output_tokens: last.get("output_tokens").and_then(Value::as_u64).unwrap_or(0),
        last_cached_input_tokens: last
            .get("cached_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        last_total_tokens: last.get("total_tokens").and_then(Value::as_u64).unwrap_or(0),
        model_context_window: info
            .get("model_context_window")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

fn parse_rate_limits(rl: &Value) -> RateLimits {
    let primary = rl.get("primary").unwrap_or(&Value::Null);
    let five_hour = RateLimitInfo {
        used_percentage: primary
            .get("used_percent")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        resets_at: primary
            .get("resets_at")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    };
    let seven_day = rl.get("secondary").and_then(|s| {
        if s.is_null() {
            None
        } else {
            Some(RateLimitInfo {
                used_percentage: s.get("used_percent").and_then(Value::as_f64).unwrap_or(0.0),
                resets_at: s.get("resets_at").and_then(Value::as_u64).unwrap_or(0),
            })
        }
    });
    RateLimits { five_hour, seven_day }
}

fn clamp_percentage(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/codex")
            .join(name);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read fixture {}: {}", path.display(), e))
    }

    #[test]
    fn parses_minimal_single_turn() {
        let raw = fixture("rollout-minimal.jsonl");
        let parsed = parse_rollout("pty-test", &raw).expect("happy path");
        let event = parsed.event;

        assert_eq!(event.session_id, "pty-test");
        assert_eq!(event.agent_session_id, "019defd8-15a1-7401-9f4f-40fe52a1c590");
        assert_eq!(event.model_id, "gpt-5.4");
        assert_eq!(event.model_display_name, "gpt-5.4");
        assert_eq!(event.version, "0.128.0");

        assert_eq!(event.context_window.context_window_size, 258400);
        assert_eq!(event.context_window.total_input_tokens, 52685);
        assert_eq!(event.context_window.total_output_tokens, 2177);
        assert!(event.context_window.used_percentage.is_some());
        let used = event.context_window.used_percentage.unwrap();
        assert!((used - 21.23).abs() < 0.5, "used_percentage near 21%, got {}", used);
        let cu = event.context_window.current_usage.expect("current_usage present");
        assert_eq!(cu.cache_read_input_tokens, 51584);
        assert_eq!(cu.cache_creation_input_tokens, 0);

        assert_eq!(event.cost.total_cost_usd, None);
        assert_eq!(event.cost.total_duration_ms, 208025);
        assert_eq!(event.cost.total_api_duration_ms, 0);

        assert!((event.rate_limits.five_hour.used_percentage - 8.0).abs() < f64::EPSILON);
        let seven_day = event.rate_limits.seven_day.expect("seven_day present");
        assert!((seven_day.used_percentage - 26.0).abs() < f64::EPSILON);

        assert!(parsed.transcript_path.is_none(), "v1 transcript_path is always None");
    }
}
```

- [ ] **Step 3: Run the test to verify it passes.**

```bash
cd src-tauri && cargo test --lib parser::tests::parses_minimal_single_turn
```

Expected: PASS.

- [ ] **Step 4: Wire `parse_rollout` into `mod.rs`.**

In `src-tauri/src/agent/adapter/codex/mod.rs`, expose the parser entry point:

```rust
//! Codex adapter — see docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md.

mod locator;
mod parser;
mod transcript;

pub(crate) use parser::parse_rollout;
pub(crate) use mod_decl::CodexAdapter;

mod mod_decl {
    pub struct CodexAdapter;
}
```

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/agent/adapter/codex/parser.rs \
        src-tauri/src/agent/adapter/codex/mod.rs \
        src-tauri/tests/fixtures/codex/rollout-minimal.jsonl
git commit -m "feat(agent/codex): rollout parser happy-path + fixture

parse_rollout folds session_meta, turn_context, and event_msg
(task_started, task_complete, token_count) into an AgentStatusEvent.
Per spec: context_window driven by last_token_usage (not lifetime
totals), total_api_duration_ms emits 0, transcript_path is None for
v1. Fixture covers the single-turn happy path."
```

---

## Task 10: Codex parser — edge cases (null info, long-session, fixtures)

**Goal:** Cover the spec's locked edge-case rules with fixtures and tests.

**Files:**

- Create: `src-tauri/tests/fixtures/codex/rollout-info-null.jsonl`
- Create: `src-tauri/tests/fixtures/codex/rollout-long-session.jsonl`
- Create: `src-tauri/tests/fixtures/codex/rollout-multi-turn.jsonl`
- Create: `src-tauri/tests/fixtures/codex/rollout-incomplete-trail.jsonl`
- Create: `src-tauri/tests/fixtures/codex/rollout-malformed-mid.jsonl`
- Modify: `src-tauri/src/agent/adapter/codex/parser.rs` (test additions only)

- [ ] **Step 1: Add the `info-null` fixture.**

`src-tauri/tests/fixtures/codex/rollout-info-null.jsonl`:

```jsonl
{"timestamp":"2026-05-03T21:56:49.215Z","type":"session_meta","payload":{"id":"sess-info-null","cwd":"/tmp","cli_version":"0.128.0","originator":"codex_tui"}}
{"timestamp":"2026-05-03T21:56:49.220Z","type":"turn_context","payload":{"model":"gpt-5.4"}}
{"timestamp":"2026-05-03T21:56:49.230Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"codex","primary":{"used_percent":3.5,"window_minutes":300,"resets_at":1777848985}}}}
{"timestamp":"2026-05-03T21:56:50.500Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":200,"reasoning_output_tokens":50,"total_tokens":1200},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":200,"reasoning_output_tokens":50,"total_tokens":1200},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":3.6,"window_minutes":300,"resets_at":1777848985}}}}
```

The first `token_count` has `info: null` and only `rate_limits`; the second has both. Folded result must show: rate*limits = the \_second* (last-write-wins), context_window from the second.

But the test below pins the _partial-update rule_ — i.e. the first event's rate_limits must NOT zero out the context window state. Order the events to verify correctly:

Better fixture (re-order so the partial event comes after a real one):

```jsonl
{"timestamp":"2026-05-03T21:56:49.215Z","type":"session_meta","payload":{"id":"sess-info-null","cwd":"/tmp","cli_version":"0.128.0","originator":"codex_tui"}}
{"timestamp":"2026-05-03T21:56:49.220Z","type":"turn_context","payload":{"model":"gpt-5.4"}}
{"timestamp":"2026-05-03T21:56:50.500Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":200,"reasoning_output_tokens":50,"total_tokens":1200},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":200,"reasoning_output_tokens":50,"total_tokens":1200},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":3.5,"window_minutes":300,"resets_at":1777848985}}}}
{"timestamp":"2026-05-03T21:56:51.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"codex","primary":{"used_percent":4.0,"window_minutes":300,"resets_at":1777848985}}}}
```

So the second `token_count` has `info: null` after a real one. The expected fold: context_window from the first, rate_limits from the second (4.0%, not 3.5%).

- [ ] **Step 2: Add the `long-session` fixture.**

`rollout-long-session.jsonl`:

```jsonl
{"timestamp":"2026-05-03T21:56:49.215Z","type":"session_meta","payload":{"id":"sess-long","cwd":"/tmp","cli_version":"0.128.0"}}
{"timestamp":"2026-05-03T21:56:49.220Z","type":"turn_context","payload":{"model":"gpt-5.4"}}
{"timestamp":"2026-05-03T21:57:30.500Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":600000,"cached_input_tokens":550000,"output_tokens":15000,"reasoning_output_tokens":7500,"total_tokens":615000},"last_token_usage":{"input_tokens":52000,"cached_input_tokens":51000,"output_tokens":2100,"reasoning_output_tokens":1800,"total_tokens":54100},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":50.0,"window_minutes":300,"resets_at":1777848985}}}}
```

`total_token_usage.total_tokens = 615000` is well over `model_context_window = 258400`. The spec mandates `used_percentage` is computed from `last_token_usage.total_tokens / model_context_window` = `54100 / 258400 ≈ 20.94%` — not pinned to 100%.

- [ ] **Step 3: Add the multi-turn fixture (3+ task_completes for duration sum).**

`rollout-multi-turn.jsonl`:

```jsonl
{"timestamp":"2026-05-03T21:56:49.215Z","type":"session_meta","payload":{"id":"sess-multi","cwd":"/tmp","cli_version":"0.128.0"}}
{"timestamp":"2026-05-03T21:56:49.220Z","type":"turn_context","payload":{"model":"gpt-5.4"}}
{"timestamp":"2026-05-03T21:56:49.300Z","type":"event_msg","payload":{"type":"task_complete","duration_ms":10000}}
{"timestamp":"2026-05-03T21:56:49.400Z","type":"event_msg","payload":{"type":"task_complete","duration_ms":20000}}
{"timestamp":"2026-05-03T21:56:49.500Z","type":"event_msg","payload":{"type":"task_complete","duration_ms":30000}}
{"timestamp":"2026-05-03T21:56:49.600Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":10,"reasoning_output_tokens":5,"total_tokens":110},"last_token_usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":10,"reasoning_output_tokens":5,"total_tokens":110},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":1.0,"window_minutes":300,"resets_at":1}}}}
```

Expected: `total_duration_ms = 60000` (sum of 10k + 20k + 30k).

- [ ] **Step 4: Add the incomplete-trail fixture.**

`rollout-incomplete-trail.jsonl` — last line is missing the trailing `\n`. Easiest way: `printf` without a final newline.

```bash
printf '%s\n%s\n%s' \
  '{"timestamp":"...","type":"session_meta","payload":{"id":"sess-trail","cli_version":"0.128.0"}}' \
  '{"timestamp":"...","type":"turn_context","payload":{"model":"gpt-5.4"}}' \
  '{"timestamp":"...","type":"event_msg","payload":{"type":"task_complete","duration_ms":' \
  > src-tauri/tests/fixtures/codex/rollout-incomplete-trail.jsonl
```

The last line is structurally truncated mid-JSON — the parser must NOT warn and MUST drop it silently because the file doesn't end in `\n`.

- [ ] **Step 5: Add the malformed-mid fixture.**

`rollout-malformed-mid.jsonl` — one bad line surrounded by valid lines:

```jsonl
{"timestamp":"2026-05-03T21:56:49.215Z","type":"session_meta","payload":{"id":"sess-malformed","cli_version":"0.128.0"}}
this is not json
{"timestamp":"2026-05-03T21:56:49.220Z","type":"turn_context","payload":{"model":"gpt-5.4"}}
```

Note this file ENDS in `\n` so the bad line is in the middle, not trailing — that triggers `warn!`.

- [ ] **Step 6: Write the failing tests.**

Append to `parser.rs` test module:

```rust
#[test]
fn long_session_uses_last_token_usage_not_lifetime() {
    let raw = fixture("rollout-long-session.jsonl");
    let parsed = parse_rollout("pty-long", &raw).expect("long session");
    let event = parsed.event;

    // last_token_usage.total_tokens (54100) / model_context_window (258400) ≈ 20.94%
    let used = event.context_window.used_percentage.expect("present");
    assert!(
        (used - 20.94).abs() < 0.5,
        "used_percentage must reflect last_token_usage, not lifetime; got {}",
        used
    );
    assert!(used < 100.0, "regression: lifetime totals would pin to 100%");

    // Fields take last_token_usage values.
    assert_eq!(event.context_window.total_input_tokens, 52000);
    assert_eq!(event.context_window.total_output_tokens, 2100);
}

#[test]
fn token_count_info_null_preserves_prior_context() {
    let raw = fixture("rollout-info-null.jsonl");
    let parsed = parse_rollout("pty-info-null", &raw).expect("info-null");
    let event = parsed.event;

    // Context fields come from the FIRST token_count (info present);
    // the SECOND (info=null) must NOT erase them.
    assert_eq!(event.context_window.total_input_tokens, 1000);
    assert_eq!(event.context_window.total_output_tokens, 200);

    // rate_limits comes from the SECOND token_count (4.0%), not the first (3.5%).
    assert!(
        (event.rate_limits.five_hour.used_percentage - 4.0).abs() < f64::EPSILON,
        "rate_limits last-write-wins; got {}",
        event.rate_limits.five_hour.used_percentage
    );
}

#[test]
fn multi_turn_sums_durations() {
    let raw = fixture("rollout-multi-turn.jsonl");
    let parsed = parse_rollout("pty-multi", &raw).expect("multi-turn");
    assert_eq!(parsed.event.cost.total_duration_ms, 60000);
}

#[test]
fn incomplete_trailing_line_dropped_silently() {
    let raw = fixture("rollout-incomplete-trail.jsonl");
    // Should NOT panic, NOT return Err, NOT log warn.
    let parsed = parse_rollout("pty-trail", &raw).expect("incomplete trail");
    // session_meta + turn_context absorbed; the truncated task_complete dropped.
    assert_eq!(parsed.event.cost.total_duration_ms, 0);
    assert_eq!(parsed.event.model_id, "gpt-5.4");
}

#[test]
fn malformed_mid_line_skipped_with_warn() {
    let raw = fixture("rollout-malformed-mid.jsonl");
    let parsed = parse_rollout("pty-malformed", &raw).expect("malformed mid");
    // The bad line is skipped; the valid surrounding lines are absorbed.
    assert_eq!(parsed.event.agent_session_id, "sess-malformed");
    assert_eq!(parsed.event.model_id, "gpt-5.4");
}

#[test]
fn task_started_fallback_for_context_window_size() {
    let raw = r#"{"timestamp":"...","type":"event_msg","payload":{"type":"task_started","model_context_window":128000}}
"#;
    let parsed = parse_rollout("pty-fallback", raw).expect("task_started fallback");
    // No token_count.info yet, but task_started supplies context_window_size.
    assert_eq!(parsed.event.context_window.context_window_size, 128000);
}

#[test]
fn empty_object_returns_defaults() {
    let parsed = parse_rollout("pty-empty", "").expect("empty");
    assert_eq!(parsed.event.model_id, "unknown");
    assert_eq!(parsed.event.context_window.context_window_size, 0);
    assert!(parsed.event.context_window.used_percentage.is_none());
    assert_eq!(parsed.event.cost.total_cost_usd, None);
}

#[test]
fn unknown_event_type_ignored_without_warn() {
    let raw = r#"{"timestamp":"...","type":"future_event_kind","payload":{"hello":"world"}}
"#;
    let parsed = parse_rollout("pty-unknown", raw).expect("forward-compat");
    assert_eq!(parsed.event.model_id, "unknown");
}
```

- [ ] **Step 7: Run the parser test suite.**

```bash
cd src-tauri && cargo test --lib parser::tests
```

Expected: all PASS, including the eight new ones.

- [ ] **Step 8: Commit.**

```bash
git add src-tauri/tests/fixtures/codex/ src-tauri/src/agent/adapter/codex/parser.rs
git commit -m "test(agent/codex): parser edge cases (null info, long-session, ...)

Six fixtures covering: minimal happy path (Task 9), info-null partial
update, long-session lifetime>>context, multi-turn duration sum,
incomplete trailing line, malformed mid-line, task_started
context-window fallback, unknown event-type forward-compat. Pins the
spec's locked partial-update and last_token_usage rules."
```

---

## Task 11: `CodexSessionLocator` trait + DB discovery

**Goal:** Schema-driven SQLite DB discovery in `~/.codex/*.sqlite` with tie-break by numeric suffix → newest mtime. Trait declared so subsequent tasks can implement it.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/locator.rs`

- [ ] **Step 1: Write the failing test.**

In `locator.rs`:

```rust
//! CodexSessionLocator — resolves a PTY's codex rollout JSONL.

use crate::agent::adapter::types::BindContext;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct RolloutLocation {
    pub rollout_path: PathBuf,
    pub thread_id: String,
    pub state_updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub enum LocatorError {
    NotYetReady,
    Unresolved(String),
    Fatal(String),
}

impl std::fmt::Display for LocatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotYetReady => f.write_str("locator: not yet ready"),
            Self::Unresolved(reason) => write!(f, "locator: unresolved — {}", reason),
            Self::Fatal(reason) => write!(f, "locator: fatal — {}", reason),
        }
    }
}

impl std::error::Error for LocatorError {}

pub trait CodexSessionLocator {
    fn resolve_rollout(
        &self,
        ctx: &BindContext<'_>,
    ) -> Result<RolloutLocation, LocatorError>;
}

/// Discover SQLite DBs by schema. Scans `codex_home` for `*.sqlite`
/// files, opens each read-only, and selects the candidate whose
/// schema contains `target_table`. Tie-break: highest numeric
/// suffix in the filename → newest mtime.
///
/// Returns `Ok(None)` when no candidate has the table (schema-drift
/// signal — caller routes to FS fallback). Returns `Err` on I/O
/// errors during the scan.
pub(super) fn discover_db(
    codex_home: &Path,
    target_table: &str,
) -> Result<Option<PathBuf>, std::io::Error> {
    let mut candidates: Vec<(PathBuf, u32, std::time::SystemTime)> = Vec::new();

    for entry in std::fs::read_dir(codex_home)? {
        let entry = entry?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };
        if !name.ends_with(".sqlite") {
            continue;
        }
        // Skip WAL/SHM sidecars.
        if name.ends_with(".sqlite-wal") || name.ends_with(".sqlite-shm") {
            continue;
        }

        // Open read-only; if the file isn't a SQLite DB or the table
        // isn't there, skip it.
        let url = format!("file:{}?mode=ro", path.display());
        let conn = match rusqlite::Connection::open_with_flags(
            &url,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        ) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let has_table: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
                [target_table],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !has_table {
            continue;
        }

        let suffix = extract_numeric_suffix(name);
        let mtime = entry.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        candidates.push((path, suffix, mtime));
    }

    if candidates.is_empty() {
        return Ok(None);
    }

    // Sort by (suffix DESC, mtime DESC). Highest suffix wins; mtime is
    // tie-break.
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)));
    Ok(Some(candidates.remove(0).0))
}

/// Extract trailing `_<n>` from a name like `logs_2.sqlite` → 2.
/// Returns 0 if no numeric suffix is present, so unsuffixed files
/// sort lowest.
fn extract_numeric_suffix(name: &str) -> u32 {
    let without_ext = name.strip_suffix(".sqlite").unwrap_or(name);
    let suffix = without_ext.rsplit_once('_').map(|(_, s)| s).unwrap_or("");
    suffix.parse::<u32>().unwrap_or(0)
}

#[cfg(test)]
mod discovery_tests {
    use super::*;
    use rusqlite::Connection;

    fn make_db(path: &Path, table: &str) {
        let conn = Connection::open(path).unwrap();
        conn.execute(
            &format!("CREATE TABLE {} (id INTEGER PRIMARY KEY)", table),
            [],
        )
        .unwrap();
    }

    #[test]
    fn picks_db_with_target_table() {
        let dir = tempfile::tempdir().unwrap();
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        make_db(&dir.path().join("state_1.sqlite"), "threads");

        let logs = discover_db(dir.path(), "logs").unwrap().unwrap();
        let state = discover_db(dir.path(), "threads").unwrap().unwrap();
        assert!(logs.ends_with("logs_1.sqlite"));
        assert!(state.ends_with("state_1.sqlite"));
    }

    #[test]
    fn returns_none_when_no_db_has_target_table() {
        let dir = tempfile::tempdir().unwrap();
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        let result = discover_db(dir.path(), "threads").unwrap();
        assert!(result.is_none(), "schema-drift signal");
    }

    #[test]
    fn highest_numeric_suffix_wins() {
        let dir = tempfile::tempdir().unwrap();
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        make_db(&dir.path().join("logs_3.sqlite"), "logs");
        make_db(&dir.path().join("logs_2.sqlite"), "logs");

        let picked = discover_db(dir.path(), "logs").unwrap().unwrap();
        assert!(
            picked.ends_with("logs_3.sqlite"),
            "highest suffix wins; got {}",
            picked.display()
        );
    }

    #[test]
    fn skips_wal_and_shm_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        // Touch sidecars; they should be ignored.
        std::fs::write(dir.path().join("logs_1.sqlite-wal"), b"").unwrap();
        std::fs::write(dir.path().join("logs_1.sqlite-shm"), b"").unwrap();

        let picked = discover_db(dir.path(), "logs").unwrap().unwrap();
        assert!(picked.ends_with("logs_1.sqlite"));
    }
}
```

- [ ] **Step 2: Run discovery tests.**

```bash
cd src-tauri && cargo test --lib discovery_tests
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/src/agent/adapter/codex/locator.rs
git commit -m "feat(agent/codex): CodexSessionLocator trait + schema-driven DB discovery

Discovery scans ~/.codex/*.sqlite, opens each read-only, picks the
file whose schema has the target table. Tie-break: highest numeric
suffix → newest mtime. Skips *-wal/*-shm sidecars. Returns Ok(None)
on schema drift (no matching candidate); Tasks 12+ implement the
queries that consume the discovered handles."
```

---

## Task 12: `SqliteFirstLocator` — logs + threads queries

**Goal:** Concrete locator that runs the primary SQLite path: logs → thread_id, state → rollout_path.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/locator.rs`

- [ ] **Step 1: Write the failing test.**

Append to `locator.rs`:

```rust
pub struct SqliteFirstLocator {
    pub codex_home: PathBuf,
}

impl SqliteFirstLocator {
    pub fn new(codex_home: PathBuf) -> Self {
        Self { codex_home }
    }
}

impl CodexSessionLocator for SqliteFirstLocator {
    fn resolve_rollout(
        &self,
        ctx: &BindContext<'_>,
    ) -> Result<RolloutLocation, LocatorError> {
        let logs_db = discover_db(&self.codex_home, "logs")
            .map_err(|e| LocatorError::Fatal(format!("scan {}: {}", self.codex_home.display(), e)))?;
        let state_db = discover_db(&self.codex_home, "threads")
            .map_err(|e| LocatorError::Fatal(format!("scan {}: {}", self.codex_home.display(), e)))?;

        // Schema drift on either port → caller should fall through to
        // FS fallback. SqliteFirstLocator alone surfaces the drift as
        // NotYetReady so the FS-fallback wrapper composing this locator
        // sees it as "primary path doesn't apply, try fallback".
        // Per spec "Fatal precedence": missing schema is never Fatal here.
        let (Some(logs_path), Some(state_path)) = (logs_db, state_db) else {
            return Err(LocatorError::Unresolved(
                "schema drift: logs or threads table not found".to_string(),
            ));
        };

        let (pty_secs, pty_nanos) = pty_start_to_secs_nanos(ctx.pty_start)?;

        let thread_id = self.query_logs_thread_id(&logs_path, ctx.pid, pty_secs, pty_nanos)?;
        let row = self.query_thread_row(&state_path, &thread_id)?;
        Ok(row)
    }
}

fn pty_start_to_secs_nanos(t: std::time::SystemTime) -> Result<(i64, i64), LocatorError> {
    let dur = t
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| LocatorError::Fatal(format!("pty_start before epoch: {}", e)))?;
    Ok((dur.as_secs() as i64, dur.subsec_nanos() as i64))
}

impl SqliteFirstLocator {
    fn query_logs_thread_id(
        &self,
        path: &Path,
        pid: u32,
        pty_secs: i64,
        pty_nanos: i64,
    ) -> Result<String, LocatorError> {
        let url = format!("file:{}?mode=ro", path.display());
        let conn = rusqlite::Connection::open_with_flags(
            &url,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| LocatorError::Fatal(format!("open logs db: {}", e)))?;

        let pid_pattern = format!("pid:{}:%", pid);
        let mut stmt = conn
            .prepare(
                "SELECT thread_id FROM logs
                 WHERE process_uuid LIKE :pid
                   AND thread_id IS NOT NULL
                   AND (ts > :pty_start_secs
                        OR (ts = :pty_start_secs AND ts_nanos >= :pty_start_nanos))
                 ORDER BY ts DESC, ts_nanos DESC
                 LIMIT 1",
            )
            .map_err(|e| LocatorError::Fatal(format!("prepare logs query: {}", e)))?;

        let mut rows = stmt
            .query(rusqlite::named_params! {
                ":pid": pid_pattern,
                ":pty_start_secs": pty_secs,
                ":pty_start_nanos": pty_nanos,
            })
            .map_err(|e| LocatorError::Fatal(format!("execute logs query: {}", e)))?;

        match rows.next() {
            Ok(Some(row)) => row
                .get::<_, String>(0)
                .map_err(|e| LocatorError::Fatal(format!("read thread_id: {}", e))),
            Ok(None) => Err(LocatorError::NotYetReady),
            Err(e) => Err(LocatorError::Fatal(format!("step logs query: {}", e))),
        }
    }

    fn query_thread_row(
        &self,
        path: &Path,
        thread_id: &str,
    ) -> Result<RolloutLocation, LocatorError> {
        let url = format!("file:{}?mode=ro", path.display());
        let conn = rusqlite::Connection::open_with_flags(
            &url,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| LocatorError::Fatal(format!("open state db: {}", e)))?;

        let mut stmt = conn
            .prepare(
                "SELECT rollout_path, updated_at_ms FROM threads WHERE id = :thread_id",
            )
            .map_err(|e| LocatorError::Fatal(format!("prepare threads query: {}", e)))?;

        let mut rows = stmt
            .query(rusqlite::named_params! { ":thread_id": thread_id })
            .map_err(|e| LocatorError::Fatal(format!("execute threads query: {}", e)))?;

        match rows.next() {
            Ok(Some(row)) => Ok(RolloutLocation {
                rollout_path: PathBuf::from(
                    row.get::<_, String>(0)
                        .map_err(|e| LocatorError::Fatal(format!("read rollout_path: {}", e)))?,
                ),
                thread_id: thread_id.to_string(),
                state_updated_at_ms: row.get::<_, i64>(1).unwrap_or(0),
            }),
            // Per spec: zero rows on threads is the same race-transient
            // signal as zero rows on logs; codex commits to logs first.
            Ok(None) => Err(LocatorError::NotYetReady),
            Err(e) => Err(LocatorError::Fatal(format!("step threads query: {}", e))),
        }
    }
}

#[cfg(test)]
mod sqlite_first_tests {
    use super::*;
    use rusqlite::Connection;
    use std::time::{Duration, SystemTime};

    fn build_logs_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                level TEXT NOT NULL,
                target TEXT NOT NULL,
                thread_id TEXT,
                process_uuid TEXT
            );",
        )
        .unwrap();
    }

    fn build_state_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                cwd TEXT,
                updated_at_ms INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
    }

    fn insert_log_row(
        path: &Path,
        process_uuid: &str,
        thread_id: Option<&str>,
        ts: i64,
        ts_nanos: i64,
    ) {
        let conn = Connection::open(path).unwrap();
        conn.execute(
            "INSERT INTO logs (ts, ts_nanos, level, target, thread_id, process_uuid)
             VALUES (?, ?, 'INFO', 'test', ?, ?)",
            rusqlite::params![ts, ts_nanos, thread_id, process_uuid],
        )
        .unwrap();
    }

    fn insert_thread(path: &Path, id: &str, rollout: &str, updated_at_ms: i64) {
        let conn = Connection::open(path).unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, cwd, updated_at_ms) VALUES (?, ?, '/tmp', ?)",
            rusqlite::params![id, rollout, updated_at_ms],
        )
        .unwrap();
    }

    fn ctx<'a>(cwd: &'a Path, pid: u32, pty_start: SystemTime) -> BindContext<'a> {
        BindContext {
            session_id: "sid-test",
            cwd,
            pid,
            pty_start,
        }
    }

    #[test]
    fn happy_path_logs_then_threads_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now() - Duration::from_secs(60);
        let pty_secs = pty_start.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;

        insert_log_row(&logs, "pid:12345:abc", Some("thread-A"), pty_secs + 5, 0);
        insert_thread(&state, "thread-A", "/tmp/rollout-A.jsonl", 1000);

        let loc = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = loc.resolve_rollout(&ctx(dir.path(), 12345, pty_start)).unwrap();
        assert_eq!(result.thread_id, "thread-A");
        assert_eq!(result.rollout_path, PathBuf::from("/tmp/rollout-A.jsonl"));
        assert_eq!(result.state_updated_at_ms, 1000);
    }

    #[test]
    fn pty_start_filters_out_old_thread() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now();
        let pty_secs = pty_start.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;

        // OLD thread: ts WAY before pty_start.
        insert_log_row(&logs, "pid:12345:old", Some("thread-OLD"), pty_secs - 3600, 0);
        insert_thread(&state, "thread-OLD", "/tmp/rollout-OLD.jsonl", 1);

        let loc = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = loc.resolve_rollout(&ctx(dir.path(), 12345, pty_start));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }

    #[test]
    fn missing_thread_row_is_not_yet_ready() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now();
        let pty_secs = pty_start.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        insert_log_row(&logs, "pid:12345:abc", Some("thread-orphan"), pty_secs + 1, 0);
        // No matching threads row.

        let loc = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = loc.resolve_rollout(&ctx(dir.path(), 12345, pty_start));
        assert!(matches!(result, Err(LocatorError::NotYetReady)),
            "logs commits before threads — gap is race-transient");
    }

    #[test]
    fn nanosecond_tuple_comparison_passes_within_same_second() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        // pty_start at exactly :30.500ms; codex commits at :30.600ms (same second, later nanos).
        let pty_secs = 1_777_900_000_i64;
        let pty_nanos = 500_000_000_i64;
        let pty_start = std::time::UNIX_EPOCH + Duration::new(pty_secs as u64, pty_nanos as u32);

        // Codex log: same ts, ts_nanos 600M > 500M.
        insert_log_row(&logs, "pid:777:abc", Some("thread-NANOS"), pty_secs, 600_000_000);
        insert_thread(&state, "thread-NANOS", "/tmp/rollout-NANOS.jsonl", 1);

        let loc = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = loc.resolve_rollout(&ctx(dir.path(), 777, pty_start)).unwrap();
        assert_eq!(result.thread_id, "thread-NANOS");
    }

    #[test]
    fn schema_drift_returns_unresolved_for_caller_dispatch() {
        let dir = tempfile::tempdir().unwrap();
        // Only a `state_1.sqlite` with a `threads` table. No `logs` table anywhere.
        let state = dir.path().join("state_1.sqlite");
        build_state_db(&state);

        let loc = SqliteFirstLocator::new(dir.path().to_path_buf());
        let pty_start = SystemTime::now();
        let result = loc.resolve_rollout(&ctx(dir.path(), 1, pty_start));
        // Caller (Task 13) catches Unresolved-from-schema-drift and dispatches to FS fallback.
        // Per Fatal-precedence spec: missing schema is NOT Fatal at the locator level.
        assert!(matches!(result, Err(LocatorError::Unresolved(_))));
    }
}
```

- [ ] **Step 2: Run the new tests.**

```bash
cd src-tauri && cargo test --lib sqlite_first_tests
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/src/agent/adapter/codex/locator.rs
git commit -m "feat(agent/codex): SqliteFirstLocator — logs + threads queries

Tuple comparison (ts > :secs OR (ts = :secs AND ts_nanos >= :nanos))
with named placeholders so anonymous-? slot collision can't happen.
Zero rows on either query → NotYetReady (race-transient — codex
commits to logs before threads, gap covered by start_for retry).
Schema drift → Unresolved (caller dispatches to FS fallback)."
```

---

## Task 13: `FsScanFallback` + composing locator

**Goal:** FS-scan fallback for the schema-drift case; a wrapper locator that composes SqliteFirstLocator with FsScanFallback.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/locator.rs`

- [ ] **Step 1: Write the FS fallback impl + tests.**

Append:

```rust
pub struct FsScanFallback {
    pub codex_home: PathBuf,
}

impl FsScanFallback {
    pub fn new(codex_home: PathBuf) -> Self {
        Self { codex_home }
    }

    fn scan_today_and_yesterday(&self, ctx: &BindContext<'_>) -> Vec<PathBuf> {
        use chrono::{Datelike, Local, Duration as ChronoDuration};
        let mut paths = Vec::new();
        for offset in 0..=1 {
            let date = Local::now().date_naive() - ChronoDuration::days(offset);
            let dir = self
                .codex_home
                .join("sessions")
                .join(format!("{:04}", date.year()))
                .join(format!("{:02}", date.month()))
                .join(format!("{:02}", date.day()));
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                        paths.push(p);
                    }
                }
            }
        }
        // Filter by mtime ≥ pty_start.
        paths.retain(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .map(|mtime| mtime >= ctx.pty_start)
                .unwrap_or(false)
        });
        paths
    }
}

impl CodexSessionLocator for FsScanFallback {
    fn resolve_rollout(
        &self,
        ctx: &BindContext<'_>,
    ) -> Result<RolloutLocation, LocatorError> {
        let candidates = self.scan_today_and_yesterday(ctx);

        // Filter by session_meta.cwd matching ctx.cwd (advisory).
        let mut matches: Vec<(PathBuf, String)> = Vec::new();
        for p in candidates {
            let Ok(file) = std::fs::File::open(&p) else { continue };
            let mut reader = std::io::BufReader::new(file);
            let mut first_line = String::new();
            use std::io::BufRead;
            if reader.read_line(&mut first_line).is_err() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(first_line.trim()) else {
                continue;
            };
            let cwd_match = value
                .pointer("/payload/cwd")
                .and_then(|v| v.as_str())
                .map(|s| s == ctx.cwd.to_string_lossy())
                .unwrap_or(false);
            if cwd_match {
                let id = value
                    .pointer("/payload/id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                matches.push((p, id));
            }
        }

        match matches.len() {
            0 => Err(LocatorError::NotYetReady),
            1 => {
                let (path, id) = matches.remove(0);
                Ok(RolloutLocation {
                    rollout_path: path,
                    thread_id: id,
                    state_updated_at_ms: 0,
                })
            }
            _ => Err(LocatorError::Unresolved(
                "multiple rollout candidates after FS scan".to_string(),
            )),
        }
    }
}

/// Composing locator: SQLite primary, FS fallback on schema drift.
/// This is the production locator wired into CodexAdapter (Task 14).
pub struct CompositeLocator {
    primary: SqliteFirstLocator,
    fallback: FsScanFallback,
}

impl CompositeLocator {
    pub fn new(codex_home: PathBuf) -> Self {
        Self {
            primary: SqliteFirstLocator::new(codex_home.clone()),
            fallback: FsScanFallback::new(codex_home),
        }
    }
}

impl CodexSessionLocator for CompositeLocator {
    fn resolve_rollout(
        &self,
        ctx: &BindContext<'_>,
    ) -> Result<RolloutLocation, LocatorError> {
        match self.primary.resolve_rollout(ctx) {
            Ok(loc) => Ok(loc),
            // Schema drift dispatches to FS fallback. Other errors propagate.
            Err(LocatorError::Unresolved(reason)) if reason.contains("schema drift") => {
                self.fallback.resolve_rollout(ctx)
            }
            Err(other) => Err(other),
        }
    }
}

#[cfg(test)]
mod fs_fallback_tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn write_rollout(dir: &Path, name: &str, cwd: &str, id: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join(name);
        let line = format!(
            r#"{{"timestamp":"...","type":"session_meta","payload":{{"id":"{}","cwd":"{}","cli_version":"0.128.0"}}}}"#,
            id, cwd
        );
        std::fs::write(&p, format!("{}\n", line)).unwrap();
        p
    }

    fn ctx<'a>(cwd: &'a Path, pty_start: SystemTime) -> BindContext<'a> {
        BindContext {
            session_id: "sid",
            cwd,
            pid: 0,
            pty_start,
        }
    }

    #[test]
    fn fs_zero_matches_returns_not_yet_ready() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = std::path::Path::new("/tmp/no-rollouts-here");
        let fallback = FsScanFallback::new(dir.path().to_path_buf());
        let result = fallback.resolve_rollout(&ctx(cwd, SystemTime::now()));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }

    #[test]
    fn fs_multi_match_returns_unresolved() {
        let dir = tempfile::tempdir().unwrap();
        use chrono::{Datelike, Local};
        let date = Local::now().date_naive();
        let day_dir = dir
            .path()
            .join("sessions")
            .join(format!("{:04}", date.year()))
            .join(format!("{:02}", date.month()))
            .join(format!("{:02}", date.day()));

        let cwd_str = day_dir.parent().unwrap().to_str().unwrap().to_string();
        let cwd_path = std::path::Path::new(&cwd_str);

        let pty_start = SystemTime::now() - Duration::from_secs(10);
        write_rollout(&day_dir, "rollout-A.jsonl", cwd_str.as_str(), "id-A");
        write_rollout(&day_dir, "rollout-B.jsonl", cwd_str.as_str(), "id-B");

        let fallback = FsScanFallback::new(dir.path().to_path_buf());
        let result = fallback.resolve_rollout(&ctx(cwd_path, pty_start));
        assert!(
            matches!(result, Err(LocatorError::Unresolved(_))),
            "two cwd-matching rollouts must be Unresolved, not arbitrarily picked"
        );
    }

    #[test]
    fn composite_dispatches_schema_drift_to_fs() {
        let dir = tempfile::tempdir().unwrap();
        // No SQLite DBs at all → schema drift on both ports → FS fallback.
        // FS finds zero matches → NotYetReady.
        let composite = CompositeLocator::new(dir.path().to_path_buf());
        let result = composite.resolve_rollout(&ctx(
            std::path::Path::new("/tmp"),
            SystemTime::now(),
        ));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }
}
```

- [ ] **Step 2: Run the FS fallback tests.**

```bash
cd src-tauri && cargo test --lib fs_fallback_tests
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/src/agent/adapter/codex/locator.rs
git commit -m "feat(agent/codex): FsScanFallback + CompositeLocator

FS scan reads today + yesterday's session dirs, filters by mtime
>= pty_start, peeks first line for session_meta.cwd match. Zero
matches → NotYetReady (transient); multiple matches → Unresolved.
CompositeLocator dispatches schema-drift Unresolved from
SqliteFirstLocator to FsScanFallback per spec's Fatal-precedence
tree."
```

---

## Task 14: `CodexAdapter` trait impl

**Goal:** Replace the `CodexAdapter` placeholder with the real implementation that wires `CompositeLocator` + `parse_rollout` into the `AgentAdapter` trait.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/mod.rs`
- Modify: `src-tauri/src/agent/adapter/codex/transcript.rs`

- [ ] **Step 1: Write the adapter impl + tests.**

Replace `codex/mod.rs` body with the full impl:

```rust
//! Codex adapter — see docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md.

mod locator;
mod parser;
mod transcript;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;

use locator::{CodexSessionLocator, CompositeLocator, LocatorError};

/// CodexAdapter — implements AgentAdapter<R> for codex CLI sessions.
///
/// Discovery state is memoized via `OnceLock` for the lifetime of
/// this `Arc<CodexAdapter>` instance (one attach). Across attaches
/// `<dyn AgentAdapter<R>>::for_type(Codex)` constructs a fresh
/// instance, so discovery re-runs.
pub struct CodexAdapter {
    locator_cache: OnceLock<CompositeLocator>,
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self {
            locator_cache: OnceLock::new(),
        }
    }

    fn locator(&self) -> &CompositeLocator {
        self.locator_cache.get_or_init(|| {
            let codex_home = dirs::home_dir()
                .map(|h| h.join(".codex"))
                .unwrap_or_else(|| PathBuf::from(".codex"));
            log::info!(
                "codex adapter: locator cache initialized (codex_home={})",
                codex_home.display()
            );
            CompositeLocator::new(codex_home)
        })
    }

    fn codex_home() -> PathBuf {
        dirs::home_dir()
            .map(|h| h.join(".codex"))
            .unwrap_or_else(|| PathBuf::from(".codex"))
    }
}

impl<R: tauri::Runtime> AgentAdapter<R> for CodexAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
        match self.locator().resolve_rollout(ctx) {
            Ok(loc) => Ok(StatusSource {
                path: loc.rollout_path,
                trust_root: Self::codex_home(),
            }),
            Err(LocatorError::NotYetReady) => Err(BindError::Pending(
                "codex session row not yet committed".to_string(),
            )),
            Err(LocatorError::Unresolved(reason)) | Err(LocatorError::Fatal(reason)) => {
                Err(BindError::Fatal(reason))
            }
        }
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        parser::parse_rollout(session_id, raw)
    }

    fn validate_transcript(&self, _raw_path: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript()
    }

    fn tail_transcript(
        &self,
        _app: AppHandle<R>,
        _session_id: String,
        _cwd: Option<PathBuf>,
        _transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        transcript::tail_transcript()
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;
    use std::time::SystemTime;
    use tauri::test::MockRuntime;

    #[test]
    fn parse_status_delegates_to_parser_with_transcript_path_none() {
        let a = CodexAdapter::new();
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;
        let parsed =
            <CodexAdapter as AgentAdapter<MockRuntime>>::parse_status(&a, "pty-1", raw).unwrap();
        assert_eq!(parsed.event.agent_session_id, "sess");
        assert!(parsed.transcript_path.is_none());
    }

    #[test]
    fn validate_transcript_returns_v1_stub_err() {
        let a = CodexAdapter::new();
        let err = <CodexAdapter as AgentAdapter<MockRuntime>>::validate_transcript(&a, "/tmp/t")
            .expect_err("v1 stub");
        match err {
            ValidateTranscriptError::Other(msg) => {
                assert!(msg.contains("not yet implemented"), "stub message; got {}", msg);
            }
            _ => panic!("expected Other variant"),
        }
    }
}
```

Replace `codex/transcript.rs`:

```rust
//! Codex transcript tailer — v1 stub.
//!
//! Returns explicit "not yet implemented" errors. Real tailer is a
//! follow-up spec.

use std::path::PathBuf;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::ValidateTranscriptError;

pub(super) fn validate_transcript() -> Result<PathBuf, ValidateTranscriptError> {
    Err(ValidateTranscriptError::Other(
        "codex transcript tailer not yet implemented".to_string(),
    ))
}

pub(super) fn tail_transcript() -> Result<TranscriptHandle, String> {
    Err("codex transcript tailer not yet implemented".to_string())
}
```

- [ ] **Step 2: Run the new adapter tests.**

```bash
cd src-tauri && cargo test --lib adapter_tests
```

Expected: PASS.

- [ ] **Step 3: Verify the full module compiles + the existing tests pass.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src-tauri/src/agent/adapter/codex/mod.rs src-tauri/src/agent/adapter/codex/transcript.rs
git commit -m "feat(agent/codex): CodexAdapter implementation

status_source uses CompositeLocator (SQLite primary, FS fallback);
parse_status delegates to parser::parse_rollout; transcript stubs
return v1 not-implemented errors. LocatorError → BindError mapping
per spec: NotYetReady → Pending (retried); Unresolved/Fatal → Fatal."
```

---

## Task 15: Wire `CodexAdapter` into `for_type`

**Goal:** Stop falling through to `NoOpAdapter` for `AgentType::Codex`.

**Files:**

- Modify: `src-tauri/src/agent/adapter/mod.rs`

- [ ] **Step 1: Update `for_type`.**

Find the existing `for_type` impl (currently around line 44-50):

```rust
pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
    match agent_type {
        AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
        AgentType::Codex => Ok(Arc::new(codex::CodexAdapter::new())),
        other => Ok(Arc::new(NoOpAdapter::new(other))),
    }
}
```

Add `use codex::CodexAdapter;` (or `use crate::agent::adapter::codex::CodexAdapter;`) at the top of the module if not already present.

- [ ] **Step 2: Update the `noop_tests` to confirm Codex no longer falls through.**

Add:

```rust
#[test]
fn for_type_codex_is_no_longer_noop() {
    use tauri::test::MockRuntime;
    let arc = <dyn AgentAdapter<MockRuntime>>::for_type(AgentType::Codex)
        .expect("codex adapter constructs");
    assert!(matches!(arc.agent_type(), AgentType::Codex));
    // NoOpAdapter::parse_status returns "X adapter has no status parser"
    // (line ~95 of adapter/mod.rs); the real CodexAdapter returns either
    // a parsed event or a JSON error, never that string.
    let err = arc.parse_status("sid", "not json").unwrap_err();
    assert!(
        !err.contains("has no status parser"),
        "expected real CodexAdapter, got NoOpAdapter behavior"
    );
}
```

- [ ] **Step 3: Run all tests.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src-tauri/src/agent/adapter/mod.rs
git commit -m "feat(agent/adapter): wire CodexAdapter into for_type

AgentType::Codex now resolves to CodexAdapter, not NoOpAdapter.
A PTY running codex on this machine should now populate the
status panel through the real parser + locator pipeline."
```

---

## Task 16: Frontend — useAgentStatus regression tests for null cost

**Goal:** Tighten the existing hook tests so the null-cost path is pinned at the hook layer too (Task 4 covered the BudgetMetrics rendering and the in-state preservation; this task adds the dedicated hook test the spec asks for).

**Files:**

- Modify: `src/features/agent-status/hooks/useAgentStatus.test.tsx`

- [ ] **Step 1: Write the failing test.**

Add to the existing test file. The exact import / setup should follow the existing tests in the same file. Sketch:

```typescript
test('preserves null totalCostUsd through state without coercing to 0', async () => {
  // ... set up the existing useAgentStatus harness used by other tests
  // in this file. The following payload shape mirrors what the Tauri
  // event bus actually delivers for a codex session.
  const codexEventPayload = {
    sessionId: 'pty-codex-1',
    agentSessionId: 'codex-uuid',
    modelId: 'gpt-5.4',
    modelDisplayName: 'gpt-5.4',
    version: '0.128.0',
    contextWindow: {
      usedPercentage: 21.23,
      remainingPercentage: 78.77,
      contextWindowSize: 258400,
      totalInputTokens: 52685,
      totalOutputTokens: 2177,
      currentUsage: {
        inputTokens: 52685,
        outputTokens: 2177,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 51584,
      },
    },
    cost: {
      totalCostUsd: null, // ← codex emits null
      totalDurationMs: 208025,
      totalApiDurationMs: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
    rateLimits: {
      fiveHour: { usedPercentage: 8.0, resetsAt: 1777848985 },
      sevenDay: null,
    },
  }

  // Use whatever delivery path the existing tests use (mocked Tauri event,
  // direct hook update, etc.). Then assert:
  expect(hookResult.cost?.totalCostUsd).toBeNull()
  // Importantly NOT 0:
  expect(hookResult.cost?.totalCostUsd).not.toBe(0)
})

test('preserves number totalCostUsd from Claude payload', async () => {
  // Same harness; payload with totalCostUsd: 0.42.
  // Assert hookResult.cost?.totalCostUsd === 0.42.
})
```

- [ ] **Step 2: Run the failing test.**

```bash
npx vitest run src/features/agent-status/hooks/useAgentStatus.test.tsx
```

Expected: the null-preservation test passes already if Task 4 was implemented correctly. If it doesn't, fix the hook (the change should be `p.cost.totalCostUsd ?? null`, not `Number(p.cost.totalCostUsd)`).

- [ ] **Step 3: Commit.**

```bash
git add src/features/agent-status/hooks/useAgentStatus.test.tsx
git commit -m "test(agent-status): pin null totalCostUsd preservation in hook"
```

---

## Task 17: Manual end-to-end sign-off

**Goal:** Confirm the dev runtime delivers the spec's user-visible promises.

**Files:** None (interactive verification only).

- [ ] **Step 1: Run the desktop app in dev mode.**

```bash
npm run tauri:dev
```

(Per `package.json` — note the colon. The script wraps `tauri dev` with the WebKitGTK renderer flag for Linux/Wayland; see `README.md` "Linux / Wayland".)

Wait for the window to open. Confirm no Rust panics in the dev console.

- [ ] **Step 2: Test fresh codex session.**

In the app's terminal pane, type `codex` and start a session. Send one prompt; wait for the turn to complete.

Expected:

- The status panel populates after the first `task_complete` event.
- Model name shows `gpt-5.4` (or your codex default).
- Context window gauge shows a sensible percentage (e.g. ~5-30%).
- Rate-limit bars show the 5h percentage; 7d if `secondary` is present.
- Cost row visibly shows `—` (not `$0.00`).
- Tokens cell shows the input + output sum.

- [ ] **Step 3: Test resume.**

In the app, exit the codex session (`/exit`). Spawn a fresh terminal pane. Type `codex resume --last`.

Expected:

- The status panel populates within ~1 second from the rollout history (not after a turn — immediate replay from `inline-init`).
- Accumulated `totalDurationMs` reflects all prior turns from the resumed session.

- [ ] **Step 4: Test Claude regression.**

In another terminal pane, type `claude`.

Expected:

- The Claude session populates as before. Cost row shows `$x.yz` (a number with dollar sign).
- No regression in the existing rate-limit, model, or context-window display.

- [ ] **Step 5: Test cold-start race tolerance.**

This is harder to test deterministically; the simplest check: run `codex` 5 times in a row in different terminal panes. The status panel should populate for each within ~1 second. If any fail to populate, check `Vimeflow.log` for `bind retry budget exhausted` warnings — those indicate the 500ms budget is too tight for this machine and should be discussed before merge (the spec ties the budget to `DETECTION_POLL_MS / 4`).

- [ ] **Step 6: Run the full suites one more time.**

```bash
cd src-tauri && cargo test --workspace --all-features
npm run test
npm run lint
npm run type-check
```

Expected: all green.

- [ ] **Step 7: Final commit (if any cleanup is needed).**

If the manual testing surfaced any small fix-ups (typos, log-line cleanup, etc.), commit them as a final `chore(agent/codex)` commit. Otherwise, the branch is ready to PR.

---

## Out-of-Scope items tracked for follow-up

Captured here for handoff to the next planning cycle:

1. **Codex transcript tailer.** v1 stubs `tail_transcript`. A follow-up spec covers JSONL tailing for `AgentTurnEvent` (turn count) and `AgentToolCallEvent` (activity feed). The rollout JSONL has all the data — `event_msg.task_started`/`task_complete` for turns, `response_item.function_call`/`function_call_output` for tool calls.
2. **`total_api_duration_ms` IPC bump.** v1 emits `0` for codex. If testers find `0ms` distracting in the API Time cell, bump to `Option<u64>` and render `—` for null.
3. **Codex-only fields surfaced in UI.** `plan_type` ("prolite"), `reasoning_output_tokens`, `time_to_first_token_ms`. Each is a small UI addition; defer until a UX brief decides whether to surface them.
4. **Step 2 — cross-adapter parser refactor.** Per the 2026-05-03 ADR. Trigger when both adapters have been in production ≥1 week and concrete duplication exists at multiple call sites. Records its own ADR.
5. **Process-global locator cache.** v1 memoizes per-attach. If profiling shows the per-attach scan is material (unlikely — a few ms), promote to a Tauri-managed shared cache.

## References

- `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` — the spec.
- `docs/decisions/2026-05-03-claude-parser-json-boundary.md` — the ADR that defers cross-adapter helpers.
- `docs/superpowers/plans/2026-05-03-claude-adapter-refactor-stage-1.md` — the predecessor plan, format reference.
- `src-tauri/src/agent/adapter/mod.rs` — `AgentAdapter` trait, `start_agent_watcher`.
- `src-tauri/src/agent/adapter/base/watcher_runtime.rs:361-409` — inline-read flow that picks up the first parse_status call.
- `src-tauri/src/terminal/state.rs:66` — `ManagedSession` (Task 2 adds `started_at`).
- `src/features/agent-status/types/index.ts:5-26` — existing override pattern for `AgentStatusEvent` (Task 4 extends to `CostMetrics`).
- `src/features/agent-status/hooks/useAgentStatus.ts:19, 335` — `DETECTION_POLL_MS=2000`, `usedPercentage ?? 0` collapse.
- `src/features/agent-status/components/BudgetMetrics.tsx:85` — "API Time" cell rendered as a distinct metric.
