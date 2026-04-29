# Tests Panel & Claude Code Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `<TestResults>` placeholder into a real, activity-driven panel that surfaces test runs and test-file creation from Claude Code via passive transcript parsing.

**Architecture:** Extend the existing transcript-watcher pipeline (#56/#63) to (a) recognise Bash tool calls invoking a known test runner and parse their result content into a structured `TestRunSnapshot`, emitted over a new `test-run` Tauri event; (b) tag Write/Edit tool calls whose `file_path` is a test file via a new `is_test_file: bool` on `AgentToolCallEvent`. UI is lazy/activity-driven: a slim placeholder until first event, then a live panel with proportional bar and per-file/group rows.

**Tech Stack:** Rust (Tauri 2 backend), TypeScript + React 18 (frontend), Vitest + RTL for tests, `shell-words` and `regex` crates (new deps), `chrono` (already present, used for ISO 8601 parsing).

**Spec:** `docs/superpowers/specs/2026-04-28-tests-panel-bridge-design.md` — read this first if any task is unclear.

---

## File Structure

### New Rust files (all under `src-tauri/src/agent/test_runners/`)

| File                    | Responsibility                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`                | Module root, registry export, public matching API                                                                                     |
| `types.rs`              | `TestRunSnapshot`, `TestRunSummary`, `TestGroup`, `TestRunStatus`, `TestGroupKind`, `TestGroupStatus`, `CapturedOutput`, `TestRunner` |
| `script_resolution.rs`  | Read `package.json` and resolve `scripts.<name>` with depth-3 recursion bound                                                         |
| `test_file_patterns.rs` | `is_test_file(path: &str) -> bool` — filename-suffix and directory-position checks for ts/js/rs/py/go test conventions                |
| `timestamps.rs`         | `parse_iso8601_ms` (chrono-backed), `compute_duration_ms`                                                                             |
| `path_resolution.rs`    | `resolve_group_path` with `..`/absolute rejection + canonical containment check                                                       |
| `sanitiser.rs`          | `sanitize_for_ui` — KEY=value, Bearer, Authorization, sk*/pk*, JWT redaction (regex-backed)                                           |
| `preview.rs`            | `build_command_preview` — joins stripped tokens, runs through sanitiser, truncates to 120 chars                                       |
| `matcher.rs`            | `match_command` — tokenize, strip env, segment-split, strip wrappers, resolve script aliases, walk `RUNNERS`                          |
| `emitter.rs`            | `TestRunEmitter` — per-tail-loop helper, latest-wins replay batching                                                                  |
| `vitest.rs`             | `VITEST` runner: `matches` + `parse_result`                                                                                           |
| `cargo.rs`              | `CARGO_TEST` runner: `matches` + `parse_result`                                                                                       |

### Modified Rust files

| File                                | Change                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/agent/types.rs`      | Add `is_test_file: bool` to `AgentToolCallEvent`                                                                                                                                       |
| `src-tauri/src/agent/transcript.rs` | Extend `InFlightToolCall` (`test_runner`, `raw_command`); add CWD threading; modify `process_assistant_message` and `process_tool_result`; integrate `TestRunEmitter` into `tail_loop` |
| `src-tauri/src/agent/watcher.rs`    | Pass resolved CWD to `TranscriptState::start_or_replace`                                                                                                                               |
| `src-tauri/src/agent/mod.rs`        | Add `pub mod test_runners;`                                                                                                                                                            |
| `src-tauri/Cargo.toml`              | Add `shell-words` and `regex` deps                                                                                                                                                     |

### Modified TypeScript files

| File                                                                                           | Change                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/agent-status/types/index.ts`                                                     | Add `TestRunSnapshot`, `TestRunSummary`, `TestGroup`, `TestRunStatus`, `TestGroupKind`, `TestGroupStatus`; add `testRun: TestRunSnapshot \| null` to `AgentStatus`; add `isTestFile: boolean` to `RecentToolCall` |
| `src/features/agent-status/types/activityEvent.ts`                                             | Add `isTestFile?: boolean` to `ActivityEvent`                                                                                                                                                                     |
| `src/features/agent-status/hooks/useAgentStatus.ts`                                            | Add `testRun: null` to `createDefaultStatus`; add `test-run` listener inside `subscribe()`; propagate `isTestFile` on tool-call events                                                                            |
| `src/features/agent-status/components/TestResults.tsx`                                         | Full rewrite — single nullable `snapshot` prop, placeholder + live sub-components                                                                                                                                 |
| `src/features/agent-status/components/AgentStatusPanel.tsx`                                    | Remove `placeholderTests` const; add `onOpenFile` prop; pass `status.testRun`                                                                                                                                     |
| `src/features/agent-status/utils/toolCallsToEvents.ts`                                         | Propagate `isTestFile` to `ActivityEvent`                                                                                                                                                                         |
| `src/features/agent-status/components/ActivityFeed.tsx` (or whichever sibling renders the row) | Render `🧪 Created test:` / `🧪 Updated test:` when `event.isTestFile === true`                                                                                                                                   |
| `src/features/workspace/WorkspaceView.tsx`                                                     | Add `handleOpenTestFile` (mirrors `handleFileSelect` dirty-state guard); pass to `AgentStatusPanel`                                                                                                               |

### Test files (co-located, `.test.ts(x)` siblings)

All existing tests for modified files get extended; all new files get their own test file.

---

## Task 1: Rust types and module skeleton

Set up the new `test_runners/` module with all types defined and stubs for the runners. Compile-only — no parsing logic yet.

**Files:**

- Create: `src-tauri/src/agent/test_runners/mod.rs`
- Create: `src-tauri/src/agent/test_runners/types.rs`
- Create: `src-tauri/src/agent/test_runners/vitest.rs`
- Create: `src-tauri/src/agent/test_runners/cargo.rs`
- Modify: `src-tauri/src/agent/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add new dependencies**

Edit `src-tauri/Cargo.toml` — add to `[dependencies]`:

```toml
shell-words = "1.1"
regex = "1.10"
once_cell = "1.19"
```

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Builds successfully with new deps fetched.

- [ ] **Step 2: Create `types.rs` with all data types**

Create `src-tauri/src/agent/test_runners/types.rs`:

```rust
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestRunSnapshot {
    pub session_id: String,
    pub runner: String,
    pub command_preview: String,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u64,
    pub status: TestRunStatus,
    pub summary: TestRunSummary,
    pub output_excerpt: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TestRunStatus {
    Pass,
    Fail,
    NoTests,
    Error,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TestRunSummary {
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub total: u32,
    pub groups: Vec<TestGroup>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestGroup {
    pub label: String,
    pub path: Option<String>,
    pub kind: TestGroupKind,
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub total: u32,
    pub status: TestGroupStatus,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestGroupKind {
    File,
    Suite,
    Module,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestGroupStatus {
    Pass,
    Fail,
    Skip,
}

/// Bash tool_result content captured for a matched test-run tool_use.
pub struct CapturedOutput {
    pub content: String,
    pub is_error: bool,
}

pub struct TestRunner {
    pub name: &'static str,
    pub matches: fn(tokens: &[&str]) -> bool,
    pub parse_result: fn(out: &CapturedOutput, cwd: &Path) -> Option<TestRunSummary>,
}
```

- [ ] **Step 3: Create stub runners**

Create `src-tauri/src/agent/test_runners/vitest.rs`:

```rust
use std::path::Path;

use super::types::{CapturedOutput, TestRunSummary, TestRunner};

pub static VITEST: TestRunner = TestRunner {
    name: "vitest",
    matches: vitest_matches,
    parse_result: vitest_parse_result,
};

fn vitest_matches(tokens: &[&str]) -> bool {
    matches!(tokens.first(), Some(&"vitest"))
}

fn vitest_parse_result(_out: &CapturedOutput, _cwd: &Path) -> Option<TestRunSummary> {
    // Implemented in Task 5
    None
}
```

Create `src-tauri/src/agent/test_runners/cargo.rs`:

```rust
use std::path::Path;

use super::types::{CapturedOutput, TestRunSummary, TestRunner};

pub static CARGO_TEST: TestRunner = TestRunner {
    name: "cargo",
    matches: cargo_matches,
    parse_result: cargo_parse_result,
};

fn cargo_matches(tokens: &[&str]) -> bool {
    matches!(tokens, [&"cargo", &"test", ..])
}

fn cargo_parse_result(_out: &CapturedOutput, _cwd: &Path) -> Option<TestRunSummary> {
    // Implemented in Task 10
    None
}
```

- [ ] **Step 4: Create `mod.rs` with registry**

Create `src-tauri/src/agent/test_runners/mod.rs`:

```rust
pub mod cargo;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
```

- [ ] **Step 5: Wire module into `agent/mod.rs`**

Edit `src-tauri/src/agent/mod.rs` — add the module declaration. Find the existing `pub mod` block and add:

```rust
pub mod test_runners;
```

- [ ] **Step 6: Build the workspace**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Builds cleanly. Some `dead_code` warnings on unused stubs are acceptable for now.

- [ ] **Step 7: Add a smoke test for matchers**

Create `src-tauri/src/agent/test_runners/types.rs` test module at the bottom of `vitest.rs` and `cargo.rs`:

In `vitest.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vitest_matches_first_token() {
        assert!((VITEST.matches)(&["vitest"]));
        assert!((VITEST.matches)(&["vitest", "run", "src/foo.test.ts"]));
        assert!(!(VITEST.matches)(&["jest"]));
        assert!(!(VITEST.matches)(&[]));
    }
}
```

In `cargo.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cargo_matches_cargo_test() {
        assert!((CARGO_TEST.matches)(&["cargo", "test"]));
        assert!((CARGO_TEST.matches)(&["cargo", "test", "--release"]));
        assert!(!(CARGO_TEST.matches)(&["cargo", "build"]));
        assert!(!(CARGO_TEST.matches)(&["cargo"]));
        assert!(!(CARGO_TEST.matches)(&[]));
    }
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners`
Expected: 2 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml \
        src-tauri/src/agent/mod.rs \
        src-tauri/src/agent/test_runners/
git commit -m "feat(agent): scaffold test_runners module with type skeleton

Adds the test_runners module with TestRunSnapshot, TestRunSummary,
TestGroup, status enums, and stub VITEST + CARGO_TEST runners.
Parsers return None — implemented in later tasks. Adds shell-words,
regex, once_cell as dependencies."
```

---

## Task 2: CWD threading through TranscriptWatcher

The transcript parser needs CWD inside `tail_loop` to (a) resolve `npm test` script aliases, (b) build absolute paths for test-file groups. This task threads `Option<PathBuf>` through the watcher.

**Files:**

- Modify: `src-tauri/src/agent/transcript.rs` (struct, `start_or_replace`, `start_tailing`, `tail_loop`)
- Modify: `src-tauri/src/agent/watcher.rs` (caller passes CWD)

- [ ] **Step 1: Write the failing test for `start_or_replace` accepting CWD**

In `src-tauri/src/agent/transcript.rs`, find the existing `transcript_state_replaces_changed_path` test in the `#[cfg(test)] mod tests` block (around line 596) and add a new test:

```rust
#[test]
fn transcript_state_threads_cwd_through() {
    let app = tauri::test::mock_builder()
        .build(tauri::generate_context!())
        .expect("failed to build test app");
    let tmp = tempfile::tempdir().expect("failed to create temp dir");
    let transcript_path = tmp.path().join("t.jsonl");
    std::fs::write(&transcript_path, "").expect("failed to write transcript");
    let cwd = tmp.path().to_path_buf();

    let state = TranscriptState::new();
    let session_id = "session-cwd".to_string();

    let status = state
        .start_or_replace(
            app.handle().clone(),
            session_id.clone(),
            transcript_path,
            Some(cwd),
        )
        .expect("failed to start watcher with cwd");
    assert_eq!(status, TranscriptStartStatus::Started);

    state.stop(&session_id).expect("failed to stop watcher");
}
```

- [ ] **Step 2: Run test to confirm it fails to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml transcript_state_threads_cwd_through`
Expected: Fails — `start_or_replace` does not accept a 4th `Option<PathBuf>` argument.

- [ ] **Step 3: Add `cwd` to `TranscriptWatcher` struct**

Edit `src-tauri/src/agent/transcript.rs`. Find the existing struct (around line 68):

```rust
struct TranscriptWatcher {
    transcript_path: PathBuf,
    handle: TranscriptHandle,
}
```

Replace with:

```rust
struct TranscriptWatcher {
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
    handle: TranscriptHandle,
}
```

- [ ] **Step 4: Add `cwd` parameter to `TranscriptState::start_or_replace` and `start`**

Edit `src-tauri/src/agent/transcript.rs`. Replace `start` (around line 112):

```rust
pub fn start<R: tauri::Runtime>(
    &self,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
) -> Result<(), String> {
    let _ = self.start_or_replace(app_handle, session_id, transcript_path, cwd)?;
    Ok(())
}
```

Replace `start_or_replace` signature (around line 123):

```rust
pub fn start_or_replace<R: tauri::Runtime>(
    &self,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
) -> Result<TranscriptStartStatus, String> {
```

Inside the function, both `watchers.insert(…)` calls now also need `cwd`. Replace the two `TranscriptWatcher { transcript_path, handle: … }` constructors with `TranscriptWatcher { transcript_path: transcript_path.clone(), cwd: cwd.clone(), handle: … }` (the `clone()` on `cwd` is needed because both branches consume it; `Option<PathBuf>` is `Clone`). And the call to `start_tailing(...)` adds `cwd.clone()` as a 4th argument.

- [ ] **Step 5: Add `cwd` parameter to `start_tailing` and `tail_loop`**

Edit `src-tauri/src/agent/transcript.rs`. Replace `start_tailing` signature (around line 219):

```rust
pub fn start_tailing<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
) -> Result<TranscriptHandle, String> {
    let file = File::open(&transcript_path).map_err(|e| {
        format!(
            "Failed to open transcript: {}: {}",
            transcript_path.display(),
            e
        )
    })?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    let join_handle = std::thread::spawn(move || {
        tail_loop(app_handle, session_id, cwd, file, stop_clone);
    });

    Ok(TranscriptHandle {
        stop_flag,
        join_handle: Some(join_handle),
    })
}
```

Replace `tail_loop` signature (around line 246):

```rust
fn tail_loop<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    _cwd: Option<PathBuf>,  // consumed in Task 4 — prefix with _ to silence unused warning for now
    file: File,
    stop_flag: Arc<AtomicBool>,
) {
```

Note: inside `tail_loop`, do NOT yet thread `cwd` to `process_line`. That happens in Task 4. The `_` prefix silences the unused-variable lint for now.

- [ ] **Step 6: Update `start_transcript_watcher` Tauri command**

Edit `src-tauri/src/agent/transcript.rs`. Replace the command (around line 565):

```rust
#[tauri::command]
pub async fn start_transcript_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, TranscriptState>,
    session_id: String,
    transcript_path: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let path = validate_transcript_path(&transcript_path)?;
    let cwd_path = cwd.map(PathBuf::from);
    state.start(app_handle, session_id, path, cwd_path)
}
```

- [ ] **Step 7: Update `watcher.rs` caller**

Edit `src-tauri/src/agent/watcher.rs`. Find the call to `ts.start_or_replace(...)` (around line 81). The CWD comes from `PtyState`'s resolved CWD (already available — fixed in #60). Update the call:

```rust
match ts.start_or_replace(
    app_handle.clone(),
    session_id.clone(),
    transcript_path,
    Some(resolved_cwd.clone()),  // resolved_cwd: PathBuf — already in scope at this call site
) {
```

If the existing local variable that holds the CWD is named differently (e.g. `cwd`, `pty_cwd`), use that name. Confirm via:

Run: `grep -n "resolved_cwd\\|cwd" src-tauri/src/agent/watcher.rs | head -20`

Use whichever local CWD variable is in scope at the `start_or_replace` call site.

- [ ] **Step 8: Update both existing tests in transcript.rs**

Edit `src-tauri/src/agent/transcript.rs`. The existing `transcript_state_replaces_changed_path` test calls `start_or_replace` three times — each call needs a 4th `None` argument:

```rust
let first_status = state
    .start_or_replace(app.handle().clone(), session_id.clone(), first_path.clone(), None)
    .expect("failed to start first transcript watcher");
// ...
let duplicate_status = state
    .start_or_replace(app.handle().clone(), session_id.clone(), first_path, None)
    .expect("failed to check duplicate transcript watcher");
// ...
let replaced_status = state
    .start_or_replace(app.handle().clone(), session_id.clone(), second_path, None)
    .expect("failed to replace transcript watcher");
```

- [ ] **Step 9: Run all transcript tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::transcript`
Expected: All tests pass, including the new `transcript_state_threads_cwd_through`.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/agent/transcript.rs src-tauri/src/agent/watcher.rs
git commit -m "refactor(agent): thread workspace cwd through TranscriptWatcher

Adds Option<PathBuf> cwd to TranscriptWatcher / start_or_replace /
start_tailing / tail_loop, and to the start_transcript_watcher Tauri
command. watcher.rs passes the PTY's resolved cwd. Consumed in
follow-up tasks for script-alias resolution and per-file path
resolution."
```

---

## Task 3: AgentToolCallEvent.is_test_file + test_file_patterns

Add the `is_test_file: bool` field to the existing `AgentToolCallEvent` and tag Write/Edit tool calls whose `file_path` matches a known test pattern. Smallest possible end-to-end backend→frontend slice — verifies the wire shape before any test-run plumbing.

**Files:**

- Create: `src-tauri/src/agent/test_runners/test_file_patterns.rs`
- Modify: `src-tauri/src/agent/types.rs` (add field)
- Modify: `src-tauri/src/agent/transcript.rs` (compute field; emit it)
- Modify: `src-tauri/src/agent/test_runners/mod.rs` (export module)
- Modify: `src/features/agent-status/types/index.ts` (add `isTestFile`)
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts` (propagate `isTestFile`)

- [ ] **Step 1: Write failing tests for `is_test_file`**

Create `src-tauri/src/agent/test_runners/test_file_patterns.rs`:

```rust
//! Test-file path matching. Frontend reads is_test_file: bool from
//! AgentToolCallEvent and renders accordingly — no JS-side glob.

/// Returns true if `path` matches a known test-file convention.
/// Matches on the basename and (for some languages) directory position.
pub fn is_test_file(path: &str) -> bool {
    let basename = path.rsplit('/').next().unwrap_or(path);

    // TS/JS: *.test.{ts,tsx,js,jsx,mjs,cjs} and *.spec.{...}
    if let Some(stem_end) = basename.rfind('.') {
        let ext = &basename[stem_end + 1..];
        let stem = &basename[..stem_end];
        if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs") {
            if let Some(inner_end) = stem.rfind('.') {
                let infix = &stem[inner_end + 1..];
                if infix == "test" || infix == "spec" {
                    return true;
                }
            }
        }
        // Rust: *_test.rs (cargo convention)
        if ext == "rs" && stem.ends_with("_test") {
            return true;
        }
        // Python: test_*.py and *_test.py (pytest convention)
        if ext == "py" && (stem.starts_with("test_") || stem.ends_with("_test")) {
            return true;
        }
        // Go: *_test.go
        if ext == "go" && stem.ends_with("_test") {
            return true;
        }
    }

    // Rust: anything inside a tests/ directory
    if path.contains("/tests/") || path.starts_with("tests/") {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ts_test_files_match() {
        assert!(is_test_file("src/foo.test.ts"));
        assert!(is_test_file("src/foo.test.tsx"));
        assert!(is_test_file("src/foo.spec.ts"));
        assert!(is_test_file("/abs/src/bar.test.mjs"));
        assert!(is_test_file("packages/x/src/baz.test.cjs"));
    }

    #[test]
    fn ts_non_test_files_dont_match() {
        assert!(!is_test_file("src/foo.ts"));
        assert!(!is_test_file("src/tests-helper.ts"));
        assert!(!is_test_file("test.txt"));
        assert!(!is_test_file("src/test.config.ts"));  // .test. but ext is .ts not .test.ts
    }

    #[test]
    fn rust_test_files_match() {
        assert!(is_test_file("src/foo_test.rs"));
        assert!(is_test_file("crates/x/tests/integration.rs"));
        assert!(is_test_file("tests/it.rs"));
    }

    #[test]
    fn rust_non_test_files_dont_match() {
        assert!(!is_test_file("src/foo.rs"));
        assert!(!is_test_file("src/test_helper.rs"));  // not _test.rs and not in tests/
    }

    #[test]
    fn python_test_files_match() {
        assert!(is_test_file("tests/test_foo.py"));
        assert!(is_test_file("src/foo_test.py"));
    }

    #[test]
    fn go_test_files_match() {
        assert!(is_test_file("pkg/foo_test.go"));
    }

    #[test]
    fn empty_and_weird_paths_dont_match() {
        assert!(!is_test_file(""));
        assert!(!is_test_file("/"));
        assert!(!is_test_file("foo"));
    }
}
```

Note: `is_test_file("src/test.config.ts")` returns false because the basename is `test.config.ts`, stem is `test.config`, infix (last dot's right side) is `config` — not `test`/`spec`. Good.

But `is_test_file("src/.test.ts")` — basename `.test.ts`, stem `.test`, inner_end is 0 (the leading dot), infix is `test` → returns true. That's a hidden file scenario; acceptable false positive (very rare).

- [ ] **Step 2: Wire module into mod.rs**

Edit `src-tauri/src/agent/test_runners/mod.rs`:

```rust
pub mod cargo;
pub mod test_file_patterns;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
```

- [ ] **Step 3: Run the test_file_patterns tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::test_file_patterns`
Expected: All 7 tests pass.

- [ ] **Step 4: Add `is_test_file` to `AgentToolCallEvent`**

Edit `src-tauri/src/agent/types.rs`. Find the `AgentToolCallEvent` struct and add the field:

```rust
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCallEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool: String,
    pub args: String,
    pub status: ToolCallStatus,
    pub timestamp: String,
    pub duration_ms: u64,
    pub is_test_file: bool,
}
```

If `Default` is derived/needed elsewhere, ensure new field is included.

- [ ] **Step 5: Set `is_test_file` in `process_assistant_message`**

Edit `src-tauri/src/agent/transcript.rs`. Find `process_assistant_message` (around line 335) where the `AgentToolCallEvent` is built (around line 377). Before the event construction, compute the flag:

```rust
let is_test_file = if matches!(name.as_str(), "Write" | "Edit") {
    item.get("input")
        .and_then(|v| v.get("file_path"))
        .and_then(|v| v.as_str())
        .map(|p| crate::agent::test_runners::test_file_patterns::is_test_file(p))
        .unwrap_or(false)
} else {
    false
};
```

Then add `is_test_file` to the event construction:

```rust
let event = AgentToolCallEvent {
    session_id: session_id.to_string(),
    tool_use_id: id,
    tool: name,
    args,
    status: ToolCallStatus::Running,
    timestamp: timestamp.clone(),
    duration_ms: 0,
    is_test_file,
};
```

Also add `is_test_file: false` in the `process_tool_result` event construction (around line 453) — the flag's relevance is on the originating tool_use, not the result event:

```rust
let event = AgentToolCallEvent {
    session_id: session_id.to_string(),
    tool_use_id,
    tool: tool_name,
    args,
    status,
    timestamp: timestamp.to_string(),
    duration_ms,
    is_test_file: false,
};
```

(For symmetry the running event carries the truth; the done/failed event mirrors what the frontend already has from the in-flight running event. Frontend uses the running-event flag to decide rendering.)

Wait — review the `useAgentStatus` mapping: for `running` status it sets `active: { tool, args, startedAt, toolUseId }` (no `is_test_file` propagated yet). For `done`/`failed`, it builds a `RecentToolCall { id, tool, args, status, durationMs, timestamp }`. The flag has to flow through one of these. Cleanest: include `is_test_file` on BOTH events with the same value (computed once at `process_assistant_message`, stored on `InFlightToolCall`, copied into `process_tool_result` event). That avoids the frontend needing to remember running-side state when only the done-side event drives the activity feed.

Revised: extend `InFlightToolCall` with `is_test_file: bool`. `process_assistant_message` writes it; `process_tool_result` reads from `call.is_test_file` and passes to the done event.

Edit `InFlightToolCall` (around line 54):

```rust
struct InFlightToolCall {
    started_at: Instant,
    tool: String,
    args: String,
    is_test_file: bool,
}
```

In `process_assistant_message`, the in-flight insert becomes:

```rust
in_flight.insert(
    id.clone(),
    InFlightToolCall {
        started_at: now,
        tool: name.clone(),
        args: args.clone(),
        is_test_file,
    },
);
```

In `process_tool_result` (after `let Some(call) = in_flight.remove(...)`):

```rust
let is_test_file = call.is_test_file;
// ...existing extraction of duration_ms, tool_name, args, status...
let event = AgentToolCallEvent {
    session_id: session_id.to_string(),
    tool_use_id,
    tool: tool_name,
    args,
    status,
    timestamp: timestamp.to_string(),
    duration_ms,
    is_test_file,
};
```

Both running and done events now carry the same flag.

- [ ] **Step 6: Update existing test fixtures in transcript.rs that build InFlightToolCall**

Edit `src-tauri/src/agent/transcript.rs`. Find the test helpers around lines 824 and 830 that build `InFlightToolCall { started_at, tool, args }` — add `is_test_file: false` to each:

```rust
InFlightToolCall {
    started_at: Instant::now(),
    tool: "Read".to_string(),
    args: "src/foo.rs".to_string(),
    is_test_file: false,
}
```

(Replace `Read`/`src/foo.rs` with whatever the existing fixtures use; just add the new field.)

- [ ] **Step 7: Run all backend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent`
Expected: All tests pass.

- [ ] **Step 8: Update TS types — add `isTestFile`**

Edit `src/features/agent-status/types/index.ts`. Find the `RecentToolCall` interface (and `ActiveToolCall` if it carries the same fields) and add:

```typescript
export interface RecentToolCall {
  id: string
  tool: string
  args: string
  status: ToolCallStatus
  durationMs: number | null
  timestamp: string
  isTestFile: boolean
}
```

Find or add the corresponding event type used by the listener:

```typescript
export interface AgentToolCallEvent {
  sessionId: string
  toolUseId: string
  tool: string
  args: string
  status: ToolCallStatus
  timestamp: string
  durationMs: number
  isTestFile: boolean
}
```

(If `AgentToolCallEvent` already exists with all fields except `isTestFile`, just add the field.)

- [ ] **Step 9: Propagate `isTestFile` in `useAgentStatus`**

Edit `src/features/agent-status/hooks/useAgentStatus.ts`. Find the `agent-tool-call` listener (around line 258). In the `done`/`failed` branch where `recentCall` is constructed, add `isTestFile`:

```typescript
const recentCall: RecentToolCall = {
  id: p.toolUseId,
  tool: p.tool,
  args: p.args,
  status: p.status,
  durationMs: Number(p.durationMs) || null,
  timestamp: p.timestamp,
  isTestFile: p.isTestFile,
}
```

The `running` branch sets `active` (which doesn't carry `isTestFile` today since the activity feed is driven by `recentToolCalls`). Leave the `active` shape unchanged.

- [ ] **Step 10: Add a hook test for `isTestFile` propagation**

Edit `src/features/agent-status/hooks/useAgentStatus.test.tsx` (or create it if missing — co-located with the hook).

Add a test that:

1. Mounts `useAgentStatus(sessionId)`
2. Mocks `getPtySessionId` to return a known PTY id
3. Fires a mocked `agent-tool-call` listener with `status: 'done'`, `isTestFile: true`
4. Asserts `result.current.recentToolCalls[0].isTestFile === true`

```typescript
test('propagates isTestFile from agent-tool-call event to recentToolCalls', async () => {
  const PTY_ID = 'pty-abc'
  vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

  let toolCallHandler:
    | ((e: { payload: AgentToolCallEvent }) => void)
    | undefined
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    if (event === 'agent-tool-call') {
      toolCallHandler = handler as never
    }
    return () => undefined
  })

  const { result } = renderHook(() => useAgentStatus('ws-1'))
  await waitFor(() => expect(toolCallHandler).toBeDefined())

  act(() => {
    toolCallHandler?.({
      payload: {
        sessionId: PTY_ID,
        toolUseId: 'tu_1',
        tool: 'Write',
        args: 'src/foo.test.ts',
        status: 'done',
        timestamp: '2026-04-28T12:00:00Z',
        durationMs: 100,
        isTestFile: true,
      },
    })
  })

  expect(result.current.recentToolCalls[0]?.isTestFile).toBe(true)
})
```

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.tsx`
Expected: New test passes; existing tests continue to pass.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/agent/test_runners/ \
        src-tauri/src/agent/types.rs \
        src-tauri/src/agent/transcript.rs \
        src/features/agent-status/types/index.ts \
        src/features/agent-status/hooks/useAgentStatus.ts \
        src/features/agent-status/hooks/useAgentStatus.test.tsx
git commit -m "feat(agent): tag Write/Edit of test files via is_test_file flag

Adds is_test_file: bool to AgentToolCallEvent. process_assistant_message
checks the FULL untruncated input.file_path against TEST_FILE patterns
(ts/tsx/js/jsx/mjs/cjs/rs/py/go test conventions) and tags the event.
Frontend hook propagates the flag to RecentToolCall. Activity feed
rendering of the flag lands in Task 11."
```

---

## Task 4: Matching algorithm

Implement the seven-step command matching algorithm: tokenize, strip env, segment-split, strip wrappers, resolve script aliases, walk runners. Each sub-function gets its own TDD cycle.

**Files:**

- Create: `src-tauri/src/agent/test_runners/matcher.rs`
- Create: `src-tauri/src/agent/test_runners/script_resolution.rs`
- Modify: `src-tauri/src/agent/test_runners/mod.rs` (export both)

- [ ] **Step 1: Test for tokenize/segment-split (failing)**

Create `src-tauri/src/agent/test_runners/matcher.rs`:

```rust
//! Command matching: tokenize → strip env → first segment → strip wrappers
//! → resolve script alias → match against RUNNERS.

use std::path::Path;

use super::script_resolution;
use super::types::TestRunner;
use super::RUNNERS;

/// Tokenize a command string into shell-words, returning None if the input
/// can't be parsed (e.g. unmatched quotes). None is treated as "no match"
/// downstream — never as a hard error — so we don't false-positive on weird
/// shell syntax we haven't seen before.
pub fn tokenize(cmd: &str) -> Option<Vec<String>> {
    shell_words::split(cmd).ok()
}

/// Drop leading KEY=VALUE assignments (env-style) until the first non-assignment.
pub fn strip_env_prefix(tokens: &[String]) -> &[String] {
    let mut i = 0;
    while i < tokens.len() {
        let t = &tokens[i];
        // KEY=value: must contain '=', and the part before '=' must look like
        // an identifier (letters/digits/underscore, not starting with digit).
        if let Some(eq) = t.find('=') {
            let key = &t[..eq];
            if !key.is_empty()
                && key.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                i += 1;
                continue;
            }
        }
        break;
    }
    &tokens[i..]
}

/// Take only the first command segment — split on &&, ;, ||, |.
pub fn first_segment<'a>(tokens: &'a [String]) -> &'a [String] {
    let separators = ["&&", "||", ";", "|"];
    for (i, t) in tokens.iter().enumerate() {
        if separators.contains(&t.as_str()) {
            return &tokens[..i];
        }
    }
    tokens
}

/// Strip leading wrapper prefixes one pass.
pub fn strip_wrappers<'a>(tokens: &'a [String]) -> &'a [String] {
    if tokens.is_empty() {
        return tokens;
    }
    match tokens[0].as_str() {
        "npx" => &tokens[1..],
        "pnpm" if tokens.get(1).map(String::as_str) == Some("exec") => &tokens[2..],
        "yarn" if tokens.get(1).map(String::as_str) == Some("exec") => &tokens[2..],
        "bun" if tokens.get(1).map(String::as_str) == Some("x") => &tokens[2..],
        "dotenv" if tokens.get(1).map(String::as_str) == Some("--") => &tokens[2..],
        _ => tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vec_of(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tokenize_simple_command() {
        assert_eq!(tokenize("vitest run"), Some(vec_of(&["vitest", "run"])));
    }

    #[test]
    fn tokenize_handles_quotes() {
        assert_eq!(
            tokenize(r#"vitest run "src/foo bar.test.ts""#),
            Some(vec_of(&["vitest", "run", "src/foo bar.test.ts"]))
        );
    }

    #[test]
    fn tokenize_unmatched_quote_returns_none() {
        assert_eq!(tokenize(r#"vitest "run"#), None);
    }

    #[test]
    fn strip_env_drops_assignments_only() {
        let tokens = vec_of(&["CI=1", "NODE_ENV=test", "vitest"]);
        assert_eq!(strip_env_prefix(&tokens), &tokens[2..]);
    }

    #[test]
    fn strip_env_does_not_drop_value_with_equals() {
        // "vitest" doesn't contain '=', so nothing stripped
        let tokens = vec_of(&["vitest", "--reporter=verbose"]);
        assert_eq!(strip_env_prefix(&tokens), &tokens[..]);
    }

    #[test]
    fn first_segment_at_first_separator() {
        let tokens = vec_of(&["cargo", "build", "&&", "cargo", "test"]);
        assert_eq!(first_segment(&tokens), &tokens[..2]);
    }

    #[test]
    fn first_segment_no_separator_returns_all() {
        let tokens = vec_of(&["vitest", "run", "src/foo.test.ts"]);
        assert_eq!(first_segment(&tokens), &tokens[..]);
    }

    #[test]
    fn strip_wrappers_handles_npx() {
        let tokens = vec_of(&["npx", "vitest"]);
        assert_eq!(strip_wrappers(&tokens), &tokens[1..]);
    }

    #[test]
    fn strip_wrappers_handles_pnpm_exec() {
        let tokens = vec_of(&["pnpm", "exec", "vitest"]);
        assert_eq!(strip_wrappers(&tokens), &tokens[2..]);
    }

    #[test]
    fn strip_wrappers_no_change_when_no_wrapper() {
        let tokens = vec_of(&["vitest"]);
        assert_eq!(strip_wrappers(&tokens), &tokens[..]);
    }
}
```

- [ ] **Step 2: Wire matcher into mod.rs and run the tokenize/strip tests**

Edit `src-tauri/src/agent/test_runners/mod.rs`:

```rust
pub mod cargo;
pub mod matcher;
pub mod script_resolution;
pub mod test_file_patterns;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
```

(The `script_resolution` module is created in step 3.)

Create an empty `src-tauri/src/agent/test_runners/script_resolution.rs` placeholder:

```rust
// Filled out in step 3.
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::matcher`
Expected: All 10 sub-tests pass.

- [ ] **Step 3: Test for script-alias resolution (failing)**

Replace `src-tauri/src/agent/test_runners/script_resolution.rs`:

```rust
//! Resolve `npm/yarn/pnpm test` and `npm/yarn/pnpm/bun run <name>` against
//! package.json scripts, with a depth-3 recursion bound to defend against
//! pathological alias loops.

use std::fs;
use std::path::Path;

use serde_json::Value;

const MAX_RECURSION_DEPTH: usize = 3;

/// Returns Some(resolved_command_string) if the first two tokens are a known
/// npm-family script invocation AND package.json contains the script.
/// Returns None for everything else (caller continues with original tokens).
///
/// `bun test` is intentionally NOT treated as an alias — bun has a built-in
/// test runner. Adding a Bun runner is future work.
pub fn resolve_alias(tokens: &[String], cwd: Option<&Path>) -> Option<String> {
    let cwd = cwd?;
    let (script_name, _consumed) = parse_alias_invocation(tokens)?;
    resolve_recursive(&script_name, cwd, 0)
}

fn parse_alias_invocation(tokens: &[String]) -> Option<(String, usize)> {
    if tokens.len() < 2 {
        return None;
    }
    let pm = tokens[0].as_str();
    let arg = tokens[1].as_str();
    match (pm, arg) {
        // bare `test` — treat as `run test`
        ("npm" | "yarn" | "pnpm", "test") => Some(("test".to_string(), 2)),
        // `run <name>`
        ("npm" | "yarn" | "pnpm" | "bun", "run") => {
            let name = tokens.get(2)?.clone();
            Some((name, 3))
        }
        _ => None,
    }
}

fn resolve_recursive(script_name: &str, cwd: &Path, depth: usize) -> Option<String> {
    if depth >= MAX_RECURSION_DEPTH {
        return None;
    }
    let pkg_path = cwd.join("package.json");
    let content = fs::read_to_string(&pkg_path).ok()?;
    let json: Value = serde_json::from_str(&content).ok()?;
    let resolved = json
        .get("scripts")
        .and_then(|s| s.get(script_name))
        .and_then(|v| v.as_str())?;

    // If the resolved string itself is an npm-family alias, recurse.
    if let Some(tokens) = super::matcher::tokenize(resolved) {
        if let Some((next_script, _)) = parse_alias_invocation(&tokens) {
            if let Some(deeper) = resolve_recursive(&next_script, cwd, depth + 1) {
                return Some(deeper);
            }
        }
    }
    Some(resolved.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_pkg(dir: &Path, scripts: &str) {
        fs::write(
            dir.join("package.json"),
            format!(r#"{{"scripts": {{ {scripts} }} }}"#),
        )
        .unwrap();
    }

    fn vec_of(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn npm_test_resolves_to_script() {
        let dir = tempdir().unwrap();
        write_pkg(dir.path(), r#""test": "vitest --passWithNoTests""#);
        assert_eq!(
            resolve_alias(&vec_of(&["npm", "test"]), Some(dir.path())),
            Some("vitest --passWithNoTests".to_string())
        );
    }

    #[test]
    fn npm_run_named_script_resolves() {
        let dir = tempdir().unwrap();
        write_pkg(dir.path(), r#""test:int": "vitest run integration""#);
        assert_eq!(
            resolve_alias(&vec_of(&["npm", "run", "test:int"]), Some(dir.path())),
            Some("vitest run integration".to_string())
        );
    }

    #[test]
    fn missing_script_returns_none() {
        let dir = tempdir().unwrap();
        write_pkg(dir.path(), r#""build": "tsc""#);
        assert_eq!(
            resolve_alias(&vec_of(&["npm", "test"]), Some(dir.path())),
            None
        );
    }

    #[test]
    fn missing_cwd_returns_none() {
        assert_eq!(
            resolve_alias(&vec_of(&["npm", "test"]), None),
            None
        );
    }

    #[test]
    fn alias_loop_bounded_to_depth_3() {
        let dir = tempdir().unwrap();
        // "test" → "npm run test" → "npm run test" → ... should not infinite-loop
        write_pkg(dir.path(), r#""test": "npm run test""#);
        // Depth bound triggers, returns None for the deepest recursion attempt.
        // The outer call still returns Some(the literal resolved string) because
        // recursion bottoms out and the outer fallback is the resolved string itself.
        // We just need to confirm it doesn't hang.
        let result = resolve_alias(&vec_of(&["npm", "test"]), Some(dir.path()));
        assert!(result.is_some());
    }

    #[test]
    fn bun_test_not_treated_as_alias() {
        let dir = tempdir().unwrap();
        write_pkg(dir.path(), r#""test": "this should not be returned""#);
        assert_eq!(
            resolve_alias(&vec_of(&["bun", "test"]), Some(dir.path())),
            None
        );
    }

    #[test]
    fn bun_run_resolves_normally() {
        let dir = tempdir().unwrap();
        write_pkg(dir.path(), r#""test": "vitest""#);
        assert_eq!(
            resolve_alias(&vec_of(&["bun", "run", "test"]), Some(dir.path())),
            Some("vitest".to_string())
        );
    }
}
```

- [ ] **Step 4: Run script-resolution tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::script_resolution`
Expected: All 7 tests pass.

- [ ] **Step 5: Test for the full match function (failing)**

Add to the bottom of `src-tauri/src/agent/test_runners/matcher.rs`, ABOVE the existing `#[cfg(test)] mod tests`:

```rust
/// Result of a successful match.
pub struct MatchedCommand {
    pub runner: &'static TestRunner,
    /// Tokens after env-strip + segment-first + wrapper-strip + script
    /// resolution. Used by build_command_preview for display.
    pub stripped_tokens: Vec<String>,
}

/// The full matching pipeline. Returns None when the command does not match
/// any known runner.
pub fn match_command(cmd: &str, cwd: Option<&Path>) -> Option<MatchedCommand> {
    let initial = tokenize(cmd)?;
    let after_env = strip_env_prefix(&initial).to_vec();
    let after_segment = first_segment(&after_env).to_vec();
    let after_wrapper = strip_wrappers(&after_segment).to_vec();

    // Try script alias resolution. If it resolves, recurse on the resolved
    // string (which goes through the SAME pipeline so its env/wrapper/etc.
    // are also normalised).
    if let Some(resolved) = script_resolution::resolve_alias(&after_wrapper, cwd) {
        return match_command(&resolved, cwd);
    }

    // Walk RUNNERS. First match wins.
    let token_refs: Vec<&str> = after_wrapper.iter().map(String::as_str).collect();
    for runner in RUNNERS {
        if (runner.matches)(&token_refs) {
            return Some(MatchedCommand {
                runner,
                stripped_tokens: after_wrapper,
            });
        }
    }
    None
}
```

Add tests at the bottom of the existing `#[cfg(test)] mod tests` in `matcher.rs`:

```rust
#[test]
fn match_command_finds_vitest() {
    let m = match_command("vitest run src/foo.test.ts", None).expect("should match");
    assert_eq!(m.runner.name, "vitest");
    assert_eq!(m.stripped_tokens, vec_of(&["vitest", "run", "src/foo.test.ts"]));
}

#[test]
fn match_command_finds_cargo_test() {
    let m = match_command("cargo test --release", None).expect("should match");
    assert_eq!(m.runner.name, "cargo");
}

#[test]
fn match_command_strips_env_and_wrapper() {
    let m = match_command("CI=1 npx vitest", None).expect("should match");
    assert_eq!(m.runner.name, "vitest");
    assert_eq!(m.stripped_tokens, vec_of(&["vitest"]));
}

#[test]
fn match_command_first_segment_only() {
    // cargo build && cargo test → only the first segment (cargo build) considered → no match
    assert!(match_command("cargo build && cargo test", None).is_none());
}

#[test]
fn match_command_unknown_returns_none() {
    assert!(match_command("git diff test.txt", None).is_none());
    assert!(match_command("eslint test/", None).is_none());
    assert!(match_command("make test", None).is_none());
}

#[test]
fn match_command_resolves_npm_test() {
    use std::fs;
    use tempfile::tempdir;
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"scripts": {"test": "vitest --passWithNoTests"}}"#,
    )
    .unwrap();
    let m = match_command("npm test", Some(dir.path())).expect("should match");
    assert_eq!(m.runner.name, "vitest");
}

#[test]
fn match_command_bun_test_does_not_match_in_v1() {
    // bun has a built-in test runner; v1 doesn't ship a BUN runner, so this
    // should NOT match (and definitely not try to resolve a script alias).
    use std::fs;
    use tempfile::tempdir;
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"scripts": {"test": "vitest"}}"#,
    )
    .unwrap();
    assert!(match_command("bun test", Some(dir.path())).is_none());
}
```

- [ ] **Step 6: Run all matcher tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners`
Expected: All matcher + script_resolution + test_file_patterns tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/agent/test_runners/matcher.rs \
        src-tauri/src/agent/test_runners/script_resolution.rs \
        src-tauri/src/agent/test_runners/mod.rs
git commit -m "feat(agent): command matching pipeline for test runner detection

Implements tokenize → strip env → first-segment → strip wrappers
→ script-alias resolution (depth-3 bounded) → match against RUNNERS.
Script aliases are resolved for npm/yarn/pnpm test and npm/yarn/pnpm/bun
run <name>; \`bun test\` deliberately doesn't match (Bun's built-in
runner is future work)."
```

---

## Task 5: Vitest result parser + first end-to-end fixture

Implement `vitest_parse_result` and integrate the matcher + parser into `process_assistant_message`/`process_tool_result`. First test-run event flows end-to-end.

**Files:**

- Modify: `src-tauri/src/agent/test_runners/vitest.rs` (real `parse_result`)
- Create: `src-tauri/src/agent/test_runners/timestamps.rs`
- Create: `src-tauri/src/agent/test_runners/path_resolution.rs`
- Create: `src-tauri/src/agent/test_runners/sanitiser.rs`
- Create: `src-tauri/src/agent/test_runners/preview.rs`
- Modify: `src-tauri/src/agent/transcript.rs` (extend `InFlightToolCall`; build snapshot in `process_tool_result`)
- Create: `src-tauri/src/agent/test_runners/build.rs` — snapshot builder (orchestrates duration, status derivation, output_excerpt)
- Modify: `src-tauri/src/agent/test_runners/mod.rs` (export new modules)
- Create: `src-tauri/tests/fixtures/transcript_vitest_pass.jsonl`
- Modify: `src-tauri/src/agent/test_runners/mod.rs`

- [ ] **Step 1: Test for `sanitize_for_ui` (failing)**

Create `src-tauri/src/agent/test_runners/sanitiser.rs`:

```rust
//! Conservative redaction for content shown in the UI. Catches the common
//! shapes; not a comprehensive secret scanner. Applied to BOTH command_preview
//! and output_excerpt.

use once_cell::sync::Lazy;
use regex::Regex;

const REDACTED: &str = "[REDACTED]";

static PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // KEY=value where KEY is uppercase identifier (env-style)
        Regex::new(r"\b[A-Z][A-Z0-9_]{2,}=\S+").unwrap(),
        // Bearer tokens (case-insensitive)
        Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+").unwrap(),
        // Authorization headers (case-insensitive)
        Regex::new(r"(?i)\bAuthorization:\s*\S+").unwrap(),
        // Stripe/etc-style API keys: (sk|pk|rk)_(live|test)_<alnum16+>
        Regex::new(r"\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}").unwrap(),
        // JWT-like: eyJ followed by base64-ish chunk
        Regex::new(r"\beyJ[A-Za-z0-9._\-]{10,}").unwrap(),
    ]
});

pub fn sanitize_for_ui(input: &str) -> String {
    let mut out = input.to_string();
    for re in PATTERNS.iter() {
        out = re.replace_all(&out, REDACTED).to_string();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_env_assignments() {
        let s = sanitize_for_ui("STRIPE_KEY=sk_live_abc123 vitest");
        assert!(!s.contains("sk_live_abc123"));
        assert!(s.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_bearer_tokens() {
        let s = sanitize_for_ui("curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.foo'");
        assert!(!s.contains("eyJhbGciOiJIUzI1NiJ9.foo"));
    }

    #[test]
    fn redacts_api_key_prefixes() {
        let s = sanitize_for_ui("--key sk_live_1234567890abcdef1234");
        assert!(!s.contains("sk_live_1234567890abcdef1234"));
    }

    #[test]
    fn redacts_jwt_like() {
        let s = sanitize_for_ui("token: eyJabcdefghijklmnop.body.sig");
        assert!(!s.contains("eyJabcdefghijklmnop"));
    }

    #[test]
    fn clean_strings_unchanged() {
        let s = sanitize_for_ui("vitest run src/foo.test.ts");
        assert_eq!(s, "vitest run src/foo.test.ts");
    }

    #[test]
    fn does_not_redact_short_uppercase_words() {
        // "OK" / "FAIL" without "=" must be untouched
        let s = sanitize_for_ui("FAIL src/foo.test.ts");
        assert_eq!(s, "FAIL src/foo.test.ts");
    }
}
```

- [ ] **Step 2: Test for `build_command_preview` (failing)**

Create `src-tauri/src/agent/test_runners/preview.rs`:

```rust
use super::sanitiser::sanitize_for_ui;

const MAX_PREVIEW_LEN: usize = 120;

pub fn build_command_preview(stripped_tokens: &[String]) -> String {
    let joined = stripped_tokens.join(" ");
    let sanitized = sanitize_for_ui(&joined);
    truncate(&sanitized, MAX_PREVIEW_LEN)
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let end = s
            .char_indices()
            .nth(max_len.saturating_sub(3))
            .map_or(s.len(), |(i, _)| i);
        format!("{}...", &s[..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vec_of(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn joins_tokens() {
        assert_eq!(
            build_command_preview(&vec_of(&["vitest", "run", "src/foo.test.ts"])),
            "vitest run src/foo.test.ts"
        );
    }

    #[test]
    fn applies_sanitiser() {
        let p = build_command_preview(&vec_of(&["vitest", "--key", "sk_live_1234567890abcdef1234"]));
        assert!(!p.contains("sk_live_1234567890abcdef1234"));
        assert!(p.contains("[REDACTED]"));
    }

    #[test]
    fn truncates_long_input() {
        let long = "a".repeat(200);
        let preview = build_command_preview(&vec_of(&[&long]));
        assert!(preview.chars().count() <= 120);
        assert!(preview.ends_with("..."));
    }
}
```

- [ ] **Step 3: Test for `parse_iso8601_ms` and `compute_duration_ms` (failing)**

Create `src-tauri/src/agent/test_runners/timestamps.rs`:

```rust
use std::time::Duration;

use chrono::DateTime;

/// Parse an ISO 8601 string (with or without fractional seconds) to
/// milliseconds since the Unix epoch. Returns None on parse failure.
pub fn parse_iso8601_ms(s: &str) -> Option<u64> {
    let dt = DateTime::parse_from_rfc3339(s).ok()?;
    let ms = dt.timestamp_millis();
    if ms < 0 {
        return None;
    }
    Some(ms as u64)
}

/// Compute the duration between two ISO 8601 timestamps. Falls back to the
/// provided `fallback` duration if either timestamp can't be parsed or the
/// computed range is negative.
pub fn compute_duration_ms(started_at: &str, finished_at: &str, fallback: Duration) -> u64 {
    match (parse_iso8601_ms(started_at), parse_iso8601_ms(finished_at)) {
        (Some(start), Some(end)) if end >= start => end - start,
        _ => {
            log::debug!("Falling back to Instant::elapsed for test-run duration");
            fallback.as_millis() as u64
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso8601_no_fraction() {
        assert_eq!(parse_iso8601_ms("2026-04-28T12:00:00Z"), Some(1777377600000));
    }

    #[test]
    fn parses_iso8601_with_fraction() {
        assert_eq!(
            parse_iso8601_ms("2026-04-28T12:00:00.500Z"),
            Some(1777377600500)
        );
    }

    #[test]
    fn returns_none_on_garbage() {
        assert_eq!(parse_iso8601_ms("not-a-date"), None);
        assert_eq!(parse_iso8601_ms(""), None);
    }

    #[test]
    fn duration_uses_timestamps_when_valid() {
        assert_eq!(
            compute_duration_ms(
                "2026-04-28T12:00:00Z",
                "2026-04-28T12:00:01.500Z",
                Duration::from_millis(0),
            ),
            1500
        );
    }

    #[test]
    fn duration_falls_back_when_end_before_start() {
        assert_eq!(
            compute_duration_ms(
                "2026-04-28T12:00:01Z",
                "2026-04-28T12:00:00Z",
                Duration::from_millis(42),
            ),
            42
        );
    }

    #[test]
    fn duration_falls_back_when_unparseable() {
        assert_eq!(
            compute_duration_ms("garbage", "garbage", Duration::from_millis(7)),
            7
        );
    }
}
```

- [ ] **Step 4: Test for `resolve_group_path` containment (failing)**

Create `src-tauri/src/agent/test_runners/path_resolution.rs`:

```rust
//! Resolve a runner-emitted relative label to an absolute, contained path.

use std::path::Path;

/// Returns Some(absolute_path_string) when:
///   - label has no `..` segments
///   - label is not absolute
///   - the canonical resolved path is inside the canonical CWD
/// Returns None otherwise — the row will render non-clickable.
pub fn resolve_group_path(cwd: &Path, label: &str) -> Option<String> {
    if label.contains("..") || Path::new(label).is_absolute() {
        return None;
    }
    let candidate = cwd.join(label).canonicalize().ok()?;
    let cwd_canonical = cwd.canonicalize().ok()?;
    if !candidate.starts_with(&cwd_canonical) {
        return None;
    }
    Some(candidate.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_dotdot_escape() {
        let dir = tempdir().unwrap();
        assert_eq!(resolve_group_path(dir.path(), "../etc/passwd"), None);
    }

    #[test]
    fn rejects_absolute_label() {
        let dir = tempdir().unwrap();
        assert_eq!(resolve_group_path(dir.path(), "/etc/passwd"), None);
    }

    #[test]
    fn resolves_valid_relative_path() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("foo.test.ts");
        fs::write(&file, "").unwrap();
        let resolved = resolve_group_path(dir.path(), "foo.test.ts");
        assert!(resolved.is_some());
        assert!(resolved.unwrap().contains("foo.test.ts"));
    }

    #[test]
    fn returns_none_for_missing_file() {
        let dir = tempdir().unwrap();
        // canonicalize fails for non-existent paths
        assert_eq!(resolve_group_path(dir.path(), "missing.test.ts"), None);
    }

    #[test]
    fn rejects_symlink_pointing_outside_cwd() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outer = tempdir().unwrap();
            let inner = tempdir().unwrap();
            let target = outer.path().join("secret.test.ts");
            fs::write(&target, "").unwrap();
            symlink(&target, inner.path().join("link.test.ts")).unwrap();
            // The symlink resolves outside the inner CWD → reject.
            assert_eq!(resolve_group_path(inner.path(), "link.test.ts"), None);
        }
    }
}
```

- [ ] **Step 5: Wire all four new modules into mod.rs**

Edit `src-tauri/src/agent/test_runners/mod.rs`:

```rust
pub mod cargo;
pub mod matcher;
pub mod path_resolution;
pub mod preview;
pub mod sanitiser;
pub mod script_resolution;
pub mod test_file_patterns;
pub mod timestamps;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
```

- [ ] **Step 6: Run all the small-helper tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners`
Expected: All sanitiser, preview, timestamps, path_resolution tests pass.

- [ ] **Step 7: Test for `vitest_parse_result` (failing)**

Replace `src-tauri/src/agent/test_runners/vitest.rs`:

```rust
//! Vitest result parser. Targets vitest 1.x summary format.
//!
//! Canonical summary lines (after ANSI strip):
//!   Test Files  3 passed (3)
//!        Tests  47 passed | 2 failed | 1 skipped (50)
//! Per-file lines (within run output):
//!   ✓ src/foo.test.ts (12)
//!   ✗ src/bar.test.ts (8 | 3 failed)

use std::path::Path;

use once_cell::sync::Lazy;
use regex::Regex;

use super::path_resolution::resolve_group_path;
use super::types::{
    CapturedOutput, TestGroup, TestGroupKind, TestGroupStatus, TestRunSummary, TestRunner,
};

pub static VITEST: TestRunner = TestRunner {
    name: "vitest",
    matches: vitest_matches,
    parse_result: vitest_parse_result,
};

const MAX_GROUPS: usize = 500;

fn vitest_matches(tokens: &[&str]) -> bool {
    matches!(tokens.first(), Some(&"vitest"))
}

static ANSI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap());

// Capture passed/failed/skipped counts from the "Tests" summary line.
// Examples:
//   Tests  47 passed (47)
//   Tests  47 passed | 2 failed (49)
//   Tests  47 passed | 2 failed | 1 skipped (50)
//   Tests  no tests
static TESTS_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?m)^\s*Tests\s+(?:(\d+)\s+passed)?(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?",
    )
    .unwrap()
});

// File rows: "✓ src/foo.test.ts (12)" or "✗ src/bar.test.ts (8 | 3 failed)"
static FILE_ROW_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^\s*([✓✗⊘])\s+(\S+\.[A-Za-z]+)\s*\((\d+)(?:\s*\|\s*(\d+)\s+failed)?\)")
        .unwrap()
});

fn vitest_parse_result(out: &CapturedOutput, cwd: &Path) -> Option<TestRunSummary> {
    let stripped = ANSI_RE.replace_all(&out.content, "").to_string();

    // Pull summary counts from the Tests line.
    let caps = TESTS_LINE_RE.captures(&stripped)?;
    let passed = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    let failed = caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    let skipped = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    let total = passed + failed + skipped;

    // Pull per-file groups.
    let mut groups: Vec<TestGroup> = Vec::new();
    for cap in FILE_ROW_RE.captures_iter(&stripped) {
        if groups.len() >= MAX_GROUPS {
            break;
        }
        let icon = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let label = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
        let file_total: u32 = cap
            .get(3)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let file_failed: u32 = cap
            .get(4)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let file_passed = file_total.saturating_sub(file_failed);
        let status = match icon {
            "✓" => TestGroupStatus::Pass,
            "✗" => TestGroupStatus::Fail,
            "⊘" => TestGroupStatus::Skip,
            _ => TestGroupStatus::Pass,
        };
        let path = resolve_group_path(cwd, &label);
        groups.push(TestGroup {
            label,
            path,
            kind: TestGroupKind::File,
            passed: file_passed,
            failed: file_failed,
            skipped: 0,
            total: file_total,
            status,
        });
    }

    Some(TestRunSummary {
        passed,
        failed,
        skipped,
        total,
        groups,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn captured(content: &str) -> CapturedOutput {
        CapturedOutput { content: content.to_string(), is_error: false }
    }

    #[test]
    fn parses_simple_pass_summary() {
        let out = captured(
            "Test Files  1 passed (1)\n     Tests  3 passed (3)\n",
        );
        let s = vitest_parse_result(&out, &PathBuf::from("/tmp")).unwrap();
        assert_eq!(s.passed, 3);
        assert_eq!(s.failed, 0);
        assert_eq!(s.skipped, 0);
        assert_eq!(s.total, 3);
    }

    #[test]
    fn parses_mixed_pass_fail_skip() {
        let out = captured(
            "Test Files  2 passed | 1 failed (3)\n     Tests  47 passed | 2 failed | 1 skipped (50)\n",
        );
        let s = vitest_parse_result(&out, &PathBuf::from("/tmp")).unwrap();
        assert_eq!(s.passed, 47);
        assert_eq!(s.failed, 2);
        assert_eq!(s.skipped, 1);
        assert_eq!(s.total, 50);
    }

    #[test]
    fn parses_per_file_rows() {
        let dir = tempdir().unwrap();
        let foo = dir.path().join("foo.test.ts");
        fs::write(&foo, "").unwrap();
        let out_str = format!(
            "✓ foo.test.ts (12)\n✗ missing.test.ts (8 | 3 failed)\n     Tests  17 passed | 3 failed (20)\n"
        );
        let out = captured(&out_str);
        let s = vitest_parse_result(&out, dir.path()).unwrap();
        assert_eq!(s.groups.len(), 2);
        assert_eq!(s.groups[0].label, "foo.test.ts");
        assert!(s.groups[0].path.is_some());
        assert_eq!(s.groups[0].passed, 12);
        assert_eq!(s.groups[0].failed, 0);
        assert_eq!(s.groups[1].label, "missing.test.ts");
        assert!(s.groups[1].path.is_none()); // file doesn't exist → no path
        assert_eq!(s.groups[1].passed, 5);
        assert_eq!(s.groups[1].failed, 3);
    }

    #[test]
    fn strips_ansi_before_parsing() {
        let out = captured(
            "\x1b[32m✓\x1b[0m foo.test.ts (12)\n     Tests  12 passed (12)\n",
        );
        let s = vitest_parse_result(&out, &PathBuf::from("/tmp")).unwrap();
        assert_eq!(s.total, 12);
        assert_eq!(s.groups.len(), 1);
    }

    #[test]
    fn returns_none_when_no_tests_line() {
        let out = captured("error: command not found");
        assert!(vitest_parse_result(&out, &PathBuf::from("/tmp")).is_none());
    }
}
```

- [ ] **Step 8: Run vitest parser tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::vitest`
Expected: All 5 tests pass.

- [ ] **Step 9: Create snapshot builder module**

Create `src-tauri/src/agent/test_runners/build.rs`:

```rust
//! Builds a TestRunSnapshot from a matched test-run tool_use + tool_result.

use std::path::Path;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;

use super::matcher::MatchedCommand;
use super::preview::build_command_preview;
use super::sanitiser::sanitize_for_ui;
use super::timestamps::compute_duration_ms;
use super::types::{
    CapturedOutput, TestRunSnapshot, TestRunStatus, TestRunSummary,
};

const MAX_EXCERPT_LEN: usize = 240;

static ERROR_HINT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(error:|fail|panicked)").unwrap());
static ANSI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap());

pub struct BuildArgs<'a> {
    pub session_id: &'a str,
    pub matched: &'a MatchedCommand,
    pub started_at: &'a str,
    pub finished_at: &'a str,
    pub instant_fallback: Duration,
    pub captured: CapturedOutput,
    pub cwd: &'a Path,
}

pub fn build_snapshot(args: BuildArgs<'_>) -> TestRunSnapshot {
    let summary = (args.matched.runner.parse_result)(&args.captured, args.cwd);
    let status = derive_status(summary.as_ref(), args.captured.is_error);
    let summary = summary.unwrap_or_default();

    let output_excerpt = if matches!(status, TestRunStatus::Error) {
        Some(extract_excerpt(&args.captured.content))
    } else {
        None
    };

    TestRunSnapshot {
        session_id: args.session_id.to_string(),
        runner: args.matched.runner.name.to_string(),
        command_preview: build_command_preview(&args.matched.stripped_tokens),
        started_at: args.started_at.to_string(),
        finished_at: args.finished_at.to_string(),
        duration_ms: compute_duration_ms(
            args.started_at,
            args.finished_at,
            args.instant_fallback,
        ),
        status,
        summary,
        output_excerpt,
    }
}

/// Returns Some(snapshot) when an event should be emitted; None when we
/// don't know what happened (parser returned None AND not an error result).
pub fn maybe_build_snapshot(args: BuildArgs<'_>) -> Option<TestRunSnapshot> {
    let summary = (args.matched.runner.parse_result)(&args.captured, args.cwd);
    if summary.is_none() && !args.captured.is_error {
        log::debug!(
            "Test runner '{}' produced unparseable output, skipping emit",
            args.matched.runner.name
        );
        return None;
    }
    Some(build_snapshot(args))
}

fn derive_status(summary: Option<&TestRunSummary>, is_error: bool) -> TestRunStatus {
    match summary {
        Some(s) if s.failed > 0 => TestRunStatus::Fail,
        Some(s) if s.total == 0 => TestRunStatus::NoTests,
        Some(_) => TestRunStatus::Pass,
        None if is_error => TestRunStatus::Error,
        None => TestRunStatus::Error, // maybe_build_snapshot already filtered the unknown case
    }
}

fn extract_excerpt(content: &str) -> String {
    let stripped = ANSI_RE.replace_all(content, "");
    // Prefer the first line containing an error hint; else first non-blank line.
    let preferred = stripped
        .lines()
        .find(|l| ERROR_HINT_RE.is_match(l) && !l.trim().is_empty());
    let chosen = preferred.unwrap_or_else(|| {
        stripped.lines().find(|l| !l.trim().is_empty()).unwrap_or("")
    });
    let truncated: String = chosen.chars().take(MAX_EXCERPT_LEN).collect();
    sanitize_for_ui(&truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_prefers_error_hint() {
        let s = extract_excerpt(
            "  some preamble\n  error: type mismatch in foo.test.ts\n  more output",
        );
        assert!(s.contains("error: type mismatch"));
    }

    #[test]
    fn excerpt_falls_back_to_first_non_blank() {
        let s = extract_excerpt("\n   \nfirst real line\nsecond line");
        assert!(s.contains("first real line"));
    }

    #[test]
    fn excerpt_caps_length() {
        let long = "x".repeat(500);
        let body = format!("error: {}", long);
        let s = extract_excerpt(&body);
        assert!(s.chars().count() <= MAX_EXCERPT_LEN);
    }

    #[test]
    fn excerpt_runs_through_sanitiser() {
        let s = extract_excerpt("error: bearer eyJabcdefghijklmnop.body.sig was rejected");
        assert!(s.contains("[REDACTED]"));
    }

    #[test]
    fn derive_status_picks_fail_over_total() {
        let s = TestRunSummary { passed: 5, failed: 1, skipped: 0, total: 6, groups: vec![] };
        assert_eq!(derive_status(Some(&s), false), TestRunStatus::Fail);
    }

    #[test]
    fn derive_status_picks_no_tests() {
        let s = TestRunSummary::default();
        assert_eq!(derive_status(Some(&s), false), TestRunStatus::NoTests);
    }

    #[test]
    fn derive_status_picks_pass() {
        let s = TestRunSummary { passed: 3, failed: 0, skipped: 0, total: 3, groups: vec![] };
        assert_eq!(derive_status(Some(&s), false), TestRunStatus::Pass);
    }

    #[test]
    fn derive_status_picks_error_when_unparseable_and_is_error() {
        assert_eq!(derive_status(None, true), TestRunStatus::Error);
    }
}
```

- [ ] **Step 10: Wire `build` into mod.rs**

Edit `src-tauri/src/agent/test_runners/mod.rs`:

```rust
pub mod build;
pub mod cargo;
pub mod matcher;
pub mod path_resolution;
pub mod preview;
pub mod sanitiser;
pub mod script_resolution;
pub mod test_file_patterns;
pub mod timestamps;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::build`
Expected: All 8 tests pass.

- [ ] **Step 11: Extend `InFlightToolCall` and emit `test-run` event from transcript parser**

Edit `src-tauri/src/agent/transcript.rs`. Find `InFlightToolCall` and update it (this builds on the change in Task 3):

```rust
use crate::agent::test_runners::matcher::{match_command, MatchedCommand};

struct InFlightToolCall {
    started_at: Instant,
    started_at_iso: String,
    tool: String,
    args: String,
    is_test_file: bool,
    test_match: Option<MatchedCommand>,
}
```

Note: `MatchedCommand` doesn't derive `Clone` but that's fine — we own the value via the `HashMap` and move it into the snapshot builder when the result arrives.

In `process_assistant_message`, before the in-flight insert, run the matcher when the tool is `Bash`:

```rust
// After computing `is_test_file`...
let test_match = if name == "Bash" {
    item.get("input")
        .and_then(|v| v.get("command"))
        .and_then(|v| v.as_str())
        .and_then(|cmd| match_command(cmd, cwd.as_deref()))
} else {
    None
};
```

The `cwd: Option<PathBuf>` parameter has to flow into `process_assistant_message`. Update its signature to take `cwd: Option<&Path>` and update the call sites in `process_line` and the recursive `process_user_message`. Also update `process_line` and `tail_loop` to pass `_cwd.as_deref()` through.

Concretely, the signature changes:

```rust
fn process_line(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<impl tauri::Runtime>,
    in_flight: &mut InFlightToolCalls,
) { ... }

fn process_assistant_message(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<impl tauri::Runtime>,
    in_flight: &mut InFlightToolCalls,
) { ... }

fn process_user_message(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<impl tauri::Runtime>,
    in_flight: &mut InFlightToolCalls,
) { ... }

fn process_tool_result(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<impl tauri::Runtime>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) { ... }
```

Inside `tail_loop`, change `process_line(line, &session_id, &app_handle, &mut in_flight)` to `process_line(line, &session_id, _cwd.as_deref(), &app_handle, &mut in_flight)` and rename `_cwd` to `cwd` (it's now used).

In the in-flight insert:

```rust
in_flight.insert(
    id.clone(),
    InFlightToolCall {
        started_at: now,
        started_at_iso: timestamp.clone(),
        tool: name.clone(),
        args: args.clone(),
        is_test_file,
        test_match,
    },
);
```

In `process_tool_result`, after `let Some(call) = in_flight.remove(...)`, build and emit the test-run snapshot when `call.test_match.is_some()`:

```rust
let duration_ms = call.started_at.elapsed().as_millis() as u64;
let tool_name = call.tool;
let args = call.args;
let is_test_file = call.is_test_file;

if let Some(matched) = call.test_match {
    // Pull the captured Bash output content.
    let content = extract_tool_result_content(value);
    let captured = crate::agent::test_runners::types::CapturedOutput {
        content,
        is_error,
    };
    let cwd_ref = cwd.unwrap_or_else(|| Path::new("."));
    let snapshot = crate::agent::test_runners::build::maybe_build_snapshot(
        crate::agent::test_runners::build::BuildArgs {
            session_id,
            matched: &matched,
            started_at: &call.started_at_iso,
            finished_at: timestamp,
            instant_fallback: call.started_at.elapsed(),
            captured,
            cwd: cwd_ref,
        },
    );
    if let Some(snap) = snapshot {
        // For now (Task 5), emit immediately. Task 6 introduces the
        // TestRunEmitter for replay batching — this direct emit will be
        // refactored to call emitter.submit().
        if let Err(e) = app_handle.emit("test-run", &snap) {
            log::warn!("Failed to emit test-run event: {}", e);
        }
    }
}

// ...existing AgentToolCallEvent build + emit
```

Add the helper at the bottom of `transcript.rs` (above the test module):

```rust
fn extract_tool_result_content(value: &Value) -> String {
    let raw = match value.get("content") {
        Some(c) => c,
        None => return String::new(),
    };
    if let Some(s) = raw.as_str() {
        return s.to_string();
    }
    if let Some(arr) = raw.as_array() {
        let mut out = String::new();
        for block in arr {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    out.push_str(text);
                    out.push('\n');
                }
            }
        }
        return out;
    }
    String::new()
}
```

- [ ] **Step 12: Update existing test fixtures in transcript.rs**

In `src-tauri/src/agent/transcript.rs`, the existing test helpers around line 824–830 build `InFlightToolCall` instances. Add the new fields:

```rust
InFlightToolCall {
    started_at: Instant::now(),
    started_at_iso: "2026-04-28T12:00:00Z".to_string(),
    tool: "Read".to_string(),
    args: "src/foo.rs".to_string(),
    is_test_file: false,
    test_match: None,
}
```

(Replace tool/args with whatever the existing fixtures use; just add the new fields.)

- [ ] **Step 13: Build everything**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Builds clean.

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent`
Expected: All existing + new tests pass.

- [ ] **Step 14: Add a fixture-based integration test**

Create `src-tauri/tests/fixtures/transcript_vitest_pass.jsonl` (this is the canonical shape Claude Code's transcript produces):

```jsonl
{"type":"assistant","timestamp":"2026-04-28T12:00:00.000Z","message":{"content":[{"type":"tool_use","id":"toolu_v_1","name":"Bash","input":{"command":"vitest run","description":"Run tests"}}]}}
{"type":"user","timestamp":"2026-04-28T12:00:01.500Z","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_v_1","is_error":false,"content":"\nTest Files  1 passed (1)\n     Tests  3 passed (3)\n"}]}}
```

Create `src-tauri/tests/transcript_vitest_e2e.rs`:

```rust
//! End-to-end test: feed a fixture transcript through the parser
//! and assert exactly one test-run event is emitted with the expected
//! summary counts.

use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn vitest_pass_fixture_emits_one_test_run() {
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::Listener;

    let app = mock_builder().build(tauri::generate_context!()).unwrap();
    let app_handle = app.handle().clone();

    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recv_clone = received.clone();
    app_handle.listen("test-run", move |event| {
        recv_clone.lock().unwrap().push(event.payload().to_string());
    });

    let state = TranscriptState::new();
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_pass.jsonl");

    state
        .start_or_replace(
            app_handle,
            "session-fixture".to_string(),
            fixture_path,
            None,
        )
        .expect("start watcher");

    // Wait briefly for the tail loop to process the file.
    std::thread::sleep(std::time::Duration::from_millis(1500));
    state.stop("session-fixture").ok();

    let events = received.lock().unwrap();
    assert_eq!(events.len(), 1, "expected exactly one test-run event");
    let payload = &events[0];
    assert!(payload.contains(r#""runner":"vitest""#));
    assert!(payload.contains(r#""passed":3"#));
    assert!(payload.contains(r#""total":3"#));
    assert!(payload.contains(r#""status":"pass""#));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test transcript_vitest_e2e`
Expected: Test passes — one event received with `runner: vitest`, `passed: 3`, `total: 3`, `status: pass`.

Note: the `start_or_replace` call uses `cwd: None`, so per-file path resolution returns `None` for any file groups. That's fine for this fixture — we're verifying summary counts, not group paths.

- [ ] **Step 15: Commit**

```bash
git add src-tauri/src/agent/test_runners/ \
        src-tauri/src/agent/transcript.rs \
        src-tauri/tests/fixtures/transcript_vitest_pass.jsonl \
        src-tauri/tests/transcript_vitest_e2e.rs
git commit -m "feat(agent): vitest result parser + first end-to-end test-run emit

Implements vitest_parse_result targeting vitest 1.x summary format
(supports pass/fail/skip and per-file rows). Adds the snapshot builder
(timestamps duration, status derivation, sanitised output_excerpt
for errors). Wires matcher + builder into transcript.rs so a Bash
tool call running vitest emits a test-run Tauri event with
TestRunSnapshot. End-to-end fixture test covers the happy path."
```

---

## Task 6: TestRunEmitter + replay batching

Replace the direct emit in `process_tool_result` with `TestRunEmitter::submit`. Defer the first EOF check inside `tail_loop` to call `emitter.finish_replay()`. Verify with a fixture transcript containing multiple historical runs.

**Files:**

- Create: `src-tauri/src/agent/test_runners/emitter.rs`
- Modify: `src-tauri/src/agent/transcript.rs` (use emitter; flip on EOF)
- Create: `src-tauri/tests/fixtures/transcript_vitest_replay.jsonl`
- Create: `src-tauri/tests/transcript_vitest_replay.rs`

- [ ] **Step 1: Test for TestRunEmitter (failing)**

Create `src-tauri/src/agent/test_runners/emitter.rs`:

```rust
//! Replay-aware emitter for test-run events. During the initial replay phase
//! of a tail_loop, `submit` keeps only the latest snapshot — when the loop
//! hits EOF for the first time and calls `finish_replay`, the latest pending
//! snapshot (if any) is emitted exactly once. After replay, every submit
//! emits immediately.

use tauri::{AppHandle, Emitter, Runtime};

use super::types::TestRunSnapshot;

pub struct TestRunEmitter<R: Runtime> {
    app_handle: AppHandle<R>,
    replay_done: bool,
    pending: Option<TestRunSnapshot>,
}

impl<R: Runtime> TestRunEmitter<R> {
    pub fn new(app_handle: AppHandle<R>) -> Self {
        Self { app_handle, replay_done: false, pending: None }
    }

    pub fn submit(&mut self, snapshot: TestRunSnapshot) {
        if self.replay_done {
            if let Err(e) = self.app_handle.emit("test-run", &snapshot) {
                log::warn!("Failed to emit test-run event: {}", e);
            }
        } else {
            self.pending = Some(snapshot);
        }
    }

    pub fn finish_replay(&mut self) {
        if self.replay_done {
            return;
        }
        self.replay_done = true;
        if let Some(s) = self.pending.take() {
            if let Err(e) = self.app_handle.emit("test-run", &s) {
                log::warn!("Failed to emit test-run event: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::test_runners::types::{TestRunStatus, TestRunSummary};
    use std::sync::{Arc, Mutex};
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::Listener;

    fn snap(passed: u32) -> TestRunSnapshot {
        TestRunSnapshot {
            session_id: "s".to_string(),
            runner: "vitest".to_string(),
            command_preview: "vitest".to_string(),
            started_at: "2026-04-28T12:00:00Z".to_string(),
            finished_at: "2026-04-28T12:00:01Z".to_string(),
            duration_ms: 1000,
            status: TestRunStatus::Pass,
            summary: TestRunSummary { passed, failed: 0, skipped: 0, total: passed, groups: vec![] },
            output_excerpt: None,
        }
    }

    fn collect_emits(app: &tauri::App<MockRuntime>) -> Arc<Mutex<Vec<String>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let clone = received.clone();
        app.handle().listen("test-run", move |event| {
            clone.lock().unwrap().push(event.payload().to_string());
        });
        received
    }

    #[test]
    fn submit_during_replay_buffers_latest() {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let emits = collect_emits(&app);
        let mut e = TestRunEmitter::new(app.handle().clone());
        e.submit(snap(1));
        e.submit(snap(2));
        e.submit(snap(3));
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(emits.lock().unwrap().is_empty());
        e.finish_replay();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let v = emits.lock().unwrap();
        assert_eq!(v.len(), 1);
        assert!(v[0].contains(r#""passed":3"#));
    }

    #[test]
    fn submit_after_replay_emits_immediately() {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let emits = collect_emits(&app);
        let mut e = TestRunEmitter::new(app.handle().clone());
        e.finish_replay();
        e.submit(snap(7));
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(emits.lock().unwrap().len(), 1);
    }

    #[test]
    fn finish_replay_is_idempotent() {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let emits = collect_emits(&app);
        let mut e = TestRunEmitter::new(app.handle().clone());
        e.submit(snap(1));
        e.finish_replay();
        e.finish_replay();   // second call must not re-emit
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(emits.lock().unwrap().len(), 1);
    }
}
```

- [ ] **Step 2: Wire emitter into mod.rs**

Edit `src-tauri/src/agent/test_runners/mod.rs`:

```rust
pub mod build;
pub mod cargo;
pub mod emitter;
pub mod matcher;
pub mod path_resolution;
pub mod preview;
pub mod sanitiser;
pub mod script_resolution;
pub mod test_file_patterns;
pub mod timestamps;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
```

- [ ] **Step 3: Run emitter tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::emitter`
Expected: All 3 tests pass.

- [ ] **Step 4: Replace direct emit in `process_tool_result` with emitter.submit**

Edit `src-tauri/src/agent/transcript.rs`. Add the `emitter` parameter through the call chain. The signature changes:

```rust
use crate::agent::test_runners::emitter::TestRunEmitter;

fn process_line<R: tauri::Runtime>(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
) { ... }

fn process_assistant_message<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
) { ... }

fn process_user_message<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
) { ... }

fn process_tool_result<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) { ... }
```

In `process_tool_result`, replace the direct `app_handle.emit("test-run", &snap)` with `emitter.submit(snap)`.

- [ ] **Step 5: Use the emitter in `tail_loop`; flip on first EOF**

Edit `src-tauri/src/agent/transcript.rs`. Replace `tail_loop`:

```rust
fn tail_loop<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: Option<PathBuf>,
    file: File,
    stop_flag: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(file);
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut emitter = TestRunEmitter::new(app_handle.clone());
    let mut line_buf = String::new();

    while !stop_flag.load(Ordering::Relaxed) {
        line_buf.clear();
        match reader.read_line(&mut line_buf) {
            Ok(0) => {
                emitter.finish_replay();
                std::thread::sleep(POLL_INTERVAL);
            }
            Ok(_) => {
                let line = line_buf.trim();
                if line.is_empty() {
                    continue;
                }
                process_line(
                    line,
                    &session_id,
                    cwd.as_deref(),
                    &app_handle,
                    &mut emitter,
                    &mut in_flight,
                );
            }
            Err(e) => {
                log::warn!("Error reading transcript line: {}", e);
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}
```

- [ ] **Step 6: Run all backend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p vimeflow_lib`
Expected: All passing.

- [ ] **Step 7: Add the replay-batching fixture**

Create `src-tauri/tests/fixtures/transcript_vitest_replay.jsonl`:

```jsonl
{"type":"assistant","timestamp":"2026-04-28T11:00:00.000Z","message":{"content":[{"type":"tool_use","id":"r1","name":"Bash","input":{"command":"vitest run"}}]}}
{"type":"user","timestamp":"2026-04-28T11:00:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"r1","is_error":false,"content":"     Tests  1 passed (1)\n"}]}}
{"type":"assistant","timestamp":"2026-04-28T11:01:00.000Z","message":{"content":[{"type":"tool_use","id":"r2","name":"Bash","input":{"command":"vitest run"}}]}}
{"type":"user","timestamp":"2026-04-28T11:01:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"r2","is_error":false,"content":"     Tests  2 passed (2)\n"}]}}
{"type":"assistant","timestamp":"2026-04-28T11:02:00.000Z","message":{"content":[{"type":"tool_use","id":"r3","name":"Bash","input":{"command":"vitest run"}}]}}
{"type":"user","timestamp":"2026-04-28T11:02:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"r3","is_error":false,"content":"     Tests  3 passed (3)\n"}]}}
```

(3 historical runs with passed = 1, 2, 3.)

- [ ] **Step 8: Add the replay-batching integration test**

Create `src-tauri/tests/transcript_vitest_replay.rs`:

```rust
use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn replay_emits_only_latest_snapshot() {
    use tauri::test::mock_builder;
    use tauri::Listener;

    let app = mock_builder().build(tauri::generate_context!()).unwrap();
    let app_handle = app.handle().clone();

    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recv_clone = received.clone();
    app_handle.listen("test-run", move |event| {
        recv_clone.lock().unwrap().push(event.payload().to_string());
    });

    let state = TranscriptState::new();
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_replay.jsonl");

    state
        .start_or_replace(
            app_handle,
            "session-replay".to_string(),
            fixture_path,
            None,
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(2000));
    state.stop("session-replay").ok();

    let events = received.lock().unwrap();
    // 3 historical runs in the fixture, but replay batching collapses to 1 emit
    // containing the LATEST run (passed=3).
    assert_eq!(events.len(), 1, "expected exactly one emit after replay");
    assert!(events[0].contains(r#""passed":3"#));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test transcript_vitest_replay`
Expected: Passes — exactly one event, with `passed: 3`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/agent/test_runners/emitter.rs \
        src-tauri/src/agent/test_runners/mod.rs \
        src-tauri/src/agent/transcript.rs \
        src-tauri/tests/fixtures/transcript_vitest_replay.jsonl \
        src-tauri/tests/transcript_vitest_replay.rs
git commit -m "feat(agent): replay batching for test-run events via TestRunEmitter

During tail_loop's initial read-from-beginning replay, multiple historical
test runs collapse to one emit (latest wins) at first EOF. After the
initial EOF, every matched run emits immediately. Eliminates UI flicker
on session restore."
```

---

## Task 7: Listener-ordering regression test (TS)

Lock the load-bearing invariant: the `test-run` listener must be attached before `start_agent_watcher` is invoked. Without a backend snapshot cache in v1, this is the only thing keeping the latest-of-replay snapshot from being lost on session start.

**Files:**

- Modify: `src/features/agent-status/types/index.ts` (add `TestRunSnapshot`, `TestGroup`, etc., and `testRun: TestRunSnapshot | null` on `AgentStatus`)
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts` (add `testRun: null` to default; add `test-run` listener inside `subscribe()`)
- Modify: `src/features/agent-status/hooks/useAgentStatus.test.tsx` (ordering test)

- [ ] **Step 1: Add TS types for the snapshot**

Edit `src/features/agent-status/types/index.ts`. Add at an appropriate spot near the other types:

```typescript
export type TestRunStatus = 'pass' | 'fail' | 'noTests' | 'error'
export type TestGroupKind = 'file' | 'suite' | 'module'
export type TestGroupStatus = 'pass' | 'fail' | 'skip'

export interface TestGroup {
  label: string
  // Rust serialises Option<String> as null (not omitted). Use string | null
  // so the boundary contract matches the wire shape exactly.
  path: string | null
  kind: TestGroupKind
  passed: number
  failed: number
  skipped: number
  total: number
  status: TestGroupStatus
}

export interface TestRunSummary {
  passed: number
  failed: number
  skipped: number
  total: number
  groups: TestGroup[]
}

export interface TestRunSnapshot {
  sessionId: string // PTY session id
  runner: string
  commandPreview: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: TestRunStatus
  summary: TestRunSummary
  outputExcerpt: string | null
}
```

In the existing `AgentStatus` interface, add:

```typescript
export interface AgentStatus {
  // ...existing fields...
  testRun: TestRunSnapshot | null
}
```

- [ ] **Step 2: Update `createDefaultStatus`**

Edit `src/features/agent-status/hooks/useAgentStatus.ts`. Find `createDefaultStatus` (line 27) and add the field:

```typescript
const createDefaultStatus = (sessionId: string | null): AgentStatus => ({
  isActive: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId,
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
})
```

- [ ] **Step 3: Add the `test-run` listener inside `subscribe()`**

Edit `src/features/agent-status/hooks/useAgentStatus.ts`. Inside the `subscribe` async function, after the existing `unlistenToolCall` setup (around line 320), add:

```typescript
const unlistenTestRun = await listen<TestRunSnapshot>('test-run', (event) => {
  if (event.payload.sessionId !== resolvePtyId()) {
    return
  }
  setStatus((prev) => ({
    ...prev,
    testRun: event.payload,
  }))
})

addUnlisten(unlistenTestRun)
```

Add `TestRunSnapshot` to the existing import from `../types` at the top of the file.

- [ ] **Step 4: Listener-ordering regression test**

Edit `src/features/agent-status/hooks/useAgentStatus.test.tsx` (extend the existing test file).

```typescript
test('attaches test-run listener BEFORE invoking start_agent_watcher', async () => {
  const PTY_ID = 'pty-ordering'
  vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

  const callOrder: string[] = []

  vi.mocked(listen).mockImplementation(async (event) => {
    callOrder.push(`listen:${String(event)}`)
    return () => undefined
  })

  vi.mocked(invoke).mockImplementation(async (cmd) => {
    callOrder.push(`invoke:${String(cmd)}`)
    if (cmd === 'detect_agent_in_session') {
      return { agentType: 'claudeCode', sessionId: PTY_ID } as never
    }
    return undefined as never
  })

  renderHook(() => useAgentStatus('ws-1'))

  // Wait for the subscribe + first detection cycle to complete.
  await waitFor(() => {
    expect(callOrder).toContain('invoke:start_agent_watcher')
  })

  const testRunIndex = callOrder.indexOf('listen:test-run')
  const startWatcherIndex = callOrder.indexOf('invoke:start_agent_watcher')

  expect(testRunIndex).toBeGreaterThanOrEqual(0)
  expect(startWatcherIndex).toBeGreaterThanOrEqual(0)
  expect(testRunIndex).toBeLessThan(startWatcherIndex)
})
```

- [ ] **Step 5: Add a hook test for `testRun` updating from a `test-run` event**

Add to `useAgentStatus.test.tsx`:

```typescript
test('test-run event with matching pty id updates status.testRun', async () => {
  const PTY_ID = 'pty-tr'
  vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

  let testRunHandler: ((e: { payload: TestRunSnapshot }) => void) | undefined
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    if (event === 'test-run') {
      testRunHandler = handler as never
    }
    return () => undefined
  })

  const { result } = renderHook(() => useAgentStatus('ws-1'))
  await waitFor(() => expect(testRunHandler).toBeDefined())

  const snap: TestRunSnapshot = {
    sessionId: PTY_ID,
    runner: 'vitest',
    commandPreview: 'vitest run',
    startedAt: '2026-04-28T12:00:00Z',
    finishedAt: '2026-04-28T12:00:01Z',
    durationMs: 1000,
    status: 'pass',
    summary: { passed: 3, failed: 0, skipped: 0, total: 3, groups: [] },
    outputExcerpt: null,
  }

  act(() => {
    testRunHandler?.({ payload: snap })
  })

  expect(result.current.testRun).toEqual(snap)
})

test('test-run event with mismatched pty id is ignored', async () => {
  const PTY_ID = 'pty-real'
  vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

  let testRunHandler: ((e: { payload: TestRunSnapshot }) => void) | undefined
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    if (event === 'test-run') {
      testRunHandler = handler as never
    }
    return () => undefined
  })

  const { result } = renderHook(() => useAgentStatus('ws-1'))
  await waitFor(() => expect(testRunHandler).toBeDefined())

  act(() => {
    testRunHandler?.({
      payload: {
        sessionId: 'wrong-pty-id',
        runner: 'vitest',
        commandPreview: 'vitest',
        startedAt: '',
        finishedAt: '',
        durationMs: 0,
        status: 'pass',
        summary: { passed: 1, failed: 0, skipped: 0, total: 1, groups: [] },
        outputExcerpt: null,
      },
    })
  })

  expect(result.current.testRun).toBeNull()
})

test('createDefaultStatus has testRun: null', () => {
  // The hook always starts with testRun: null on first render.
  vi.mocked(getPtySessionId).mockReturnValue(null)
  const { result } = renderHook(() => useAgentStatus('ws-default'))
  expect(result.current.testRun).toBeNull()
})
```

- [ ] **Step 6: Run all hook tests**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.tsx`
Expected: All tests pass — including the four new ones.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/types/index.ts \
        src/features/agent-status/hooks/useAgentStatus.ts \
        src/features/agent-status/hooks/useAgentStatus.test.tsx
git commit -m "feat(agent-status): test-run listener + ordering regression test

Adds TestRunSnapshot/TestRunSummary/TestGroup TS types matching the
Rust serde shape (Option<String> → string | null). Hook subscribes
to test-run inside subscribe() so the listener is attached before
start_agent_watcher fires — load-bearing for v1 since there's no
backend snapshot cache. Regression test asserts the call order."
```

---

## Task 8: TestResults rewrite + AgentStatusPanel wiring

Full rewrite of `<TestResults>` to take a single nullable snapshot prop. Five visual states: placeholder, pass, fail, noTests, error. Inline collapsible button with `useId` for `aria-controls`. Three-part proportional bar.

**Files:**

- Modify: `src/features/agent-status/components/TestResults.tsx` (full rewrite)
- Modify: `src/features/agent-status/components/TestResults.test.tsx` (full rewrite)
- Modify: `src/features/agent-status/components/AgentStatusPanel.tsx`

- [ ] **Step 1: Write failing tests for all five states (single shot — many cases)**

Replace `src/features/agent-status/components/TestResults.test.tsx`:

```tsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TestResults } from './TestResults'
import type { TestRunSnapshot } from '../types'

const baseSnap = (overrides: Partial<TestRunSnapshot>): TestRunSnapshot => ({
  sessionId: 's',
  runner: 'vitest',
  commandPreview: 'vitest run',
  startedAt: '2026-04-28T12:00:00Z',
  finishedAt: '2026-04-28T12:00:01Z',
  durationMs: 1400,
  status: 'pass',
  summary: { passed: 47, failed: 0, skipped: 0, total: 47, groups: [] },
  outputExcerpt: null,
  ...overrides,
})

describe('TestResults — placeholder', () => {
  test('renders dim placeholder when snapshot is null', () => {
    render(<TestResults snapshot={null} />)
    expect(screen.getByRole('status')).toHaveTextContent(/no runs yet/i)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('TestResults — live header', () => {
  test('pass state shows count, runner pill, duration', () => {
    render(<TestResults snapshot={baseSnap({ status: 'pass' })} />)
    const button = screen.getByRole('button', { name: /tests/i })
    expect(button).toHaveTextContent('47/47')
    expect(button).toHaveTextContent('vitest')
    expect(button).toHaveTextContent('1.4s')
  })

  test('fail state shows fail count', () => {
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'fail',
          summary: { passed: 45, failed: 2, skipped: 0, total: 47, groups: [] },
        })}
      />
    )
    expect(screen.getByRole('button', { name: /tests/i })).toHaveTextContent(
      '45/47'
    )
  })

  test('noTests state shows 0/0', () => {
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'noTests',
          summary: { passed: 0, failed: 0, skipped: 0, total: 0, groups: [] },
        })}
      />
    )
    expect(screen.getByRole('button', { name: /tests/i })).toHaveTextContent(
      '0/0'
    )
  })

  test('error state header shows the runner and an error indicator', () => {
    render(
      <TestResults
        snapshot={baseSnap({ status: 'error', outputExcerpt: 'TS error' })}
      />
    )
    const button = screen.getByRole('button', { name: /tests/i })
    expect(button).toHaveTextContent('vitest')
  })
})

describe('TestResults — keyboard activation', () => {
  test('Enter and Space toggle expand without custom handlers', async () => {
    const user = userEvent.setup()
    render(<TestResults snapshot={baseSnap({})} />)
    const button = screen.getByRole('button', { name: /tests/i })

    expect(button).toHaveAttribute('aria-expanded', 'false')

    button.focus()
    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('TestResults — expanded body', () => {
  test('fail state renders summary text and group rows', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'fail',
          summary: {
            passed: 45,
            failed: 2,
            skipped: 1,
            total: 48,
            groups: [
              {
                label: 'src/foo.test.ts',
                path: '/abs/src/foo.test.ts',
                kind: 'file',
                passed: 12,
                failed: 0,
                skipped: 0,
                total: 12,
                status: 'pass',
              },
              {
                label: 'src/bar.test.ts',
                path: '/abs/src/bar.test.ts',
                kind: 'file',
                passed: 5,
                failed: 2,
                skipped: 0,
                total: 7,
                status: 'fail',
              },
            ],
          },
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))

    expect(screen.getByText(/45 passed/)).toBeInTheDocument()
    expect(screen.getByText(/2 failed/)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /open src\/foo\.test\.ts/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /open src\/bar\.test\.ts/i })
    ).toBeInTheDocument()
  })

  test('error state renders outputExcerpt fallback when null', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({ status: 'error', outputExcerpt: null })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.getByText(/runner errored/i)).toBeInTheDocument()
  })

  test('error state renders outputExcerpt when present', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'error',
          outputExcerpt: 'compile error: TS2345',
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.getByText(/compile error: TS2345/)).toBeInTheDocument()
  })

  test('noTests state shows "no tests collected"', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'noTests',
          summary: { passed: 0, failed: 0, skipped: 0, total: 0, groups: [] },
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.getByText(/no tests collected/i)).toBeInTheDocument()
  })
})

describe('TestResults — group row click', () => {
  test('file row with path and onOpenFile is a button that fires onOpenFile', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <TestResults
        snapshot={baseSnap({
          summary: {
            passed: 12,
            failed: 0,
            skipped: 0,
            total: 12,
            groups: [
              {
                label: 'src/foo.test.ts',
                path: '/abs/src/foo.test.ts',
                kind: 'file',
                passed: 12,
                failed: 0,
                skipped: 0,
                total: 12,
                status: 'pass',
              },
            ],
          },
        })}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    await user.click(
      screen.getByRole('button', { name: /open src\/foo\.test\.ts/i })
    )
    expect(onOpenFile).toHaveBeenCalledOnce()
    expect(onOpenFile).toHaveBeenCalledWith('/abs/src/foo.test.ts')
  })

  test('file row with null path is non-interactive (no button)', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <TestResults
        snapshot={baseSnap({
          summary: {
            passed: 1,
            failed: 0,
            skipped: 0,
            total: 1,
            groups: [
              {
                label: 'src/missing.test.ts',
                path: null,
                kind: 'file',
                passed: 1,
                failed: 0,
                skipped: 0,
                total: 1,
                status: 'pass',
              },
            ],
          },
        })}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    // No button for the missing file — only the header button remains.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent(/tests/i)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  test('module/suite row never interactive', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <TestResults
        snapshot={baseSnap({
          summary: {
            passed: 5,
            failed: 0,
            skipped: 0,
            total: 5,
            groups: [
              {
                label: 'mycrate::tests',
                path: null,
                kind: 'module',
                passed: 5,
                failed: 0,
                skipped: 0,
                total: 5,
                status: 'pass',
              },
            ],
          },
        })}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.queryByRole('button', { name: /open mycrate/i })).toBeNull()
  })
})

describe('TestResults — useId aria-controls uniqueness', () => {
  test('two TestResults in one render have distinct aria-controls', () => {
    render(
      <>
        <TestResults snapshot={baseSnap({ runner: 'vitest' })} />
        <TestResults snapshot={baseSnap({ runner: 'cargo' })} />
      </>
    )
    const buttons = screen.getAllByRole('button', { name: /tests/i })
    expect(buttons).toHaveLength(2)
    const a = buttons[0].getAttribute('aria-controls')
    const b = buttons[1].getAttribute('aria-controls')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run the tests — all should fail (component still has old API)**

Run: `npx vitest run src/features/agent-status/components/TestResults.test.tsx`
Expected: All tests fail because the component takes `passed`/`failed`/`total` props, not `snapshot`.

- [ ] **Step 3: Rewrite `TestResults.tsx`**

Replace `src/features/agent-status/components/TestResults.tsx`:

```tsx
import { useId, useState } from 'react'
import type { ReactElement } from 'react'

import type { TestGroup, TestRunSnapshot, TestRunStatus } from '../types'

interface TestResultsProps {
  snapshot: TestRunSnapshot | null
  onOpenFile?: (path: string) => void
}

export const TestResults = ({
  snapshot,
  onOpenFile,
}: TestResultsProps): ReactElement => {
  if (snapshot === null) {
    return <TestResultsPlaceholder />
  }
  return <TestResultsLive snapshot={snapshot} onOpenFile={onOpenFile} />
}

const TestResultsPlaceholder = (): ReactElement => (
  <div
    role="status"
    aria-live="polite"
    className="border-t border-outline-variant/[0.08] px-5 py-3 font-mono text-[10px] tracking-[0.15em] text-on-surface-variant/60 uppercase"
    data-testid="test-results"
  >
    Tests &nbsp;&nbsp;no runs yet
  </div>
)

interface LiveProps {
  snapshot: TestRunSnapshot
  onOpenFile?: (path: string) => void
}

const TestResultsLive = ({ snapshot, onOpenFile }: LiveProps): ReactElement => {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  const { passed, failed, total } = snapshot.summary
  const dotClass = statusDotClass(snapshot.status)

  return (
    <div
      className="border-t border-outline-variant/[0.08]"
      data-testid="test-results"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-left"
      >
        <span className="text-[10px] text-outline">{expanded ? '▾' : '▸'}</span>
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-outline">
          Tests
        </span>
        <span
          className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
          aria-hidden
        />
        <span className="font-mono text-[10px] text-on-surface">
          {passed}/{total}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant/70">
          · {snapshot.runner}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant/70">
          · {formatDuration(snapshot.durationMs)}
        </span>
      </button>
      <div id={bodyId} hidden={!expanded} className="px-5 pb-3">
        {expanded && (
          <TestResultsBody snapshot={snapshot} onOpenFile={onOpenFile} />
        )}
      </div>
    </div>
  )
}

const TestResultsBody = ({
  snapshot,
  onOpenFile,
}: {
  snapshot: TestRunSnapshot
  onOpenFile?: (path: string) => void
}): ReactElement => {
  if (snapshot.status === 'noTests') {
    return (
      <span className="font-mono text-[10px] text-on-surface-variant">
        no tests collected
      </span>
    )
  }
  if (snapshot.status === 'error') {
    return (
      <span className="font-mono text-[10px] text-on-surface-variant">
        {snapshot.outputExcerpt ?? 'runner errored before producing results'}
      </span>
    )
  }

  const { passed, failed, skipped } = snapshot.summary
  return (
    <div className="flex flex-col gap-2">
      <ProportionalBar passed={passed} failed={failed} skipped={skipped} />
      <SummaryText passed={passed} failed={failed} skipped={skipped} />
      <ul className="flex flex-col gap-1">
        {snapshot.summary.groups.map((g, i) => (
          <li key={`${g.label}-${i}`}>
            <GroupRow group={g} onOpenFile={onOpenFile} />
          </li>
        ))}
      </ul>
    </div>
  )
}

const ProportionalBar = ({
  passed,
  failed,
  skipped,
}: {
  passed: number
  failed: number
  skipped: number
}): ReactElement => {
  if (passed + failed + skipped === 0) {
    return <></>
  }
  return (
    <div className="flex h-[3px] w-full overflow-hidden rounded-full">
      {passed > 0 && (
        <div style={{ flexGrow: passed }} className="bg-success" />
      )}
      {failed > 0 && <div style={{ flexGrow: failed }} className="bg-error" />}
      {skipped > 0 && (
        <div
          style={{ flexGrow: skipped }}
          className="bg-on-surface-variant/40"
        />
      )}
    </div>
  )
}

const SummaryText = ({
  passed,
  failed,
  skipped,
}: {
  passed: number
  failed: number
  skipped: number
}): ReactElement => {
  const parts = [`${passed} passed`]
  if (failed > 0) parts.push(`${failed} failed`)
  if (skipped > 0) parts.push(`${skipped} skipped`)
  return (
    <span className="font-mono text-[10px] font-bold text-on-surface">
      {parts.join(', ')}
    </span>
  )
}

const GroupRow = ({
  group,
  onOpenFile,
}: {
  group: TestGroup
  onOpenFile?: (path: string) => void
}): ReactElement => {
  const icon = groupIcon(group.status)
  const countText =
    group.skipped > 0
      ? `${group.passed}/${group.total} (${group.skipped} skipped)`
      : `${group.passed}/${group.total}`

  if (
    group.kind === 'file' &&
    group.path !== null &&
    onOpenFile !== undefined
  ) {
    return (
      <button
        type="button"
        aria-label={`Open ${group.label}`}
        onClick={() => onOpenFile(group.path!)}
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-container-high"
      >
        <span
          className={`${groupIconColor(group.status)} font-mono text-[11px]`}
          aria-hidden
        >
          {icon}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-on-surface">
          {group.label}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant">
          {countText}
        </span>
      </button>
    )
  }

  return (
    <div className="flex w-full items-center gap-2 px-1 py-0.5">
      <span
        className={`${groupIconColor(group.status)} font-mono text-[11px]`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex-1 truncate font-mono text-[11px] text-on-surface">
        {group.label}
      </span>
      <span className="font-mono text-[10px] text-on-surface-variant">
        {countText}
      </span>
    </div>
  )
}

const statusDotClass = (s: TestRunStatus): string => {
  switch (s) {
    case 'pass':
      return 'bg-success'
    case 'fail':
      return 'bg-error'
    case 'noTests':
      return 'bg-on-surface-variant'
    case 'error':
      return 'bg-tertiary'
  }
}

const groupIcon = (s: TestGroup['status']): string => {
  switch (s) {
    case 'pass':
      return '✓'
    case 'fail':
      return '✗'
    case 'skip':
      return '⊘'
  }
}

const groupIconColor = (s: TestGroup['status']): string => {
  switch (s) {
    case 'pass':
      return 'text-success'
    case 'fail':
      return 'text-error'
    case 'skip':
      return 'text-on-surface-variant'
  }
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}
```

- [ ] **Step 4: Run all `TestResults` tests**

Run: `npx vitest run src/features/agent-status/components/TestResults.test.tsx`
Expected: All tests pass.

- [ ] **Step 5: Wire `AgentStatusPanel`**

Edit `src/features/agent-status/components/AgentStatusPanel.tsx`. Remove the `placeholderTests` const (line 20). Update the props:

```tsx
interface AgentStatusPanelProps {
  sessionId: string | null
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
}
```

Update the destructuring at line 22:

```tsx
export const AgentStatusPanel = ({
  sessionId,
  cwd,
  onOpenDiff,
  onOpenFile,
}: AgentStatusPanelProps): ReactElement => {
```

Replace the `<TestResults ... />` block (line 95-99):

```tsx
<TestResults snapshot={status.testRun} onOpenFile={onOpenFile} />
```

- [ ] **Step 6: Type-check the panel**

Run: `npm run type-check`
Expected: No type errors.

Run: `npx vitest run src/features/agent-status`
Expected: All agent-status tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent-status/components/TestResults.tsx \
        src/features/agent-status/components/TestResults.test.tsx \
        src/features/agent-status/components/AgentStatusPanel.tsx
git commit -m "feat(agent-status): rewrite TestResults around TestRunSnapshot prop

Single nullable snapshot prop. Five visual states: placeholder (slim
'no runs yet' row), pass, fail, noTests, error. Inline collapsible
button with useId-derived aria-controls (no manual key handler).
Three-part proportional bar (passed/failed/skipped) — constant DOM.
File-kind group rows are buttons when path is non-null and onOpenFile
is provided; otherwise non-interactive divs."
```

---

## Task 9: WorkspaceView.handleOpenTestFile

Add a new dirty-state-guarded handler in `WorkspaceView` and pass it through `AgentStatusPanel.onOpenFile`. Mirrors the existing `handleFileSelect` pattern.

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx`

- [ ] **Step 1: Read existing WorkspaceView.test.tsx for the test pattern**

Run: `grep -n "handleFileSelect\|useEditorBuffer\|AgentStatusPanel" src/features/workspace/WorkspaceView.test.tsx | head -20`

Note the existing pattern for: (a) how `useEditorBuffer` is mocked, (b) how `AgentStatusPanel` is mocked or rendered, (c) how `setShowUnsavedDialog` / pending-path state is asserted. Reuse that exact pattern in Step 2's test code.

- [ ] **Step 2: Write failing tests for the new handler**

Edit `src/features/workspace/WorkspaceView.test.tsx`. Add the following tests, adjusting the mock-setup helpers to match the existing patterns observed in Step 1:

```typescript
test('handleOpenTestFile opens file directly when buffer is clean', async () => {
  const openFileMock = vi.fn().mockResolvedValue(undefined)
  // Mock useEditorBuffer with isDirty: false. Replace this with whatever
  // mock pattern Step 1 surfaced (could be vi.mock('../editor/hooks/useEditorBuffer'),
  // or a wrapper provider). Below is the shape:
  vi.mocked(useEditorBuffer).mockReturnValue({
    isDirty: false,
    openFile: openFileMock,
    saveFile: vi.fn(),
    filePath: null,
    currentContent: '',
    loading: false,
  } as unknown as ReturnType<typeof useEditorBuffer>)

  render(<WorkspaceView />)

  // Find the AgentStatusPanel render (mocked or real) and grab the onOpenFile
  // prop that was passed. If AgentStatusPanel is mocked with vi.mock, the
  // mock implementation should capture props for inspection.
  const onOpenFile = capturedAgentStatusPanelProps.onOpenFile as (p: string) => void
  expect(onOpenFile).toBeDefined()

  await act(async () => {
    onOpenFile('/abs/src/foo.test.ts')
  })

  expect(openFileMock).toHaveBeenCalledOnce()
  expect(openFileMock).toHaveBeenCalledWith('/abs/src/foo.test.ts')
  expect(screen.queryByText(/unsaved changes/i)).toBeNull()
})

test('handleOpenTestFile shows unsaved dialog when buffer is dirty', async () => {
  const openFileMock = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useEditorBuffer).mockReturnValue({
    isDirty: true,
    openFile: openFileMock,
    saveFile: vi.fn(),
    filePath: 'src/current.ts',
    currentContent: 'edits',
    loading: false,
  } as unknown as ReturnType<typeof useEditorBuffer>)

  render(<WorkspaceView />)

  const onOpenFile = capturedAgentStatusPanelProps.onOpenFile as (p: string) => void

  await act(async () => {
    onOpenFile('/abs/src/bar.test.ts')
  })

  expect(openFileMock).not.toHaveBeenCalled()
  expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument()
})
```

Setup helper for capturing `AgentStatusPanel` props (add at the top of the test file if not already present):

```typescript
const capturedAgentStatusPanelProps: {
  onOpenFile?: (p: string) => void
  onOpenDiff?: unknown
} = {}

vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: (props: {
    onOpenFile?: (p: string) => void
    onOpenDiff?: unknown
  }) => {
    capturedAgentStatusPanelProps.onOpenFile = props.onOpenFile
    capturedAgentStatusPanelProps.onOpenDiff = props.onOpenDiff
    return null
  },
}))
```

If a different mock for `AgentStatusPanel` already exists in the test file, extend its mock implementation to record `onOpenFile` instead of replacing it.

- [ ] **Step 3: Run the failing tests**

Run: `npx vitest run src/features/workspace/WorkspaceView.test.tsx`
Expected: New tests fail because `handleOpenTestFile` doesn't exist (the mock captures `onOpenFile: undefined`).

- [ ] **Step 4: Implement `handleOpenTestFile`**

Edit `src/features/workspace/WorkspaceView.tsx`. Below the existing `handleFileSelect` (line 144), add:

```typescript
// Open a test file from the activity panel. Mirrors handleFileSelect's
// dirty-state guard so clicking a test result row never silently
// discards unsaved editor changes — the same unsaved-dialog flow
// resumes the pending open.
const handleOpenTestFile = useCallback(
  (filePath: string): void => {
    if (editorBuffer.isDirty) {
      setPendingFilePathSynced(filePath)
      setShowUnsavedDialog(true)
      return
    }
    void openFileSafely(filePath)
  },
  [editorBuffer.isDirty, openFileSafely, setPendingFilePathSynced]
)
```

Then pass it down. Find the `<AgentStatusPanel ... />` render site and add the prop:

```tsx
<AgentStatusPanel
  sessionId={...}
  cwd={...}
  onOpenDiff={handleOpenDiff}
  onOpenFile={handleOpenTestFile}
/>
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run src/features/workspace/WorkspaceView.test.tsx`
Expected: New tests pass.

Run: `npm run type-check`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx \
        src/features/workspace/WorkspaceView.test.tsx
git commit -m "feat(workspace): handleOpenTestFile mirrors handleFileSelect guard

Activity panel test-result rows route through a new handler that
respects editorBuffer.isDirty — clean buffer opens directly, dirty
buffer queues the path and surfaces the unsaved dialog. Reuses the
existing handleSave/handleDiscard/handleCancel resumption flow."
```

---

## Task 10: Cargo result parser + cargo fixture

Implement `cargo_parse_result` and add a fixture covering passes, failures, and ignored tests.

**Files:**

- Modify: `src-tauri/src/agent/test_runners/cargo.rs`
- Create: `src-tauri/tests/fixtures/transcript_cargo_mixed.jsonl`
- Create: `src-tauri/tests/transcript_cargo_e2e.rs`

- [ ] **Step 1: Test for `cargo_parse_result` (failing)**

Replace `src-tauri/src/agent/test_runners/cargo.rs`:

```rust
//! Cargo test result parser. Targets cargo 1.7x output format.
//!
//! Cargo writes its summary to stderr (CapturedOutput.content carries combined
//! stdout+stderr because the Bash tool returns combined output).
//!
//! Canonical summary line:
//!   test result: ok. 47 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out;
//!
//! Per-test lines:
//!   test some_module::test_foo ... ok
//!   test some_module::test_bar ... FAILED
//!   test some_module::test_baz ... ignored

use std::collections::HashMap;
use std::path::Path;

use once_cell::sync::Lazy;
use regex::Regex;

use super::types::{
    CapturedOutput, TestGroup, TestGroupKind, TestGroupStatus, TestRunSummary, TestRunner,
};

pub static CARGO_TEST: TestRunner = TestRunner {
    name: "cargo",
    matches: cargo_matches,
    parse_result: cargo_parse_result,
};

const MAX_GROUPS: usize = 500;

fn cargo_matches(tokens: &[&str]) -> bool {
    matches!(tokens, [&"cargo", &"test", ..])
}

static ANSI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap());

// Summary line. Cargo may produce multiple summary lines (one per binary);
// we sum across all of them.
//   test result: ok. 47 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out
static SUMMARY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?m)test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored",
    )
    .unwrap()
});

// Individual test outcome lines:
//   test foo::bar::test_x ... ok
//   test foo::bar::test_y ... FAILED
//   test foo::bar::test_z ... ignored
static TEST_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^test\s+([\w:]+)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$").unwrap()
});

fn cargo_parse_result(out: &CapturedOutput, _cwd: &Path) -> Option<TestRunSummary> {
    let stripped = ANSI_RE.replace_all(&out.content, "").to_string();

    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut skipped = 0u32;
    let mut found_summary = false;
    for cap in SUMMARY_RE.captures_iter(&stripped) {
        found_summary = true;
        passed += cap.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        failed += cap.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        skipped += cap.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    }
    if !found_summary {
        return None;
    }
    let total = passed + failed + skipped;

    // Build per-module groups from individual test lines.
    let mut module_counts: HashMap<String, (u32, u32, u32)> = HashMap::new(); // (pass, fail, skip)
    for cap in TEST_LINE_RE.captures_iter(&stripped) {
        let full_path = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let outcome = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        // Module = everything before the last "::"
        let module = match full_path.rfind("::") {
            Some(i) => &full_path[..i],
            None => full_path,
        };
        let entry = module_counts.entry(module.to_string()).or_default();
        match outcome {
            "ok" => entry.0 += 1,
            "FAILED" => entry.1 += 1,
            "ignored" => entry.2 += 1,
            _ => {}
        }
    }

    let mut groups: Vec<TestGroup> = module_counts
        .into_iter()
        .take(MAX_GROUPS)
        .map(|(label, (p, f, s))| {
            let total = p + f + s;
            let status = if f > 0 {
                TestGroupStatus::Fail
            } else if total == 0 || (s > 0 && p == 0) {
                TestGroupStatus::Skip
            } else {
                TestGroupStatus::Pass
            };
            TestGroup {
                label,
                path: None, // cargo modules don't map to files reliably in v1
                kind: TestGroupKind::Module,
                passed: p,
                failed: f,
                skipped: s,
                total,
                status,
            }
        })
        .collect();
    groups.sort_by(|a, b| a.label.cmp(&b.label));

    Some(TestRunSummary {
        passed,
        failed,
        skipped,
        total,
        groups,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn captured(content: &str) -> CapturedOutput {
        CapturedOutput { content: content.to_string(), is_error: false }
    }

    #[test]
    fn parses_simple_pass_summary() {
        let out = captured(
            "running 3 tests
test mycrate::tests::test_a ... ok
test mycrate::tests::test_b ... ok
test mycrate::tests::test_c ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n"
        );
        let s = cargo_parse_result(&out, &PathBuf::from("/tmp")).unwrap();
        assert_eq!(s.passed, 3);
        assert_eq!(s.failed, 0);
        assert_eq!(s.skipped, 0);
        assert_eq!(s.groups.len(), 1);
        assert_eq!(s.groups[0].label, "mycrate::tests");
        assert_eq!(s.groups[0].passed, 3);
        assert_eq!(s.groups[0].kind, TestGroupKind::Module);
        assert!(s.groups[0].path.is_none());
    }

    #[test]
    fn parses_mixed_outcomes() {
        let out = captured(
            "running 3 tests
test mycrate::a::test_x ... ok
test mycrate::a::test_y ... FAILED
test mycrate::b::test_z ... ignored

test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out\n"
        );
        let s = cargo_parse_result(&out, &PathBuf::from("/tmp")).unwrap();
        assert_eq!(s.passed, 1);
        assert_eq!(s.failed, 1);
        assert_eq!(s.skipped, 1);
        assert_eq!(s.groups.len(), 2);
        let a = s.groups.iter().find(|g| g.label == "mycrate::a").unwrap();
        assert_eq!(a.passed, 1);
        assert_eq!(a.failed, 1);
        assert_eq!(a.status, TestGroupStatus::Fail);
        let b = s.groups.iter().find(|g| g.label == "mycrate::b").unwrap();
        assert_eq!(b.skipped, 1);
        assert_eq!(b.status, TestGroupStatus::Skip);
    }

    #[test]
    fn sums_multiple_summary_lines() {
        let out = captured(
            "test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
test result: ok. 3 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out\n"
        );
        let s = cargo_parse_result(&out, &PathBuf::from("/tmp")).unwrap();
        assert_eq!(s.passed, 8);
        assert_eq!(s.failed, 1);
    }

    #[test]
    fn returns_none_when_no_summary() {
        let out = captured("error: failed to compile crate");
        assert!(cargo_parse_result(&out, &PathBuf::from("/tmp")).is_none());
    }
}
```

- [ ] **Step 2: Run cargo parser tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::test_runners::cargo`
Expected: All 4 tests pass.

- [ ] **Step 3: Add cargo fixture**

Create `src-tauri/tests/fixtures/transcript_cargo_mixed.jsonl`:

```jsonl
{"type":"assistant","timestamp":"2026-04-28T13:00:00.000Z","message":{"content":[{"type":"tool_use","id":"c1","name":"Bash","input":{"command":"cargo test"}}]}}
{"type":"user","timestamp":"2026-04-28T13:00:05.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"c1","is_error":false,"content":"running 3 tests\ntest mycrate::a::test_x ... ok\ntest mycrate::a::test_y ... FAILED\ntest mycrate::b::test_z ... ignored\n\ntest result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out\n"}]}}
```

- [ ] **Step 4: Add the cargo end-to-end test**

Create `src-tauri/tests/transcript_cargo_e2e.rs`:

```rust
use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn cargo_mixed_fixture_emits_test_run_with_groups() {
    use tauri::test::mock_builder;
    use tauri::Listener;

    let app = mock_builder().build(tauri::generate_context!()).unwrap();
    let app_handle = app.handle().clone();

    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recv_clone = received.clone();
    app_handle.listen("test-run", move |event| {
        recv_clone.lock().unwrap().push(event.payload().to_string());
    });

    let state = TranscriptState::new();
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_cargo_mixed.jsonl");

    state
        .start_or_replace(
            app_handle,
            "session-cargo".to_string(),
            fixture_path,
            None,
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(2000));
    state.stop("session-cargo").ok();

    let events = received.lock().unwrap();
    assert_eq!(events.len(), 1);
    let payload = &events[0];
    assert!(payload.contains(r#""runner":"cargo""#));
    assert!(payload.contains(r#""passed":1"#));
    assert!(payload.contains(r#""failed":1"#));
    assert!(payload.contains(r#""skipped":1"#));
    assert!(payload.contains(r#""status":"fail""#));
    assert!(payload.contains(r#""kind":"module""#));
    assert!(payload.contains(r#""path":null"#));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test transcript_cargo_e2e`
Expected: Passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/test_runners/cargo.rs \
        src-tauri/tests/fixtures/transcript_cargo_mixed.jsonl \
        src-tauri/tests/transcript_cargo_e2e.rs
git commit -m "feat(agent): cargo test result parser + mixed-outcome fixture

Implements cargo_parse_result for the standard 'test result: ...'
summary line and per-test outcome lines, sums multiple summary blocks
(one per binary), groups by '<crate>::<module>' (kind: Module, path:
None — cargo modules don't map to files reliably in v1)."
```

---

## Task 11: Activity feed glyph + verb mapping

Render the test-file flag in the activity feed: prepend `🧪` and use `Created test:` / `Updated test:` based on `tool === 'Edit' | 'Write'`.

**Files:**

- Modify: `src/features/agent-status/types/activityEvent.ts`
- Modify: `src/features/agent-status/utils/toolCallsToEvents.ts`
- Modify: whichever component renders an `ActivityEvent` row (likely `ActivityEvent.tsx` or `ActivityFeed.tsx`)
- Modify: `src/features/agent-status/utils/toolCallsToEvents.test.ts`
- Modify: tests for the row component

- [ ] **Step 1: Locate the row renderer (already known)**

The single-row renderer is `src/features/agent-status/components/ActivityEvent.tsx` — it exposes a `getLabel(event)` helper that returns the uppercase row label (`EDIT`, `WRITE`, etc.) and renders `event.body` as the row content. The patch in Step 5 modifies `getLabel` to prepend `🧪 CREATED TEST` / `🧪 UPDATED TEST` when `event.isTestFile === true`.

The corresponding test file is `src/features/agent-status/components/ActivityEvent.test.tsx`.

- [ ] **Step 2: Add `isTestFile` to `ActivityEvent`**

Edit `src/features/agent-status/types/activityEvent.ts`:

```typescript
export interface ActivityEvent {
  // ...existing fields...
  isTestFile?: boolean
}
```

- [ ] **Step 3: Test for propagation in `toolCallsToEvents` (failing)**

Edit `src/features/agent-status/utils/toolCallsToEvents.test.ts`:

```typescript
test('propagates isTestFile from RecentToolCall to ActivityEvent', () => {
  const recent: RecentToolCall[] = [
    {
      id: 'tu_1',
      tool: 'Write',
      args: 'src/foo.test.ts',
      status: 'done',
      durationMs: 100,
      timestamp: '2026-04-28T12:00:00Z',
      isTestFile: true,
    },
  ]
  const events = toolCallsToEvents(null, recent)
  expect(events[0]?.isTestFile).toBe(true)
})

test('isTestFile defaults to false when not on RecentToolCall', () => {
  const recent: RecentToolCall[] = [
    {
      id: 'tu_2',
      tool: 'Read',
      args: 'src/foo.ts',
      status: 'done',
      durationMs: 5,
      timestamp: '2026-04-28T12:01:00Z',
      isTestFile: false,
    },
  ]
  const events = toolCallsToEvents(null, recent)
  expect(events[0]?.isTestFile).toBe(false)
})
```

Run: `npx vitest run src/features/agent-status/utils/toolCallsToEvents.test.ts`
Expected: New tests fail (field not propagated).

- [ ] **Step 4: Propagate `isTestFile` in `toolCallsToEvents`**

Edit `src/features/agent-status/utils/toolCallsToEvents.ts`. In the loop at line 75:

```typescript
for (const r of sortedRecent) {
  events.push({
    id: r.id,
    kind: toolToKind(r.tool),
    tool: r.tool,
    body: r.args,
    timestamp: r.timestamp,
    status: r.status,
    durationMs: r.durationMs,
    isTestFile: r.isTestFile,
  })
}
```

Run: `npx vitest run src/features/agent-status/utils/toolCallsToEvents.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Modify `getLabel` to prepend test-file verb**

Edit `src/features/agent-status/components/ActivityEvent.tsx`. Replace the existing `getLabel` (around line 38):

```tsx
const getLabel = (event: ActivityEventType): string => {
  if (event.isTestFile === true) {
    // Write tools may also overwrite existing files — labelled as "CREATED"
    // by approximation. Edit always means an existing file was modified.
    // Documented limitation in the spec.
    const verb = event.tool === 'Edit' ? 'UPDATED TEST' : 'CREATED TEST'
    return `🧪 ${verb}`
  }
  if (event.kind === 'meta') {
    return event.tool.toUpperCase()
  }
  return event.kind.toUpperCase()
}
```

The `🧪` glyph rides inside the existing label `<span>` (line 175–179) — no new DOM nodes, no layout changes. Color is inherited from `KIND_COLOR[event.kind]`, so test-file Write rows still get `text-primary-container` and test-file Edit rows get the same. (If you want a distinct test colour, that's a follow-up — keeping it tonally consistent for v1.)

- [ ] **Step 6: Add tests for rendering**

Add three tests to `src/features/agent-status/components/ActivityEvent.test.tsx`. Note the `now` prop is required by `<ActivityEvent>` and the existing test file should already import the necessary helpers — match its pattern.

```typescript
import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { ActivityEvent } from './ActivityEvent'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

const NOW = new Date('2026-04-28T12:05:00Z')

test('renders 🧪 CREATED TEST label for Write of a test file', () => {
  const event: ActivityEventType = {
    id: 'e1',
    kind: 'write',
    tool: 'Write',
    body: 'src/foo.test.ts',
    timestamp: '2026-04-28T12:00:00Z',
    status: 'done',
    durationMs: 50,
    isTestFile: true,
  }
  render(<ActivityEvent event={event} now={NOW} />)
  expect(screen.getByText(/created test/i)).toBeInTheDocument()
  // Glyph rides inside the same label span — partial-text match is fine.
  expect(screen.getByText(/🧪/)).toBeInTheDocument()
})

test('renders 🧪 UPDATED TEST label for Edit of a test file', () => {
  const event: ActivityEventType = {
    id: 'e2',
    kind: 'edit',
    tool: 'Edit',
    body: 'src/foo.test.ts',
    timestamp: '2026-04-28T12:01:00Z',
    status: 'done',
    durationMs: 30,
    isTestFile: true,
  }
  render(<ActivityEvent event={event} now={NOW} />)
  expect(screen.getByText(/updated test/i)).toBeInTheDocument()
})

test('regular Write event has no test glyph or prefix', () => {
  const event: ActivityEventType = {
    id: 'e3',
    kind: 'write',
    tool: 'Write',
    body: 'src/foo.ts',
    timestamp: '2026-04-28T12:02:00Z',
    status: 'done',
    durationMs: 50,
    isTestFile: false,
  }
  render(<ActivityEvent event={event} now={NOW} />)
  expect(screen.queryByText(/created test/i)).toBeNull()
  expect(screen.queryByText(/🧪/)).toBeNull()
  // Falls back to the kind-based label.
  expect(screen.getByText(/^WRITE$/)).toBeInTheDocument()
})
```

Run: `npx vitest run src/features/agent-status`
Expected: All tests pass.

- [ ] **Step 7: Final full-suite run**

Run: `npm test`
Expected: All TS tests pass.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All Rust tests pass.

Run: `npm run type-check`
Expected: Clean.

Run: `npm run lint`
Expected: No new errors.

- [ ] **Step 8: Commit**

```bash
git add src/features/agent-status/types/activityEvent.ts \
        src/features/agent-status/utils/toolCallsToEvents.ts \
        src/features/agent-status/utils/toolCallsToEvents.test.ts \
        src/features/agent-status/components/ActivityEvent.tsx \
        src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "feat(agent-status): activity feed badges test-file Write/Edit calls

Propagates isTestFile from RecentToolCall through ActivityEvent. The
row renderer prepends a 🧪 glyph and 'Created test:' / 'Updated test:'
label when isTestFile === true (Write → Created, Edit → Updated;
documented Write-overwrite caveat in the spec)."
```

---

## Self-review checklist

After all 11 tasks land, verify:

- [ ] `npm test` passes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `npm run type-check` clean
- [ ] `npm run lint` no new errors
- [ ] `npm run format:check` clean
- [ ] Manual smoke test: launch the app (`npm run tauri:dev`), open a workspace with vitest tests, run `vitest run` from the integrated terminal, confirm the TESTS panel transitions from `no runs yet` → live with the count and per-file rows; click a row, confirm the file opens in the editor.
- [ ] Manual smoke test: with a dirty buffer, click a test row, confirm the unsaved-changes dialog appears.
