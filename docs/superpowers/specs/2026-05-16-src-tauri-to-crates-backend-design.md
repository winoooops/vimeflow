# Rust Crate to `crates/backend/` Design Spec

## 1. Overview & Scope

**Goal:** Rename the Rust sidecar source directory from `src-tauri/` to
`crates/backend/` and introduce a Cargo workspace manifest at the
**repo root** (`./Cargo.toml`), then update every consumer (npm
scripts, `electron-builder.yml`, Electron main-process sidecar path,
both CI workflows, the `.cargo/config.toml` env, docs, lint configs).
The Rust binary name (`vimeflow-backend`), library name
(`vimeflow_lib`), and Cargo package name (`vimeflow`) all stay
unchanged — only the directory path moves and the workspace shape
gains a root manifest. This closes the final deferred follow-up from
the May 2026 Electron migration: PR-D3 spec §4.5 and the
`electron-migration` phase in `docs/roadmap/progress.yaml` both flagged
this rename as deferred; the post-PR-D3 retrospective lists
"`src-tauri/` directory rename is deferred but the name becomes
misleading" as a recognized friction point.

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

**Workspace shape (key decision):** The workspace manifest lives at
the **repo root** (`./Cargo.toml`) with `members = ["crates/backend"]`.
This means `cargo` invocations from any subdirectory walk up to the
repo root and the build target lands at **`./target/`**. The
alternative of putting the workspace at `crates/Cargo.toml` was
rejected after codex review because (a) repo-root cargo invocations
would need `--manifest-path crates/Cargo.toml` and (b) the cargo
target-dir would land at `crates/target/`, which is one level above
the only crate it builds for and is confusing to readers. Zed and
many other multi-language repos with `crates/` follow the
root-Cargo.toml convention.

**Tech Stack:** Rust 1.77.2 (Cargo workspace, resolver = "2"). No new
runtime dependencies. The post-PR-D3 crate's `[dependencies]` set is
unchanged. One new file (`./Cargo.toml` at repo root); everything
else moves via `git mv` (preserves git history).

### 1.1 In Scope

**Directory rename + workspace setup:**

- `mkdir -p crates && git mv src-tauri crates/backend` — moves every
  tracked file in the directory, preserving git history (Cargo.toml,
  Cargo.lock, src/, tests/, bindings/, README.md, .cargo/config.toml).
  The `mkdir -p crates` is load-bearing: `git mv` does not auto-create
  the destination parent.
- New `Cargo.toml` at repo root: 3-line workspace manifest with
  `members = ["crates/backend"]` and `resolver = "2"`.
- Inside `crates/backend/Cargo.toml`: `[package] name = "vimeflow"`,
  `[lib] name = "vimeflow_lib"`, `[[bin]] name = "vimeflow-backend"`,
  `[[bin]] path = "src/bin/vimeflow-backend.rs"` — all unchanged.
- Inside `crates/backend/.cargo/config.toml`: update
  `TS_RS_EXPORT_DIR = "../src/bindings/"` →
  `TS_RS_EXPORT_DIR = "../../src/bindings/"` (one extra `../` to
  escape both `crates/` and `crates/backend/`).
- `Cargo.lock` is currently tracked (despite being in `.gitignore` —
  the file was committed before the ignore rule was added; git
  preserves tracking for already-tracked files). The `git mv` moves
  it from `src-tauri/Cargo.lock` to `crates/backend/Cargo.lock`. Cargo
  then prefers the workspace-root location, so the lockfile will be
  regenerated at `./Cargo.lock` on the first build. The plan lets
  Cargo handle this naturally (no second `git mv` for the lockfile).

**Path-aware consumer updates:**

- `package.json` scripts:
  - `backend:build`: `cd src-tauri && cargo build --bin vimeflow-backend` →
    `cargo build --bin vimeflow-backend` (no `cd` needed — root workspace).
  - `backend:build:release`: same pattern.
  - `test:e2e:build`: drop the `cd src-tauri &&` prefix; cargo runs
    from repo root.
  - `generate:bindings`: `cd src-tauri && cargo test export_bindings && cd .. && prettier --write src/bindings/` →
    `cargo test --manifest-path crates/backend/Cargo.toml export_bindings && prettier --write src/bindings/`.
    Using `--manifest-path` instead of `cd` keeps the
    `prettier --write src/bindings/` step's CWD at the repo root,
    avoiding the `cd ../..` arithmetic that codex flagged as fragile.
- `electron-builder.yml`:
  `extraResources.from: src-tauri/target/release/vimeflow-backend` →
  `target/release/vimeflow-backend`. Workspace-root target dir.
- `electron/main.ts:39-52`: dev sidecar path
  `path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', BINARY_NAME)` →
  `path.resolve(__dirname, '..', 'target', 'debug', BINARY_NAME)`.
- `.github/workflows/e2e.yml`:
  - Push + PR path filters: `'src-tauri/**'` → `'crates/**'` (covers
    the renamed crate AND the root Cargo.toml is at the repo root, so
    a separate `'Cargo.toml'` path entry is added).
  - `Swatinem/rust-cache@v2 with: workspaces: src-tauri` → `workspaces: .`
    (workspace root is the repo root; the action's `workspaces` key
    is the path TO the workspace manifest's directory).
  - Diagnostics upload path: `src-tauri/target/debug/vimeflow-backend` →
    `target/debug/vimeflow-backend`.
- `.github/workflows/ci-checks.yml`:
  - Two `Swatinem/rust-cache@v2 with: workspaces: src-tauri` →
    `workspaces: .`.
  - One `working-directory: src-tauri` → `working-directory: .`.
- `.gitignore`:
  - `src-tauri/target/` → `/target/` (workspace-root build dir).
  - Add `/Cargo.lock`? **No** — lockfile is committed in this repo
    (it's a binary-producing project, not a published library); keep
    it tracked. The existing `src-tauri/Cargo.lock` in `.gitignore`
    is a leftover; the rename's `.gitignore` edit removes that line
    entirely without adding a `/Cargo.lock` ignore.
- `cspell.config.yaml`, `eslint.config.js`, `init.sh`,
  `phase3-terminal-features.json`: each grep'd hit for `src-tauri`
  substituted to `crates/backend/`.
- `tests/e2e/agent/specs/agent-detect-fake.spec.ts`: if the spec
  references the sidecar binary path directly.
- Internal Rust comments under the (newly-renamed)
  `crates/backend/src/` that mention the old `src-tauri/` path
  (`src/agent/adapter/base/transcript_state.rs`,
  `src/agent/adapter/claude_code/test_runners/test_file_patterns.rs`,
  `src/filesystem/tests/mod.rs`, `src/agent/architecture.puml`).

**Doc updates:**

- `README.md` + `README.zh-CN.md`: project-structure tree;
  `src-tauri/` mentions.
- `ARCHITECT.md`: `src-tauri/` mentions.
- `CLAUDE.md` (project root): index references.
- `docs/CLAUDE.md` and its subdirectories.
- `docs/roadmap/progress.yaml`: mark the `src-tauri/ → backend/` rename
  follow-up done in the `electron-migration` phase entry.
- `docs/roadmap/tauri-migration-roadmap.md`: Current State table row.
- `docs/superpowers/retros/2026-05-16-electron-migration.md`: move the
  rename out of "Deferrals tracked" into a "Resolved deferrals"
  subsection.
- `docs/decisions/2026-05-16-in-repo-skills-setup.md`: any path refs.
- `rules/rust/coding-style.md` line 29 ("Feature-based directory
  structure under `src-tauri/src/`") → `crates/backend/src/`.
- `CHANGELOG.md` + `CHANGELOG.zh-CN.md`: append a Changed bullet under
  the Electron Migration section.
- `src-tauri/README.md` (added in PR-D3 specifically to defuse the
  "`src-tauri/` is misleading" confusion): obsolete after this rename.
  Rewrite to a 5-10-line `crates/backend/README.md` crate-orientation
  doc (template in §3.6).

### 1.2 Out of Scope

- Renaming the binary `vimeflow-backend` (stays per the planner-time
  binary-name decision).
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
- `cargo build --bin vimeflow-backend` works from the **repo root** —
  the root workspace manifest at `./Cargo.toml` resolves the
  `crates/backend` member. Also works from `crates/backend/` (cargo
  walks upward).
- `cargo test` works the same from both invocations; test count
  matches the pre-rename baseline exactly.
- `cargo metadata --no-deps | jq '.target_directory'` returns the
  absolute path to `./target/` (repo root). This is the exact path
  the packaging step expects.
- `npm run electron:dev` and `npm run electron:build` produce the
  same artifacts at the same paths (`dist-electron/main.js`,
  `release/vimeflow-<version>-x64.AppImage`,
  `<resources>/bin/vimeflow-backend` inside the AppImage).
- `npm run type-check`, `npm run lint`, `npm run format:check` clean.
- `npm run test` count matches the pre-rename baseline.
- `npm run test:e2e:build && npm run test:e2e:all` green.
- `npm run generate:bindings` regenerates `src/bindings/*` without
  ending up in the wrong CWD for the prettier step.
- `rg -n "src-tauri" --hidden --glob '!docs/**' --glob '!**/*.md' --glob '!target/**' --glob '!node_modules/**' --glob '!**/bindings/**' --glob '!.git/**'`
  returns **zero hits**.

## 2. Target Layout

### 2.1 Post-rename directory tree (top-level)

```text
vimeflow/
├── Cargo.toml                    # NEW — workspace root manifest (3 lines)
├── Cargo.lock                    # MOVED — regenerated at root by cargo on first build
├── target/                       # MOVED — Cargo workspace target dir (.gitignored)
├── src/                          # Renderer (React + TypeScript) — unchanged
├── electron/                     # Electron main process + preload + sidecar.ts — unchanged
├── crates/                       # NEW — Rust workspace member parent
│   └── backend/                  # RENAMED from src-tauri/
│       ├── Cargo.toml            # Crate manifest (content unchanged; new location)
│       ├── .cargo/
│       │   └── config.toml       # TS_RS_EXPORT_DIR adjusted: ../src/bindings/ → ../../src/bindings/
│       ├── README.md             # Rewritten — describes the crate, not "why src-tauri"
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
├── package.json                  # Modified — scripts drop the `cd src-tauri` prefix
├── electron-builder.yml          # Modified — extraResources path
├── .github/workflows/{e2e,ci-checks}.yml  # Modified — workspaces key, working-directory, path filters
└── ...
```

The `src-tauri/` entry disappears entirely.

### 2.2 `./Cargo.toml` (new workspace root manifest)

```toml
[workspace]
resolver = "2"
members = ["crates/backend"]
```

That's the full file. ~3 lines (plus blank line).

**Why `resolver = "2"`:** Required because the member crate's Rust
edition is 2021. Cargo warns when a 2021-edition workspace member
lacks an explicit `resolver = "2"` at the workspace root; setting it
now silences the warning forever.

**Why no `[workspace.package]` shared metadata:** The single-crate
workspace doesn't benefit from shared fields. If a second member
crate lands later (per §1.2), the workspace can add a
`[workspace.package]` block then and the member crate switches to
`version.workspace = true` etc.

### 2.3 `crates/backend/Cargo.toml` (renamed; content unchanged)

The manifest is unmodified. Contents that stay byte-for-byte:

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

### 2.4 `crates/backend/.cargo/config.toml` (one path adjustment)

```toml
[env]
# Before (pre-rename): TS_RS_EXPORT_DIR = { value = "../src/bindings/", relative = true }
# After: one extra `../` to escape both crates/ and backend/.
TS_RS_EXPORT_DIR = { value = "../../src/bindings/", relative = true }
```

The `relative = true` flag means the path is resolved relative to the
`.cargo/config.toml` file. After the move:

```
crates/backend/.cargo/config.toml
                ↑   ↑   ↑
              ../  ../  ../   = repo root
crates/backend/.cargo/../../src/bindings  → crates/backend/src/bindings ✗
crates/backend/.cargo/../../../src/bindings → repo-root/src/bindings ✓
```

Wait — `.cargo/config.toml` is one level inside `crates/backend/`. So
escaping to the repo root needs `../../../` (one for `.cargo/`, one
for `backend/`, one for `crates/`). Let me re-verify in the plan via
empirical check.

Actually `relative = true` resolves relative to the `.cargo/config.toml`
**file's directory** (`.cargo/`), so:

```
.cargo/                                  (cwd of relative resolution)
.cargo/../                               → crates/backend/
.cargo/../../                            → crates/
.cargo/../../../                         → repo root
.cargo/../../../src/bindings/            → repo-root/src/bindings/  ✓
```

So `TS_RS_EXPORT_DIR = "../../../src/bindings/"` (THREE `../`,
not two). The plan empirically verifies this in §3.4.

### 2.5 Cargo.lock placement

Cargo always places the lockfile at the workspace root. With the
workspace root at `./Cargo.toml`, the lockfile lands at `./Cargo.lock`.

Currently `src-tauri/Cargo.lock` is tracked (verified empirically:
`git ls-files src-tauri/Cargo.lock` returns the path). The `git mv`
moves it to `crates/backend/Cargo.lock`, but Cargo will then prefer
the workspace-root location and the **next** build creates
`./Cargo.lock`. The plan handles this in two ways:

- **Option A (simpler):** let the `git mv` carry the existing lockfile
  to `crates/backend/Cargo.lock`. On first build, Cargo creates
  `./Cargo.lock` at the workspace root. The plan immediately
  `git rm crates/backend/Cargo.lock` and `git add Cargo.lock` so the
  tracked lockfile lives at the workspace root afterward.
- **Option B (one-step):** `git mv src-tauri/Cargo.lock Cargo.lock`
  as an explicit move (so reviewers see the rename), then leave the
  rest of the `git mv src-tauri crates/backend` to handle the
  remaining files.

**Decision:** Option B. The single explicit move makes the lockfile
relocation reviewable in the diff. The plan does
`git mv src-tauri/Cargo.lock Cargo.lock` immediately after the
directory move.

### 2.6 Why workspace root files don't all move

`build/icon.png`, `electron-builder.yml`, `package.json`,
`.gitignore`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`,
etc. all stay at the repo root. They reference the renamed paths
internally; they don't live under `crates/`.

`docs/`, `tests/e2e/`, `electron/`, `src/`, `build/` all stay at
the repo root.

The two NEW files at the repo root: `./Cargo.toml` (workspace
manifest) and `./Cargo.lock` (workspace lockfile, regenerated by
Cargo on first build).

### 2.7 How electron/main.ts resolves the binary

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

Post-rename (workspace target at repo root → `./target/`):

```ts
const resolveSidecarBin = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', BINARY_NAME)
  }

  return path.resolve(__dirname, '..', 'target', 'debug', BINARY_NAME)
}
```

The packaged path (`process.resourcesPath/bin/<BINARY>`) is unchanged
— electron-builder's `extraResources` maps `./target/release/vimeflow-backend` (the new workspace target) into
`<resources>/bin/vimeflow-backend`, so the runtime resolution is
identical.

## 3. Migration Steps

### 3.1 Pre-flight

**Rebase or skip:** If PR #212 (docs wrap-up) has merged to `dev`
before this PR's implementation starts, rebase this branch onto the
new `dev` tip first. Otherwise, this PR collides with #212's edits
to `CHANGELOG.md`, `progress.yaml`,
`docs/superpowers/retros/2026-05-16-electron-migration.md`, etc.
Rebase resolution is mechanical (string-substitute `src-tauri` →
`crates/backend` in any conflicting line).

**Baseline:** clean working tree on `feat/rust-crate-to-electron-dir`,
all gates green:

```bash
git status                                  # clean
npm run type-check && npm run lint && npm run test
(cd src-tauri && cargo test)
```

**Clear untracked output:**

```bash
rm -rf src-tauri/target src-tauri/gen
```

This is load-bearing — `git mv` only moves tracked files; untracked
build output left behind in `src-tauri/` after the move would be
orphaned in the working tree.

### 3.2 Step 1 — Move the directory + lockfile

```bash
# Create parent first (git mv does not auto-create destination parent).
mkdir -p crates

# Move the lockfile explicitly to the workspace root so the diff
# shows the relocation. The lockfile is currently tracked despite
# being in .gitignore (committed before the ignore rule was added).
git mv src-tauri/Cargo.lock Cargo.lock

# Move the rest of the directory. All tracked files (including
# .cargo/config.toml, src/, tests/, bindings/, Cargo.toml, README.md)
# are moved in one git operation, which preserves rename detection.
git mv src-tauri crates/backend
```

Verify post-move:

```bash
ls src-tauri 2>&1                                  # "No such file or directory"
ls -la crates/backend/                             # full contents
ls -la Cargo.lock                                  # at repo root
git log --follow crates/backend/Cargo.toml | head -5
# Should show the same commits as the pre-rename `src-tauri/Cargo.toml`.
git log --follow Cargo.lock | head -5
# Should show the same commits as the pre-rename `src-tauri/Cargo.lock`.
```

**Do not commit yet** — at this state Cargo can't resolve the
workspace (no manifest at root) and the lockfile is orphaned. Step 2
completes the move atomically.

### 3.3 Step 2 — Create the workspace root manifest

Write `./Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/backend"]
```

Verify the workspace resolves:

```bash
cargo metadata --no-deps | jq '.workspace_members'
# Should list one member: "vimeflow 0.1.0 (path+file:///.../crates/backend)"

cargo metadata --no-deps | jq -r '.target_directory'
# Should print the absolute path to ./target/ at the repo root.

cargo check
# Should succeed (workspace root manifest at ./Cargo.toml; cargo
# discovers the member at crates/backend/).
```

Build the binary to confirm target dir lands at `./target/`:

```bash
cargo build --bin vimeflow-backend
ls -la target/debug/vimeflow-backend
# Should exist.
```

**Commit 1:**
`refactor(rust): move src-tauri/ → crates/backend/ + add root workspace manifest`
Staged paths: the entire renamed tree + new `./Cargo.toml` +
`./Cargo.lock`.

### 3.4 Step 3 — Update the `.cargo/config.toml` env path

Edit `crates/backend/.cargo/config.toml`:

```toml
[env]
# Before: TS_RS_EXPORT_DIR = { value = "../src/bindings/", relative = true }
TS_RS_EXPORT_DIR = { value = "../../../src/bindings/", relative = true }
```

The three `../` segments escape (in order) `.cargo/` →
`crates/backend/` → `crates/`, landing at the repo root, then
descends into `src/bindings/`. Verify empirically:

```bash
# Run the binding regeneration; should NOT create crates/backend/src/bindings/
# or any other wrong-path output. Should overwrite src/bindings/ at repo root.
cargo test --manifest-path crates/backend/Cargo.toml export_bindings
ls -la src/bindings/        # exists, recently modified
ls crates/backend/src/bindings/ 2>&1   # "No such file or directory"
```

If the path resolution lands in the wrong place, increment or
decrement the `../` count until `src/bindings/` at the repo root is
the resolved target.

**Commit 2:** `refactor(rust): adjust .cargo/config.toml TS_RS_EXPORT_DIR for crates/backend/ depth`
Single-file commit — the `.cargo/config.toml` change is conceptually
distinct from the directory move (the depth changed; the move alone
would leave it broken).

### 3.5 Step 4 — Update path-aware code

In one commit:

**`electron/main.ts`** — `resolveSidecarBin`:

```ts
// Find:
'src-tauri',
'target',

// Replace with:
'target',  // src-tauri/ removed; workspace target is now at repo root
```

(I.e. drop the `'src-tauri',` segment; `'target'` stays adjacent to
`'debug'`.)

**`electron-builder.yml`:**

```yaml
# Find:
extraResources:
  - from: src-tauri/target/release/vimeflow-backend
    to: bin/vimeflow-backend

# Replace with:
extraResources:
  - from: target/release/vimeflow-backend
    to: bin/vimeflow-backend
```

**`package.json` scripts** — drop `cd src-tauri &&` prefixes. Final
shapes (all four affected scripts):

```jsonc
"backend:build": "cargo build --bin vimeflow-backend",
"backend:build:release": "cargo build --release --bin vimeflow-backend",
"generate:bindings": "cargo test --manifest-path crates/backend/Cargo.toml export_bindings && prettier --write src/bindings/",
"test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cargo build --bin vimeflow-backend --features e2e-test",
```

The `--manifest-path crates/backend/Cargo.toml` in `generate:bindings`
keeps the prettier step's CWD at the repo root (no `cd ../..`
arithmetic). The other three scripts inherit the workspace from any
`cd` — but since they don't need a specific manifest, dropping the
`cd` entirely is simpler.

**`.github/workflows/e2e.yml`:**

- Lines 8, 20 (push + PR path filters): `'src-tauri/**'` →
  `'crates/**'`. Also add `'Cargo.toml'` and `'Cargo.lock'` to the
  filter so root-workspace changes trigger E2E.
- Line 57: `Swatinem/rust-cache@v2 with: workspaces: src-tauri` →
  `workspaces: .` (workspace root is the repo root).
- Line 92: diagnostics upload path
  `src-tauri/target/debug/vimeflow-backend` →
  `target/debug/vimeflow-backend`.

**`.github/workflows/ci-checks.yml`:**

- Lines 70 + 106: `Swatinem/rust-cache@v2 with: workspaces: src-tauri` →
  `workspaces: .`.
- Line 83: `working-directory: src-tauri` → `working-directory: .` (or
  drop the line entirely — `.` is the default).

**`.gitignore`:** replace `src-tauri/target/` line with `/target/`.
Workspace-root build dir. Other entries (`build/`, `release/`,
`dist-electron/`, `!build/icon.png`, etc.) don't change. **Also
remove** the `src-tauri/Cargo.lock` line from `.gitignore` if it
exists (drop the stale ignore now that the lockfile lives at
`./Cargo.lock` and is tracked).

**`cspell.config.yaml`** + **`eslint.config.js`** + **`init.sh`** +
**`phase3-terminal-features.json`**: grep each for `src-tauri` and
substitute. The plan-level breakdown enumerates exact lines per
file.

**`tests/e2e/agent/specs/agent-detect-fake.spec.ts`**: if it has a
literal `src-tauri/` path, substitute. (E2E specs are normally
DOM-only — if there's no hit after this swap, the file doesn't need
editing.)

**Verification after this commit:**

```bash
npm run type-check && npm run lint && npm run test
cargo build --bin vimeflow-backend
npm run electron:build
ls -la release/vimeflow-*.AppImage   # produced
```

The electron-builder run exercises the new `extraResources.from`
path AND the dev sidecar path AND the new workspace target dir.

**Commit 3:**
`refactor(electron): point dev sidecar + packaging + scripts + CI at crates/backend/`

### 3.6 Step 5 — Update doc-comments in Rust source

Inside the (newly-renamed) `crates/backend/src/` tree:

- `crates/backend/src/agent/adapter/base/transcript_state.rs`
- `crates/backend/src/agent/adapter/claude_code/test_runners/test_file_patterns.rs`
- `crates/backend/src/filesystem/tests/mod.rs`
- `crates/backend/src/agent/architecture.puml`

For each, grep for `src-tauri/` and substitute `crates/backend/` in
doc-comments. The `.puml` file is a PlantUML source — the
`tauri::Runtime` references (different concern; out of scope) stay;
only the path references update.

**Verification:**

```bash
rg -n "src-tauri" crates/backend/src/
# Expected: zero hits.

cargo test
# Expected: green; doc-comments don't affect tests.
```

**Commit 4:**
`docs(rust): update src-tauri/ path references in crate doc-comments`

### 3.7 Step 6 — Update project docs + crate README

Update path references in:

- `README.md`, `README.zh-CN.md`
- `ARCHITECT.md`
- `CLAUDE.md` (root)
- `docs/CLAUDE.md` + subdir CLAUDE.md indexes
- `docs/roadmap/progress.yaml` — flip the rename follow-up in the
  `electron-migration` phase entry to `done` with this PR's number/sha.
- `docs/roadmap/tauri-migration-roadmap.md` — Current State table.
- `docs/superpowers/retros/2026-05-16-electron-migration.md` — move
  the rename out of the "Deferrals tracked" list into a new
  "Resolved deferrals" subsection (or annotate the existing entry as
  resolved).
- `docs/decisions/2026-05-16-in-repo-skills-setup.md` — any path refs.
- `rules/rust/coding-style.md:29` — `src-tauri/src/` →
  `crates/backend/src/`.
- `CHANGELOG.md` + `CHANGELOG.zh-CN.md` — append a Changed bullet
  under the Electron Migration section: "Renamed Rust crate directory
  `src-tauri/` → `crates/backend/` and introduced a root Cargo
  workspace manifest (`./Cargo.toml`). Closes the PR-D3 deferred
  follow-up."

For `crates/backend/README.md` (formerly `src-tauri/README.md`):
rewrite to a 5-10-line crate-orientation doc. Replace the
"directory-name confusion defuser" framing (obsolete now) with a
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

This crate is the sole member of the workspace at `./Cargo.toml`
(repo root). The directory was renamed from `src-tauri/` in <PR#>
after the May 2026 Electron migration; see
`docs/superpowers/retros/2026-05-16-electron-migration.md`.
```

**Verification:**

```bash
rg -n "src-tauri" --hidden \
  --glob '!docs/**' --glob '!**/*.md' \
  --glob '!target/**' --glob '!node_modules/**' \
  --glob '!**/bindings/**' --glob '!.git/**'
# Expected: zero hits.

# Docs/markdown CAN still mention src-tauri/ — it's historical context
# in spec/plan/retro narratives. The grep above excludes them.
```

**Commit 5:**
`docs: update src-tauri/ path references across project docs`

### 3.8 Step 7 — Final verification gate

```bash
npm run format:check
npm run lint
npm run type-check
npm run test
cargo test
cargo build --release --bin vimeflow-backend
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

### 3.9 Commit cadence summary

- **Commit 1:** `refactor(rust): move src-tauri/ → crates/backend/ + add root workspace manifest`
- **Commit 2:** `refactor(rust): adjust .cargo/config.toml TS_RS_EXPORT_DIR for crates/backend/ depth`
- **Commit 3:** `refactor(electron): point dev sidecar + packaging + scripts + CI at crates/backend/`
- **Commit 4:** `docs(rust): update src-tauri/ path references in crate doc-comments`
- **Commit 5:** `docs: update src-tauri/ path references across project docs`

Squash-merge convention means these collapse to one feature commit
on `dev` at merge time; the in-PR cadence is for reviewer clarity.

## 4. Risks & Rollback

### 4.1 High-Severity Risks

**R1 — `git mv` history-follow regression.**
If `git mv` is run on multiple files individually rather than the
top-level directory, git's rename-detection may miss similarity
threshold for some files and record them as delete+add instead of
rename.

_Mitigation:_ §3.2 runs `git mv src-tauri crates/backend` as a single
command on the whole directory. The earlier `git mv
src-tauri/Cargo.lock Cargo.lock` is on a single file — git records
that as an explicit rename. Verify post-move with `git log --follow`
on at least three sample files (Cargo.toml, src/lib.rs, a tests file).

**R2 — Sequencing collision with PR #212 (docs wrap-up).**
PR #212 edits many of the same doc files this PR also edits
(CHANGELOG, retro, progress.yaml, decisions doc, README, ARCHITECT,
CLAUDE.md). If both PRs are open simultaneously, the second to merge
faces conflicts.

_Mitigation:_ merge #212 first (it's ready and pending review). This
PR rebases onto post-#212 `dev` before opening. Pre-flight check
in §3.1 enforces this.

**R3 — `.cargo/config.toml` env path resolves to the wrong directory.**
The `TS_RS_EXPORT_DIR` env var with `relative = true` is resolved
relative to the `.cargo/config.toml` file's directory (`.cargo/`).
The spec specifies `../../../src/bindings/` (three `../` segments)
to escape `.cargo/ → crates/backend/ → crates/ → repo root`. If the
actual cargo resolution differs (e.g. relative to the crate root
rather than the config file's parent), the bindings land in the
wrong place and downstream consumers in `src/bindings/` go stale.

_Mitigation:_ §3.4 includes an empirical verification step — run
`cargo test export_bindings` and verify `src/bindings/` updates AND
`crates/backend/src/bindings/` does not exist. If the path is wrong,
increment or decrement the `../` count until the test passes. The
plan must execute this before commit 2 lands.

### 4.2 Medium-Severity Risks

**R4 — `.gitignore` patterns inside the (now-moved) `src-tauri/`.**
The current `.gitignore` has `src-tauri/target/`. After the rename,
that rule points at a non-existent path and no longer ignores the
`target/` output directory created by `cargo build` at the workspace
root.

_Mitigation:_ §3.5 step 3 includes the `.gitignore` substitution
(`src-tauri/target/` → `/target/`). Verify post-build with
`git status` — if `target/` files show up as untracked, the
`.gitignore` edit is incomplete; add the missing rule.

**R5 — Tooling that hardcodes `src-tauri/` outside the grep'd set.**
The §1.1 inventory was based on a grep across `src/`, `tests/`,
`electron/`, `package.json`, top-level config files, both CI
workflows, and the `src-tauri/` source itself. Tools that read
paths at runtime from sources NOT in the grep set (e.g. a VS Code
launch.json, a `.vscode/tasks.json`, a `.envrc` direnv config, a
helper script under `scripts/`) would silently break.

_Mitigation:_ after §3.5 step 3 commits, run a comprehensive grep:

```bash
rg -n "src-tauri" --hidden \
  --glob '!docs/**' --glob '!**/*.md' --glob '!target/**' \
  --glob '!node_modules/**' --glob '!**/bindings/**' \
  --glob '!.git/**'
```

Investigate every remaining hit.

**R6 — `gen/` directory and other side-effect outputs.**
The current `src-tauri/gen/` directory holds Tauri-generated
schemas. Post-PR-D3 this is dead code but the directory may still
exist in the working tree (gitignored). `git mv` doesn't move
untracked files; orphaned `src-tauri/gen/` would remain after the
move, and `src-tauri/` would not actually disappear.

_Mitigation:_ §3.1 includes `rm -rf src-tauri/gen src-tauri/target`
before the `git mv`. Verify post-move with `ls src-tauri/ 2>&1` →
should say "No such file or directory."

### 4.3 Low-Severity Risks

**R7 — Cargo target-dir cache invalidation.**
Cargo's incremental compilation cache is keyed off source-file
absolute paths. After the directory move, the first `cargo build`
will be a full rebuild (the old `src-tauri/target/` cache won't
match the new `target/` location). ~30-60s one-time cost.

_Mitigation:_ accept it. Document in the PR that the first CI run
after merge will be slower than steady-state.

**R8 — Doc-comments referencing the old path in code reviews.**
Future code reviews against `crates/backend/src/` will sometimes
quote line numbers / paths from previous PRs (e.g. "see §X of the
PR-D3 spec, which references `src-tauri/src/lib.rs:31`"). Those
historical references become slightly confusing.

_Mitigation:_ none required at PR scope. The historical docs are
preserved verbatim per §1.2. The retrospective's "Resolved
deferrals" subsection (added in §3.7) flags this for future readers.

### 4.4 Rollback

This PR is a single atomic rename. Rollback options:

- **Full revert:** `git revert <merge-sha>` undoes the entire PR.
  Restores `src-tauri/` directory + drops `./Cargo.toml` and
  `./Cargo.lock` at the repo root. The packaged AppImage layout
  (`bin/vimeflow-backend` inside resources) is unchanged either way
  since the binary name didn't move; only the source-tree path moves
  back.
- **Partial revert:** if the workspace manifest causes problems but
  the rename itself is fine, revert just commit 1 (the
  `./Cargo.toml` addition) and turn the workspace into a
  single-crate package by removing the root manifest. Then
  consumers using the workspace must switch to per-crate manifests.
  Not recommended.

### 4.5 What This Spec Does Not Promise

- That historical specs / plans / retros get retroactively rewritten.
  The acceptance grep excludes `docs/**` and `*.md` precisely to
  allow this.
- That the Cargo workspace will be used by adding more member crates
  soon. The workspace is added for shape; splitting the single crate
  is a future-roadmap concern.
- A directory layout that matches any specific other project's. The
  research showed no single dominant convention; `crates/<name>/`
  with a root `Cargo.toml` is the user's pick from the survey of Zed
  - the Cargo workspace norm.
