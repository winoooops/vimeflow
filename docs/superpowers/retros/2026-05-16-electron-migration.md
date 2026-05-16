# Electron Migration Retrospective

> **Date:** 2026-05-16
> **Scope:** Tauri 2 → Electron 42 + Rust sidecar (vimeflow-backend), 3 merged PRs / 6 design tracks May 13-16, 2026
> **Outcome:** Runtime cutover complete. Tauri runtime fully removed; AppImage packaging working; PR-D3 CI checks green. The final main-branch E2E workflow signal remains tracked in `docs/roadmap/progress.yaml`.

## TL;DR

We replaced the Tauri 2 desktop shell with Electron 42 over three merged PRs (#209, #210, #211) and six design tracks (PR-A through PR-D3), preserving the Rust backend's PTY / filesystem / git / agent surface unchanged. The Rust crate transitioned from "Tauri command handlers + invoke_handler! macro" to "runtime-neutral `BackendState` methods + LSP-framed JSON IPC over stdio." `npm run electron:build` now produces a Linux AppImage with the sidecar binary bundled as an `extraResource`. The PR-A / PR-B / PR-C design tracks (runtime-neutral backend / sidecar IPC / frontend bridge) were authored as separate specs + plans but landed bundled inside #209 to keep the cutover atomic.

## What worked

### Two skills carried the migration — `native-feel-cross-platform-desktop` for shape, `lifeline:planner` for execution

The upfront question "which Electron tooling stack does a modern, native-feeling Claude Code-style desktop app actually use?" was answered by the `native-feel-cross-platform-desktop` skill before any spec was written. The skill's curated knowledge about Electron + `vite-plugin-electron` + sidecar architectures (versus alternatives like Tauri, `electron-vite`, or plain `tsc` bundling) collapsed what could have been a multi-day research detour into a single design conversation. PR-D1's research phase reads as "validate against the skill's recommendations + Codex Desktop reference + chrome-launcher prior art" rather than "discover the architecture from scratch."

Once the shape was locked, `lifeline:planner`'s per-section codex review + plan-complete codex review carried every spec from draft to merge-ready. Without it, we'd have been writing specs unreviewed, executing them, and discovering missing items only after PRs hit GitHub. The two skills compose: `native-feel-cross-platform-desktop` answers "what should this look like?" once; `lifeline:planner` answers "is this spec self-consistent and complete?" on every iteration.

### Cross-PR contracts pinned the migration's shape early

PR-C's spec §2.5 explicitly locked in that PR-D's bridge edit would be "a 4-to-6-line delete of the `@tauri-apps` imports and the fallback branches." When PR-D3 finally executed, the actual diff in `src/lib/backend.ts` matched that line count almost exactly — confirming the cross-PR contract held. Without that pin, the temptation to refactor the bridge mid-migration would have been hard to resist; the contract made deferral the obvious right move.

### Runtime-neutral layer extracted first, runtime swapped second

The migration roadmap put PR-A (`BackendState` + `*_inner` helpers) and PR-B (sidecar IPC over stdio) ahead of any Electron work. The result: when PR-D1 wired in Electron, the production code path was already "runtime-neutral state methods dispatched by a JSON IPC router" — Tauri vs Electron was just a question of which process spawned the IPC. The 20 `#[tauri::command]` wrappers PR-D3 eventually deleted were already dead code by the time we deleted them; verified by `cargo test` count staying byte-identical across the change.

### Per-section codex review caught spec drift at the section grain

`/lifeline:planner`'s per-section iteration mode ran `codex exec` against the cumulative spec after each section was approved. This caught several real issues at the section level — invalid empirical claims (e.g., PR-D3 spec's initial "22 #[tauri::command] wrappers" count was actually 20 in `.rs` files; the extra 2 were doc-string references in README/SECURITY markdown), file-state contradictions (icon path bouncing between `build/icon.png` and `build/icons/256x256.png`), and dependency-ordering insights (the lib.rs collapse must precede the wrapper deletion to keep cargo compiling, vs the user's planner-anchor list that had them in the opposite order). Catching these at section grain meant no end-of-spec surprises and no rework of approved sections.

### Plan-complete review found cross-section drift the section reviews missed

Codex's whole-spec pass at the end of `/lifeline:planner` and the whole-plan pass at the end of `superpowers:writing-plans` each surfaced findings that no section-level review could have caught — items like "this acceptance grep can't return zero because `agent/architecture.{puml,svg}` contain `tauri::Runtime` strings" and "`package-lock.json` is updated by `npm install` and needs to be committed alongside `package.json`." These cross-cutting checks were the highest-value codex passes; the per-section ones were more about local accuracy.

### Atomic AppImage smoke verification

The PR-D3 smoke step extracted the produced AppImage with `--appimage-extract` and `find`ed `resources/bin/vimeflow-backend` before any UI walk. This catches the highest-severity packaging failure (sidecar path mismatch between `electron/main.ts:40-42` and `electron-builder.yml`'s `extraResources`) before manual UI testing — without it, you only notice the failure when `pwd` doesn't return in the terminal pane.

### Squash-merge convention paid off

The repo's squash-merge workflow meant that intermediate per-PR commits (PR-D1's ~15 sub-commits before merge) collapsed into a single feature commit on `dev`. The full migration shows as 3 commits on `dev` — easy to bisect, easy to revert atomically if needed.

## Friction points

### Dependency ordering required deviating from planner anchors

The user's planner-anchor list for PR-D3 had Task 4 = "delete #[tauri::command] wrappers" before Task 6 = "delete lib.rs/main.rs/build.rs". That ordering breaks `cargo build` because `lib.rs::run()` contains `invoke_handler![spawn_pty, write_pty, ...]` macro references to the wrappers — deleting the wrappers first leaves the macro pointing at non-existent symbols. The plan deviated to: collapse `lib.rs` (drop the `invoke_handler!` references), then delete the wrappers, then delete `tauri_bridge.rs`, then `build.rs`, then strip `Cargo.toml`. Each commit in this order compiles cleanly. The deviation was documented at the top of the plan; in retrospect we should have caught this during the spec phase too.

### Pre-existing TypeScript diagnostics surfaced repeatedly during verification

`vite.config.ts:75-93` has type errors on `simple-git`'s `DiffResult*` union types. The diagnostics aren't caught by `npm run type-check` (the root `tsconfig.json:include = ["src"]` skips `vite.config.ts`; only `tsconfig.node.json` would catch it, and that's not invoked by the type-check script). The editor's TypeScript language server runs all `tsconfig*.json` projects and surfaces them. The pattern: every time we ran a verification gate, the LSP diagnostic chip lit up, and we had to confirm "yes, pre-existing, out of scope." Lesson: untracked technical debt that lives outside the CI gates eventually becomes background noise. The fix is its own follow-up (probably a `DiffResultTextFile` type narrowing in `vite.config.ts`).

### Codex 300 s timeout fired on long spec reviews

The default `LIFELINE_CODEX_TIMEOUT=300` aborted on the second per-section review for PR-D3 (codex was actively reading source files when the timeout fired). Retrying with `LIFELINE_CODEX_TIMEOUT=500` worked. This is the same friction PR-D1's retro flagged with `LIFELINE_CODEX_TIMEOUT=900`. The planner skill should default to 500-600 s; the current 300 default is too short once the spec passes ~10 KB or the codex agent's source-reading phase kicks in.

### Codex sometimes re-flagged findings we'd already applied

On one mid-section review, codex returned the _exact same 4 findings_ from the previous pass — same line-number citations against the older spec version, even though the prompt clearly contained the updated spec. The root cause turned out to be that the prior run had genuinely failed (bash timeout fired before codex completed; the review file from a still-earlier run was stale). The workflow now is: always check `stat` on the review file timestamp before reading it, and re-run if the timestamp is older than the prompt file's mtime. Better still, `codex-review.sh` should fail-loud when codex exits non-zero rather than silently leaving a stale review file.

### Doc-comment drift was wider than the spec scope

Codex's plan-complete review caught that `useSessionManager.test.ts`, `useTerminal.ts`, and `terminal/types/index.ts` had doc-comments referencing `tauriTerminalService` that would become stale after the rename. The original Task 3 (class rename) plan only listed the obvious file pair. Codex's broader sweep caught the leak. Lesson: when renaming a symbol that's referenced in non-source-of-truth comments, plan for a global text sweep on the symbol name — not just the source files.

### The `src-tauri/` directory name remains misleading

We deferred the `src-tauri/` → `backend/` rename because it touches every Cargo path, every CI workflow, and every test script. The interim state has a directory called `src-tauri/` that contains zero Tauri references. We added `src-tauri/README.md` as a defusing doc but it's a workaround. New contributors reading `src-tauri/` will reasonably assume Tauri is still in use; the rename should land in a follow-up PR before any new contributor onboards.

## Deferrals tracked

- **`src-tauri/` → `backend/` directory rename.** Touches every Cargo path / CI workflow / test script. Own atomic PR.
- **macOS / Windows packaging.** `electron-builder.yml` is structured to accept them; needs a new CI matrix workflow + cross-build verification.
- **Code signing + notarization.** Required for production end-user distribution on macOS / Windows; deferred until distribution is a real concern.
- **Auto-update wiring.** `electron-builder` supports `publish: null` for now; auto-update integration is its own design problem (Squirrel for Windows, latest.yml for AppImage).
- **End-user-safe sandboxed AppImage.** PR-D3's AppImage requires `--no-sandbox` on hosts without a SUID `chrome-sandbox`. Bundling chrome-sandbox or wrapping in flatpak / AppRun-with-sandbox-helper is a follow-up.
- **Multi-platform CI matrix.** The deleted `.github/workflows/tauri-build.yml` did Ubuntu/macOS/Windows; a replacement `packaged-build.yml` is a follow-up.
- **`src-tauri/src/agent/architecture.{puml,svg}` redraw.** The diagrams still show `AgentAdapter<R: tauri::Runtime>`; the post-D3 trait is non-generic.

## What we'd do differently

1. **Default `LIFELINE_CODEX_TIMEOUT` to 500-600 s.** The 300 s default isn't enough once specs grow past 10 KB.
2. **Verify codex review-file timestamps before reading.** A stale review file from a prior timed-out run can produce misleading "same findings as before" loops.
3. **Plan for doc-comment sweep when renaming public symbols.** Add an explicit step like "`rg -i <old-symbol-name> src tests` and update every comment hit" rather than relying on codex review to catch them.
4. **Bake dependency-ordering analysis into the spec, not just the plan.** PR-D3's "Tasks must execute in this order to keep compilation green" insight surfaced during plan-writing; it should have been in the spec's architecture section so it could be reviewed earlier.
5. **Land the directory rename in the same migration window.** The deferred `src-tauri/` → `backend/` rename is going to confuse contributors. The "do it during the migration" cost was finite; the "do it later as a follow-up" cost is unbounded contributor-onboarding friction.

## Notes on the skill toolkit used for this migration

Two skills carried the migration end-to-end:

1. **`native-feel-cross-platform-desktop`** (system-wide skill) — opened the migration by answering "what's the right Electron + bundler + sidecar architecture for a Claude Code-class desktop app in 2026?" Without it, PR-D1 would have spent days re-deriving an architecture that the skill could land in one conversation. Trigger phrases for future work: "Electron alternative", "Tauri vs native", "WebView wrapper", "near-native performance", "Raycast architecture". The skill is most useful at the _shape_ stage — before any spec is written.
2. **`/lifeline:planner`** (in-repo symlinked skill) — carried every spec from draft to codex-reviewed-and-committed. Per-section iteration + plan-complete review caught issues that no human-only review would have surfaced. This migration was the third project to use it end-to-end (after PR-D1 and PR-D2). The in-repo `skills/planner` symlink workaround (see `docs/decisions/2026-05-16-in-repo-skills-setup.md`) makes it reliable across machines.

The pattern of "shape with `native-feel-cross-platform-desktop` once → spec section-by-section with `/lifeline:planner` → human-executed → `lifeline:approve-pr` at merge" is now load-bearing for non-trivial PRs in this repo. Both skills are intentional choices and worth highlighting to new contributors during onboarding.

For migrations specifically: the per-PR design specs + the overarching migration roadmap (`docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`) gave a clear scaffold for what each PR owned. New contributors picking up future migrations should mirror this shape: shape with the design skill once, then one roadmap doc, then one spec per PR, with cross-PR contracts explicitly pinned in each spec's `§N.M Cross-PR Contract` subsections.

## Pointers

- Roadmap: `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`
- Per-PR specs: `docs/superpowers/specs/2026-05-{13,14,15}-pr-{a,b,c,d1,d2,d3}-*-design.md`
- Per-PR plans: `docs/superpowers/plans/2026-05-{13,14,15}-pr-{a,b,c,d2,d3}-*.md`
- Merged PRs: [#209](https://github.com/winoooops/vimeflow/pull/209), [#210](https://github.com/winoooops/vimeflow/pull/210), [#211](https://github.com/winoooops/vimeflow/pull/211)
- CHANGELOG entries: `CHANGELOG.md` § Electron Migration, `CHANGELOG.zh-CN.md` § Electron 迁移
- Per-session planner retros (private, ignored): `.lifeline-planner/retros/2026-05-12-1455.md`, `.lifeline-planner/retros/2026-05-15-0231.md`
