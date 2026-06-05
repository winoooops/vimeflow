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

| Pattern                                                                              | Category           | Findings | Refs | Last Updated |
| ------------------------------------------------------------------------------------ | ------------------ | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md)                                     | security           | 21       | 3    | 2026-05-20   |
| [React Lifecycle](patterns/react-lifecycle.md)                                       | react-patterns     | 25       | 9    | 2026-05-31   |
| [Resource Cleanup](patterns/resource-cleanup.md)                                     | react-patterns     | 5        | 3    | 2026-05-31   |
| [Cross-Platform Paths](patterns/cross-platform-paths.md)                             | cross-platform     | 4        | 3    | 2026-05-07   |
| [Debug Artifacts](patterns/debug-artifacts.md)                                       | code-quality       | 5        | 0    | 2026-05-09   |
| [Generated Artifacts](patterns/generated-artifacts.md)                               | code-quality       | 3        | 2    | 2026-05-25   |
| [Testing Gaps](patterns/testing-gaps.md)                                             | testing            | 56       | 26   | 2026-06-02   |
| [Terminal Input Handling](patterns/terminal-input-handling.md)                       | terminal           | 4        | 2    | 2026-05-24   |
| [Documentation Accuracy](patterns/documentation-accuracy.md)                         | code-quality       | 76       | 24   | 2026-06-02   |
| [Accessibility](patterns/accessibility.md)                                           | a11y               | 25       | 6    | 2026-05-09   |
| [Async Race Conditions](patterns/async-race-conditions.md)                           | react-patterns     | 50       | 14   | 2026-06-02   |
| [Tokio Blocking On Async](patterns/tokio-blocking-on-async.md)                       | backend            | 2        | 1    | 2026-05-20   |
| [Command Injection](patterns/command-injection.md)                                   | security           | 7        | 3    | 2026-05-02   |
| [Credential Leakage](patterns/credential-leakage.md)                                 | security           | 1        | 0    | 2026-05-31   |
| [Policy Judge Hygiene](patterns/policy-judge-hygiene.md)                             | security           | 16       | 1    | 2026-06-04   |
| [Fail-Closed Hooks](patterns/fail-closed-hooks.md)                                   | security           | 3        | 1    | 2026-04-20   |
| [Preflight Checks](patterns/preflight-checks.md)                                     | error-handling     | 4        | 0    | 2026-06-02   |
| [CSP Configuration](patterns/csp-configuration.md)                                   | security           | 8        | 5    | 2026-05-16   |
| [PTY Session Management](patterns/pty-session-management.md)                         | backend            | 8        | 2    | 2026-05-28   |
| [Git Operations](patterns/git-operations.md)                                         | correctness        | 25       | 10   | 2026-05-31   |
| [CI Orchestration State](patterns/ci-orchestration-state.md)                         | correctness        | 13       | 4    | 2026-06-04   |
| [CodeMirror Integration](patterns/codemirror-integration.md)                         | editor             | 12       | 0    | 2026-04-11   |
| [Error Surfacing](patterns/error-surfacing.md)                                       | error-handling     | 51       | 13   | 2026-06-05   |
| [File Tree Paths](patterns/file-tree-paths.md)                                       | files              | 4        | 0    | 2026-04-10   |
| [Scope Boundary](patterns/scope-boundary.md)                                         | review-process     | 7        | 2    | 2026-05-12   |
| [E2E Testing](patterns/e2e-testing.md)                                               | e2e-testing        | 18       | 6    | 2026-05-20   |
| [Module Boundaries](patterns/module-boundaries.md)                                   | code-quality       | 4        | 1    | 2026-06-02   |
| [Diagnostic Instrumentation](patterns/diagnostic-instrumentation.md)                 | code-quality       | 10       | 2    | 2026-06-03   |
| [Keyboard Shortcut Guards](patterns/keyboard-shortcut-guards.md)                     | keyboard-shortcuts | 18       | 0    | 2026-05-26   |
| [Promise Patterns](patterns/promise-patterns.md)                                     | code-quality       | 1        | 0    | 2026-05-31   |
| [Infrastructure Identifier Exposure](patterns/infrastructure-identifier-exposure.md) | security           | 1        | 0    | 2026-06-05   |
| [Verify Render Target](patterns/verify-render-target.md)                             | code-quality       | 2        | 0    | 2026-05-24   |
| [Service Privilege Boundary](patterns/service-privilege-boundary.md)                 | security           | 1        | 1    | 2026-06-04   |
| [Status Indicator Display](patterns/status-indicator-display.md)                     | code-quality       | 3        | 0    | 2026-05-26   |
