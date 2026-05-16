# Rust Crate to `crates/backend/` Design Spec

## 1. Overview & Scope

**Goal:** Rename the Rust sidecar source directory from `src-tauri/` to
`crates/backend/` and introduce a Cargo workspace manifest at
`crates/Cargo.toml`, then update every consumer (npm scripts,
`electron-builder.yml`, Electron main-process sidecar path, CI workflow,
docs, lint configs). The Rust binary name (`vimeflow-backend`), library
name (`vimeflow_lib`), and Cargo package name (`vimeflow`) all stay
unchanged — only the directory path moves. This closes the final
deferred follow-up from the May 2026 Electron migration:
PR-D3 spec §4.5 and the `electron-migration` phase in
`docs/roadmap/progress.yaml` both flagged this rename as deferred; the
post-PR-D3 retrospective lists "`src-tauri/` directory rename is
deferred but the name becomes misleading" as a recognized friction
point.

**Migration context:** Tauri 2 → Electron 42 (PRs #209, #210, #211,
with the docs wrap-up at #212) replaced the desktop shell but kept the
Tauri-era `src-tauri/` directory name to bound the diff size. With the
runtime gone, the name is the last historical artifact and creates
onboarding friction (new contributors reading `src-tauri/` reasonably
assume Tauri is still in use; the `src-tauri/README.md` added in
PR-D3 is a workaround, not a fix).

**Sequencing note:** This branch was created from `dev` at
`c5433da` (PR-D3's squash-merge), _before_ PR #212 (docs wrap-up) lands.
This spec assumes #212 merges first; the rename branch will rebase onto
the post-#212 `dev` tip, picking up #212's doc edits and then applying
the rename on top.

**Tech Stack:** Rust 1.77.2 (Cargo workspace, resolver = "2"). No new
runtime dependencies. The post-PR-D3 crate's `[dependencies]` set is
unchanged. One new file (`crates/Cargo.toml`); everything else moves
via `git mv` (preserves git history).

### 1.1 In Scope

**Directory rename + workspace setup:**

- `git mv src-tauri/ crates/backend/` — moves every tracked file in
  the directory, preserving git history (Cargo.toml, src/, tests/,
  bindings/, Cargo.lock, README.md).
- New `crates/Cargo.toml` workspace root:
  `[workspace] members = ["backend"]\nresolver = "2"`.
- Inside `crates/backend/Cargo.toml`: `[package] name = "vimeflow"`,
  `[lib] name = "vimeflow_lib"`, `[[bin]] name = "vimeflow-backend"`,
  `[[bin]] path = "src/bin/vimeflow-backend.rs"` — all unchanged.

**Path-aware consumer updates:**

- `package.json` scripts: `cd src-tauri && cargo ...` →
  `cd crates/backend && cargo ...`. Scripts: `backend:build`,
  `backend:build:release`, `generate:bindings`, `test:e2e:build`.
- `electron-builder.yml`:
  `extraResources.from: src-tauri/target/release/vimeflow-backend` →
  `crates/backend/target/release/vimeflow-backend` (subject to the §4.2
  R2 workspace target-dir verification — Cargo may produce a workspace
  target at `crates/target/` instead).
- `electron/main.ts:39-52`: dev sidecar path
  `path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', BINARY_NAME)` →
  `path.resolve(__dirname, '..', 'crates', 'backend', 'target', 'debug', BINARY_NAME)`
  (also subject to R2's workspace target-dir verification).
- `.github/workflows/e2e.yml`: `Swatinem/rust-cache@v2`'s
  `workspaces: src-tauri` → `workspaces: crates/backend`.
- `.gitignore`: any `src-tauri/target/` etc. → `crates/backend/target/`
  (and add `crates/target/` if the workspace produces output there).
- `cspell.config.yaml`, `eslint.config.js`, `init.sh`,
  `phase3-terminal-features.json`: each grep'd hit for `src-tauri`.
- `tests/e2e/agent/specs/agent-detect-fake.spec.ts`: if the spec
  references the sidecar binary path directly.
- Internal Rust comments under the (newly-renamed)
  `crates/backend/src/` that mention the old `src-tauri/` path.
- `crates/backend/src/agent/architecture.puml` — diagram source.

**Doc updates:**

- `README.md` + `README.zh-CN.md`: project-structure tree;
  `src-tauri/` mentions.
- `ARCHITECT.md`: `src-tauri/` mentions.
- `CLAUDE.md` (project root): index references.
- `docs/CLAUDE.md` and its subdirectories.
- `docs/roadmap/progress.yaml`: mark the `src-tauri/ → backend/` rename
  follow-up done in the `electron-migration` phase entry.
- `docs/roadmap/tauri-migration-roadmap.md`: Current State table row.
- `docs/superpowers/retros/2026-05-16-electron-migration.md`: update
  the deferral list to reflect this PR closing the loop.
- `docs/decisions/2026-05-16-in-repo-skills-setup.md`: any path refs.
- `rules/` files: only `rules/rust/coding-style.md` line 29
  ("Feature-based directory structure under `src-tauri/src/`") needs a
  path update.
- `CHANGELOG.md` + `CHANGELOG.zh-CN.md`: add a Changed bullet under
  the Electron Migration section.
- `src-tauri/README.md` (added in PR-D3 specifically to defuse the
  "`src-tauri/` is misleading" confusion): obsolete after this rename.
  Rewrite to a 5-10-line `crates/backend/README.md` crate-orientation
  doc.

### 1.2 Out of Scope

- Renaming the binary `vimeflow-backend` (stays per §2 binary-name
  decision).
- Renaming the Cargo package name `vimeflow` or library name
  `vimeflow_lib` (both stay).
- Splitting the single crate into multiple workspace members (e.g.
  `crates/agent/`, `crates/runtime/`). The workspace manifest is
  added to enable this later; the split itself is its own refactor.
- Renaming `electron/` to anything else (already correct).
- Retroactively rewriting historical spec/plan docs (PR-A → PR-D3 docs
  - their reviews) to say `crates/backend/` instead of `src-tauri/`.
    Those docs reflect the state at the time they were written. The
    acceptance grep excludes `docs/**` and `*.md` to allow this.

### 1.3 Acceptance Posture

- `git log --follow crates/backend/Cargo.toml` shows the same history
  as `git log src-tauri/Cargo.toml` did pre-rename (verifies `git mv`
  preserved history).
- `cargo build --bin vimeflow-backend` works from the repo root
  (resolves through the workspace manifest) AND from `crates/backend/`
  (resolves directly).
- `cargo test` works the same from both invocations; test count
  matches the pre-rename baseline exactly.
- `npm run electron:dev` and `npm run electron:build` produce the
  same artifacts at the same paths (`dist-electron/main.js`,
  `release/vimeflow-<version>-x64.AppImage`,
  `<resources>/bin/vimeflow-backend` inside the AppImage).
- `npm run type-check`, `npm run lint`, `npm run format:check` clean.
- `npm run test` count matches the pre-rename baseline.
- `npm run test:e2e:build && npm run test:e2e:all` green.
- `rg -n "src-tauri" --glob '!docs/**' --glob '!**/*.md' --glob '!target/**' --glob '!node_modules/**' --glob '!**/bindings/**' --glob '!.git/**'`
  returns **zero hits**.

## 2. Target Layout

### 2.1 Post-rename directory tree (top-level)

```text
vimeflow/
├── src/                          # Renderer (React + TypeScript) — unchanged
├── electron/                     # Electron main process + preload + sidecar.ts — unchanged
├── crates/                       # NEW — Cargo workspace root
│   ├── Cargo.toml                # NEW — workspace manifest
│   └── backend/                  # RENAMED from src-tauri/
│       ├── Cargo.toml            # Crate manifest (unchanged content; new location)
│       ├── README.md             # Rewritten — now describes the crate, not "why src-tauri"
│       ├── src/
│       │   ├── lib.rs            # 6-line module declarations (unchanged)
│       │   ├── bin/
│       │   │   └── vimeflow-backend.rs   # Sidecar entry (unchanged)
│       │   ├── runtime/          # BackendState, IPC router, EventSink
│       │   ├── terminal/
│       │   ├── filesystem/
│       │   ├── git/
│       │   ├── agent/
│       │   └── debug/
│       ├── tests/                # Rust integration tests
│       └── bindings/             # ts-rs generated bindings (consumed by src/bindings/)
├── build/                        # electron-builder icon source — unchanged
├── docs/                         # All docs unchanged in this section's scope
├── tests/                        # WDIO E2E specs — unchanged
├── package.json                  # Modified — scripts get new paths
├── electron-builder.yml          # Modified — extraResources path
├── .github/workflows/e2e.yml     # Modified — rust-cache workspaces key
└── ...
```

The `src-tauri/` entry disappears entirely.

### 2.2 `crates/Cargo.toml` (new workspace manifest)

```toml
[workspace]
resolver = "2"
members = ["backend"]
```

That's the full file. ~3 lines. Workspace defaults are fine; member
crate manages its own `[package]`, `[dependencies]`, `[features]`.

**Why `resolver = "2"`:** Required because the member crate's Rust
edition is 2021 (currently set in `src-tauri/Cargo.toml`). Cargo
warns when a 2021-edition workspace member lacks an explicit
`resolver = "2"` at the workspace root; setting it now silences the
warning forever and matches what the contained crate would have
gotten as a single-crate package.

### 2.3 `crates/backend/Cargo.toml` (renamed; content unchanged)

The manifest itself is unmodified. Contents that stay byte-for-byte:

```toml
[package]
name = "vimeflow"               # ← stays "vimeflow"
version = "0.1.0"
edition = "2021"
rust-version = "1.77.2"
default-run = "vimeflow-backend"

[lib]
name = "vimeflow_lib"
crate-type = ["rlib"]

[dependencies]
# ... unchanged (post-PR-D3 set: serde, tokio, portable-pty, etc.) ...

[features]
e2e-test = []

[target.'cfg(unix)'.dependencies]
libc = "0.2"

[dev-dependencies]
# ... unchanged ...

[[bin]]
name = "vimeflow-backend"
path = "src/bin/vimeflow-backend.rs"
```

The `path = "src/bin/vimeflow-backend.rs"` is RELATIVE to the
manifest, so the `git mv` doesn't change it. Same for the
`[lib]` (which has no `path` and defaults to `src/lib.rs`).

### 2.4 Cargo.lock placement

Two options under a workspace:

- **Lockfile at workspace root** (`crates/Cargo.lock`). Cargo's default
  when a workspace is detected. `cargo` from any subdir walks upward
  to find the workspace root and reads `crates/Cargo.lock`.
- **Lockfile inside the member crate** (`crates/backend/Cargo.lock`).
  Cargo will ignore this if the workspace manifest is detected first.

**Decision:** Let Cargo do the default — move `Cargo.lock` to
`crates/Cargo.lock` via `git mv` from `src-tauri/Cargo.lock`. The
`git mv crates/backend/Cargo.lock crates/Cargo.lock` second-step is
explicit so reviewers see the move.

### 2.5 Why workspace root files don't move

`build/icon.png`, `electron-builder.yml`, `package.json`,
`.gitignore`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`,
etc. all stay at the repo root. They reference the renamed paths
internally; they don't live under `crates/`.

`docs/`, `tests/e2e/`, `electron/`, `src/`, `build/` all stay at
the repo root.

### 2.6 Cross-reference: how electron/main.ts resolves the binary

Pre-rename (current state):

```ts
// electron/main.ts:39-52
const resolveSidecarBin = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', BINARY_NAME)
  }

  return path.resolve(
    __dirname,
    '..',
    'src-tauri',
    'target',
    'debug',
    BINARY_NAME
  )
}
```

Post-rename (assuming Cargo produces output at `crates/backend/target/`
per the §4.2 R2 verification step; adjust to `crates/target/` if
Cargo's workspace target overrides):

```ts
const resolveSidecarBin = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', BINARY_NAME)
  }

  return path.resolve(
    __dirname,
    '..',
    'crates',
    'backend',
    'target',
    'debug',
    BINARY_NAME
  )
}
```

The packaged path (`process.resourcesPath/bin/<BINARY>`) is unchanged
— electron-builder's `extraResources` maps the `release/vimeflow-backend`
path into `<resources>/bin/vimeflow-backend`, so the runtime resolution
is identical regardless of where Cargo lands the build artifact.

## 3. Migration Steps

### 3.1 Pre-flight

**Rebase or skip:** If PR #212 (docs wrap-up) has merged to `dev`
before this PR's implementation starts, rebase this branch onto the
new `dev` tip first. Otherwise, this PR may collide with #212's
edits to `CHANGELOG.md`, `progress.yaml`,
`docs/superpowers/retros/2026-05-16-electron-migration.md`, etc.
Resolution at rebase time is mechanical (string-substitute
`src-tauri` → `crates/backend` in any conflicting line).

**Baseline:** clean working tree on `feat/rust-crate-to-electron-dir`,
all gates green:

```bash
git status                                  # clean
npm run type-check && npm run lint && npm run test
(cd src-tauri && cargo test)
```

Also clear untracked output that would otherwise be left behind by
`git mv` (which only moves tracked files):

```bash
rm -rf src-tauri/target src-tauri/gen
```

### 3.2 Step 1 — Move the directory

```bash
# Git-tracked move (preserves history).
git mv src-tauri crates/backend
```

Verify history follows:

```bash
git log --follow crates/backend/Cargo.toml | head -5
# Should show the same commits as the pre-rename `src-tauri/Cargo.toml`.
```

**Do not commit yet** — at this state Cargo can't resolve the
workspace and `cargo check` would fail. Step 2 completes the move
atomically.

### 3.3 Step 2 — Create the workspace manifest

Write `crates/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["backend"]
```

Move the lockfile too (Cargo's default place is the workspace root):

```bash
git mv crates/backend/Cargo.lock crates/Cargo.lock
```

**Verify the workspace resolves AND the target directory lands where
expected (§4.2 R2 verification):**

```bash
cargo metadata --no-deps --manifest-path crates/Cargo.toml | jq '.workspace_members'
# Should list one member: "vimeflow 0.1.0 ..."

cargo check --manifest-path crates/Cargo.toml
# Should succeed.

(cd crates/backend && cargo check)
# Should succeed (walks upward, finds workspace).

# CRITICAL: identify the actual target dir Cargo produces.
cargo build --bin vimeflow-backend --manifest-path crates/Cargo.toml 2>&1 | grep -E "Compiling|Finished"
ls -d crates/target 2>/dev/null && echo "WORKSPACE_TARGET=crates/target" || echo "MEMBER_TARGET=crates/backend/target"
ls -d crates/backend/target 2>/dev/null && echo "MEMBER_TARGET=crates/backend/target" || true
```

If `crates/target/` exists with a `release/vimeflow-backend` binary
inside, Cargo is using the workspace target dir — update §1.1's
electron-builder + electron/main.ts paths from
`crates/backend/target/` to `crates/target/` before step 3.

**Commit 1:**
`refactor(rust): move src-tauri/ → crates/backend/ + add workspace manifest`
Staged paths: the entire renamed tree + new `crates/Cargo.toml`.

### 3.4 Step 3 — Update path-aware code

In one commit:

**`electron/main.ts`** — the `resolveSidecarBin` function:

```ts
// Find:
'src-tauri',
'target',

// Replace with (or 'crates','target', per the R2 verification):
'crates',
'backend',
'target',
```

**`electron-builder.yml`:**

```yaml
# Find:
extraResources:
  - from: src-tauri/target/release/vimeflow-backend
    to: bin/vimeflow-backend

# Replace with (or `crates/target/release/...` per R2 verification):
extraResources:
  - from: crates/backend/target/release/vimeflow-backend
    to: bin/vimeflow-backend
```

**`package.json` scripts** — all `cd src-tauri && cargo ...` →
`cd crates/backend && cargo ...`. The four affected:

- `backend:build`
- `backend:build:release`
- `generate:bindings`
- `test:e2e:build`

**`.github/workflows/e2e.yml`:**

```yaml
# Find:
- name: Cache Rust dependencies
  uses: Swatinem/rust-cache@v2
  with:
    workspaces: src-tauri

# Replace with:
- name: Cache Rust dependencies
  uses: Swatinem/rust-cache@v2
  with:
    workspaces: crates/backend
```

(The `shared-key: e2e-test` line stays.)

**`.gitignore`:** any `src-tauri/target/`, `src-tauri/gen/` rules →
`crates/backend/target/`, `crates/backend/gen/`. **If R2 verification
showed `crates/target/`, add that rule too.** The `build/`,
`release/`, `dist-electron/` rules don't change.

**`cspell.config.yaml`** + **`eslint.config.js`** + **`init.sh`** +
**`phase3-terminal-features.json`**: grep each for `src-tauri` and
substitute. The plan-level breakdown will enumerate exact lines per
file.

**`tests/e2e/agent/specs/agent-detect-fake.spec.ts`**: if it has a
literal `src-tauri/` path, substitute. (E2E specs are normally
DOM-only — if there's no hit after this swap, the file doesn't need
editing.)

**Verification after this commit:**

```bash
npm run type-check && npm run lint && npm run test
(cd crates/backend && cargo build --bin vimeflow-backend)
npm run electron:build
```

The electron-builder run is the load-bearing check — it exercises the
new `extraResources.from` path and the dev sidecar path through the
packaging machinery.

**Commit 2:**
`refactor(electron): point dev sidecar + packaging + scripts at crates/backend/`

### 3.5 Step 4 — Update doc-comments in Rust source

Inside the (newly-renamed) `crates/backend/src/` tree:

- `crates/backend/src/agent/adapter/base/transcript_state.rs`
- `crates/backend/src/agent/adapter/claude_code/test_runners/test_file_patterns.rs`
- `crates/backend/src/filesystem/tests/mod.rs`
- `crates/backend/src/agent/architecture.puml`

For each, grep for `src-tauri/` and substitute `crates/backend/` in
doc-comments. The .puml file is a PlantUML source — the `tauri::Runtime`
references (different concern; out of scope) stay; only the path
references update.

**Verification:**

```bash
rg -n "src-tauri" crates/backend/src/
# Expected: zero hits.

(cd crates/backend && cargo test)
# Expected: green; doc-comments don't affect tests.
```

**Commit 3:**
`docs(rust): update src-tauri/ path references in crate doc-comments`

### 3.6 Step 5 — Update project docs

Pick up references in:

- `README.md`, `README.zh-CN.md`
- `ARCHITECT.md`
- `CLAUDE.md` (root)
- `docs/CLAUDE.md` + subdir CLAUDE.md indexes
- `docs/roadmap/progress.yaml` — change deferred-follow-up note to
  `done` for the rename; add commit pointer
- `docs/roadmap/tauri-migration-roadmap.md` — Current State table
- `docs/superpowers/retros/2026-05-16-electron-migration.md` — move
  the rename out of "Deferrals tracked" into a "Resolved deferrals"
  subsection
- `docs/decisions/2026-05-16-in-repo-skills-setup.md` — any path refs
- `rules/rust/coding-style.md:29` — `src-tauri/src/` →
  `crates/backend/src/`
- `CHANGELOG.md` + `CHANGELOG.zh-CN.md` — append a Changed bullet under
  the Electron Migration section: "Renamed Rust crate directory
  `src-tauri/` → `crates/backend/` (PR-D3 deferred follow-up)."

For `src-tauri/README.md` (now at `crates/backend/README.md` after
the `git mv`): rewrite to a 5-10-line crate-orientation doc. Replace
the "directory-name confusion defuser" framing (obsolete now) with a
short "what's here" summary:

```markdown
# crates/backend — Electron sidecar (Rust)

Long-lived sidecar process spawned by Electron over LSP-framed JSON
stdio IPC. Hosts PTY (`portable-pty`), filesystem, git (status / diff /
watch), and agent observability (Claude Code + Codex adapters).

- `src/bin/vimeflow-backend.rs` — sidecar binary entry point.
- `src/runtime/` — `BackendState`, IPC router, `EventSink` trait.
- `src/{terminal,filesystem,git,agent}/` — feature modules.
- `bindings/` — `ts-rs` generated TypeScript types; regenerate via
  `npm run generate:bindings`.
- `tests/` — integration tests.

The directory was renamed from `src-tauri/` in <PR#> after the May 2026
Electron migration; see `docs/superpowers/retros/2026-05-16-electron-migration.md`.
```

**Verification:**

```bash
rg -n "src-tauri" \
  --glob '!docs/**' --glob '!**/*.md' \
  --glob '!target/**' --glob '!node_modules/**' \
  --glob '!**/bindings/**' --glob '!.git/**'
# Expected: zero hits.

# Docs/markdown CAN still mention src-tauri/ — it's historical context
# in spec/plan/retro narratives. The grep above excludes them.
```

**Commit 4:**
`docs: update src-tauri/ path references across project docs`

### 3.7 Step 6 — Final verification gate

```bash
npm run format:check
npm run lint
npm run type-check
npm run test
(cd crates/backend && cargo test)
(cd crates/backend && cargo build --release --bin vimeflow-backend)
npm run test:e2e:build
# (run E2E suites if local environment supports xvfb-run)
npm run electron:build
ls -la release/vimeflow-*.AppImage
```

Manual smoke (the AppImage):

```bash
chmod +x release/vimeflow-0.1.0-x64.AppImage
./release/vimeflow-0.1.0-x64.AppImage --no-sandbox &
# Walk the 7 baseline flows from PR-D3 §3.4.
```

### 3.8 Commit cadence summary

- **Commit 1:** `refactor(rust): move src-tauri/ → crates/backend/ + add workspace manifest` (the `git mv` + `crates/Cargo.toml` + lockfile move)
- **Commit 2:** `refactor(electron): point dev sidecar + packaging + scripts at crates/backend/` (electron/main.ts, electron-builder.yml, package.json, e2e.yml, .gitignore, cspell, eslint, init.sh, phase3 JSON, e2e spec)
- **Commit 3:** `docs(rust): update src-tauri/ path references in crate doc-comments`
- **Commit 4:** `docs: update src-tauri/ path references across project docs`

Squash-merge convention means these collapse to one feature commit
on `dev` at merge time; the in-PR cadence is for reviewer clarity.

## 4. Risks & Rollback

### 4.1 High-Severity Risks

**R1 — `git mv` history-follow regression.**
If `git mv` is run on multiple files individually rather than the
top-level directory, git's rename-detection may miss similarity
threshold for some files and record them as delete+add instead of
rename. History-following via `git log --follow` then breaks for
those files.

_Mitigation:_ run `git mv src-tauri crates/backend` on the whole
directory in one command. Verify post-move with
`git log --follow crates/backend/Cargo.toml` and a few sample files
(at least the lib root, one tests file, one src module file). If any
file looks de-correlated, redo the move with explicit per-file
`git mv` retries.

**R2 — Workspace target-dir ambiguity.**
With `crates/Cargo.toml` (workspace) and `crates/backend/Cargo.toml`
(member), Cargo's upward-walk from any subdir finds the workspace
root first. This is the intended behavior, but it means Cargo may
produce the build target at either `crates/target/` (workspace
target dir) OR `crates/backend/target/` (member target dir),
depending on which manifest's `[workspace.target-dir]` /
`[build] target-dir` setting wins. The packaging path
(`extraResources.from`) must match the actual produced path or the
AppImage won't bundle the binary.

_Mitigation:_ §3.3 step 2 includes an empirical verification step.
Run `cargo build --bin vimeflow-backend` first, then `ls
crates/target/ crates/backend/target/ 2>/dev/null` to see where the
binary actually lands. Set the §3 path references accordingly. The
plan must execute this verification BEFORE editing
`electron-builder.yml`, `electron/main.ts`, and `.gitignore`. If the
workspace produces `crates/target/`, all three references update to
that path.

**R3 — Sequencing collision with PR #212 (docs wrap-up).**
PR #212 edits many of the same doc files this PR also edits
(CHANGELOG, retro, progress.yaml, decisions doc, README, ARCHITECT,
CLAUDE.md). If both PRs are open simultaneously, the second to merge
faces conflicts.

_Mitigation:_ merge #212 first (it's ready and pending review). This
PR rebases onto post-#212 `dev` before opening. Pre-flight check
in §3.1 enforces this.

### 4.2 Medium-Severity Risks

**R4 — `.gitignore` patterns inside the (now-moved) `src-tauri/`.**
The current `.gitignore` likely has rules like `src-tauri/target/`
and `src-tauri/gen/`. After the rename, those rules point at
non-existent paths and no longer ignore the `target/` output
directory created by `cargo build` under `crates/backend/` or
`crates/target/`.

_Mitigation:_ §3.4 step 3 includes the `.gitignore` substitution.
Verify post-build with `git status` — if `crates/backend/target/`
or `crates/target/` files show up as untracked, the `.gitignore`
edit is incomplete; add the missing rule.

**R5 — Tooling that hardcodes `src-tauri/` outside the grep'd set.**
The §1.1 inventory was based on a grep across `src/`, `tests/`,
`electron/`, `package.json`, top-level config files, and the
`src-tauri/` source itself. Tools that read paths at runtime from
sources NOT in the grep set (e.g. an IDE setting, a VS Code
launch.json, a `.vscode/tasks.json`) would silently break.

_Mitigation:_ after §3 step 3 commits, run a comprehensive grep:

```bash
rg -n "src-tauri" --hidden \
  --glob '!docs/**' --glob '!**/*.md' --glob '!target/**' \
  --glob '!node_modules/**' --glob '!**/bindings/**' \
  --glob '!.git/**'
```

Investigate every remaining hit. Most likely categories: VS Code /
editor settings, `.envrc` direnv config, shell-helper scripts under
`scripts/`.

**R6 — `gen/` directory and other side-effect outputs.**
The current `src-tauri/gen/` directory holds Tauri-generated
schemas (from `tauri::generate_handler!`-time codegen). Post-PR-D3
this is dead code but the directory may still exist in the working
tree (gitignored). After the `git mv`, the `gen/` folder moves to
`crates/backend/gen/` (if it was tracked) or stays at `src-tauri/gen/`
(if it was untracked-but-present, `git mv` doesn't move untracked
files).

_Mitigation:_ before the `git mv`, `rm -rf src-tauri/gen/
src-tauri/target/` to clear any untracked output. Verify
post-move with `ls src-tauri/ 2>&1` — should say "No such file or
directory."

### 4.3 Low-Severity Risks

**R7 — Cargo target-dir cache invalidation.**
Cargo's incremental compilation cache is keyed off the source-file
absolute paths. After the directory move, the first
`cargo build` from `crates/backend/` will be a full rebuild (the
old `src-tauri/target/` cache won't match). This adds ~30-60s to
the first build.

_Mitigation:_ accept it; this is a one-time cost. Document in the PR
that the first CI run after merge will be slower than steady-state.

**R8 — Doc-comments referencing the old path in code reviews.**
Future code reviews against `crates/backend/src/` will sometimes
quote line numbers / paths from previous PRs (e.g. "see §X of the
PR-D3 spec, which references `src-tauri/src/lib.rs:31`"). Those
historical references become slightly confusing — the code is now
at `crates/backend/src/lib.rs` but the spec mentions
`src-tauri/src/lib.rs`.

_Mitigation:_ none required at PR scope. The historical docs are
preserved verbatim per the §1.2 out-of-scope policy. Reviewers
should mentally map `src-tauri/` → `crates/backend/` when reading
pre-rename docs. The retrospective's "Resolved deferrals" subsection
(added in §3.6) flags this for future readers.

### 4.4 Rollback

This PR is a single atomic rename. Rollback options:

- **Full revert:** `git revert <merge-sha>` undoes the entire PR.
  Restores `src-tauri/` directory + drops `crates/Cargo.toml`. The
  packaged AppImage layout (`bin/vimeflow-backend` inside resources)
  is unchanged either way since the binary name didn't move; only
  the source-tree path moves back.
- **Partial revert:** if the workspace manifest causes problems but
  the rename itself is fine, revert just commit 1 in the PR
  sequence (the `crates/Cargo.toml` + lockfile move) and keep the
  directory at `crates/backend/` with the lockfile inside it. This
  requires hand-editing the revert; not recommended unless the
  workspace causes a specific issue (e.g. an upstream tool that
  doesn't understand workspace manifests).

### 4.5 What This Spec Does Not Promise

- That historical specs / plans / retros get retroactively rewritten.
  The acceptance grep excludes `docs/**` and `*.md` precisely to
  allow this.
- That the Cargo workspace will be used by adding more member crates
  soon. The workspace is added for shape; splitting the single crate
  is a future-roadmap concern.
- A directory layout that matches any specific other project's. The
  research showed no single dominant convention; `crates/<n>/` is the
  user's pick from the survey of NeverWrite + Zed + the Cargo
  workspace norm.
