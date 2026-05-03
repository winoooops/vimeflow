# AgentAdapter Refactor Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Claude-Code-only agent backend behind an `AgentAdapter<R>` trait abstraction without changing any user-visible behavior, so Stage 2 (Codex adapter) becomes a pure addition.

**Architecture:** A `trait AgentAdapter<R: tauri::Runtime>` carries five provider hooks (`agent_type`, `status_source`, `parse_status`, `validate_transcript`, `tail_transcript`). The user-facing `for_type` / `start` / `stop` live on an `impl<R> dyn AgentAdapter<R>` inherent block. The watcher orchestration body lives in private `pub(crate) fn base::start_for<R>` and routes transcript spawns through `TranscriptState::start_or_replace(adapter, …)` so the registry owns lifecycle. `ClaudeCodeAdapter` implements the trait via the relocated `claude_code/` modules; `NoOpAdapter` covers Codex / Aider / Generic so today's silent-no-op UX survives unchanged.

**Tech Stack:** Rust 2024 edition (Tauri 2.x backend), `notify` crate for filesystem watching, `serde_json::Value` for parser internals (wrapped behind `adapter::json` primitives), `tauri::test::mock_builder()` + `MockRuntime` for integration tests. TypeScript / React only for the single-line `useAgentStatus.ts` deletion in Task 13.

**Spec:** `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md` — read before starting.

---

## Pre-Flight

Before starting:

- Read `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md` end to end. The plan below assumes the spec's invariants, IDEA blocks, and rationales as binding context.
- Read `rules/CLAUDE.md`, `rules/rust/coding-style.md`, `rules/rust/patterns.md`, `rules/common/design-philosophy.md`. The plan does not duplicate their guidance; it expects the engineer to default to those standards.
- Confirm working directory is the project root (`/home/will/projects/vimeflow`). All paths below are relative to that root.
- Confirm the test suite is green on `main` before starting: `cd src-tauri && cargo test --workspace --all-features` and `npm run test`. If anything is red, stop and fix that first — every task uses test stability as a gate.

## Target File Structure

```
BEFORE                                AFTER
──────                                ─────
src-tauri/src/agent/                  src-tauri/src/agent/
├── commands.rs                       ├── commands.rs        (unchanged)
├── detector.rs                       ├── detector.rs        (unchanged)
├── mod.rs                            ├── mod.rs             (re-exports updated)
├── statusline.rs                     ├── types.rs           (unchanged)
├── transcript.rs                     ├── adapter/
├── test_runners/                     │   ├── mod.rs         (NEW: trait, factory, NoOpAdapter)
├── types.rs                          │   ├── base.rs        (NEW: orchestration + lifted TranscriptState)
└── watcher.rs                        │   ├── types.rs       (NEW: provider-hook types)
                                      │   ├── json.rs        (NEW: shared parse primitives)
                                      │   └── claude_code/
                                      │       ├── mod.rs     (NEW: ClaudeCodeAdapter impl)
                                      │       ├── statusline.rs    (was agent/statusline.rs)
                                      │       ├── transcript.rs    (was agent/transcript.rs, lifecycle types lifted to base)
                                      │       └── test_runners/    (was agent/test_runners/)
                                      └── types.rs
```

`agent/watcher.rs` is deleted in Task 12. The five tests under `src-tauri/tests/transcript_*.rs` migrate their imports + add an adapter argument across Tasks 7 + 9. The frontend's `useAgentStatus.ts:53-58` loses one `invoke('stop_transcript_watcher')` block in Task 13.

---

## Task 1: Add Module Skeletons

**Goal:** Empty new modules, build still passes, nothing yet uses them.

**Files:**

- Create: `src-tauri/src/agent/adapter/mod.rs`
- Create: `src-tauri/src/agent/adapter/base.rs`
- Create: `src-tauri/src/agent/adapter/types.rs`
- Create: `src-tauri/src/agent/adapter/json.rs`
- Create: `src-tauri/src/agent/adapter/claude_code/mod.rs`
- Modify: `src-tauri/src/agent/mod.rs` (add `pub mod adapter;`)

- [ ] **Step 1: Create the adapter directory tree with stubs.**

```bash
mkdir -p src-tauri/src/agent/adapter/claude_code
```

Then write each file with a single-line top doc-comment and nothing else:

```rust
// src-tauri/src/agent/adapter/mod.rs
//! Agent adapter abstraction — see docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md.

pub mod base;
pub mod claude_code;
pub mod json;
pub mod types;
```

```rust
// src-tauri/src/agent/adapter/base.rs
//! Watcher orchestration body shared across all agent adapters.
```

```rust
// src-tauri/src/agent/adapter/types.rs
//! Provider-hook types — `StatusSource`, `ParsedStatus`.
```

```rust
// src-tauri/src/agent/adapter/json.rs
//! Shared JSON-extraction primitives consumed by every adapter's parsers.
```

```rust
// src-tauri/src/agent/adapter/claude_code/mod.rs
//! Claude Code adapter — implements `AgentAdapter<R>`.
```

- [ ] **Step 2: Wire the new tree into `agent/mod.rs`.**

Edit `src-tauri/src/agent/mod.rs`. Add `pub mod adapter;` adjacent to the existing `pub mod` declarations (alphabetical placement).

- [ ] **Step 3: Verify build.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors. Warnings about unused modules are fine — the contents land in subsequent tasks.

- [ ] **Step 4: Commit.**

```bash
git add src-tauri/src/agent/adapter/ src-tauri/src/agent/mod.rs
git commit -m "refactor(agent): scaffold adapter module tree

Empty stubs for adapter/{mod,base,types,json}.rs and
adapter/claude_code/mod.rs. No callers yet; Task 2-13 fill the bodies."
```

---

## Task 2: Implement `adapter/json.rs` Shared Parse Primitives (TDD)

**Goal:** A small set of generic JSON-extraction primitives that every adapter's parser will consume, replacing today's repeated `obj.get(...).and_then(|v| v.as_u64()).unwrap_or(0)` chains.

**Files:**

- Modify: `src-tauri/src/agent/adapter/json.rs`

- [ ] **Step 1: Write the failing tests first.**

Replace `adapter/json.rs` contents with the test module below (the impls land in step 3):

```rust
//! Shared JSON-extraction primitives consumed by every adapter's parsers.
//!
//! Generic enough to apply across Claude's `status.json` schema and
//! Codex's rollout-JSONL schema (Stage 2). See spec section "Shared
//! parse primitives" for the rationale.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

pub fn navigate<'a>(_v: &'a Value, _path: &[&str]) -> Option<&'a Value> {
    unimplemented!()
}

pub fn extract<T: DeserializeOwned>(_v: &Value, _path: &[&str]) -> Option<T> {
    unimplemented!()
}

pub fn u64_at(_v: &Value, _path: &[&str]) -> Option<u64> {
    unimplemented!()
}

pub fn f64_at(_v: &Value, _path: &[&str]) -> Option<f64> {
    unimplemented!()
}

pub fn str_at<'a>(_v: &'a Value, _path: &[&str]) -> Option<&'a str> {
    unimplemented!()
}

pub fn obj_at<'a>(_v: &'a Value, _path: &[&str]) -> Option<&'a Map<String, Value>> {
    unimplemented!()
}

pub fn u64_or(_v: &Value, _path: &[&str], _default: u64) -> u64 {
    unimplemented!()
}

pub fn f64_or(_v: &Value, _path: &[&str], _default: f64) -> f64 {
    unimplemented!()
}

pub fn str_or<'a>(_v: &'a Value, _path: &[&str], _default: &'a str) -> &'a str {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "model": { "id": "claude-opus-4", "display_name": "Opus 4" },
            "context_window": {
                "used_percentage": 42.5,
                "total_input_tokens": 12345,
                "current_usage": { "input_tokens": 100 }
            },
            "transcript_path": "/tmp/x.jsonl",
            "weird": null
        })
    }

    // navigate

    #[test]
    fn navigate_single_key_present_returns_value() {
        let v = fixture();
        assert_eq!(navigate(&v, &["model"]).and_then(Value::as_object).is_some(), true);
    }

    #[test]
    fn navigate_nested_key_present_returns_leaf() {
        let v = fixture();
        let leaf = navigate(&v, &["context_window", "current_usage", "input_tokens"]);
        assert_eq!(leaf.and_then(Value::as_u64), Some(100));
    }

    #[test]
    fn navigate_missing_intermediate_returns_none() {
        let v = fixture();
        assert!(navigate(&v, &["context_window", "absent", "input_tokens"]).is_none());
    }

    #[test]
    fn navigate_missing_leaf_returns_none() {
        let v = fixture();
        assert!(navigate(&v, &["model", "absent"]).is_none());
    }

    #[test]
    fn navigate_empty_path_returns_root() {
        let v = fixture();
        assert!(std::ptr::eq(navigate(&v, &[]).unwrap(), &v));
    }

    // typed scalar accessors

    #[test]
    fn u64_at_present_returns_some() {
        let v = fixture();
        assert_eq!(u64_at(&v, &["context_window", "total_input_tokens"]), Some(12345));
    }

    #[test]
    fn u64_at_wrong_type_returns_none() {
        let v = fixture();
        // used_percentage is f64, not u64 — `as_u64` returns None
        assert_eq!(u64_at(&v, &["context_window", "used_percentage"]), None);
    }

    #[test]
    fn u64_at_missing_returns_none() {
        let v = fixture();
        assert_eq!(u64_at(&v, &["nope"]), None);
    }

    #[test]
    fn f64_at_present_returns_some() {
        let v = fixture();
        assert_eq!(f64_at(&v, &["context_window", "used_percentage"]), Some(42.5));
    }

    #[test]
    fn str_at_present_returns_some() {
        let v = fixture();
        assert_eq!(str_at(&v, &["model", "id"]), Some("claude-opus-4"));
    }

    #[test]
    fn str_at_null_returns_none() {
        let v = fixture();
        assert_eq!(str_at(&v, &["weird"]), None);
    }

    #[test]
    fn obj_at_present_returns_some() {
        let v = fixture();
        assert!(obj_at(&v, &["model"]).is_some());
    }

    // *_or defaults

    #[test]
    fn u64_or_present_returns_value() {
        let v = fixture();
        assert_eq!(u64_or(&v, &["context_window", "total_input_tokens"], 0), 12345);
    }

    #[test]
    fn u64_or_missing_returns_default() {
        let v = fixture();
        assert_eq!(u64_or(&v, &["nope"], 999), 999);
    }

    #[test]
    fn str_or_present_returns_value() {
        let v = fixture();
        assert_eq!(str_or(&v, &["model", "id"], "fallback"), "claude-opus-4");
    }

    #[test]
    fn str_or_missing_returns_default() {
        let v = fixture();
        assert_eq!(str_or(&v, &["nope"], "fallback"), "fallback");
    }

    // generic extract<T>

    #[test]
    fn extract_typed_struct_round_trip() {
        #[derive(serde::Deserialize, Debug, PartialEq)]
        struct Model { id: String, display_name: String }

        let v = fixture();
        let m: Option<Model> = extract(&v, &["model"]);
        assert_eq!(m, Some(Model {
            id: "claude-opus-4".into(),
            display_name: "Opus 4".into(),
        }));
    }

    #[test]
    fn extract_missing_returns_none() {
        let v = fixture();
        let m: Option<String> = extract(&v, &["absent"]);
        assert_eq!(m, None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they all fail with `unimplemented!`.**

```bash
cd src-tauri && cargo test --lib agent::adapter::json::tests
```

Expected: every test fails with `not implemented` panic or compile-fine-but-runtime-panic.

- [ ] **Step 3: Implement the bodies.**

Replace the `unimplemented!()` stubs with real implementations:

```rust
pub fn navigate<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(v, |acc, key| acc.get(*key))
}

pub fn extract<T: DeserializeOwned>(v: &Value, path: &[&str]) -> Option<T> {
    let leaf = navigate(v, path)?;
    serde_json::from_value(leaf.clone()).ok()
}

pub fn u64_at(v: &Value, path: &[&str]) -> Option<u64> {
    navigate(v, path).and_then(Value::as_u64)
}

pub fn f64_at(v: &Value, path: &[&str]) -> Option<f64> {
    navigate(v, path).and_then(Value::as_f64)
}

pub fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    navigate(v, path).and_then(Value::as_str)
}

pub fn obj_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Map<String, Value>> {
    navigate(v, path).and_then(Value::as_object)
}

pub fn u64_or(v: &Value, path: &[&str], default: u64) -> u64 {
    u64_at(v, path).unwrap_or(default)
}

pub fn f64_or(v: &Value, path: &[&str], default: f64) -> f64 {
    f64_at(v, path).unwrap_or(default)
}

pub fn str_or<'a>(v: &'a Value, path: &[&str], default: &'a str) -> &'a str {
    str_at(v, path).unwrap_or(default)
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
cd src-tauri && cargo test --lib agent::adapter::json::tests
```

Expected: all 16 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/agent/adapter/json.rs
git commit -m "feat(agent/adapter): add shared JSON-extraction primitives

navigate / extract<T> / typed accessors (u64_at, f64_at, str_at,
obj_at) and *_or default variants. Tested against missing paths,
wrong-type leaves, null leaves, and a typed struct round-trip.
Used by every adapter's parser internals (Tasks 6, 7, 8, future Stage 2)."
```

---

## Task 3: Move Provider-Hook Types into `adapter/types.rs`

**Goal:** Define `StatusSource` and `ParsedStatus` so the trait skeleton in Task 4 has its return types ready.

**Files:**

- Modify: `src-tauri/src/agent/adapter/types.rs`

- [ ] **Step 1: Write the file body.**

Replace `adapter/types.rs` contents:

```rust
//! Provider-hook types used by `AgentAdapter` implementations.
//!
//! See the spec section "Provider-hook types" for the design rationale.

use std::path::PathBuf;

use crate::agent::types::AgentStatusEvent;

/// Where an agent writes its status snapshot, plus a trust root the
/// resolved path must live under (defense-in-depth against path
/// traversal from a misconfigured cwd or a malicious adapter).
///
/// `trust_root` is enforced by `base::start_for` before `create_dir_all`
/// or `notify::watch` — see the Stage 1 spec, step 10 procedure.
#[derive(Debug, Clone)]
pub struct StatusSource {
    pub path: PathBuf,
    pub trust_root: PathBuf,
}

/// Result of `AgentAdapter::parse_status` — the typed status event plus
/// the transcript path the next layer should validate and tail.
#[derive(Debug, Clone)]
pub struct ParsedStatus {
    pub event: AgentStatusEvent,
    /// Transcript path the watcher should pass to
    /// `TranscriptState::start_or_replace`. `None` when no transcript
    /// is available yet (e.g. Claude hasn't written one this session).
    pub transcript_path: Option<String>,
}
```

- [ ] **Step 2: Verify build.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors. The types compile but have no callers yet.

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/src/agent/adapter/types.rs
git commit -m "feat(agent/adapter): add provider-hook types

StatusSource and ParsedStatus — return types for AgentAdapter's
status_source and parse_status hooks (Task 4 defines the trait)."
```

---

## Task 4: Define `AgentAdapter<R>` Trait Skeleton

**Goal:** The trait declaration with all five provider hooks. No `impl<R> dyn AgentAdapter<R>` inherent block yet (that lands in Task 11 after `base::start_for` exists).

**Files:**

- Modify: `src-tauri/src/agent/adapter/mod.rs`

- [ ] **Step 1: Write the trait declaration.**

Replace `adapter/mod.rs` contents:

```rust
//! Agent adapter abstraction — see docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md.
//!
//! ## Layered design
//!
//! - **`trait AgentAdapter<R: tauri::Runtime>`** carries the five
//!   provider hooks (this file). Generic over `R` so production
//!   (Wry) and `tauri::test::mock_builder()`-driven integration tests
//!   (MockRuntime) can share one trait.
//! - **`impl<R> dyn AgentAdapter<R>`** (Task 11) carries the
//!   user-facing `for_type` / `start` / `stop` inherent methods — the
//!   only entry points production callers need.
//! - **`pub(crate) fn base::start_for<R>`** (Task 10) holds the
//!   orchestration body. Trait default methods can't own per-watcher
//!   mutable state, so the orchestrator lives in a free fn that the
//!   inherent `start` delegates to.

pub mod base;
pub mod claude_code;
pub mod json;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::AppHandle;

use crate::agent::types::AgentType;
use base::TranscriptHandle; // re-exported below; lands in Task 9
use types::{ParsedStatus, StatusSource};

pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    /// Which agent this adapter represents.
    fn agent_type(&self) -> AgentType;

    /// Where this agent writes its status snapshot. Claude returns
    /// `<cwd>/.vimeflow/sessions/<sid>/status.json` with
    /// `trust_root: <cwd>`. Codex (Stage 2) will return its rollout
    /// JSONL path with `trust_root: ~/.codex/sessions`.
    fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource;

    /// Parse one snapshot of the status source. Returns the typed
    /// event plus the transcript path to start tailing (if any).
    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;

    /// Validate a transcript path against this provider's trust root.
    /// Claude rejects paths outside `~/.claude`; future providers reject
    /// paths outside their own session directories. MUST canonicalize
    /// and reject symlink-out via `fs::canonicalize`.
    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, String>;

    /// Tail this provider's transcript and emit Tauri events as new
    /// lines arrive. The adapter owns the tail loop end-to-end —
    /// including in-flight tool-call tracking, turn counting, and
    /// the replay-aware `TestRunEmitter` lifecycle. Returns a
    /// `TranscriptHandle` whose `Drop` only signals stop on the next
    /// poll (sets `stop_flag`); explicit `TranscriptHandle::stop(self)`
    /// also joins. Stage 1 preserves this — no behavioral change.
    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}
```

This will FAIL to compile — `base::TranscriptHandle` doesn't exist yet (it lands in Task 9). Add a temporary stub to `base.rs` so the trait skeleton compiles:

- [ ] **Step 2: Add a temporary `TranscriptHandle` stub in `base.rs`.**

Replace `adapter/base.rs` contents:

```rust
//! Watcher orchestration body shared across all agent adapters.
//!
//! TranscriptHandle/State land here in Task 9 (lifted from
//! claude_code/transcript.rs). For now, expose a minimal stub so the
//! trait skeleton in `mod.rs` compiles before Task 9.

// TEMPORARY — replaced in Task 9 with the real lifted type. Marked
// pub(crate) so no external consumer depends on this transitional shape.
pub(crate) struct TranscriptHandle {
    _placeholder: (),
}
```

- [ ] **Step 3: Update the trait re-export to use the temporary path.**

Edit `adapter/mod.rs`. Replace `use base::TranscriptHandle;` with `use base::TranscriptHandle;` (path is the same — kept here as a reminder that Task 9 will redefine the underlying type).

- [ ] **Step 4: Verify build.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors. Warnings about unused `_placeholder` field are fine.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/agent/adapter/mod.rs src-tauri/src/agent/adapter/base.rs
git commit -m "feat(agent/adapter): declare AgentAdapter<R> trait skeleton

Five provider hooks: agent_type, status_source, parse_status,
validate_transcript, tail_transcript. Generic over R: tauri::Runtime
so production (Wry) and integration tests (MockRuntime) share one
trait. Inherent impl block (for_type/start/stop) lands in Task 11.

Adds a temporary TranscriptHandle stub in base.rs so the trait
compiles; replaced in Task 9 with the real lifted type."
```

---

## Task 5: Move `agent/test_runners/` → `agent/adapter/claude_code/test_runners/`

**Goal:** Pure file move. No code changes.

**Files:**

- Move: `src-tauri/src/agent/test_runners/` → `src-tauri/src/agent/adapter/claude_code/test_runners/`
- Modify: `src-tauri/src/agent/mod.rs` (remove `pub mod test_runners;`)
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs` (add `pub mod test_runners;`)
- Modify: `src-tauri/src/agent/transcript.rs` (still in old location — update import path)

- [ ] **Step 1: Move the directory.**

```bash
git mv src-tauri/src/agent/test_runners src-tauri/src/agent/adapter/claude_code/test_runners
```

- [ ] **Step 2: Update `agent/mod.rs`.**

Edit `src-tauri/src/agent/mod.rs`. Remove the `pub mod test_runners;` line (or `mod test_runners;` if non-pub).

- [ ] **Step 3: Update `adapter/claude_code/mod.rs`.**

Replace its contents:

```rust
//! Claude Code adapter — implements `AgentAdapter<R>`.
//!
//! Provider-specific submodules live here:
//! - `test_runners/` — vitest/cargo-test parser ecosystem
//! - `statusline.rs` (Task 6) — status.json parser
//! - `transcript.rs` (Task 7) — JSONL tail loop and per-line parsing
//! - The `ClaudeCodeAdapter` impl itself (Task 8)

pub mod test_runners;
```

- [ ] **Step 4: Update `agent/transcript.rs`'s import to point at the new path.**

Open `src-tauri/src/agent/transcript.rs:19-20` (the `use crate::agent::test_runners::…` lines) and change them to `use crate::agent::adapter::claude_code::test_runners::…`.

Specifically the existing imports:

```rust
use crate::agent::test_runners::emitter::TestRunEmitter;
use crate::agent::test_runners::matcher::{match_command, MatchedCommand};
```

Become:

```rust
use crate::agent::adapter::claude_code::test_runners::emitter::TestRunEmitter;
use crate::agent::adapter::claude_code::test_runners::matcher::{match_command, MatchedCommand};
```

- [ ] **Step 5: Update the relocated `super::*` references inside `test_runners/build.rs:1` etc.**

Run a fast scan to find any `super::super::test_runners::…` or `crate::agent::test_runners::…` imports that broke:

```bash
cd src-tauri && rg "agent::test_runners|super::test_runners" --type rust src/
```

For each hit inside the moved files, change `super::test_runners::X` → `super::X` (now siblings) or `crate::agent::test_runners::X` → `crate::agent::adapter::claude_code::test_runners::X`. The internal cross-imports between submodules under `test_runners/` (e.g. `build.rs` referencing `types::*`) likely use relative paths and need no change — verify with the grep above.

- [ ] **Step 6: Run all tests.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green. Tests that previously lived under `agent::test_runners::*::tests` now live under `agent::adapter::claude_code::test_runners::*::tests`.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor(agent): move test_runners under adapter/claude_code

Pure relocation; no logic change. Updates the import path in
agent/transcript.rs (still at the old location until Task 7) and
in the relocated module's internal references."
```

---

## Task 6: Move `agent/statusline.rs` and Refactor Parsers to Use `adapter/json` Primitives

**Goal:** Relocate `statusline.rs` AND eliminate the ~30 duplicate `obj.get(...).and_then(|v| v.as_*()).unwrap_or(default)` chains by routing them through `adapter::json::*_or` helpers. Mechanical except for the chains.

**Files:**

- Move: `src-tauri/src/agent/statusline.rs` → `src-tauri/src/agent/adapter/claude_code/statusline.rs`
- Modify: `src-tauri/src/agent/mod.rs` (remove `pub mod statusline;`)
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs` (add `pub mod statusline;`)
- Modify: `src-tauri/src/agent/watcher.rs` (update import path — temporary; goes away in Task 12)

- [ ] **Step 1: Move the file.**

```bash
git mv src-tauri/src/agent/statusline.rs src-tauri/src/agent/adapter/claude_code/statusline.rs
```

- [ ] **Step 2: Update `agent/mod.rs`.**

Remove `pub mod statusline;` (or `mod statusline;`) from `src-tauri/src/agent/mod.rs`.

- [ ] **Step 3: Update `adapter/claude_code/mod.rs`.**

Append `pub mod statusline;` to the existing module-declaration block.

- [ ] **Step 4: Update `agent/watcher.rs`'s import (temporary — removed in Task 12).**

Open `src-tauri/src/agent/watcher.rs:16`:

```rust
use super::statusline::parse_statusline;
```

Change to:

```rust
use crate::agent::adapter::claude_code::statusline::parse_statusline;
```

- [ ] **Step 5: Refactor the moved file's parsers to use `adapter::json` primitives.**

Open `src-tauri/src/agent/adapter/claude_code/statusline.rs`. At the top of the file, add:

```rust
use crate::agent::adapter::json;
```

Then walk through `parse_context_window`, `parse_cost_metrics`, `parse_rate_limits`, and replace every chain of the form:

```rust
let total_input_tokens = cw.get("total_input_tokens")
    .and_then(|v| v.as_u64())
    .unwrap_or(0);
```

with:

```rust
let total_input_tokens = json::u64_or(value, &["context_window", "total_input_tokens"], 0);
```

(Note the path is rooted at the top-level `value` because `json::*_or` takes a slice from root, not a sub-object.)

Apply analogous transformations for `f64`, `str`, and `obj` accessors. The parser's logic is preserved; only the extraction primitives change.

- [ ] **Step 6: Run the mechanical acceptance check.**

```bash
cd src-tauri && rg "and_then\(\|v\| v\.as_(u64|f64|str|object)\(\)\)" src/agent/adapter/claude_code/statusline.rs
```

Expected: zero matches. (The transcript.rs parser still has them; we'll handle that in Task 7. This grep is scoped to statusline.rs.)

- [ ] **Step 7: Run the statusline-specific tests.**

```bash
cd src-tauri && cargo test --lib agent::adapter::claude_code::statusline
```

Expected: all `statusline::tests::*` tests pass — the parser refactor is semantics-preserving.

- [ ] **Step 8: Run the full suite to confirm nothing else broke.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green.

- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "refactor(agent/adapter): move statusline.rs + use json primitives

Relocates statusline.rs under adapter/claude_code/ and replaces
~30 inline obj.get().and_then().unwrap_or() chains with
adapter::json::*_or calls. Parser semantics unchanged; tests pass
under the new path."
```

---

## Task 7: Move `agent/transcript.rs` (Relocate-Only) + Transitional Re-Export Shim

**Goal:** Relocate the file. `TranscriptState`/`Handle`/`StartStatus` are NOT lifted to `base.rs` yet (that's Task 9). Leave a `pub use` shim at `agent/transcript.rs` so `lib.rs:8-9`'s import keeps resolving.

**Files:**

- Move: `src-tauri/src/agent/transcript.rs` → `src-tauri/src/agent/adapter/claude_code/transcript.rs`
- Create: `src-tauri/src/agent/transcript.rs` (transitional shim — deleted in Task 9)
- Modify: `src-tauri/src/agent/mod.rs` (no change needed; `pub use transcript::TranscriptState` still resolves through the shim)
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs` (add `pub mod transcript;`)
- Modify: `src-tauri/src/agent/adapter/claude_code/transcript.rs` (refactor parsers to `adapter::json`; remove the temporary `TranscriptHandle` stub from `base.rs`)
- Modify: `src-tauri/src/agent/adapter/base.rs` (remove temporary stub)
- Modify: `src-tauri/src/agent/watcher.rs` (update transcript import path — temporary)
- Modify: `src-tauri/tests/transcript_*.rs` (4 files — import-only edit at this step)

- [ ] **Step 1: Move the file.**

```bash
git mv src-tauri/src/agent/transcript.rs src-tauri/src/agent/adapter/claude_code/transcript.rs
```

- [ ] **Step 2: Add the transitional shim at the old path.**

Create `src-tauri/src/agent/transcript.rs` with exactly:

```rust
//! Transitional re-export shim — deleted in Task 9 once
//! TranscriptState/Handle/StartStatus lift into adapter::base.
//! See spec section "Migration Steps", step 7.

pub use crate::agent::adapter::claude_code::transcript::*;
```

- [ ] **Step 3: Add `pub mod transcript;` to `adapter/claude_code/mod.rs`.**

Append to the existing module-declaration block:

```rust
pub mod transcript;
```

- [ ] **Step 4: Remove the temporary `TranscriptHandle` stub from `adapter/base.rs`.**

Open `src-tauri/src/agent/adapter/base.rs`. Delete the temporary stub:

```rust
// Delete this entire block:
pub(crate) struct TranscriptHandle {
    _placeholder: (),
}
```

Replace it with a re-export so `adapter/mod.rs:use base::TranscriptHandle;` keeps resolving:

```rust
//! Watcher orchestration body shared across all agent adapters.
//!
//! TranscriptHandle/State will live here permanently after Task 9
//! (lifted from claude_code/transcript.rs). Until then, re-export
//! through the shim path.

pub use crate::agent::adapter::claude_code::transcript::TranscriptHandle;
```

- [ ] **Step 5: Update relocated transcript.rs's internal `super::*` imports.**

The moved file currently has `use super::test_runners::…` references that broke when test_runners moved in Task 5 (already fixed there) and now need a second update because transcript.rs itself moved up one level. Run:

```bash
cd src-tauri && rg "use super::|use crate::agent::test_runners|use super::types" src/agent/adapter/claude_code/transcript.rs
```

For each hit, fix:

- `use super::types::{…}` (refers to `agent/types.rs`) → `use crate::agent::types::{…}`
- `use super::test_runners::…` → `use super::test_runners::…` (transcript.rs and test_runners/ are now siblings under claude_code/, so `super::` is correct — verify the depth)
- `use crate::agent::test_runners::…` → `use crate::agent::adapter::claude_code::test_runners::…`

Run `cargo check` after each batch to catch path errors early.

- [ ] **Step 6: Refactor the relocated transcript.rs's parsers to use `adapter::json` primitives.**

Same pattern as Task 6, applied to `process_assistant_message`, `process_user_message`, `process_tool_result`, and helpers. Add `use crate::agent::adapter::json;` at the top, then replace `value.get("…").and_then(|v| v.as_*())` chains with `json::*_at` / `json::*_or`. The acceptance-check `rg` should now also pass for transcript.rs:

```bash
cd src-tauri && rg "and_then\(\|v\| v\.as_(u64|f64|str|object)\(\)\)" src/agent/adapter/claude_code/transcript.rs
```

Expected: zero matches.

- [ ] **Step 7: Update `agent/watcher.rs`'s transcript import (temporary — removed in Task 12).**

Open `src-tauri/src/agent/watcher.rs:17`:

```rust
use super::transcript::{validate_transcript_path, TranscriptStartStatus, TranscriptState};
```

Either keep as-is (resolves through the shim from step 2) or update to the new path:

```rust
use crate::agent::adapter::claude_code::transcript::{validate_transcript_path, TranscriptStartStatus, TranscriptState};
```

The shim makes both forms resolve identically. Pick the latter for clarity; it's easier to spot when Task 12 deletes watcher.rs entirely.

- [ ] **Step 8: Update the four integration tests' import paths.**

Each of:

- `src-tauri/tests/transcript_vitest_e2e.rs:7`
- `src-tauri/tests/transcript_vitest_replay.rs:8`
- `src-tauri/tests/transcript_turns.rs:4`
- `src-tauri/tests/transcript_cargo_e2e.rs:3`

Currently has:

```rust
use vimeflow_lib::agent::transcript::TranscriptState;
```

Change each to:

```rust
use vimeflow_lib::agent::adapter::claude_code::transcript::TranscriptState;
```

(They go to the FINAL location `…::adapter::base::TranscriptState` in Task 9. Two-step migration so each step compiles.)

- [ ] **Step 9: Run all tests.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green. Behavior unchanged.

- [ ] **Step 10: Commit.**

```bash
git add -A
git commit -m "refactor(agent/adapter): move transcript.rs + json primitives

Relocates transcript.rs under adapter/claude_code/, refactors its
serde_json::Value extraction chains to use adapter::json primitives,
and adds a transitional re-export shim at agent/transcript.rs so
lib.rs and integration tests keep resolving (shim deleted in Task 9
when TranscriptState/Handle/StartStatus lift to adapter::base).

Integration test imports updated to the claude_code path; they
move again to the base path in Task 9 alongside the API change."
```

---

## Task 8: Implement `AgentAdapter<R>` for `ClaudeCodeAdapter` and Add `NoOpAdapter`

**Goal:** The two concrete adapter structs that the factory in Task 11 will dispatch to.

**Files:**

- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs` (add `ClaudeCodeAdapter` struct + impl)
- Modify: `src-tauri/src/agent/adapter/mod.rs` (add `NoOpAdapter` struct + impl)

- [ ] **Step 1: Write the failing test for `ClaudeCodeAdapter::agent_type`.**

Append to `adapter/claude_code/mod.rs`:

```rust
pub struct ClaudeCodeAdapter;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::adapter::AgentAdapter;
    use crate::agent::types::AgentType;
    use tauri::test::MockRuntime;

    #[test]
    fn agent_type_returns_claude_code() {
        let adapter = ClaudeCodeAdapter;
        // Type-annotate so the compiler picks the right `impl<R>`.
        assert!(matches!(
            <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::agent_type(&adapter),
            AgentType::ClaudeCode
        ));
    }
}
```

This will fail to compile (no impl). Run:

```bash
cd src-tauri && cargo test --lib agent::adapter::claude_code::tests::agent_type_returns_claude_code 2>&1 | head -20
```

Expected: error E0277 or similar — `ClaudeCodeAdapter: AgentAdapter<MockRuntime>` not satisfied.

- [ ] **Step 2: Write the impl block.**

Append to `adapter/claude_code/mod.rs`:

```rust
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::agent::adapter::types::{ParsedStatus, StatusSource};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
use transcript::TranscriptHandle;

impl<R: tauri::Runtime> AgentAdapter<R> for ClaudeCodeAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource {
        StatusSource {
            path: cwd
                .join(".vimeflow")
                .join("sessions")
                .join(session_id)
                .join("status.json"),
            trust_root: cwd.to_path_buf(),
        }
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        let parsed = statusline::parse_statusline(session_id, raw)?;
        Ok(ParsedStatus {
            event: parsed.event,
            transcript_path: parsed.transcript_path,
        })
    }

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, String> {
        transcript::validate_transcript_path(raw)
    }

    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        transcript::start_tailing(app, session_id, transcript_path, cwd)
    }
}
```

If `statusline::parse_statusline`'s return type is not exactly `ParsedStatus` (it currently returns `ParsedStatusline` with the same shape), keep the explicit `ParsedStatus { event, transcript_path }` construction shown above so the trait signature lines up.

- [ ] **Step 3: Run the test for `agent_type`.**

```bash
cd src-tauri && cargo test --lib agent::adapter::claude_code::tests::agent_type_returns_claude_code
```

Expected: pass.

- [ ] **Step 4: Add tests for the other four hooks (delegation contract).**

Append to the `mod tests` block:

```rust
use std::path::PathBuf;

#[test]
fn status_source_returns_claude_path_under_cwd() {
    let adapter = ClaudeCodeAdapter;
    let cwd = PathBuf::from("/tmp/ws");
    let src = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::status_source(
        &adapter, &cwd, "sess-1",
    );
    assert_eq!(src.path, cwd.join(".vimeflow/sessions/sess-1/status.json"));
    assert_eq!(src.trust_root, cwd);
}

#[test]
fn parse_status_minimal_json_matches_statusline_module() {
    let adapter = ClaudeCodeAdapter;
    let parsed = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::parse_status(
        &adapter, "sess-1", r#"{}"#,
    )
    .expect("minimal json should parse");
    // statusline::parse_statusline's behavior on empty json — keep
    // assertion minimal to avoid duplicating its own test suite.
    assert_eq!(parsed.event.session_id, "sess-1");
    assert!(parsed.transcript_path.is_none());
}

#[test]
fn validate_transcript_rejects_path_outside_claude_root() {
    let adapter = ClaudeCodeAdapter;
    let tmp = tempfile::tempdir().expect("tmp");
    let bad = tmp.path().join("transcript.jsonl");
    std::fs::write(&bad, "").expect("write");

    let result = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::validate_transcript(
        &adapter,
        bad.to_str().unwrap(),
    );
    assert!(result.is_err(), "expected outside-~/.claude path to be rejected");
}
```

(The `tail_transcript` hook's contract is exercised end-to-end by the integration tests in Task 9 — no thin delegation test is added here because the hook's body is a one-line forward to `transcript::start_tailing`, which has its own test suite.)

- [ ] **Step 5: Write `NoOpAdapter` in `adapter/mod.rs`.**

Append to `src-tauri/src/agent/adapter/mod.rs`:

```rust
/// Fallback adapter for agents not yet implemented in Stage 1
/// (Codex, Aider, Generic). Routes the watcher to the same path
/// Claude uses so today's silent-no-op UX (watcher starts, no
/// events, frontend collapses on agent exit) survives the refactor
/// unchanged. Stage 2 replaces the `Codex` arm of `for_type` with
/// a real `CodexAdapter`. See spec IDEA "NoOpAdapter for non-Claude
/// agents in for_type" for why `Err` would have regressed the UI.
pub(crate) struct NoOpAdapter {
    agent_type: AgentType,
}

impl NoOpAdapter {
    pub(crate) fn new(agent_type: AgentType) -> Self {
        Self { agent_type }
    }
}

impl<R: tauri::Runtime> AgentAdapter<R> for NoOpAdapter {
    fn agent_type(&self) -> AgentType {
        // .clone() because AgentType derives only Clone, not Copy
        // (agent/types.rs:6). Returning by reference would change the
        // trait signature — Stage 1 keeps the existing by-value shape.
        self.agent_type.clone()
    }

    fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource {
        StatusSource {
            path: cwd
                .join(".vimeflow")
                .join("sessions")
                .join(session_id)
                .join("status.json"),
            trust_root: cwd.to_path_buf(),
        }
    }

    fn parse_status(&self, _: &str, _: &str) -> Result<ParsedStatus, String> {
        Err(format!(
            "{:?} adapter has no status parser",
            self.agent_type
        ))
    }

    fn validate_transcript(&self, _: &str) -> Result<PathBuf, String> {
        Err(format!(
            "{:?} adapter has no transcript validator",
            self.agent_type
        ))
    }

    fn tail_transcript(
        &self,
        _: AppHandle<R>,
        _: String,
        _: Option<PathBuf>,
        _: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        Err(format!(
            "{:?} adapter has no transcript tailer",
            self.agent_type
        ))
    }
}

#[cfg(test)]
mod noop_tests {
    use super::*;
    use tauri::test::MockRuntime;

    #[test]
    fn agent_type_round_trips() {
        let adapter = NoOpAdapter::new(AgentType::Codex);
        assert!(matches!(
            <NoOpAdapter as AgentAdapter<MockRuntime>>::agent_type(&adapter),
            AgentType::Codex
        ));
    }

    #[test]
    fn status_source_uses_claude_shaped_path() {
        let adapter = NoOpAdapter::new(AgentType::Codex);
        let cwd = std::path::PathBuf::from("/tmp/ws");
        let src = <NoOpAdapter as AgentAdapter<MockRuntime>>::status_source(&adapter, &cwd, "sid");
        assert!(src.path.ends_with(".vimeflow/sessions/sid/status.json"));
        assert_eq!(src.trust_root, cwd);
    }

    #[test]
    fn parse_status_returns_err() {
        let adapter = NoOpAdapter::new(AgentType::Aider);
        assert!(<NoOpAdapter as AgentAdapter<MockRuntime>>::parse_status(
            &adapter, "sid", "{}",
        )
        .is_err());
    }
}
```

- [ ] **Step 6: Run all adapter tests.**

```bash
cd src-tauri && cargo test --lib agent::adapter
```

Expected: all `claude_code::tests::*` and `noop_tests::*` tests pass.

- [ ] **Step 7: Run the full suite.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green.

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "feat(agent/adapter): impl AgentAdapter for ClaudeCodeAdapter + NoOpAdapter

ClaudeCodeAdapter delegates each hook to the relocated claude_code/
modules. NoOpAdapter covers Codex/Aider/Generic during Stage 1 by
returning Claude's status path so the watcher's start_for behavior
matches today's silent no-op UX — preserves frontend exit-collapse.

Tests cover agent_type / status_source / parse_status delegation;
tail_transcript is exercised end-to-end via Task 9's integration
tests."
```

---

## Task 9: Lift `TranscriptState` / `TranscriptHandle` / `TranscriptStartStatus` into `base.rs`, Change `start_or_replace` API, Update Callers

**Goal:** Move the registry types from `claude_code/transcript.rs` into `adapter/base.rs`, change `start_or_replace` to take an `Arc<dyn AgentAdapter<R>>`, update every caller (5 unit tests inside the moved transcript.rs + 4 integration tests + 1 watcher.rs call site that exists temporarily until Task 10).

**Files:**

- Modify: `src-tauri/src/agent/adapter/claude_code/transcript.rs` (remove the three lifecycle types + their tests)
- Modify: `src-tauri/src/agent/adapter/base.rs` (add the three types + their tests + adapter-aware `start_or_replace`)
- Modify: `src-tauri/src/agent/mod.rs` (re-export updates)
- Modify: `src-tauri/src/agent/transcript.rs` (delete the transitional shim from Task 7)
- Modify: `src-tauri/src/agent/watcher.rs` (update call sites to pass adapter — temporary; goes away in Task 10)
- Modify: `src-tauri/tests/transcript_*.rs` (4 files — adapter-arg edits)
- Modify: `src-tauri/src/lib.rs` (verify import path still resolves through `agent/mod.rs`)

- [ ] **Step 1: Lift the types from `claude_code/transcript.rs` into `base.rs`.**

In `src-tauri/src/agent/adapter/claude_code/transcript.rs`, identify these items (referencing the original `agent/transcript.rs` line numbers as guidance — exact lines shifted during the move):

- `pub struct TranscriptHandle` (with its `Drop` and `stop` impls)
- `pub struct TranscriptWatcher`
- `pub enum TranscriptStartStatus`
- `pub struct TranscriptState` (with its `new`, `start`, `start_or_replace`, `contains`, `stop` impls)

Cut these definitions (and only these — leave `start_tailing`, `tail_loop`, `process_*`, `validate_transcript_path`, etc. in place).

Cut their `#[cfg(test)] mod tests` items too, specifically the three state-driving tests (`transcript_state_replaces_changed_path`, `transcript_state_threads_cwd_through`, `transcript_state_replaces_when_only_cwd_changes`) and `transcript_handle_drop_sets_stop_flag`. Keep `validate_transcript_path_rejects_path_outside_claude_root` and the parser-level tests in claude_code/transcript.rs.

In `src-tauri/src/agent/adapter/base.rs`, replace the temporary re-export shim (added in Task 7) with the lifted types:

```rust
//! Watcher orchestration body shared across all agent adapters.
//!
//! Holds:
//! - `TranscriptState` registry — Tauri-managed (see `lib.rs:77`).
//! - `TranscriptHandle` / `TranscriptStartStatus` — lifecycle types.
//! - `start_for<R>` (Task 10) — the watcher orchestration body.
//!
//! `TranscriptState`/`TranscriptHandle`/`TranscriptStartStatus` stay
//! `pub #[doc(hidden)]` because four `tests/transcript_*.rs`
//! integration tests drive them directly. Production code MUST go
//! through `<dyn AgentAdapter<R>>::start(...)`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::agent::adapter::AgentAdapter;
use crate::agent::adapter::claude_code::transcript::{
    // Bring in start_tailing, tail_loop, etc. via path — these stay
    // in claude_code/transcript.rs and are reached through the adapter.
};

/// Test-only public surface — production code MUST use AgentAdapter::start instead.
#[doc(hidden)]
pub struct TranscriptHandle {
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

impl TranscriptHandle {
    pub(crate) fn new(
        stop_flag: Arc<AtomicBool>,
        join_handle: std::thread::JoinHandle<()>,
    ) -> Self {
        Self {
            stop_flag,
            join_handle: Some(join_handle),
        }
    }

    /// Signal the background thread to stop and wait for it to finish.
    pub fn stop(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for TranscriptHandle {
    fn drop(&mut self) {
        // Signal-only — explicit `stop(self)` is what joins. Preserves
        // today's behavior at the original transcript.rs:104-108.
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptStartStatus {
    Started,
    Replaced,
    AlreadyRunning,
}

struct TranscriptWatcher {
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
    handle: TranscriptHandle,
}

/// Test-only public surface — production code MUST use AgentAdapter::start instead.
#[doc(hidden)]
#[derive(Default, Clone)]
pub struct TranscriptState {
    watchers: Arc<Mutex<HashMap<String, TranscriptWatcher>>>,
}

impl TranscriptState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start tailing for the given session, dispatching the spawn
    /// to the supplied adapter. Same identity check (transcript_path,
    /// cwd) as before — only the spawn site changes.
    pub fn start_or_replace<R: tauri::Runtime>(
        &self,
        adapter: Arc<dyn AgentAdapter<R>>,
        app_handle: AppHandle<R>,
        session_id: String,
        transcript_path: PathBuf,
        cwd: Option<PathBuf>,
    ) -> Result<TranscriptStartStatus, String> {
        {
            let watchers = self.watchers.lock().expect("watchers lock");
            if let Some(current) = watchers.get(&session_id) {
                if current.transcript_path == transcript_path && current.cwd == cwd {
                    return Ok(TranscriptStartStatus::AlreadyRunning);
                }
            }
        }

        let mut new_handle = Some(adapter.tail_transcript(
            app_handle,
            session_id.clone(),
            cwd.clone(),
            transcript_path.clone(),
        )?);

        let (old_handle, status) = {
            let mut watchers = self.watchers.lock().expect("watchers lock");
            if let Some(current) = watchers.get(&session_id) {
                if current.transcript_path == transcript_path && current.cwd == cwd {
                    (None, TranscriptStartStatus::AlreadyRunning)
                } else {
                    let old = watchers.insert(
                        session_id,
                        TranscriptWatcher {
                            transcript_path: transcript_path.clone(),
                            cwd: cwd.clone(),
                            handle: new_handle.take().expect("new handle"),
                        },
                    );
                    (old.map(|w| w.handle), TranscriptStartStatus::Replaced)
                }
            } else {
                watchers.insert(
                    session_id,
                    TranscriptWatcher {
                        transcript_path,
                        cwd,
                        handle: new_handle.take().expect("new handle"),
                    },
                );
                (None, TranscriptStartStatus::Started)
            }
        };

        if let Some(handle) = new_handle {
            handle.stop();
        }
        if let Some(handle) = old_handle {
            handle.stop();
        }

        Ok(status)
    }

    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        let handle = {
            let mut watchers = self.watchers.lock().expect("watchers lock");
            watchers.remove(session_id)
        };
        match handle {
            Some(watcher) => {
                watcher.handle.stop();
                Ok(())
            }
            None => Err(format!("No transcript watcher for session: {}", session_id)),
        }
    }

    #[allow(dead_code)]
    pub fn contains(&self, session_id: &str) -> bool {
        self.watchers.lock().expect("watchers lock").contains_key(session_id)
    }
}
```

The previous `TranscriptHandle`'s constructor was private to `claude_code/transcript.rs`; the lifted version exposes a `pub(crate) fn new(...)` so `start_tailing` can construct it from across the module boundary.

- [ ] **Step 2: Update `claude_code/transcript.rs::start_tailing` to construct via `TranscriptHandle::new(...)`.**

Open `src-tauri/src/agent/adapter/claude_code/transcript.rs`. Find `pub fn start_tailing<R: tauri::Runtime>(…)` and update its return-construction:

```rust
// Before:
Ok(TranscriptHandle {
    stop_flag,
    join_handle: Some(join_handle),
})

// After:
Ok(crate::agent::adapter::base::TranscriptHandle::new(stop_flag, join_handle))
```

Update the type alias / import at the top of `claude_code/transcript.rs` so `TranscriptHandle` resolves to `base::TranscriptHandle`:

```rust
pub use crate::agent::adapter::base::TranscriptHandle;
```

- [ ] **Step 3: Move the unit tests for `TranscriptState`/`TranscriptHandle` into `base.rs`.**

In `src-tauri/src/agent/adapter/base.rs`, append (or extend the existing `#[cfg(test)] mod tests`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::adapter::claude_code::ClaudeCodeAdapter;
    use std::sync::Arc;
    use tauri::test::{mock_builder, MockRuntime};

    #[test]
    fn transcript_state_contains_empty() {
        let state = TranscriptState::new();
        assert!(!state.contains("any-session"));
    }

    #[test]
    fn transcript_state_replaces_changed_path() {
        let app = mock_builder().build(tauri::generate_context!()).expect("build");
        let tmp = tempfile::tempdir().expect("temp");
        let first_path = tmp.path().join("first.jsonl");
        let second_path = tmp.path().join("second.jsonl");
        std::fs::write(&first_path, "").expect("write first");
        std::fs::write(&second_path, "").expect("write second");

        let state = TranscriptState::new();
        let session_id = "session-1".to_string();
        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter);

        let first = state
            .start_or_replace(adapter.clone(), app.handle().clone(),
                              session_id.clone(), first_path.clone(), None)
            .expect("first");
        assert_eq!(first, TranscriptStartStatus::Started);

        let dup = state
            .start_or_replace(adapter.clone(), app.handle().clone(),
                              session_id.clone(), first_path, None)
            .expect("dup");
        assert_eq!(dup, TranscriptStartStatus::AlreadyRunning);

        let replaced = state
            .start_or_replace(adapter, app.handle().clone(),
                              session_id.clone(), second_path, None)
            .expect("replaced");
        assert_eq!(replaced, TranscriptStartStatus::Replaced);

        state.stop(&session_id).expect("stop");
    }

    #[test]
    fn transcript_state_threads_cwd_through() {
        let app = mock_builder().build(tauri::generate_context!()).expect("build");
        let tmp = tempfile::tempdir().expect("temp");
        let path = tmp.path().join("t.jsonl");
        std::fs::write(&path, "").expect("write");
        let cwd = tmp.path().to_path_buf();

        let state = TranscriptState::new();
        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter);
        let status = state
            .start_or_replace(adapter, app.handle().clone(),
                              "sess-cwd".into(), path, Some(cwd))
            .expect("start");
        assert_eq!(status, TranscriptStartStatus::Started);

        state.stop("sess-cwd").expect("stop");
    }

    #[test]
    fn transcript_state_replaces_when_only_cwd_changes() {
        let app = mock_builder().build(tauri::generate_context!()).expect("build");
        let tmp = tempfile::tempdir().expect("temp");
        let path = tmp.path().join("t.jsonl");
        std::fs::write(&path, "").expect("write");
        let cwd_a = tempfile::tempdir().expect("a");
        let cwd_b = tempfile::tempdir().expect("b");

        let state = TranscriptState::new();
        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter);
        let session_id = "sess-cwd-change".to_string();

        let first = state
            .start_or_replace(adapter.clone(), app.handle().clone(),
                              session_id.clone(), path.clone(),
                              Some(cwd_a.path().to_path_buf()))
            .expect("first");
        assert_eq!(first, TranscriptStartStatus::Started);

        let same = state
            .start_or_replace(adapter.clone(), app.handle().clone(),
                              session_id.clone(), path.clone(),
                              Some(cwd_a.path().to_path_buf()))
            .expect("same");
        assert_eq!(same, TranscriptStartStatus::AlreadyRunning);

        let replaced = state
            .start_or_replace(adapter.clone(), app.handle().clone(),
                              session_id.clone(), path.clone(),
                              Some(cwd_b.path().to_path_buf()))
            .expect("replaced");
        assert_eq!(replaced, TranscriptStartStatus::Replaced);

        let to_none = state
            .start_or_replace(adapter, app.handle().clone(),
                              session_id.clone(), path, None)
            .expect("to none");
        assert_eq!(to_none, TranscriptStartStatus::Replaced);

        state.stop(&session_id).expect("stop");
    }

    #[test]
    fn transcript_handle_drop_sets_stop_flag() {
        let stop_flag = Arc::new(AtomicBool::new(false));
        // Build a fake JoinHandle on a thread that exits immediately.
        let handle = std::thread::spawn(|| {});

        {
            let _h = TranscriptHandle::new(Arc::clone(&stop_flag), handle);
        }

        assert!(stop_flag.load(Ordering::Relaxed));
    }
}
```

- [ ] **Step 4: Delete the transitional shim at `agent/transcript.rs`.**

```bash
rm src-tauri/src/agent/transcript.rs
```

- [ ] **Step 5: Update `agent/mod.rs` re-exports.**

Open `src-tauri/src/agent/mod.rs`. Replace the existing transcript-related re-exports:

```rust
// Before:
pub use transcript::{start_transcript_watcher, stop_transcript_watcher, TranscriptState};

// After:
pub use adapter::base::TranscriptState;
// start_transcript_watcher / stop_transcript_watcher are removed in Task 13.
```

Also remove `pub mod transcript;` (the file is gone).

- [ ] **Step 6: Update the four integration tests' imports + add adapter argument.**

For each of:

- `src-tauri/tests/transcript_vitest_e2e.rs`
- `src-tauri/tests/transcript_vitest_replay.rs`
- `src-tauri/tests/transcript_turns.rs`
- `src-tauri/tests/transcript_cargo_e2e.rs`

Change the import (which Task 7 set to `…::adapter::claude_code::transcript::TranscriptState`):

```rust
use vimeflow_lib::agent::adapter::base::TranscriptState;
```

Add an adapter import + construction line above the `state.start_or_replace(...)` call:

```rust
use std::sync::Arc;
use vimeflow_lib::agent::adapter::AgentAdapter;
use vimeflow_lib::agent::adapter::claude_code::ClaudeCodeAdapter;
use tauri::test::MockRuntime;

// ... inside the test fn, before state.start_or_replace ...
let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter);
```

Then add `adapter` (or `adapter.clone()` if used multiple times) as the new first argument to every `state.start_or_replace(...)` call. The exact call sites to edit:

- `transcript_vitest_e2e.rs:30-31`
- `transcript_vitest_replay.rs:34-35`
- `transcript_turns.rs:60-61`
- `transcript_cargo_e2e.rs:30-31`

- [ ] **Step 7: Update `agent/watcher.rs`'s `maybe_start_transcript` call site (temporary — goes away in Task 10).**

Open `src-tauri/src/agent/watcher.rs`. Find the `start_or_replace` call in `maybe_start_transcript` (currently around line 361). Today it's:

```rust
ts.start_or_replace(
    app_handle.clone(),
    session_id.to_string(),
    canonical.clone(),
    cwd,
)
```

Update to pass an adapter. Until Task 10 wires `start_for` to receive the adapter, build one inline at the call site:

```rust
use std::sync::Arc;
use crate::agent::adapter::AgentAdapter;
use crate::agent::adapter::claude_code::ClaudeCodeAdapter;
// ...
let adapter: Arc<dyn AgentAdapter<tauri::Wry>> = Arc::new(ClaudeCodeAdapter);
ts.start_or_replace(
    adapter,
    app_handle.clone(),
    session_id.to_string(),
    canonical.clone(),
    cwd,
)
```

This is a transitional hardcode. Task 10 lifts the adapter through the proper plumbing.

- [ ] **Step 8: Verify `lib.rs` still compiles.**

`lib.rs:8-9` imports `TranscriptState` from `agent::{...}`. With Step 5's re-export update, that import resolves to `agent::adapter::base::TranscriptState`. No edit to `lib.rs` is needed at this step.

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors.

- [ ] **Step 9: Run all tests.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green. The lifted unit tests pass under their new path; the integration tests pass with the adapter argument; existing claude_code/transcript.rs tests pass unchanged.

- [ ] **Step 10: Commit.**

```bash
git add -A
git commit -m "refactor(agent/adapter): lift TranscriptState into base.rs

TranscriptState/Handle/StartStatus move from claude_code/transcript.rs
to adapter/base.rs as pub #[doc(hidden)] items. start_or_replace
gains an Arc<dyn AgentAdapter<R>> first argument so it routes the
spawn through adapter.tail_transcript instead of the Claude-specific
start_tailing — keeps base from re-coupling to claude_code.

Updates the four integration tests + transcript.rs's own state-
driving unit tests + the temporary call site in watcher.rs (lifted
through start_for plumbing in Task 10). Deletes the transitional
re-export shim from Task 7."
```

---

## Task 10: Move Watcher Orchestration Body into `adapter/base.rs`

**Goal:** The single biggest behavioral-risk step. Move `start_watching` (700 lines from `watcher.rs:403-642`) into `base.rs` as `pub(crate) fn start_for<R>`, route the transcript spawn through `state.start_or_replace(adapter.clone(), ...)`, enforce `trust_root`, add the `WatcherHandle` field changes + Drop cascade.

**Files:**

- Modify: `src-tauri/src/agent/adapter/base.rs` (add `start_for` + `WatcherHandle` + `AgentWatcherState`)
- Modify: `src-tauri/src/agent/watcher.rs` (will be deleted in Task 12; this task removes its function bodies)

This task is a verbatim move with five admissible substitutions per the spec's "Behavioral drift in step 10" IDEA. Reviewer must `diff -u` between the deleted `watcher.rs::{start_agent_watcher, start_watching}` bodies and the new `base::start_for` body and confirm every change is one of:

1. `parse_statusline(&sid, &c)` → `adapter.parse_status(&sid, &c)`
2. `validate_transcript_path(p)` → `adapter.validate_transcript(p)`
3. status-file-path construction → `adapter.status_source(cwd, sid)` plus the trust-root verification block from spec step 10 (canonicalize trust_root → walk to deepest existing ancestor → canonicalize → assert under trust_root → create_dir_all → re-canonicalize → re-assert)
4. inline `start_tailing(...)` → `state.start_or_replace(adapter.clone(), app, sid, path, cwd)` (NOT `adapter.tail_transcript` directly — the registry owns identity check + replacement)
5. `WatcherHandle` field additions (`_watcher: Option<RecommendedWatcher>`, `transcript_state: TranscriptState`, `session_id: String`) and Drop reorder (`drop(self._watcher.take())` → `stop_flag` + poll-join → `transcript_state.stop`).

- [ ] **Step 1: Copy the full `start_watching` body from `watcher.rs:403-642` into `base.rs`.**

Open both files side-by-side. In `base.rs`, append:

```rust
use std::time::Duration;
use std::time::Instant;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

// ────────────────────────────────────────────────────────────────────
// Diagnostic types — private to base. See spec's "Visibility" section.
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TxOutcome { /* … verbatim from watcher.rs:38-65 … */ }

impl TxOutcome { fn label(&self) -> &'static str { /* … verbatim … */ } }

#[derive(Default)]
struct EventTiming { /* … verbatim from watcher.rs:69-72 … */ }

#[derive(Default)]
struct PathHistory { /* … verbatim from watcher.rs:81-135, including the observe() method … */ }

fn short_sid(sid: &str) -> &str { /* verbatim watcher.rs:137-139 */ }
fn short_path(path: &str) -> String { /* verbatim watcher.rs:141-147 */ }
fn record_event_diag(/* … */) { /* verbatim watcher.rs:158-232 */ }

// ────────────────────────────────────────────────────────────────────
// WatcherHandle — gains transcript_state cascade + Option<RecommendedWatcher>
// ────────────────────────────────────────────────────────────────────

pub struct WatcherHandle {
    _watcher: Option<RecommendedWatcher>,
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
    transcript_state: TranscriptState,
    session_id: String,
    #[cfg(debug_assertions)]
    session_id_for_log: String,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        // ORDER MATTERS — Rust drops fields AFTER the explicit Drop body.
        // Drop the notify watcher first so callbacks cease, THEN signal+
        // join the polling thread, THEN stop the transcript registry.
        // A late notify callback firing after transcript_state.stop would
        // call start_or_replace and restart the tailer — which is exactly
        // what this ordering prevents (spec Behavioral Invariant #8).
        drop(self._watcher.take());

        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(h) = self.join_handle.take() {
            let _ = h.join();
        }
        let _ = self.transcript_state.stop(&self.session_id);

        #[cfg(debug_assertions)]
        log::info!(
            "watcher.handle.dropped session={}",
            short_sid(&self.session_id_for_log)
        );
    }
}

#[derive(Default, Clone)]
pub struct AgentWatcherState {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
}

impl AgentWatcherState {
    pub fn new() -> Self { Self::default() }
    pub fn insert(&self, session_id: String, handle: WatcherHandle) {
        let mut watchers = self.watchers.lock().expect("watchers lock");
        watchers.insert(session_id, handle);
    }
    pub fn remove(&self, session_id: &str) -> bool {
        let mut watchers = self.watchers.lock().expect("watchers lock");
        watchers.remove(session_id).is_some()
    }
    #[allow(dead_code)]
    pub fn contains(&self, session_id: &str) -> bool {
        self.watchers.lock().expect("watchers lock").contains_key(session_id)
    }
    fn active_count(&self) -> usize {
        self.watchers.lock().expect("watchers lock").len()
    }
}

// ────────────────────────────────────────────────────────────────────
// start_for — the public-ish (pub(crate)) orchestrator
// ────────────────────────────────────────────────────────────────────

pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app: AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String> {
    use std::fs;

    // Resolve status source from the adapter.
    let src = adapter.status_source(&cwd, &session_id);

    // Trust-root verification — first-run safe.
    let canonical_root = fs::canonicalize(&src.trust_root).map_err(|e| {
        format!(
            "trust_root not resolvable: {}: {}",
            src.trust_root.display(),
            e
        )
    })?;

    let parent = src.path.parent()
        .ok_or_else(|| "status path has no parent".to_string())?;

    let resolved_ancestor = {
        let mut probe: &std::path::Path = parent;
        loop {
            if probe.exists() {
                break fs::canonicalize(probe).map_err(|e| {
                    format!("ancestor canonicalize failed: {}", e)
                })?;
            }
            probe = probe.parent().ok_or_else(|| {
                format!(
                    "status path escapes filesystem root: {}",
                    parent.display()
                )
            })?;
        }
    };

    if !resolved_ancestor.starts_with(&canonical_root) {
        return Err(format!(
            "status source path escapes trust_root: {} not under {}",
            resolved_ancestor.display(),
            canonical_root.display(),
        ));
    }

    // Stop any existing watcher BEFORE counting active watchers (so the
    // restart-same-session case doesn't inflate the leak signal in logs).
    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        src.path.display(),
        state.active_count(),
    );

    fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create status directory: {}", e))?;

    // Post-create symlink-race check.
    let canonical_parent = fs::canonicalize(parent).map_err(|e| {
        format!("post-create canonicalize failed: {}", e)
    })?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!(
            "status parent escapes trust_root after create: {} not under {}",
            canonical_parent.display(),
            canonical_root.display(),
        ));
    }

    // ── BODY VERBATIM FROM watcher.rs:403-642 (start_watching) ──
    //
    // The exact 700-line body — debounce + notify + WSL2 polling
    // fallback + inline-init read + record_event_diag wiring — copies
    // here with these substitutions only:
    //
    //   parse_statusline(&sid, &c)  →  adapter.parse_status(&sid, &c)
    //   validate_transcript_path(p) →  adapter.validate_transcript(p)
    //   start_tailing(app, sid, path, cwd)
    //     →  ts.start_or_replace(adapter.clone(), app, sid, path, cwd)
    //   construct WatcherHandle with the new fields
    //     (_watcher: Some(watcher), transcript_state: ts.clone(),
    //      session_id: session_id.clone())
    //
    // The TranscriptState reference comes from
    // app.state::<TranscriptState>() exactly as today.

    let ts: tauri::State<'_, TranscriptState> = app.state::<TranscriptState>();
    let transcript_state_for_handle = (*ts).clone();

    // … the rest of start_watching's body, lifted verbatim …

    // After constructing the notify watcher and spawning the poll thread:
    let handle = WatcherHandle {
        _watcher: Some(watcher),
        stop_flag,
        join_handle: poll_join_handle,
        transcript_state: transcript_state_for_handle,
        session_id: session_id.clone(),
        #[cfg(debug_assertions)]
        session_id_for_log: session_id.clone(),
    };

    state.insert(session_id, handle);
    Ok(())
}
```

The actual body of `start_for` is mechanical — open `watcher.rs:403-642` in one pane and base.rs in the other; copy the body line-by-line, applying the four substitutions listed above. Where today's body calls `validate_transcript_path` directly (in `maybe_start_transcript` which lives at `watcher.rs:320-393`), inline that helper into `start_for` or move it as a private fn in `base.rs`, calling `adapter.validate_transcript` instead of the Claude-specific helper.

The `maybe_start_transcript` helper itself moves into `base.rs` as a private fn that takes `adapter: &Arc<dyn AgentAdapter<R>>` and calls `state.start_or_replace(adapter.clone(), ...)`.

- [ ] **Step 2: Reduce `agent/watcher.rs` to a stub for the duration of this task.**

Tasks 11 and 12 remove watcher.rs entirely. For now, replace `start_watching` and `start_agent_watcher` / `stop_agent_watcher` (the Tauri commands) with calls into `base::start_for` so existing imports keep resolving:

```rust
//! Stub — full body moved to adapter::base. This file is deleted in Task 12.

pub use crate::agent::adapter::base::{AgentWatcherState, WatcherHandle};

#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AgentWatcherState>,
    pty_state: tauri::State<'_, crate::terminal::PtyState>,
    session_id: String,
) -> Result<(), String> {
    use std::sync::Arc;
    use crate::agent::adapter::AgentAdapter;
    use crate::agent::detector::detect_agent;

    let cwd = pty_state.get_cwd(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;
    let pid = pty_state.get_pid(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;
    let agent_type = detect_agent(pid)
        .map(|(t, _)| t)
        .ok_or_else(|| format!("no agent detected in PTY session {}", session_id))?;

    let adapter: Arc<dyn AgentAdapter<tauri::Wry>> =
        <dyn AgentAdapter<tauri::Wry>>::for_type(agent_type)?;
    adapter.start(app_handle, session_id, std::path::PathBuf::from(cwd), (*state).clone())
}

#[tauri::command]
pub async fn stop_agent_watcher(
    state: tauri::State<'_, AgentWatcherState>,
    session_id: String,
) -> Result<(), String> {
    if state.remove(&session_id) {
        log::info!("Stopped watching statusline for session {}", session_id);
        Ok(())
    } else {
        Err(format!("No active watcher for session: {}", session_id))
    }
}
```

This file is a thin shim until Task 12 deletes it; the inherent impl block (`for_type`, `start`, `stop`) referenced here lands in Task 11.

- [ ] **Step 3: Add the inherent impl block on `dyn AgentAdapter<R>` in `adapter/mod.rs`.**

NOTE: Task 11 is the canonical home for this. Pull it forward to step 3 here so Task 10's stub `start_agent_watcher` compiles. Append to `adapter/mod.rs`:

```rust
impl<R: tauri::Runtime> dyn AgentAdapter<R> {
    pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter)),
            other => Ok(Arc::new(NoOpAdapter::new(other))),
        }
    }

    pub fn start(
        self: Arc<Self>,
        app: AppHandle<R>,
        session_id: String,
        cwd: PathBuf,
        state: base::AgentWatcherState,
    ) -> Result<(), String> {
        crate::agent::adapter::base::start_for(self, app, session_id, cwd, state)
    }

    pub fn stop(state: &base::AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
    }
}
```

- [ ] **Step 4: Verify build.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors. The orchestration body now lives in `base.rs`; `watcher.rs` is a thin Tauri-command shim.

- [ ] **Step 5: Run the full test suite.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green. **Critical milestone** — if anything fails, the diff between watcher.rs (old) and base.rs (new) has drift. Diff carefully against `git show HEAD~1:src-tauri/src/agent/watcher.rs` to find the substitution that introduced the regression.

- [ ] **Step 6: Run the manual acceptance test (per spec's Acceptance test section).**

Start a Claude Code session under Vimeflow on a workspace with a JSONL transcript that exercises `tool_use` + `tool_result` + a `vitest` test run. Compare:

- `Vimeflow.log` lines for `watcher.event` / `watcher.slow_event` / `watcher.tx_path_change` / `watcher.handle.dropped` against a baseline run on `main` (saved before starting Task 10).
- Frontend `agent-status`, `agent-tool-call`, `agent-turn`, `test-run` events — payloads identical (compare via dev-tools network capture or a tap added temporarily).

Expected: byte-identical event payloads, equivalent `Vimeflow.log` lines (timing fluctuations OK).

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor(agent/adapter): move start_watching into base::start_for

Verbatim move of watcher.rs:403-642 (start_watching) and the
surrounding state.remove + log + state.insert flow into
adapter::base::start_for<R>, with the four allowed substitutions:
parse_statusline → adapter.parse_status, validate_transcript_path
→ adapter.validate_transcript, status-file-path construction →
adapter.status_source + first-run-safe trust_root canonicalize-
and-verify, start_tailing → state.start_or_replace(adapter.clone(),
...). WatcherHandle gains _watcher: Option<RecommendedWatcher> +
transcript_state: TranscriptState + session_id: String + Drop
cascade so dropping the handle stops notify callbacks first, then
joins the poll thread, then stops the transcript registry — makes
Task 13's stop_transcript_watcher IPC removal safe.

watcher.rs reduced to a stub Tauri-command file pending deletion
in Task 12."
```

---

## Task 11: Move Tauri Commands into `adapter/mod.rs`

**Goal:** Move `start_agent_watcher` / `stop_agent_watcher` from `watcher.rs` into `adapter/mod.rs` so `watcher.rs` can be deleted in Task 12.

**Files:**

- Modify: `src-tauri/src/agent/adapter/mod.rs` (add the Tauri command bodies)
- Modify: `src-tauri/src/agent/watcher.rs` (remove the command bodies — only `pub use` re-exports remain)
- Modify: `src-tauri/src/lib.rs` (update `tauri::generate_handler![...]` + the import path if needed)

- [ ] **Step 1: Move the two Tauri command bodies from `watcher.rs` to `adapter/mod.rs`.**

Cut from `src-tauri/src/agent/watcher.rs`:

```rust
#[tauri::command]
pub async fn start_agent_watcher(...) -> Result<(), String> { ... }

#[tauri::command]
pub async fn stop_agent_watcher(...) -> Result<(), String> { ... }
```

Paste into `src-tauri/src/agent/adapter/mod.rs`.

- [ ] **Step 2: Update `agent/mod.rs` re-exports.**

```rust
// Before:
pub use watcher::{start_agent_watcher, stop_agent_watcher, AgentWatcherState};

// After:
pub use adapter::{start_agent_watcher, stop_agent_watcher, AgentWatcherState};
```

(Or via `pub use adapter::base::AgentWatcherState;` if more readable; both resolve identically.)

- [ ] **Step 3: Verify `lib.rs` still compiles.**

```bash
cd src-tauri && cargo check --all-features
```

Expected: 0 errors. `lib.rs:8` imports through `agent::{...}` and the re-exports keep its import path stable.

- [ ] **Step 4: Run the test suite.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor(agent/adapter): move Tauri commands into adapter/mod.rs

start_agent_watcher / stop_agent_watcher relocate from watcher.rs
to adapter/mod.rs alongside the inherent impl block. watcher.rs is
now empty pending deletion in Task 12."
```

---

## Task 12: Delete `agent/watcher.rs`

**Goal:** Final cleanup — the file is empty (or only re-exports) after Task 11.

**Files:**

- Delete: `src-tauri/src/agent/watcher.rs`
- Modify: `src-tauri/src/agent/mod.rs` (remove `pub mod watcher;`)

- [ ] **Step 1: Confirm `watcher.rs` has nothing live.**

```bash
cat src-tauri/src/agent/watcher.rs
```

Expected: only doc-comments and / or `pub use` re-exports. If anything else remains, that's a leak from Tasks 10-11; resolve before deleting.

- [ ] **Step 2: Delete the file.**

```bash
git rm src-tauri/src/agent/watcher.rs
```

- [ ] **Step 3: Update `agent/mod.rs`.**

Remove `pub mod watcher;` (or `mod watcher;`) from `src-tauri/src/agent/mod.rs`.

- [ ] **Step 4: Verify build + tests.**

```bash
cd src-tauri && cargo test --workspace --all-features
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor(agent): delete watcher.rs

All bodies moved to adapter/base.rs (orchestration) and
adapter/mod.rs (Tauri commands) in Tasks 10-11. The file's only
remaining content was re-exports, now redundant with agent/mod.rs's
direct re-exports from adapter."
```

---

## Task 13: Delete `start_transcript_watcher` / `stop_transcript_watcher` Tauri Commands + Frontend Cleanup

**Goal:** Remove the IPC surface that's superseded by the `WatcherHandle::Drop` cascade from Task 10. Frontend deletes its `stop_transcript_watcher` invoke in the same commit.

**Files:**

- Modify: `src-tauri/src/agent/adapter/claude_code/transcript.rs` (delete the Tauri command bodies if any remain; if they were already inlined into the move in Task 7, this step is empty)
- Modify: `src-tauri/src/lib.rs` (remove from `tauri::generate_handler![...]`)
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts` (delete the `invoke('stop_transcript_watcher')` block)

- [ ] **Step 1: Locate any remaining `#[tauri::command] pub async fn start_transcript_watcher` / `stop_transcript_watcher` definitions.**

```bash
cd src-tauri && rg "start_transcript_watcher|stop_transcript_watcher" src/
```

Wherever they live (likely `claude_code/transcript.rs` after the moves), delete the function definitions and any `pub use` re-exports.

- [ ] **Step 2: Remove from `lib.rs`'s `tauri::generate_handler![...]`.**

Open `src-tauri/src/lib.rs:93-94` and `:117-118` (the four lines mentioning these commands per the spec's earlier reference). Delete those lines.

- [ ] **Step 3: Delete the frontend `invoke` block.**

Open `src/features/agent-status/hooks/useAgentStatus.ts:53-58`. Delete:

```ts
try {
  await invoke('stop_transcript_watcher', { sessionId: ptyId })
} catch {
  // Transcript watcher may not be running — ignore
}
```

The surrounding `stopWatchers` function reduces to just the `stop_agent_watcher` invoke.

- [ ] **Step 4: Run the full Rust + TypeScript test suites.**

```bash
cd src-tauri && cargo test --workspace --all-features
cd .. && npm run test
```

Expected: all green.

- [ ] **Step 5: Manual acceptance test.**

Run a Claude Code session, let it complete a turn with a transcript event, exit, and verify the agent panel collapses (5s hold then hide). Then run a Codex session, verify the panel shows the agent type, exit Codex, verify the panel collapses (this exercises the NoOpAdapter path).

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(agent): drop start/stop_transcript_watcher IPC

WatcherHandle::Drop's transcript_state.stop cascade (added in
Task 10) replaces the frontend-driven 'stop watcher then stop
transcript' two-step. lib.rs's generate_handler! list shrinks by
two; useAgentStatus.ts's stopWatchers loses one invoke."
```

---

## Task 14: Final Acceptance Pass

**Goal:** End-to-end verification that the refactor preserved every Stage 1 invariant.

- [ ] **Step 1: Re-read the spec's "Behavioral Invariants" section.**

Open `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md` and walk through invariants 1-9. For each, locate the test or manual check that proves it.

- [ ] **Step 2: Run the full test suite one final time.**

```bash
cd src-tauri && cargo test --workspace --all-features
cd .. && npm run test
npm run lint
npm run type-check
```

Expected: all green. No new warnings.

- [ ] **Step 3: Run `cargo clippy` to surface any warnings the refactor introduced.**

```bash
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings
```

Expected: 0 warnings.

- [ ] **Step 4: Manual integration check — Claude session.**

Boot Vimeflow, run `claude` in a workspace with a vitest project, exercise tool calls + a test run. Verify the agent panel populates correctly (model, context window, token cache, activity feed, test results). Compare events to a `main`-baseline capture if available.

- [ ] **Step 5: Manual integration check — Codex session (NoOpAdapter path).**

Boot Vimeflow, run `codex` in a workspace. Verify the agent panel shows the agent type as "codex" but no events fire. Exit codex. Verify the panel collapses after the 5s hold. (This is the NoOpAdapter exercising the same lifecycle as today's silent no-op.)

- [ ] **Step 6: Verify acceptance grep — no stale `obj.get(...).and_then(|v| v.as_*())` chains in adapter parsers.**

```bash
cd src-tauri && rg "and_then\(\|v\| v\.as_(u64|f64|str|object)\(\)\)" src/agent/adapter/
```

Expected: zero results.

- [ ] **Step 7: Open a PR.**

```bash
gh pr create --title "refactor(agent): introduce AgentAdapter abstraction (Stage 1)" --body "$(cat <<'EOF'
## Summary

- Introduces `AgentAdapter<R: tauri::Runtime>` trait with 5 provider hooks
- Migrates Claude Code logic behind `ClaudeCodeAdapter` (relocated to `agent/adapter/claude_code/`)
- Adds `NoOpAdapter` for Codex/Aider so today's silent-no-op UX survives
- Watcher orchestration body moves into `agent/adapter/base.rs::start_for<R>`
- `WatcherHandle::Drop` now cascades to transcript shutdown — replaces the frontend-driven two-step stop and lets us drop two Tauri commands

## Spec

Spec lives at `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md` and went through six Codex review rounds before implementation.

## Test plan

- [x] `cargo test --workspace --all-features` green
- [x] `npm run test` green
- [x] `cargo clippy -- -D warnings` clean
- [x] Manual: Claude Code session — events identical to baseline
- [x] Manual: Codex session — agent panel collapses correctly on exit (NoOpAdapter path)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

Walking through the spec's sections to confirm coverage:

- **Context / Goal / Non-Goals / Behavioral Invariants** — covered by the plan's pre-flight read of the spec; Task 14 verifies invariants.
- **Architecture / `AgentAdapter` deep module** — Task 4 (trait skeleton), Task 11 (inherent impl).
- **Rust shape (impl on `dyn`, free helper)** — Tasks 4, 10, 11.
- **File / module layout** — Tasks 1-7 effect the moves; Tasks 11-12 finalize.
- **Trait surface (5 hooks)** — Task 4 declares; Task 8 implements.
- **Provider-hook types (`StatusSource`, `ParsedStatus`)** — Task 3.
- **Shared parse primitives (`adapter/json.rs`)** — Task 2 with TDD; Tasks 6+7 consume them.
- **Visibility (`pub` module, `pub #[doc(hidden)]` for test surface)** — Task 9 lifts with the right markers.
- **Factory + `NoOpAdapter`** — Task 8 (NoOpAdapter struct + impl); Task 11 (factory body in `for_type`).
- **Tauri command surface** — Tasks 11-13.
- **Frontend touch** — Task 13 step 3.
- **Test strategy (unit + integration + MockAdapter)** — covered through Tasks 2, 8, 9 (integration test edits), and the MockAdapter test infrastructure mentioned in Task 10 step 5 (relies on the existing `mock_builder()` plumbing). The full MockAdapter/test-injection design is left as exercises within each task because Stage 1's test surface is dominantly the existing tests, not new ones.
- **Migration steps 1-14** — Tasks 1-14 are 1:1 with the spec's migration steps.
- **IDEAs (Behavioral drift / NoOpAdapter / etc.)** — informing the substitution rules in Task 10 and the rationale comments in Task 8's NoOpAdapter struct.

**Placeholder scan:** No `TBD`, `TODO`, `fill in later`, or "similar to Task N" placeholders. Task 10 steps 1 + 2 reference the spec's substitution list explicitly rather than re-quoting 700 lines of code; that's intentional — the body is verbatim from `watcher.rs`, and copying it inline would balloon the plan without adding signal.

**Type / signature consistency:** `start_or_replace<R>` adds `Arc<dyn AgentAdapter<R>>` as its first arg consistently across Tasks 9 + 10. `WatcherHandle`'s field additions (`_watcher: Option<RecommendedWatcher>`, `transcript_state: TranscriptState`, `session_id: String`) appear consistently in Task 10's struct definition and the Drop impl. `for_type` signature `fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String>` is stable across Task 8 and Task 11.

**Spec requirement → task mapping** complete. No gaps.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-claude-adapter-refactor-stage-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because Task 10 is the high-risk step and benefits from a clean reviewer pass against `watcher.rs` before merge.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster but loses the per-task fresh-context property.

**Which approach?**
