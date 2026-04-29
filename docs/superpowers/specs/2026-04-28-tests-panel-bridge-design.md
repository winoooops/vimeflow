# Tests Panel & Claude Code Bridge — Design Spec

**Date**: 2026-04-28
**Status**: Draft (pre-implementation)
**Depends on**: Real-time agent status sidebar (#57, merged), Transcript parser for tool call tracking (#63, merged), PtyState CWD resolution (#60, merged), PTY reattach with cursor protocol (#55, merged)

## Problem

The activity sidebar already renders a `<TestResults>` placeholder showing `▶ TESTS 0/0`. Today the data is hard-coded zeros at `src/features/agent-status/components/AgentStatusPanel.tsx:96` — no test runner is observed, no events flow, the panel is decorative. We need to:

1. Decide **when** the panel is visible.
2. Make it **automatically populate** when test events occur, with no per-project setup.
3. Establish a **bridge** between the integrated coding agent (Claude Code) and the app so test runs and test-file creation surface in the UI.

## Solution

Extend the existing transcript-watcher pipeline (the same one that powers `agent-tool-call`) to (a) recognise Bash tool calls that invoke a known test runner and parse their result content into a structured `TestRunSnapshot`, and (b) tag Write/Edit tool calls whose `file_path` is a test file. The snapshot is delivered to the frontend over a new `test-run` Tauri event; test-file tagging rides on the existing `agent-tool-call` event via a new `is_test_file` boolean.

The visible panel uses a **lazy, activity-driven** model: it doesn't exist (beyond a slim placeholder row) until the first matched test run for the active session. There is **no filesystem detection at startup**, **no extra Claude Code configuration**, **no command hijacking**.

## Decisions

| #   | Decision                                               | Choice                                                                                                       | Rationale                                                                                 |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Q1  | When does the TESTS panel appear?                      | Only when project has tests configured — refined to lazy / activity-driven (Q5)                              | Avoids cold-start filesystem scan; nothing renders for non-test projects.                 |
| Q2  | How does the app learn about test events?              | Passive transcript parsing extending the #63 pipeline                                                        | Zero per-project setup; reuses the watcher already on disk.                               |
| Q3  | How are test commands identified?                      | Strict allowlist with `npm/yarn/pnpm/bun run` script resolution; runner registry leaves room for new entries | Zero false positives; allowlist trivially extensible by adding one file.                  |
| Q4  | What does the expanded panel show?                     | Compact per-file (or per-suite/module) summary with pass/fail/skip counts; click file rows to open in editor | Smallest unit that's actually useful for navigating to failures; failure detail deferred. |
| Q5  | How is "tests configured" detected?                    | Lazy / activity-driven — panel materialises on first matched test run                                        | Cheaper cold start; avoids fs detection logic; matches Q1 intent.                         |
| Q6  | First-time UX for projects that haven't yet run tests? | Slim dim placeholder row `▶ TESTS no runs yet`; promote to live panel on first event                         | One-DOM-line discoverability; ask-Claude CTA deferred to v2.                              |

## Architecture

```
Claude Code transcript JSONL  (Bash tool_use + tool_result blocks)
        │  (existing transcript watcher in src-tauri/src/agent/transcript.rs)
        ▼
Rust transcript parser  (extended)
   1. On Bash tool_use: read raw input.command (NOT the summarized args).
      Match BEFORE summarize_input() truncates to MAX_ARGS_LEN.
      Store { tool_use_id → (runner, raw_command) } on InFlightToolCall.
   2. On Write/Edit tool_use: check input.file_path against TEST_FILE patterns
      (also pre-summarisation). Tag AgentToolCallEvent.is_test_file accordingly.
   3. On matching Bash tool_result: pull the full result payload
      (stdout + stderr + combined content blocks). Run runner.parse_result().
   4. Build TestRunSnapshot. Resolve per-file group paths against session CWD,
      with a containment check.
        │
        ▼
Tauri events:
  - test-run         → payload = TestRunSnapshot          (new)
  - agent-tool-call  → payload = AgentToolCallEvent       (extended: + is_test_file)
        │
        ▼
useAgentStatus hook  (extended)
   - Resolves workspaceSessionId → PTY id via getPtySessionId(sessionId).
   - Filters events by event.payload.sessionId === resolvedPtyId
     (mirrors the agent-tool-call listener at lines 258–321).
   - test-run listener attached BEFORE start_agent_watcher invocation —
     load-bearing for replay correctness with no backend snapshot cache.
        │
        ▼
TestResults component  (rewritten)
   - snapshot === null → dim placeholder row "▶ TESTS no runs yet"
   - snapshot !== null → live panel with header, 3-part proportional bar,
                          per-group rows, click-to-open for file groups.
ActivityFeed                (existing component, extended)
   - When event.isTestFile, prepend test glyph and use "Created/Updated test:" verb.
```

## Visibility & first-time UX

- The `{passed:0, failed:0, total:0}` placeholder at `AgentStatusPanel.tsx:96` is **removed**. `placeholderTests` const goes away.
- `<TestResults snapshot={status.testRun} onOpenFile={onOpenFile} />` renders inline in the existing `thin-scrollbar` flex column.
- `snapshot === null` → one dim row, ~20px tall, no chevron, no expand interaction. `role="status"` for screen readers; `aria-live="polite"` for one-shot announce on transition to live.
- `snapshot !== null` → live panel with collapsible header, runner pill, duration, status dot, expanded body with proportional bar and per-group rows.
- No filesystem detection, no startup cost beyond one DOM line per session.

**Persistence model.** The transcript JSONL is the source of truth. On reload the existing transcript watcher replays every tool_use/tool_result pair through the same parser. No separate cache in v1. See "Listener-attach ordering" below for the correctness invariant this depends on.

## Data model

### Rust types (new module `src-tauri/src/agent/test_runners/types.rs`)

```rust
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestRunSnapshot {
    /// PTY session id — same routing convention as agent-tool-call.
    pub session_id: String,
    pub runner: String,                // "vitest" | "cargo" — additive
    /// Sanitised, human-readable form of the command (env-strip + wrapper-strip
    /// + cap at 120 chars). Raw command is NEVER emitted; see Section "Command
    /// preview" for construction rules.
    pub command_preview: String,
    pub started_at: String,            // ISO 8601 — from tool_use timestamp
    pub finished_at: String,           // ISO 8601 — from tool_result timestamp
    /// Computed from finished_at - started_at via parse_iso8601_ms().
    /// Falls back to InFlightToolCall.started_at.elapsed() on parse failure.
    pub duration_ms: u64,
    pub status: TestRunStatus,
    pub summary: TestRunSummary,
    /// First useful line(s) of stderr/stdout when status == Error, capped at
    /// 240 chars; ANSI stripped. Always JSON-serialised (null when absent) —
    /// TS mirror is `string | null`.
    pub output_excerpt: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TestRunStatus {
    /// summary.failed == 0 AND summary.total > 0
    Pass,
    /// summary.failed > 0
    Fail,
    /// Parseable run with summary.total == 0 — vitest --passWithNoTests etc.
    /// NOT a runner crash. Distinct from Pass so the UI can say "no tests
    /// collected" instead of "passed".
    NoTests,
    /// parse_result returned None, OR is_error == true with no parseable summary.
    Error,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestRunSummary {
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    /// Invariant: total == passed + failed + skipped.
    pub total: u32,
    pub groups: Vec<TestGroup>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestGroup {
    /// Display label (relative path or "<crate>::<module>").
    pub label: String,
    /// Absolute, canonical path. Set ONLY when:
    ///   - kind == File
    ///   - the runner parser resolved it against CWD
    ///   - the canonical path is contained inside the session CWD
    /// None otherwise — frontend uses this to decide if the row is clickable.
    /// Always JSON-serialised (null when absent); TS mirror is `string | null`.
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
pub enum TestGroupKind { File, Suite, Module }

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestGroupStatus { Pass, Fail, Skip }
```

### Status derivation rules

| `parse_result` returned                         | `is_error` | Resulting `status`                                                                                                    |
| ----------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `Some(summary)` with `failed > 0`               | any        | `Fail`                                                                                                                |
| `Some(summary)` with `failed == 0 && total > 0` | any        | `Pass`                                                                                                                |
| `Some(summary)` with `total == 0`               | any        | `NoTests`                                                                                                             |
| `None`                                          | true       | `Error` (summary zeros, `output_excerpt` populated — see below)                                                       |
| `None`                                          | false      | _no event emitted_ — we don't know what happened, don't fabricate signal. Debug-level log so this case is observable. |

`output_excerpt` is constructed in `process_tool_result` after `parse_result` returns, NOT inside the per-runner parser. When the resulting status will be `Error`: take `out.content`, strip ANSI, take the first non-blank line(s) up to 240 chars (preferring the line containing `error:` / `Error:` / `FAIL` / `panicked` if present, else the first non-blank line), then run through `sanitize_for_ui` (see "Command preview & output sanitisation" below). For `Pass` / `Fail` / `NoTests`, `output_excerpt` is `None`.

### `AgentToolCallEvent` extension

```diff
 #[serde(rename_all = "camelCase")]
 pub struct AgentToolCallEvent {
     pub session_id: String,
     pub tool_use_id: String,
     pub tool: String,
     pub args: String,
     pub status: ToolCallStatus,
     pub timestamp: String,
     pub duration_ms: u64,
+    /// Set true ONLY for Write/Edit tool calls whose input.file_path matches
+    /// a TEST_FILE pattern. Computed in process_assistant_message against
+    /// the FULL untruncated path (before summarize_input runs). False for
+    /// everything else. The TEST_FILE pattern list lives only on the Rust
+    /// side at agent/test_runners/test_file_patterns.rs — frontend reads
+    /// this flag, no JS-side glob.
+    pub is_test_file: bool,
 }
```

### TypeScript mirror (`src/features/agent-status/types/index.ts`)

```typescript
export type TestRunStatus = 'pass' | 'fail' | 'noTests' | 'error'
export type TestGroupKind = 'file' | 'suite' | 'module'
export type TestGroupStatus = 'pass' | 'fail' | 'skip'

export interface TestGroup {
  label: string
  // Rust serialises Option<String> as null (not omitted). Use explicit
  // `string | null` so the boundary contract matches the wire shape.
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
  runner: string // not a union — additive
  commandPreview: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: TestRunStatus
  summary: TestRunSummary
  outputExcerpt: string | null
}

export interface AgentStatus {
  // ...existing fields...
  testRun: TestRunSnapshot | null
}

export interface RecentToolCall {
  // ...existing fields...
  isTestFile: boolean
}
```

`createDefaultStatus(...)` at `useAgentStatus.ts:27` is updated to include `testRun: null`. Without this the panel reads `undefined` and the `?? :` chain in the renderer breaks. **Required code change**, not optional.

## Bridge — runner registry, command identification, CWD threading

### Module layout (new pattern)

`src-tauri/src/agent/` today has no parser directory or trait abstraction — `statusline.rs` and `transcript.rs` parse inline. This spec introduces a _new_ registry-based pattern:

```
src-tauri/src/agent/test_runners/
├── mod.rs                    # registry, shared types, matching algorithm
├── types.rs                  # TestRunSnapshot, TestRunStatus, etc.
├── script_resolution.rs      # package.json scripts.<name> resolution
├── test_file_patterns.rs     # TEST_FILE_PATTERNS for is_test_file tagging
├── timestamps.rs             # parse_iso8601_ms helper (no chrono dep)
├── path_resolution.rs        # resolve_group_path with containment check
├── vitest.rs                 # vitest matcher + result parser
└── cargo.rs                  # cargo test matcher + result parser
```

Adding a new runner = one new file + one slice entry in `RUNNERS`.

### Registry shape

```rust
pub struct CapturedOutput {
    /// Joined text from tool_result.content. tool_result.content is either:
    ///   - a plain string (most common for Bash) → used as-is
    ///   - an array of content blocks: each block with type:"text" contributes
    ///     its `text` field; non-text blocks are ignored.
    /// Runners that put summaries on stderr (cargo, pytest) have them included
    /// here because the Bash tool returns combined stdout+stderr in `content`.
    pub content: String,
    pub is_error: bool,
}

pub struct TestRunner {
    pub name: &'static str,
    pub matches: fn(tokens: &[&str]) -> bool,
    pub parse_result: fn(out: &CapturedOutput, cwd: &Path) -> Option<TestRunSummary>,
}

pub static RUNNERS: &[&TestRunner] = &[&VITEST, &CARGO_TEST];
```

`parse_result` receives CWD so it can build absolute paths via `resolve_group_path` (see Path resolution below).

### Matching algorithm (called only when `tool_name == "Bash"`)

1. **Tokenize** raw `input.command` with the `shell-words` crate. On error → return None (no match, no false positive).
2. **Strip leading env assignments** (`KEY=value` tokens before the first non-assignment).
3. **Take only the first command segment** — split on `&&`, `;`, `||`, `|`, take tokens before the first separator. Multi-segment commands where the test invocation isn't first (`cargo build && cargo test`) are silently ignored in v1.
4. **Strip wrapper prefixes** in one pass: `npx`, `pnpm exec`, `yarn` (when followed by `exec`), `bun x`, `dotenv --`.
5. **Script-alias resolution.** Only for these exact shapes:
   - `npm test` | `npm run <name>`
   - `yarn test` | `yarn run <name>`
   - `pnpm test` | `pnpm run <name>`
   - `bun run <name>` ← **NOT `bun test`**: that invokes Bun's built-in test runner, not a script. Adding a `BUN` runner is future work; for v1 `bun test` matches nothing and is ignored.

   For matched shapes, read `<cwd>/package.json`, look up `scripts[<name>]`. If found, **recurse** on the resolved string. **Bound recursion to depth 3** to defend against alias loops.

6. **Match against `RUNNERS`.** First `matches(tokens)` returning true wins. Each matcher inspects only what it needs (`vitest`: `tokens[0] == "vitest"`; `cargo`: `tokens[0] == "cargo" && tokens[1] == "test"`).
7. **No match → ignore.** Bash tool call still flows through the existing pipeline; we just don't tag it.

### `InFlightToolCall` extension

```diff
 struct InFlightToolCall {
     started_at: Instant,
     tool: String,
     args: String,
+    /// Set during process_assistant_message when a Bash tool_use's command
+    /// matches a runner. Used in process_tool_result to drive parse_result.
+    test_runner: Option<&'static TestRunner>,
+    /// Raw command (pre-summarization), retained internally for snapshot
+    /// construction. NEVER emitted directly — see Command preview.
+    raw_command: Option<String>,
 }
```

### CWD threading

Today `TranscriptWatcher` carries only `transcript_path`. Script-alias resolution and per-file path resolution both need CWD inside `tail_loop`. Required changes:

```diff
 struct TranscriptWatcher {
     transcript_path: PathBuf,
+    cwd: Option<PathBuf>,        // resolved workspace CWD; None = no resolution
     handle: TranscriptHandle,
 }

 pub fn start_tailing<R: tauri::Runtime>(
     app_handle: tauri::AppHandle<R>,
     session_id: String,
     transcript_path: PathBuf,
+    cwd: Option<PathBuf>,
 ) -> Result<TranscriptHandle, String>;

 fn tail_loop<R: tauri::Runtime>(
     app_handle: tauri::AppHandle<R>,
     session_id: String,
+    cwd: Option<PathBuf>,
     file: File,
     stop_flag: Arc<AtomicBool>,
 );
```

`watcher.rs` already resolves the PTY's CWD (fixed in #60); it threads it into `TranscriptState::start` / `start_or_replace`. When CWD is `None`, script-alias resolution and per-file path resolution are both skipped — direct-binary matches (`vitest`, `cargo test`) still work; aliased forms (`npm test`) silently miss; group `path` stays `None`. This degradation is acceptable and produces no false matches.

### Command preview & output sanitisation (security)

The raw `input.command` is **not** emitted. It's retained on `InFlightToolCall.raw_command` for matching only. The snapshot carries `command_preview`, constructed from the matcher's already-stripped tokens and then run through a shared `sanitize_for_ui` function. The same sanitiser also runs over `output_excerpt` before emission.

```rust
// agent/test_runners/sanitiser.rs

const MAX_PREVIEW_LEN: usize = 120;
const REDACTED: &str = "[REDACTED]";

/// Conservative redaction for content shown in the UI. Catches the common
/// shapes; not a comprehensive secret scanner. Applied to BOTH command_preview
/// and output_excerpt so the same heuristics protect both surfaces.
///
/// Patterns redacted (each match replaced with [REDACTED]):
///   - KEY=value where KEY is [A-Z][A-Z0-9_]{2,} (env-style assignments)
///   - "Bearer <token>" (case-insensitive)
///   - "Authorization: <value>" (case-insensitive)
///   - Stripe/etc-style keys: (sk|pk|rk)_(live|test)_<16+ alnum>
///   - JWT-like tokens: eyJ<base64ish>
///
/// The matcher's env-strip (steps 2/4) already removes leading "KEY=val" tokens
/// from command_preview, but flags / positional args / test output can still
/// surface secrets — e.g. `vitest run --some-flag sk_live_xxx` or a failing
/// assertion that prints `process.env.STRIPE_KEY`. This catches those.
pub fn sanitize_for_ui(input: &str) -> String { ... }

fn build_command_preview(stripped_tokens: &[&str]) -> String {
    let joined = stripped_tokens.join(" ");
    let sanitized = sanitize_for_ui(&joined);
    truncate_string(&sanitized, MAX_PREVIEW_LEN)  // existing helper at transcript.rs:509
}
```

What this still doesn't catch (documented limitation): novel custom-prefix API keys, arbitrary base64/hex blobs that happen to be secrets, secrets passed as flag _names_, secrets in URLs (`?token=xxx`). Threat model: best-effort to avoid the common cases, not a comprehensive DLP scan. If a user pastes a custom-prefix secret into their test output, it may surface in `output_excerpt`. Acceptable for v1.

### Test-file pattern matching

`agent/test_runners/test_file_patterns.rs` exposes a static slice of patterns:

```rust
pub static TEST_FILE_PATTERNS: &[&str] = &[
    // **/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}
    // **/*_test.rs, **/tests/**/*.rs (cargo convention)
    // **/test_*.py, **/*_test.py (pytest convention)
    // **/*_test.go (go test convention)
];

pub fn is_test_file(path: &str) -> bool { ... }  // glob match against patterns
```

Used in `process_assistant_message` for Write/Edit tool calls to set `event.is_test_file = true`. Match is performed on the **full untruncated `file_path`** before `summarize_input` truncates.

### Per-runner `parse_result` contract

```rust
pub static VITEST: TestRunner = TestRunner {
    name: "vitest",
    matches: |t| t.first().is_some_and(|s| *s == "vitest"),
    parse_result: parse_vitest_output,
};

fn parse_vitest_output(out: &CapturedOutput, cwd: &Path) -> Option<TestRunSummary> {
    // 1. Strip ANSI escapes from out.content.
    // 2. Find canonical summary lines:
    //      Test Files  3 passed (3)
    //           Tests  47 passed | 2 failed | 1 skipped (50)
    // 3. Parse per-file lines: " ✓ src/foo.test.ts (12)"  /  " ✗ src/bar.test.ts (8 | 3 failed)"
    // 4. For each file group: label = relative path; path = resolve_group_path(cwd, label).
    // 5. Build TestRunSummary, enforcing total == passed + failed + skipped per group AND summary.
    // 6. Cap groups at MAX_GROUPS = 500 (cumulative counts in summary stay accurate).
}
```

Same shape for `cargo.rs` (cargo writes its summary to stderr; `CapturedOutput.content` carries combined stdout+stderr).

### Path resolution with containment check

```rust
// agent/test_runners/path_resolution.rs

pub fn resolve_group_path(cwd: &Path, label: &str) -> Option<String> {
    // Reject obvious escape attempts before touching the filesystem.
    if label.contains("..") || Path::new(label).is_absolute() {
        return None;
    }
    let candidate = cwd.join(label).canonicalize().ok()?;
    let cwd_canonical = cwd.canonicalize().ok()?;
    // Defends against runner-emitted symlinks pointing outside the workspace
    // and any future runner whose label could include "../../etc/passwd"
    // even if we already stripped ".." above.
    if !candidate.starts_with(&cwd_canonical) {
        return None;
    }
    Some(candidate.display().to_string())
}
```

`group.path` is `None` when the check fails — frontend renders the row non-clickable.

### Duration computation

Duration is computed from **transcript timestamps**, not the parser-time `Instant`. Replay would otherwise stamp every replayed run with parser-cost duration (near-zero) and a fresh live run with whatever `Instant::elapsed` reports inside the parser (also near-zero).

```rust
// agent/test_runners/timestamps.rs

/// Parse "YYYY-MM-DDTHH:MM:SS[.sss]Z" → milliseconds since Unix epoch.
/// Returns None on parse failure (no chrono dep — manual parse, mirrors
/// the inverse of now_iso8601() / days_to_date() already in transcript.rs).
pub fn parse_iso8601_ms(s: &str) -> Option<u64>;

pub fn compute_duration_ms(
    started_at_iso: &str,
    finished_at_iso: &str,
    fallback: Duration,
) -> u64 {
    match (parse_iso8601_ms(started_at_iso), parse_iso8601_ms(finished_at_iso)) {
        (Some(start), Some(end)) if end >= start => end - start,
        _ => {
            log::debug!("Falling back to Instant::elapsed for test-run duration");
            fallback.as_millis() as u64
        }
    }
}
```

## Bridge — emission lifecycle

### Replay batching

The existing `tail_loop` reads the transcript from the beginning, hits EOF, then polls. We use the **first EOF as the replay-done marker.** A per-tail-loop helper buffers during replay:

```rust
struct TestRunEmitter<'a, R: tauri::Runtime> {
    app_handle: &'a tauri::AppHandle<R>,
    replay_done: bool,
    pending: Option<TestRunSnapshot>,   // latest seen during replay
}

impl<'a, R: tauri::Runtime> TestRunEmitter<'a, R> {
    fn submit(&mut self, snapshot: TestRunSnapshot) {
        if self.replay_done {
            let _ = self.app_handle.emit("test-run", &snapshot);
        } else {
            self.pending = Some(snapshot); // latest wins, older ones dropped
        }
    }
    fn finish_replay(&mut self) {
        if self.replay_done { return; }   // idempotent
        self.replay_done = true;
        if let Some(s) = self.pending.take() {
            let _ = self.app_handle.emit("test-run", &s);
        }
    }
}
```

`tail_loop` flow:

```rust
let mut emitter = TestRunEmitter { app_handle: &app_handle, replay_done: false, pending: None };
loop {
    match reader.read_line(...) {
        Ok(0) => {
            emitter.finish_replay();   // first EOF flips the switch
            sleep(POLL_INTERVAL);
        }
        Ok(_) => process_line(line, ..., &mut emitter, ...),
        Err(_) => sleep(POLL_INTERVAL),
    }
}
```

`process_tool_result`, after building a `TestRunSnapshot`, calls `emitter.submit(snapshot)`. `agent-tool-call` events stay direct-emit — only `test-run` is batched, since it's the only event whose visible output flickers if many fire in succession.

**Guarantees:**

- After a fresh tail (app start, session switch): the visible snapshot equals the latest matched test run in the transcript, emitted _once_ after replay completes. Zero flicker.
- During live tailing (after first EOF): every new matched run emits immediately.
- A session whose transcript has zero matched runs emits nothing — panel stays in `no runs yet`.
- A session whose only matched run was a runner-error: `status: 'error'`, `output_excerpt` populated, panel renders the runner badge + error state.

### Listener-attach ordering (load-bearing for v1)

Because we have **no backend snapshot cache in v1**, the frontend listener for `test-run` MUST be attached before the transcript watcher's replay completes. Otherwise the latest-of-replay emit (the only source of historical state) is lost forever for that session.

The existing `useAgentStatus` flow already provides this:

```
useAgentStatus effect runs
   └─ subscribe() async block
       └─ await listen('agent-status', ...)        ✓ attached
       └─ await listen('agent-tool-call', ...)     ✓ attached
       └─ await listen('test-run', ...)            ✓ attached  (NEW)
   └─ handleDetection(sessionId)                   ← runs only after subscribe resolves
       └─ invoke('start_agent_watcher', ...)
           └─ (Rust) statusline bridge eventually fires
               └─ TranscriptState::start_or_replace
                   └─ start_tailing → tail_loop → EOF → emitter.finish_replay()
```

Adding the `test-run` listener inside the existing `subscribe()` block (alongside `agent-status` and `agent-tool-call`) is sufficient to inherit the ordering. **This is a load-bearing invariant**, covered by a regression test (see Test plan).

## UI

### Component shape

```tsx
// src/features/agent-status/components/TestResults.tsx

interface TestResultsProps {
  snapshot: TestRunSnapshot | null
  onOpenFile?: (path: string) => void // GUARDED entry point — see below
}

export const TestResults = ({
  snapshot,
  onOpenFile,
}: TestResultsProps): ReactElement => {
  if (snapshot === null) return <TestResultsPlaceholder />
  return <TestResultsLive snapshot={snapshot} onOpenFile={onOpenFile} />
}
```

Both internal sub-components live in the same file. External callers always render `<TestResults>` and pass `snapshot`.

### `AgentStatusPanel` changes

```diff
-const placeholderTests = { passed: 0, failed: 0, total: 0 }
-
 interface AgentStatusPanelProps {
   sessionId: string | null
   cwd: string
   onOpenDiff: (file: ChangedFile) => void
+  onOpenFile?: (path: string) => void
 }

-<TestResults
-  passed={placeholderTests.passed}
-  failed={placeholderTests.failed}
-  total={placeholderTests.total}
-/>
+<TestResults snapshot={status.testRun} onOpenFile={onOpenFile} />
```

### Safe file open (the dirty-state hazard)

`WorkspaceView.openFileSafely` at line 112 explicitly **bypasses** the unsaved-changes guard — its docstring says so. Wiring `onOpenFile={openFileSafely}` would silently discard user edits. Wrong.

Instead, `WorkspaceView` exposes a _new_ handler that mirrors the proven pattern at `handleFileSelect:144`:

```typescript
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

Then `<AgentStatusPanel onOpenFile={handleOpenTestFile} />`. The unsaved-dialog flow (`handleSave` / `handleDiscard` / `handleCancel`) already handles pending-path resumption — no new code there.

### Path passed to `onOpenFile`

`TestResults` calls `onOpenFile(group.path)` only when `group.kind === 'file' && group.path !== null`. The `path` field is the absolute, contained, canonical path resolved by the Rust runner parser. The display label (`group.label`) stays relative for compactness; only the resolved path goes to `openFile`. If `path` is `null` (resolution failed, escape rejected, or kind is suite/module), the row renders as a non-interactive `<div>`.

This guarantees:

- vitest's `src/foo.test.ts` → resolved to `/abs/path/to/repo/src/foo.test.ts` → Tauri `read_file` accepts it.
- cargo's `vimeflow_lib::agent::tests` → kind `module`, `path: null` → not clickable.
- A vitest path that doesn't exist on disk anymore → resolution fails → `path: null` → not clickable (better than a broken click).
- A malicious `../../../etc/passwd` label → containment check rejects → `path: null` → not clickable.

### Visual states

**Placeholder** — one dim row, no chevron, no expand interaction:

```
TESTS  no runs yet
```

`text-on-surface-variant`, `font-mono text-[10px]`, ~20px tall. `role="status"` for screen readers.

**Live header (collapsed)**:

```
▶ TESTS  47/50  · vitest  · 1.4s
```

Composition uses **only existing tailwind tokens** (verified in `tailwind.config.js`):

| Element                | Token                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Status dot — pass      | `bg-success`                                                                                             |
| Status dot — fail      | `bg-error`                                                                                               |
| Status dot — error     | `bg-tertiary` (no `warning` token; `tertiary` is the closest amber/pink in the palette — see Future #14) |
| Status dot — noTests   | `bg-on-surface-variant`                                                                                  |
| Count text             | `text-on-surface`                                                                                        |
| Runner pill / duration | `text-on-surface-variant`                                                                                |

**Live header is its own collapsible button**, not a `CollapsibleSection`. The existing `CollapsibleSection` API only exposes `title` and `count`; we need dot + runner + duration too. Inlining the button keeps `CollapsibleSection` stable. Native `<button type="button">` activation is sufficient — **no manual Enter/Space `onKeyDown` handler** (which would risk double-toggling because the browser also synthesises `click` on Space-up).

```tsx
const bodyId = useId()  // unique per instance — required for parameterised test renders
const [expanded, setExpanded] = useState(false)

<button
  type="button"
  aria-expanded={expanded}
  aria-controls={bodyId}
  onClick={() => setExpanded((v) => !v)}
>
  ...header content...
</button>
<div id={bodyId} hidden={!expanded}>
  ...body...
</div>
```

**Live header (expanded body)**:

```
▼ TESTS  47/50  · vitest  · 1.4s
   [ pass ████████████  fail ██  skip █ ]
   47 passed, 2 failed, 1 skipped
   ✓  src/foo.test.ts            12/12
   ✗  src/bar.test.ts             5/8
   ⊘  src/baz.test.ts             0/3 skipped
```

**Bar is a 3-part proportional bar**, not per-test segments. Three flex children with `flex-grow: passed | failed | skipped`. Constant DOM regardless of suite size.

```tsx
<div className="flex h-[3px] w-full overflow-hidden rounded-full">
  {passed > 0 && <div style={{ flexGrow: passed }} className="bg-success" />}
  {failed > 0 && <div style={{ flexGrow: failed }} className="bg-error" />}
  {skipped > 0 && (
    <div style={{ flexGrow: skipped }} className="bg-on-surface-variant/40" />
  )}
</div>
```

**Status-specific live body**:

| `snapshot.status` | Body                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `pass`            | bar + `47 passed`, group rows green                                                                         |
| `fail`            | bar + `45 passed, 2 failed`, group rows mixed                                                               |
| `noTests`         | no bar, summary `no tests collected`, no group rows                                                         |
| `error`           | no bar, summary text = `snapshot.outputExcerpt ?? 'runner errored before producing results'`, no group rows |

### Group rows

- Status icon (`✓ ✗ ⊘`) in the runner status colour
- Label (file path or `<crate>::<module>`) — `font-mono text-[11px]`, truncated with `text-ellipsis`
- Right-aligned count `passed/total` (and `skipped` suffix when nonzero)
- Click behaviour:
  - `kind === 'file' && path !== null && onOpenFile` defined → row is `<button type="button" aria-label={"Open " + label}>`, calls `onOpenFile(group.path)`. `cursor-pointer` + `hover:bg-surface-container-high`.
  - Otherwise → row is `<div>`, no `cursor-pointer`, no click handler.

### Accessibility

- Placeholder row: `role="status"`, `aria-live="polite"` (one-shot announce on transition to live).
- Live header: native `<button type="button" aria-expanded aria-controls={useId()}>`; activation by Enter and Space goes through native semantics — no custom handler.
- Group rows: `<button>` only when interactive; `<div>` when not. Status colours always paired with an icon glyph (`✓ ✗ ⊘`), never colour-only.
- Per `rules/typescript/testing/a11y-queries.md`: tests use `getByRole`/`getByText`. One `data-testid="test-results"` on the wrapper for outer integration tests only.

## Test creation signal (activity feed)

Per Q4: surfaces in the activity feed, not the TESTS panel. **Backend-driven**, not render-layer glob:

1. `process_assistant_message` checks `tool_name in ["Write", "Edit"]` AND `is_test_file(input.file_path)` (full untruncated path). Sets `event.is_test_file = true` on the emitted `AgentToolCallEvent`.
2. `useAgentStatus` maps `AgentToolCallEvent` → `RecentToolCall`, propagating `isTestFile: boolean`.
3. `toolCallsToEvents` (`toolCallsToEvents.ts:75`) propagates the flag to `ActivityEvent.isTestFile`.
4. `ActivityEvent` renderer prepends a `🧪` glyph and selects the verb based on the existing `tool` field:

```typescript
const verb = event.tool === 'Edit' ? 'Updated test' : 'Created test'
```

**Documented limitation:** `Write` tool calls can either create a new file or overwrite an existing one; we label both as "Created". A precise create/update distinction would require either a backend pre-check of existence (race-prone) or per-session path memoisation (state we don't otherwise need). Acceptable for v1; revisit if the mislabel turns out to be confusing. The upgrade path — a `testFileAction: 'created' | 'updated' | 'touched'` enum on `AgentToolCallEvent` — is in the Future Work table.

No frontend glob, no drift between layers, no truncation hazard.

## Test plan

### Rust — unit tests

- `tokenize_command` — shellwords success/failure, env-strip, wrapper-strip (`npx`, `pnpm exec`, `yarn`, `bun x`, `dotenv --`), segment-split (`&&`, `;`, `||`, `|`)
- `resolve_script_alias` — happy path, missing script, depth-3 loop bound, missing CWD → None, `bun test` is **not** treated as alias (reserved for future Bun runner)
- Per-runner `matches()` — vitest positive (`vitest run …`) + negative (`git diff test.txt`, `eslint test/`); cargo positive (`cargo test …`) + negative (`cargo build`)
- `parse_iso8601_ms` — `2026-04-27T15:23:45Z`, `2026-04-27T15:23:45.123Z`, malformed → None
- `compute_duration_ms` — both valid, end-before-start → fallback, malformed → fallback
- `build_command_preview` — env-stripped tokens preserved, truncation at 120 chars (multi-byte safe via existing `truncate_string`)
- `sanitize_for_ui` — `KEY=value` redacted, `Bearer xxx` redacted, `Authorization:` redacted, `sk_live_…` / `pk_test_…` redacted, `eyJ…` JWT redacted; clean strings unchanged; sanitiser applied to both `command_preview` and `output_excerpt` paths
- `resolve_group_path` — `..`-escape rejected, absolute label rejected, symlink escape rejected (canonical containment check), valid relative path resolved against CWD
- Per-runner `parse_result` — pass / mixed / all-fail / no-tests-collected / compile-error / skipped tests; invariant `passed + failed + skipped == total` per group and per summary; group cap respected at `MAX_GROUPS`
- `TestRunEmitter::submit` during replay — multiple submits collapse to latest
- `TestRunEmitter::finish_replay` — idempotent; submit-after-finish emits immediately
- `is_test_file` matcher — full untruncated paths like `src/foo.test.ts`, `crates/x/src/bar/baz_test.rs`, `tests/test_qux.py` match; non-test paths (`src/foo.ts`, `tests-helper.ts`) don't

### Rust — integration tests (fixture JSONL transcripts under `src-tauri/tests/fixtures/`)

- `transcript_vitest_pass.jsonl` — 3 historical runs + 1 live → exactly 2 `test-run` emits (latest-of-replay, then live), correct `runner: 'vitest'`, correct counts
- `transcript_vitest_no_tests.jsonl` — `vitest --passWithNoTests` → one emit with `status: 'noTests'`, `summary.total == 0`
- `transcript_compile_error.jsonl` — `is_error: true`, parser returns None → one emit with `status: 'error'`, `outputExcerpt` populated
- `transcript_cargo_mixed.jsonl` — pass + fail + ignored, summary counts and groups correct, group `kind: 'module'`, `path: null`
- `transcript_mixed_bash.jsonl` — interleaved Bash calls (test + non-test) → only matched calls emit `test-run`; non-test Bash calls flow through `agent-tool-call` unchanged
- `transcript_test_file_creation.jsonl` — `Write` and `Edit` of test paths → `agent-tool-call` events have `isTestFile: true`; non-test `Write` has `isTestFile: false`

### TypeScript — component tests (Vitest + RTL)

- `<TestResults snapshot={null} />` — placeholder text, `role="status"`, no chevron, no expand
- `<TestResults snapshot={passSnap} />` header — counts, success dot, runner pill, formatted duration
- `<TestResults snapshot={failSnap} />` expanded — proportional 3-part bar, group rows include failing file with `✗`, summary text reads `X passed, Y failed`
- `<TestResults snapshot={noTestsSnap} />` — no bar rendered, summary `no tests collected`, no group rows
- `<TestResults snapshot={errorSnap} />` — summary uses `outputExcerpt` when present; falls back to default message
- `<TestResults snapshot={mixedWithSkips} />` — 3-part bar visible; summary includes `skipped` clause; group rows show skipped counts
- Group row click — `kind: 'file'`, `path !== null`, `onOpenFile` defined → renders as `<button>`, calls `onOpenFile(group.path)` once
- Group row — `path === null` → renders as `<div>`, no `onOpenFile` invocation possible
- Group row — `kind: 'suite' | 'module'` → renders as `<div>`, no `cursor-pointer`
- Native button keyboard activation — `userEvent.keyboard('{Enter}')` and `userEvent.keyboard(' ')` toggle expand without any custom handler
- Multiple `<TestResults>` in one render — `useId`-derived `aria-controls` are unique per instance
- `<TestResults>` axe-clean — no a11y violations across all five state snapshots

### TypeScript — workspace integration

- `WorkspaceView.handleOpenTestFile` clean buffer → calls `openFileSafely(filePath)`
- `WorkspaceView.handleOpenTestFile` dirty buffer → calls `setPendingFilePathSynced(filePath)` + `setShowUnsavedDialog(true)`; does **not** call `openFileSafely`
- Existing dialog flow (`handleSave` / `handleDiscard`) resumes the pending test-file open correctly (extending existing tests, not new ones)

### TypeScript — hook & event wiring

- `useAgentStatus` — `test-run` event with `payload.sessionId === resolvedPtyId` updates `status.testRun`
- `useAgentStatus` — `test-run` event with mismatched id is ignored
- `useAgentStatus` — `createDefaultStatus(sessionId).testRun === null`
- `useAgentStatus` — sessionId change resets `status.testRun` to null along with the rest of the default
- **Listener-ordering regression** — mock `invoke` and `listen`; assert that `listen('test-run', …)` resolves before `invoke('start_agent_watcher', …)` fires. This is the load-bearing correctness hinge for v1's no-cache design.

### TypeScript — activity feed

- `Write` tool-call event with `isTestFile: true` renders label `Created test: <basename>` with the test glyph
- `Edit` tool-call event with `isTestFile: true` renders label `Updated test: <basename>` with the test glyph
- Tool-call event with `isTestFile: false` renders default label, no glyph
- `RecentToolCall.isTestFile` propagates through `toolCallsToEvents` to `ActivityEvent.isTestFile`

## Out of scope for v1

| #   | Item                                                                                                 | Rationale                                                                                                                                                                                                      | Upgrade path                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Ask-Claude CTA** (Q6 option C — button next to placeholder that injects a prompt)                  | Non-trivial: needs session targeting, prompt template, mid-task safety. Worth a separate spec.                                                                                                                 | Add a `<TestResultsPlaceholderCTA>` variant; new IPC command to inject text into the active PTY session.                         |
| 2   | **Backend snapshot cache + `get_latest_test_snapshot` command**                                      | Same gap exists for `recentToolCalls` today; not new.                                                                                                                                                          | `HashMap<session_id, TestRunSnapshot>` in `TranscriptState`; one Tauri command; hook calls it on mount before subscribing.       |
| 3   | **More runners** (`jest`, `mocha`, `pytest`, `go test`, `bun test`, `deno test`, `rspec`, `phpunit`) | Allowlist scopes risk; this project uses vitest + cargo.                                                                                                                                                       | One new file under `test_runners/` + one slice entry per runner.                                                                 |
| 4   | **User-extensible runner registry** (`.vimeflow/test-runners.json`)                                  | YAGNI until a user asks for `make test`-style wrappers.                                                                                                                                                        | Read at `TranscriptState::start`, merge entries into `RUNNERS`.                                                                  |
| 5   | **Multi-segment commands** (`cargo build && cargo test`)                                             | First segment only in v1.                                                                                                                                                                                      | Walk all segments, match each independently, use the last matched run.                                                           |
| 6   | **`bash -c "vitest"` indirection**                                                                   | Rare; needs sub-shell tokenisation.                                                                                                                                                                            | Recurse on the inner string when `tokens[0..3] == ["bash", "-c", _]`.                                                            |
| 7   | **Workspace tools** (`pnpm -F pkg test`)                                                             | Requires per-package `package.json` walks.                                                                                                                                                                     | Detect `-F`/`--filter`/`-w`/`--workspace`; resolve script in target package's `package.json`.                                    |
| 8   | **Tests run outside the integrated PTY**                                                             | Bridge is intentionally agent-scoped.                                                                                                                                                                          | Filesystem watcher for runner report files; merged into `TestRunSnapshot` as a separate signal source.                           |
| 9   | **Failure messages / stack frames in expanded view** (Q4 option C)                                   | v1 = per-file counts only.                                                                                                                                                                                     | Extend per-runner parser to capture `failures: Vec<TestFailure>`; render in collapsible sub-row.                                 |
| 10  | **Test creation as a panel counter**                                                                 | Activity feed surface is enough; keeps panel focused on run state.                                                                                                                                             | Add `testFilesCreated: number` to `TestRunSnapshot` or `AgentStatus`; render as secondary badge.                                 |
| 11  | **Precise `created` vs `updated` for test files**                                                    | v1 approximation: Write→Created, Edit→Updated.                                                                                                                                                                 | Backend tracks `HashSet<PathBuf>` of test files seen this session; emits `testFileAction: 'created' \| 'updated'` enum on event. |
| 12  | **`testFileAction` enum on `AgentToolCallEvent`**                                                    | v1 uses `is_test_file: bool` + tool name; sufficient.                                                                                                                                                          | See #11.                                                                                                                         |
| 13  | **Storybook stories**                                                                                | No Storybook setup in repo.                                                                                                                                                                                    | Add Storybook in a separate scaffolding task; port the five state stories.                                                       |
| 14  | **`warning` semantic Tailwind token (project-wide)**                                                 | v1's rewritten `TestResults.tsx` uses verified tokens only (`tertiary` for the amber error-state dot, no `text-warning`). Adding a real `warning` token across the rest of the codebase is a separate cleanup. | Add `warning` and `on-warning` to `tailwind.config.js`; sweep the codebase for `text-warning` / `bg-warning` usages and migrate. |
| 15  | **`kind: 'test-file-creation'` derived event** in `useActivityEvents`                                | v1 reads `event.isTestFile` at render time; minimal.                                                                                                                                                           | Add `kind?: 'test-file-creation' \| 'test-file-edit'` to `ActivityEvent`, set in `toolCallsToEvents`.                            |
| 16  | **Cross-language fixture for test-file pattern drift**                                               | N/A in v1 — patterns live only on Rust side.                                                                                                                                                                   | Becomes relevant if frontend ever adds its own glob; cross-layer fixture test.                                                   |

## Risks & mitigations

| #   | Risk                                                                                                                                                                      | Likelihood | Impact | Mitigation                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Listener-attach race — `test-run` listener not yet active when transcript replay's batched emit fires; latest-of-replay snapshot lost forever for that session.           | Low        | Medium | Existing `subscribe() → handleDetection()` ordering in `useAgentStatus`; load-bearing invariant covered by the listener-ordering regression test.                                                                           |
| R2  | Replay flicker — many historical runs emitting in succession.                                                                                                             | Low        | Low    | `TestRunEmitter` latest-wins batching; verified by 3-historical-+-1-live fixture test.                                                                                                                                      |
| R3  | Stdout parser drift — vitest or cargo changes its summary line format in a future version, and we silently stop matching → snapshots become `status: 'error'` everywhere. | Medium     | Medium | Per-runner unit tests on captured fixtures; spec calls out that runner version bumps in `package-lock.json` / `Cargo.lock` should trigger fixture review. Comment near each parser cites the version it was tested against. |
| R4  | Malicious or weird runner labels (`../../etc/passwd`, absolute paths, symlinks) being clickable.                                                                          | Low        | High   | `resolve_group_path` rejects `..`, absolute labels, and post-canonicalize escapes via containment check. Unit-tested.                                                                                                       |
| R5  | Secrets leaking via the command preview when secrets are in flag values or positional args (env-prefix case is already handled).                                          | Low        | Medium | Documented as out-of-threat-model; flag-value redaction would be heuristic and brittle.                                                                                                                                     |
| R6  | Memory blowup on huge test suites (`TestRunSummary.groups` grows unbounded).                                                                                              | Low        | Medium | Cap `groups` at `MAX_GROUPS = 500` in each parser; spec calls out the cap. Counts in `summary.{passed,failed,skipped,total}` stay accurate even when groups list is truncated.                                              |
| R7  | Skipped tests miscounted as failures or passes — runners differ in `ignored` / `skipped` / `pending` terminology.                                                         | Medium     | Low    | Explicit per-runner unit tests for skipped output; invariant `passed + failed + skipped == total` enforced in parser tests.                                                                                                 |
| R8  | Session-id mix-up (workspace vs PTY) — a stale snapshot persists across PTY reset.                                                                                        | Low        | Low    | `useAgentStatus` already resets `status` (including `testRun: null`) on `sessionId` change; same code path.                                                                                                                 |
| R9  | Test runner exits cleanly with no parseable output — no event emitted, user wonders why nothing showed up.                                                                | Low        | Low    | Documented behaviour. Debug-level log in `process_tool_result` when a recognised runner produces unparseable output.                                                                                                        |
| R10 | Test-file glob false positives (e.g., `tests-helper.ts` matching `**/test*`).                                                                                             | Low        | Low    | Strict patterns: `**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,rs,py,go}`. No broader globs.                                                                                                                                     |
| R11 | `text-warning` carried forward into the rewritten `TestResults.tsx` (the existing file uses it; tailwind silently drops unknown classes).                                 | Low        | Low    | The v1 rewrite of `TestResults.tsx` uses verified tokens only — no `text-warning` in the new component or its tests. Stale `text-warning` usages elsewhere in the codebase are out of v1 scope (Future #14).                |

## Implementation order (suggested)

1. **Rust — types & test_runners module skeleton** (no parser logic yet). Wire `RUNNERS` slice with stub `VITEST` and `CARGO_TEST`. Compile-only.
2. **CWD threading** — extend `TranscriptWatcher`, `start_tailing`, `tail_loop` signatures. `watcher.rs` passes the resolved CWD through.
3. **`AgentToolCallEvent.is_test_file` + test_file_patterns.rs** — pattern matcher and renderer-agnostic flag. Smallest backend-frontend slice; verifies the wire shape.
4. **Matching algorithm + `InFlightToolCall` extension** — tokenize, strip, resolve scripts, recurse, match. Unit tests.
5. **vitest parser + fixture transcript test.** First end-to-end emission.
6. **`TestRunEmitter` + replay batching.** Flicker-free historical playback.
7. **Listener-ordering regression test (TS).** Lock the correctness invariant.
8. **`<TestResults>` rewrite + `AgentStatusPanel` wiring.** All five visual states.
9. **`WorkspaceView.handleOpenTestFile` + onOpenFile flow.** Guarded file open.
10. **cargo parser + cargo fixture.** Second runner; validates the registry abstraction.
11. **Activity feed glyph + verb mapping.** `isTestFile` rendering.

Each step lands as its own PR, reviewable in isolation. Steps 1–7 are pure backend + hook plumbing; the user sees nothing change visually until step 8.
