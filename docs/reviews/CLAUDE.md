# Review Knowledge Base

Patterns learned from code reviews (local Codex, GitHub Claude, and GitHub
Codex connector). This is an optional reference — agents may consult relevant patterns before implementing
to avoid repeating past mistakes.

**Timeline companion.** The repo-root `CHANGELOG.md` (and its zh-CN mirror
`CHANGELOG.zh-CN.md`) is the linear timeline; entries there may
cross-link patterns defined here. Record new patterns here; append the
matching CHANGELOG bullet on merge.

**Runtime migration note.** Many older findings intentionally preserve original
Tauri-era paths and wording (`src-tauri/`, `tauri-driver`, Tauri events). The
current implementation is Electron + the `crates/backend/` Rust sidecar. Apply
the reusable lesson, but translate active-code guidance to
`window.vimeflow`, `BackendState`, `EventSink`, and LSP-framed sidecar IPC.

**For agents:** When you read a pattern file during implementation, bump its
`ref_count` in frontmatter by 1 and update the Refs column below.

**After a review-fix cycle:** Record new findings by appending to an existing
pattern or creating a new file. See the spec at
`docs/superpowers/specs/2026-04-09-review-knowledge-base-design.md` for the
ingestion protocol.

## Source labels

When appending findings to a pattern file, label the source so future readers can trace which reviewer caught it:

- `github-codex` — the old aggregated Codex GitHub Action (`.github/workflows/codex-review.yml`,
  disabled as of [#111](https://github.com/winoooops/vimeflow/issues/111)). Existing entries with
  this label remain as historical record; do **NOT** rewrite or relabel them.
- `github-codex-connector` — the `chatgpt-codex-connector[bot]` GitHub App integration. Posts
  inline review comments on PR diffs. New entries from `/lifeline:upsource-review` cycles use
  this label.
- `github-claude` — the Claude Code Review GitHub Action (`.github/workflows/claude-review.yml`).
  Posts an aggregated `## Claude Code Review` issue comment per push.
- `github-human` — a human reviewer (PR author, maintainer, contributor) commenting on a PR.
  Posted via `/issues/{pr}/comments` (top-level conversation) or `/pulls/{pr}/comments` (inline).
  New entries from `/lifeline:upsource-review` human-review processing use this label.
- `local-codex` — local `codex exec` runs (e.g. `/lifeline:review` or post-fix verify in
  `/lifeline:upsource-review`).

| Pattern                                                                                              | Category           | Findings | Refs | Last Updated |
| ---------------------------------------------------------------------------------------------------- | ------------------ | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md)                                                     | security           | 21       | 3    | 2026-05-20   |
| [React Lifecycle](patterns/react-lifecycle.md)                                                       | react-patterns     | 33       | 14   | 2026-06-11   |
| [Motion Layout Projection](patterns/motion-layout-projection.md)                                     | react-patterns     | 1        | 0    | 2026-06-10   |
| [Fixed-Position Portals](patterns/fixed-position-portals.md)                                         | react-patterns     | 1        | 0    | 2026-06-12   |
| [Resource Cleanup](patterns/resource-cleanup.md)                                                     | react-patterns     | 12       | 10   | 2026-06-12   |
| [Cross-Platform Paths](patterns/cross-platform-paths.md)                                             | cross-platform     | 6        | 3    | 2026-05-30   |
| [Debug Artifacts](patterns/debug-artifacts.md)                                                       | code-quality       | 7        | 0    | 2026-06-11   |
| [Derived State Consistency](patterns/derived-state-consistency.md)                                   | code-quality       | 7        | 4    | 2026-06-12   |
| [Generated Artifacts](patterns/generated-artifacts.md)                                               | code-quality       | 6        | 3    | 2026-06-12   |
| [Generated Shell Scripts](patterns/generated-shell-scripts.md)                                       | backend            | 7        | 1    | 2026-06-03   |
| [Hot-Path Caching](patterns/hot-path-caching.md)                                                     | backend            | 1        | 0    | 2026-06-09   |
| [Testing Gaps](patterns/testing-gaps.md)                                                             | testing            | 64       | 30   | 2026-06-12   |
| [Terminal Input Handling](patterns/terminal-input-handling.md)                                       | terminal           | 4        | 2    | 2026-05-24   |
| [Documentation Accuracy](patterns/documentation-accuracy.md)                                         | code-quality       | 85       | 25   | 2026-06-08   |
| [Accessibility](patterns/accessibility.md)                                                           | a11y               | 51       | 22   | 2026-06-12   |
| [Event Identity Guard](patterns/event-identity-guard.md)                                             | backend            | 1        | 0    | 2026-06-11   |
| [Async Race Conditions](patterns/async-race-conditions.md)                                           | react-patterns     | 63       | 21   | 2026-06-08   |
| [Tokio Blocking On Async](patterns/tokio-blocking-on-async.md)                                       | backend            | 2        | 1    | 2026-05-20   |
| [Command Injection](patterns/command-injection.md)                                                   | security           | 7        | 3    | 2026-05-02   |
| [Policy Judge Hygiene](patterns/policy-judge-hygiene.md)                                             | security           | 15       | 2    | 2026-04-20   |
| [Fail-Closed Hooks](patterns/fail-closed-hooks.md)                                                   | security           | 3        | 1    | 2026-04-20   |
| [Preflight Checks](patterns/preflight-checks.md)                                                     | error-handling     | 3        | 0    | 2026-05-31   |
| [CSP Configuration](patterns/csp-configuration.md)                                                   | security           | 8        | 5    | 2026-05-16   |
| [Network Request Hardening](patterns/network-request-hardening.md)                                   | security           | 1        | 1    | 2026-06-08   |
| [PTY Session Management](patterns/pty-session-management.md)                                         | backend            | 9        | 2    | 2026-06-03   |
| [Git Operations](patterns/git-operations.md)                                                         | correctness        | 25       | 10   | 2026-05-31   |
| [CodeMirror Integration](patterns/codemirror-integration.md)                                         | editor             | 19       | 4    | 2026-06-06   |
| [Error Surfacing](patterns/error-surfacing.md)                                                       | error-handling     | 38       | 11   | 2026-06-12   |
| [File Tree Paths](patterns/file-tree-paths.md)                                                       | files              | 4        | 0    | 2026-04-10   |
| [Scope Boundary](patterns/scope-boundary.md)                                                         | review-process     | 8        | 3    | 2026-06-01   |
| [E2E Testing](patterns/e2e-testing.md)                                                               | e2e-testing        | 19       | 7    | 2026-06-06   |
| [Module Boundaries](patterns/module-boundaries.md)                                                   | code-quality       | 15       | 3    | 2026-06-12   |
| [Diagnostic Instrumentation](patterns/diagnostic-instrumentation.md)                                 | code-quality       | 11       | 3    | 2026-06-12   |
| [Keyboard Shortcut Guards](patterns/keyboard-shortcut-guards.md)                                     | keyboard-shortcuts | 19       | 1    | 2026-06-06   |
| [Verify Render Target](patterns/verify-render-target.md)                                             | code-quality       | 2        | 0    | 2026-05-24   |
| [UI Visual Regression](patterns/ui-visual-regression.md)                                             | code-quality       | 4        | 1    | 2026-06-12   |
| [Status Indicator Display](patterns/status-indicator-display.md)                                     | code-quality       | 3        | 0    | 2026-05-26   |
| [Parser Resilience](patterns/parser-resilience.md)                                                   | code-quality       | 11       | 8    | 2026-06-12   |
| [Persisted State Invariants](patterns/persisted-state-invariants.md)                                 | correctness        | 6        | 3    | 2026-06-08   |
| [macOS Window Chrome](patterns/macos-window-chrome.md)                                               | cross-platform     | 8        | 2    | 2026-06-11   |
| [Guard Branch Correctness](patterns/guard-branch-correctness.md)                                     | correctness        | 1        | 0    | 2026-06-11   |
| [Identifier Prefix Matching](patterns/identifier-prefix-matching.md)                                 | correctness        | 3        | 1    | 2026-06-12   |
| [Prototype Handoff Artifacts](patterns/prototype-handoff-artifacts.md)                               | review-process     | 2        | 0    | 2026-06-12   |
| [CloudFormation Environment Prefix Coupling](patterns/cloudformation-environment-prefix-coupling.md) | infrastructure     | 1        | 0    | 2026-06-12   |
| [CloudFormation Stale References](patterns/cloudformation-stale-references.md)                       | infrastructure     | 2        | 1    | 2026-06-12   |
