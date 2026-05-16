# `src-tauri/` → `crates/backend/` Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Rust sidecar source directory from `src-tauri/` to `crates/backend/` and introduce a Cargo workspace manifest at the **repo root** (`./Cargo.toml`). The Rust binary name (`vimeflow-backend`), library name (`vimeflow_lib`), and Cargo package name (`vimeflow`) all stay unchanged — only the directory path moves and the workspace shape gains a root manifest. Closes the final deferred follow-up from the May 2026 Electron migration.

**Architecture:** Mechanical refactor — `git mv` preserves history; a single 3-line root `Cargo.toml` registers `crates/backend` as the workspace's sole member. Cargo's target dir lands at `./target/` (workspace root). Every path-aware consumer (npm scripts, `electron-builder.yml`, `electron/main.ts`, both CI workflows, `.gitignore`, the crate's `.cargo/config.toml`, lint configs, internal doc-comments, project docs) is updated to match.

**Tech Stack:** Rust 1.77.2 (Cargo workspace, `resolver = "2"`). No new runtime dependencies. The post-PR-D3 crate's `[dependencies]` set is unchanged.

**Spec:** `docs/superpowers/specs/2026-05-16-src-tauri-to-crates-backend-design.md`

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md` — the May 2026 Electron migration. This rename closes the final deferred follow-up (PR-D3 spec §4.5; `electron-migration` phase in `docs/roadmap/progress.yaml`).

**Sequencing:** This branch was created from `dev` at `c5433da` (PR-D3's squash-merge), _before_ PR #212 (docs wrap-up) lands. Pre-flight in Task 0 instructs a rebase onto post-#212 `dev` before any other work.

---

## File Structure

### New (2 files)

- `./Cargo.toml` — workspace root manifest (3 lines). Registers `crates/backend` as the sole member with `resolver = "2"`.
- `./Cargo.lock` — moved via `git mv src-tauri/Cargo.lock Cargo.lock` so the diff shows the relocation. Cargo regenerates the file in place on the first build.

### Renamed (1 directory move via `git mv`)

- `src-tauri/` → `crates/backend/` — single `git mv` on the directory; preserves git history for every tracked file inside.

### Modified

- `crates/backend/Cargo.toml` — content unchanged; new location.
- `crates/backend/.cargo/config.toml` — `TS_RS_EXPORT_DIR` path depth updated. Exact `../` count verified empirically in Task 2.
- `crates/backend/src/agent/adapter/base/transcript_state.rs` — doc-comment at line 75 references the old `src-tauri/tests/...` path.
- `crates/backend/src/agent/adapter/claude_code/test_runners/test_file_patterns.rs` — comments at lines 98 + 101 reference `src-tauri/tests/fixtures/`.
- `crates/backend/src/filesystem/tests/mod.rs` — doc-comment at line 11 references `src-tauri/src/filesystem/SECURITY.md`.
- `crates/backend/src/agent/architecture.puml` — PlantUML diagram source.
- `crates/backend/README.md` — rewritten from "directory-name confusion defuser" to "crate orientation" framing.
- `electron/main.ts:39-52` — `resolveSidecarBin` dev path drops `'src-tauri',` segment.
- `electron-builder.yml` — `extraResources.from` path.
- `package.json` — four scripts.
- `.github/workflows/e2e.yml` — push + PR path filters (lines 8, 20), rust-cache `workspaces` (line 57), diagnostics upload path (line 92).
- `.github/workflows/ci-checks.yml` — two rust-cache `workspaces` (lines 70 + 106), one `working-directory` (line 83).
- `.gitignore` — `src-tauri/target/` → `/target/`. Also drop the stale `src-tauri/Cargo.lock` entry if it exists.
- `cspell.config.yaml:109` — `src-tauri/target` → `crates/backend/target` (or `target` if root-relative).
- `eslint.config.js:28-29` — `src-tauri/target` + `src-tauri/bindings/` → `crates/backend/target` + `crates/backend/bindings/`.
- `init.sh:66` — `if [ -d "src-tauri" ]` → `if [ -d "crates/backend" ]`.
- `phase3-terminal-features.json:124-125` — historical task descriptions reference `src-tauri/Cargo.toml` + `src-tauri/src/terminal/mod.rs`. Update to `crates/backend/...`.
- `src/features/agent-status/types/index.ts:151` — doc-comment pointer.
- `tests/e2e/agent/specs/agent-detect-fake.spec.ts:12` — comment about the detector path.
- `README.md`, `README.zh-CN.md` — project-structure tree + `src-tauri/` mentions.
- `ARCHITECT.md` — `src-tauri/` mentions.
- `CLAUDE.md` (root) — index references.
- `docs/CLAUDE.md` and subdir CLAUDE.md indexes — references to `src-tauri/` paths.
- `docs/roadmap/progress.yaml` — `electron-migration` phase entry's deferred-follow-up note.
- `docs/roadmap/tauri-migration-roadmap.md` — Current State table.
- `docs/superpowers/retros/2026-05-16-electron-migration.md` — Deferrals section.
- `docs/decisions/2026-05-16-in-repo-skills-setup.md` — any path refs.
- `rules/rust/coding-style.md:29` — `src-tauri/src/` → `crates/backend/src/`.
- `CHANGELOG.md` + `CHANGELOG.zh-CN.md` — Changed bullet under Electron Migration section.

### Files NOT touched

- Renderer (`src/**`) — unchanged. The `src/bindings/` regen verifies the renamed `.cargo/config.toml` env in Task 2.
- Electron main process TypeScript (`electron/**`) other than `main.ts:39-52`.
- E2E spec files (`tests/e2e/{core,terminal,agent}/specs/*.ts`) except for the one comment in `agent-detect-fake.spec.ts`.
- `electron-builder.yml`'s structure (only the one `extraResources.from` line changes).
- The crate's internal Rust logic — only doc-comments are touched.
- Historical spec/plan docs from PR-A → PR-D3 + their reviews — preserved verbatim per spec §1.2.
- `ci-checks.yml`'s GTK/webkit2gtk apt deps — flagged as a separate pre-existing cleanup opportunity (the sidecar no longer link-pulls webkit2gtk-rs post-PR-D3); out of scope.

---

## Task 0: Baseline Verification

**Files:** none.

- [ ] **Step 1: Confirm branch + working tree.**

```bash
cd /home/will/projects/vimeflow
git status
git branch --show-current
```

Expected: `nothing to commit, working tree clean`. Branch: `feat/rust-crate-to-electron-dir` or `feat/rename-src-tauri-to-crates-backend` (rename the branch via `git branch -m` before opening the PR; the destination dir name should be in the branch name).

- [ ] **Step 2: Rebase onto post-#212 `dev` if #212 has merged.**

```bash
gh pr view 212 --json state -q .state
```

If output is `MERGED`:

```bash
git fetch origin dev
git rebase origin/dev
# Resolve conflicts mechanically: substitute `src-tauri` → `crates/backend`
# in any conflicting line, then `git rebase --continue`.
```

If output is `OPEN` or `CLOSED` (not merged): proceed; the rebase happens at PR-creation time or after #212 lands first.

- [ ] **Step 3: Confirm static gates green on the current state.**

```bash
npm run type-check
npm run lint
npm run format:check
npm run test
```

Expected: type-check + lint + test all green. `format:check` warnings stay restricted to the pre-existing `src-tauri/bindings/` set.

Record the Vitest test count for the post-rename comparison. The rename touches no production code, so the count must match exactly.

- [ ] **Step 4: Confirm Rust gates green.**

```bash
(cd src-tauri && cargo test)
(cd src-tauri && cargo build --bin vimeflow-backend)
```

Expected: green. Record the cargo test count.

- [ ] **Step 5: Clear untracked output that `git mv` would orphan.**

```bash
rm -rf src-tauri/target src-tauri/gen
ls src-tauri/
```

Expected: only tracked content remains (`Cargo.toml`, `Cargo.lock`, `README.md`, `src/`, `tests/`, `bindings/`, `.cargo/`).

- [ ] **Step 6: Inventory `src-tauri/` references for the post-rename grep gate.**

```bash
rg -nl "src-tauri" --hidden \
  --glob '!docs/**' --glob '!**/*.md' --glob '!target/**' \
  --glob '!node_modules/**' --glob '!**/bindings/**' \
  --glob '!.git/**' > /tmp/srctauri-pre.txt
wc -l /tmp/srctauri-pre.txt
cat /tmp/srctauri-pre.txt
```

Expected output: ~13 files listed. Compare against the spec §1.1 inventory; this baseline is checked again at Task 8 Step 5 (should be zero hits post-rename).

---

## Task 1: Move directory + lockfile + add root workspace manifest

**Files:**

- Create: `./Cargo.toml`
- Rename via `git mv`: `src-tauri/Cargo.lock` → `Cargo.lock`
- Rename via `git mv`: `src-tauri/` → `crates/backend/`

Atomic refactor — these three steps land in a single commit because the intermediate states don't compile (Cargo would error: workspace manifest references a member that doesn't exist yet, or vice-versa).

- [ ] **Step 1: Create the `crates/` parent.**

```bash
mkdir -p crates
```

Expected: `crates/` directory exists, empty. `git mv` does NOT auto-create the destination parent — this is load-bearing.

- [ ] **Step 2: Move the lockfile to the workspace root.**

```bash
git mv src-tauri/Cargo.lock Cargo.lock
git status -s Cargo.lock src-tauri/Cargo.lock
```

Expected: `R  src-tauri/Cargo.lock -> Cargo.lock`. If git shows it as `D` + `??` (delete + untracked-add) instead of `R` (rename), the rename was not detected — investigate `git config diff.renames` and `git config diff.renameLimit`.

- [ ] **Step 3: Move the rest of the directory.**

```bash
git mv src-tauri crates/backend
git status -s | head -10
```

Expected: many `R  src-tauri/... -> crates/backend/...` entries. No `D` + `??` pairs (those indicate rename detection missed the file).

- [ ] **Step 4: Verify the old directory is gone and the new tree is populated.**

```bash
ls src-tauri 2>&1               # Expected: "No such file or directory"
ls crates/backend/Cargo.toml    # Expected: file exists
ls crates/backend/src/          # Expected: directory listing with lib.rs, bin/, runtime/, terminal/, etc.
ls -la Cargo.lock               # Expected: at repo root, tracked
```

- [ ] **Step 5: Verify history-following works.**

```bash
git log --follow crates/backend/Cargo.toml | head -3
git log --follow crates/backend/src/lib.rs | head -3
git log --follow Cargo.lock | head -3
git log --follow crates/backend/src/agent/commands.rs | head -3
```

Expected: each command shows commits from before the rename. If any file shows only one commit (the rename itself), history-following is broken — investigate and consider an explicit per-file `git mv`.

- [ ] **Step 6: Write the workspace root manifest.**

Create `./Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/backend"]
```

That's the full file. 4 lines including the blank line after the section header.

- [ ] **Step 7: Verify the workspace resolves.**

```bash
cargo metadata --no-deps | jq '.workspace_members'
```

Expected: a JSON array with one element matching `"vimeflow 0.1.0 (path+file:///.../vimeflow/crates/backend)"`. If `jq` is not installed, `cargo metadata --no-deps --format-version 1 | grep -o '"workspace_members":\[[^]]*\]'` is an alternative.

```bash
cargo metadata --no-deps | jq -r '.target_directory'
```

Expected: the absolute path to `<repo-root>/target` (NOT `<repo-root>/crates/target` and NOT `<repo-root>/crates/backend/target`). This is the empirical proof that the workspace target lands at the repo root — required for Task 3's `electron-builder.yml` and `electron/main.ts` updates to be correct.

- [ ] **Step 8: Build the binary to confirm the target dir lands where expected.**

```bash
cargo build --bin vimeflow-backend
ls -la target/debug/vimeflow-backend
```

Expected: clean build (30-60s cold cache). Binary exists at `./target/debug/vimeflow-backend`.

If the binary lands at `crates/target/...` or `crates/backend/target/...` instead, the workspace shape is producing an unexpected target dir — STOP and re-read the spec's §2.7 / §4.1 R2 discussion. Do not proceed to Task 3 until the binary is at `./target/`.

- [ ] **Step 9: Commit.**

```bash
git add Cargo.toml Cargo.lock crates/
git commit -m "$(cat <<'EOF'
refactor(rust): move src-tauri/ -> crates/backend/ + add root workspace

Rename the Rust sidecar source directory and introduce a Cargo
workspace manifest at the repo root with crates/backend as its sole
member. Closes the final deferred follow-up from the May 2026
Electron migration (PR-D3 spec §4.5).

- `git mv src-tauri crates/backend` preserves history for every
  tracked file.
- `git mv src-tauri/Cargo.lock Cargo.lock` relocates the lockfile to
  the workspace root so cargo can manage it natively.
- New ./Cargo.toml: 3-line workspace manifest, `resolver = "2"`,
  `members = ["crates/backend"]`.
- Crate manifest (crates/backend/Cargo.toml) unchanged: package name
  stays "vimeflow", lib name stays "vimeflow_lib", bin name stays
  "vimeflow-backend".

Cargo target now lands at ./target/ (workspace root). Tasks 2-7
adjust the .cargo/config.toml env path, electron/main.ts, packaging
config, npm scripts, CI workflows, doc-comments, and docs to match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Adjust `crates/backend/.cargo/config.toml` `TS_RS_EXPORT_DIR`

**Files:**

- Modify: `crates/backend/.cargo/config.toml`

The `TS_RS_EXPORT_DIR` env var uses `relative = true`, which resolves the path relative to the `.cargo/config.toml` **file's directory**. After the move from `src-tauri/.cargo/config.toml` (depth 1: `.cargo/`) to `crates/backend/.cargo/config.toml` (depth 3: `crates/`, `backend/`, `.cargo/`), the path needs more `../` segments to escape to the repo root.

The spec hedged about the exact count. This task verifies empirically.

- [ ] **Step 1: Read the current file.**

```bash
cat crates/backend/.cargo/config.toml
```

Expected: 1 `[env]` section with `TS_RS_EXPORT_DIR = { value = "../src/bindings/", relative = true }`.

- [ ] **Step 2: Try the spec's first guess (one extra `../` for the workspace nesting).**

Use the `Edit` tool on `crates/backend/.cargo/config.toml`. Find:

```toml
TS_RS_EXPORT_DIR = { value = "../src/bindings/", relative = true }
```

Replace with:

```toml
TS_RS_EXPORT_DIR = { value = "../../src/bindings/", relative = true }
```

- [ ] **Step 3: Run the bindings export and observe where files land.**

```bash
cargo test --manifest-path crates/backend/Cargo.toml export_bindings
echo "---src/bindings/ at repo root:---"
ls -la src/bindings/ | head -5
echo "---crates/backend/src/bindings/ (should NOT exist):---"
ls -la crates/backend/src/bindings/ 2>&1
echo "---repo-root level bindings/ (should NOT exist):---"
ls -la bindings/ 2>&1
```

Expected outcome IF `../../` is correct:

- `src/bindings/` at the repo root contains recently-modified files.
- `crates/backend/src/bindings/` does NOT exist.
- No `bindings/` at the repo root.

If `../../` lands the files in `crates/backend/src/bindings/` (wrong), increment to `../../../`:

```toml
TS_RS_EXPORT_DIR = { value = "../../../src/bindings/", relative = true }
```

Re-run Step 3 and verify `src/bindings/` updates. If THAT lands them in the wrong place too, walk up one more (`../../../../`).

The empirical resolution depth depends on whether cargo treats `.cargo/config.toml`'s `relative = true` as "relative to the file" (i.e., from `.cargo/`) or "relative to the crate root" (from `crates/backend/`). The spec's §2.4 noted three `../` segments would be needed in the file-relative case; in the crate-root case, two would work. The empirical run is authoritative.

- [ ] **Step 4: Verify `npm run generate:bindings` (which Task 4 will update to use `--manifest-path`) also produces the right output.**

The Task 4 update isn't in place yet, so this step uses an inline command matching what Task 4 will set:

```bash
cargo test --manifest-path crates/backend/Cargo.toml export_bindings && prettier --write src/bindings/
ls -la src/bindings/ | head -10
```

Expected: `src/bindings/` at repo root is updated AND prettier-formatted.

- [ ] **Step 5: Commit.**

```bash
git add crates/backend/.cargo/config.toml
git commit -m "$(cat <<'EOF'
refactor(rust): adjust .cargo/config.toml TS_RS_EXPORT_DIR for crates/backend/ depth

The .cargo/config.toml's TS_RS_EXPORT_DIR env var uses
`relative = true`, which resolves relative to the config.toml's
directory. After moving from src-tauri/.cargo/ to
crates/backend/.cargo/, the path needs additional ../ segments to
escape to the repo root.

Empirically verified by running `cargo test export_bindings` and
confirming src/bindings/ at the repo root gets the regenerated
files (not crates/backend/src/bindings/ or any other intermediate
path).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update `electron/main.ts` + `electron-builder.yml`

**Files:**

- Modify: `electron/main.ts:39-52` (the `resolveSidecarBin` function)
- Modify: `electron-builder.yml`

- [ ] **Step 1: Edit `electron/main.ts`'s `resolveSidecarBin`.**

Read the current function:

```bash
sed -n '39,52p' electron/main.ts
```

Use the `Edit` tool on `electron/main.ts`. Find:

```ts
return path.resolve(
  __dirname,
  '..',
  'src-tauri',
  'target',
  'debug',
  BINARY_NAME
)
```

Replace with:

```ts
return path.resolve(__dirname, '..', 'target', 'debug', BINARY_NAME)
```

(The `'src-tauri',` segment is removed; the entire `path.resolve` call collapses to one line because it's now only 5 arguments.)

- [ ] **Step 2: Edit `electron-builder.yml`.**

Use the `Edit` tool. Find:

```yaml
extraResources:
  - from: src-tauri/target/release/vimeflow-backend
    to: bin/vimeflow-backend
```

Replace with:

```yaml
extraResources:
  - from: target/release/vimeflow-backend
    to: bin/vimeflow-backend
```

- [ ] **Step 3: Run the renderer + Electron type-check + lint.**

```bash
npm run type-check
npm run lint
```

Expected: clean.

- [ ] **Step 4: Build the renderer + Electron bundles (without electron-builder) to verify main.ts compiles correctly.**

```bash
cross-env VITE_E2E=1 vite build --mode electron
ls dist-electron/main.js
```

Expected: build succeeds; `dist-electron/main.js` is produced.

- [ ] **Step 5: Run the release Cargo build + electron-builder to verify the packaging path.**

```bash
cargo build --release --bin vimeflow-backend
ls -la target/release/vimeflow-backend         # exists at workspace root
npm run electron:build
ls -la release/vimeflow-*.AppImage              # AppImage produced
```

Expected: AppImage exists at `release/vimeflow-0.1.0-x64.AppImage`. If electron-builder fails with "missing extraResource source", the path in `electron-builder.yml` does not match where cargo placed the binary — verify `cargo metadata --no-deps | jq -r '.target_directory'` and compare against the `from:` path.

- [ ] **Step 6: Extract the AppImage to verify the bundled sidecar binary.**

```bash
mkdir -p /tmp/rename-verify
cd /tmp/rename-verify
rm -rf squashfs-root
/home/will/projects/vimeflow/release/vimeflow-*.AppImage --appimage-extract > /dev/null
find squashfs-root -path "*/resources/bin/vimeflow-backend" -executable -ls
cd /home/will/projects/vimeflow
rm -rf /tmp/rename-verify
```

Expected: one match at `squashfs-root/resources/bin/vimeflow-backend`. If empty, electron-builder didn't bundle the binary — recheck `extraResources.from` in `electron-builder.yml`.

- [ ] **Step 7: Commit.**

```bash
git add electron/main.ts electron-builder.yml
git commit -m "$(cat <<'EOF'
refactor(electron): point dev sidecar + packaging at workspace root target/

electron/main.ts: resolveSidecarBin drops the 'src-tauri' path
segment; the workspace root build target is now at ./target/.

electron-builder.yml: extraResources.from updates from
src-tauri/target/release/vimeflow-backend to
target/release/vimeflow-backend. Confirmed by running
`npm run electron:build` and verifying the produced AppImage
contains resources/bin/vimeflow-backend via --appimage-extract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `package.json` scripts

**Files:**

- Modify: `package.json`

Four scripts need updating. All drop the `cd src-tauri &&` prefix; one (`generate:bindings`) switches to `--manifest-path` to keep the prettier step at the repo root.

- [ ] **Step 1: Read the current scripts block.**

```bash
grep -nE "\"backend:build|\"generate:bindings|\"test:e2e:build" package.json
```

Expected: 4 lines around lines 13-32 (varies by post-#212-rebase state).

- [ ] **Step 2: Update `backend:build`.**

Use the `Edit` tool. Find:

```json
    "backend:build": "cd src-tauri && cargo build --bin vimeflow-backend",
```

Replace with:

```json
    "backend:build": "cargo build --bin vimeflow-backend",
```

- [ ] **Step 3: Update `backend:build:release`.**

Find:

```json
    "backend:build:release": "cd src-tauri && cargo build --release --bin vimeflow-backend",
```

Replace with:

```json
    "backend:build:release": "cargo build --release --bin vimeflow-backend",
```

- [ ] **Step 4: Update `generate:bindings`.**

Find:

```json
    "generate:bindings": "cd src-tauri && cargo test export_bindings && cd .. && prettier --write src/bindings/",
```

Replace with:

```json
    "generate:bindings": "cargo test --manifest-path crates/backend/Cargo.toml export_bindings && prettier --write src/bindings/",
```

The `--manifest-path` flag tells cargo which manifest to use without changing the CWD, so `prettier --write src/bindings/` runs from the repo root and resolves correctly.

- [ ] **Step 5: Update `test:e2e:build`.**

Find:

```json
    "test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test",
```

Replace with:

```json
    "test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cargo build --bin vimeflow-backend --features e2e-test",
```

(Just drop the `cd src-tauri && ` substring.)

- [ ] **Step 6: Verify package.json parses.**

```bash
node -e "console.log(Object.keys(require('./package.json').scripts).filter(k => k.includes('backend') || k === 'generate:bindings' || k === 'test:e2e:build'))"
```

Expected: prints the four script names without error.

- [ ] **Step 7: Run each updated script.**

```bash
npm run backend:build
ls -la target/debug/vimeflow-backend

npm run backend:build:release
ls -la target/release/vimeflow-backend

npm run generate:bindings
git diff --stat src/bindings/ | tail -3   # should show "no changes" or only the prettier formatting

npm run test:e2e:build
ls -la dist-electron/main.js
ls -la target/debug/vimeflow-backend
```

Expected: each command succeeds; binaries and bindings land at the expected paths.

- [ ] **Step 8: Commit.**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
refactor(scripts): drop `cd src-tauri` prefix; cargo runs from workspace root

After the workspace manifest moved to ./Cargo.toml at the repo root,
cargo invocations from the repo root resolve the crates/backend
member automatically. Four scripts simplified:

- backend:build: drop `cd src-tauri && `
- backend:build:release: drop `cd src-tauri && `
- generate:bindings: switch from `cd src-tauri && cargo test ... && cd .. && prettier ...`
  to `cargo test --manifest-path crates/backend/Cargo.toml ... && prettier ...`
  so the prettier step's CWD stays at the repo root (no cd
  arithmetic).
- test:e2e:build: drop `cd src-tauri && `

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update CI workflows + `.gitignore` + lint/spell configs + helper script + JSON

**Files:**

- Modify: `.github/workflows/e2e.yml`
- Modify: `.github/workflows/ci-checks.yml`
- Modify: `.gitignore`
- Modify: `cspell.config.yaml:109`
- Modify: `eslint.config.js:28-29`
- Modify: `init.sh:66`
- Modify: `phase3-terminal-features.json:124-125`
- Modify: `tests/e2e/agent/specs/agent-detect-fake.spec.ts:12`

- [ ] **Step 1: Update `.github/workflows/e2e.yml` push + PR path filters.**

Use the `Edit` tool. Find (in BOTH the `on.push.paths` AND `on.pull_request.paths` blocks — there are two):

```yaml
- 'src-tauri/**'
```

Replace each with:

```yaml
- 'crates/**'
- 'Cargo.toml'
- 'Cargo.lock'
```

Two entries become three each, so each `paths:` block gains two lines net.

- [ ] **Step 2: Update e2e.yml rust-cache `workspaces` key.**

Find:

```yaml
- name: Cache Rust dependencies
  uses: Swatinem/rust-cache@v2
  with:
    workspaces: src-tauri
```

Replace with:

```yaml
- name: Cache Rust dependencies
  uses: Swatinem/rust-cache@v2
  with:
    workspaces: .
```

- [ ] **Step 3: Update e2e.yml diagnostics upload path.**

Find:

```yaml
path: |
  src-tauri/target/debug/vimeflow-backend
  dist/
```

Replace with:

```yaml
path: |
  target/debug/vimeflow-backend
  dist/
```

- [ ] **Step 4: Update `ci-checks.yml` — both rust-cache entries.**

Use `Edit` with `replace_all: true` on `.github/workflows/ci-checks.yml`. Find:

```yaml
workspaces: src-tauri
```

Replace with:

```yaml
workspaces: .
```

(Replaces both occurrences — lines 70 and 106 of the pre-edit file.)

- [ ] **Step 5: Update ci-checks.yml `working-directory`.**

Find:

```yaml
- name: Run Rust tests
  working-directory: src-tauri
  run: cargo test
```

Replace with:

```yaml
- name: Run Rust tests
  run: cargo test
```

(The default `working-directory` is the repo root, which is the workspace root post-rename. The line is dropped entirely.)

- [ ] **Step 6: Verify e2e.yml + ci-checks.yml parse.**

```bash
npx js-yaml .github/workflows/e2e.yml > /dev/null && echo "e2e.yml YAML valid"
npx js-yaml .github/workflows/ci-checks.yml > /dev/null && echo "ci-checks.yml YAML valid"
```

Expected: both print "YAML valid". If `js-yaml` is not available, use `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e.yml'))" && echo OK`.

- [ ] **Step 7: Update `.gitignore`.**

Find:

```
src-tauri/target/
```

Replace with:

```
/target/
```

Also check if `.gitignore` has a stale `src-tauri/Cargo.lock` line:

```bash
grep -n "src-tauri/Cargo.lock" .gitignore
```

If present, delete that line (the lockfile is now at `./Cargo.lock` and tracked).

- [ ] **Step 8: Update `cspell.config.yaml:109`.**

Find:

```yaml
- src-tauri/target
```

Replace with:

```yaml
- target
```

(The cspell ignore pattern is repo-root-relative; the workspace target dir is now at the repo root.)

- [ ] **Step 9: Update `eslint.config.js:28-29`.**

Find:

```js
      'src-tauri/target',
      'src-tauri/bindings/',
```

Replace with:

```js
      'target',
      'crates/backend/bindings/',
```

(The `target/` ignore matches the workspace-root build dir; the `bindings/` ignore points at the moved crate location.)

- [ ] **Step 10: Update `init.sh:66`.**

Find:

```bash
if [ -d "src-tauri" ]; then
```

Replace with:

```bash
if [ -d "crates/backend" ]; then
```

If the surrounding body of the `if` references additional `src-tauri/` paths (likely it does — it probably runs cargo build), grep for them and update:

```bash
grep -nA10 'if \[ -d "crates/backend" \]' init.sh
```

Substitute any `cd src-tauri` → `cd crates/backend` or remove the `cd` entirely (cargo from repo root works post-rename).

- [ ] **Step 11: Update `phase3-terminal-features.json:124-125`.**

These are historical task descriptions in a feature-tracking JSON. The references to old paths are documentation, but they should reflect current reality for any tooling that reads this file.

Find:

```json
      "Add portable-pty dependency to src-tauri/Cargo.toml",
      "Create src-tauri/src/terminal/mod.rs module",
```

Replace with:

```json
      "Add portable-pty dependency to crates/backend/Cargo.toml",
      "Create crates/backend/src/terminal/mod.rs module",
```

- [ ] **Step 12: Update `tests/e2e/agent/specs/agent-detect-fake.spec.ts:12`.**

Find:

```ts
// Host has any claude processes? The current detector (src-tauri/src/agent/
```

Replace with:

```ts
// Host has any claude processes? The current detector (crates/backend/src/agent/
```

- [ ] **Step 13: Update `src/features/agent-status/types/index.ts:151`.**

Find:

```ts
   * AgentToolCallEvent — see `src-tauri/src/agent/test_runners/test_file_patterns.rs`.
```

Replace with:

```ts
   * AgentToolCallEvent — see `crates/backend/src/agent/test_runners/test_file_patterns.rs`.
```

- [ ] **Step 14: Verify lint + type-check + tests still pass.**

```bash
npm run lint
npm run type-check
npm run test
```

Expected: all green.

- [ ] **Step 15: Commit.**

```bash
git add .github/workflows/e2e.yml .github/workflows/ci-checks.yml \
  .gitignore cspell.config.yaml eslint.config.js init.sh \
  phase3-terminal-features.json \
  tests/e2e/agent/specs/agent-detect-fake.spec.ts \
  src/features/agent-status/types/index.ts
git commit -m "$(cat <<'EOF'
refactor(ci+config): update src-tauri/ paths to crates/backend/ across CI + lint + helpers

CI workflows (e2e.yml + ci-checks.yml):
- rust-cache workspaces key: src-tauri → . (workspace root is repo root)
- e2e.yml path filters: 'src-tauri/**' → 'crates/**' + 'Cargo.toml' + 'Cargo.lock'
- e2e.yml diagnostics upload: src-tauri/target/debug → target/debug
- ci-checks.yml working-directory: src-tauri → (default repo root)

.gitignore: src-tauri/target/ → /target/. Drop the stale
src-tauri/Cargo.lock entry (lockfile is now tracked at workspace
root).

Lint + spell configs:
- cspell.config.yaml line 109: src-tauri/target → target
- eslint.config.js lines 28-29: src-tauri/{target,bindings/} →
  target + crates/backend/bindings/

Helper scripts + metadata:
- init.sh line 66: `if [ -d "src-tauri" ]` → crates/backend
- phase3-terminal-features.json lines 124-125: historical task
  descriptions updated.

Doc-comment path pointers:
- tests/e2e/agent/specs/agent-detect-fake.spec.ts line 12
- src/features/agent-status/types/index.ts line 151

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Rust source doc-comments

**Files:**

- Modify: `crates/backend/src/agent/adapter/base/transcript_state.rs:75`
- Modify: `crates/backend/src/agent/adapter/claude_code/test_runners/test_file_patterns.rs:98+101`
- Modify: `crates/backend/src/filesystem/tests/mod.rs:11`
- Modify: `crates/backend/src/agent/architecture.puml`

Doc-comments only — no logic changes. The grep at Task 0 Step 6 listed these 4 files as the ones with internal `src-tauri/` references.

- [ ] **Step 1: Update `transcript_state.rs:75`.**

Use the `Edit` tool. Find:

```rust
/// `src-tauri/tests/transcript_*.rs`; do not construct ad hoc instances
```

Replace with:

```rust
/// `crates/backend/tests/transcript_*.rs`; do not construct ad hoc instances
```

- [ ] **Step 2: Update `test_file_patterns.rs:98+101`.**

Find:

```rust
        // PR's own fixtures live under src-tauri/tests/fixtures/*.jsonl
```

Replace with:

```rust
        // PR's own fixtures live under crates/backend/tests/fixtures/*.jsonl
```

Then find:

```rust
            "src-tauri/tests/fixtures/transcript_vitest_pass.jsonl"
```

Replace with:

```rust
            "crates/backend/tests/fixtures/transcript_vitest_pass.jsonl"
```

Note: this second hit is a STRING LITERAL (not a comment). If it's used as a path to actually open a file at runtime, the substitution is load-bearing. Verify with `cargo test` after the edit.

- [ ] **Step 3: Update `filesystem/tests/mod.rs:11`.**

Find:

```rust
//! test, update the map in `src-tauri/src/filesystem/SECURITY.md`
```

Replace with:

```rust
//! test, update the map in `crates/backend/src/filesystem/SECURITY.md`
```

- [ ] **Step 4: Update `crates/backend/src/agent/architecture.puml`.**

```bash
grep -n "src-tauri" crates/backend/src/agent/architecture.puml
```

Substitute each hit `src-tauri/` → `crates/backend/`. The `tauri::Runtime` text in this diagram is a separate concern (deferred per PR-D3 retro) — leave that text alone; only update path-shaped strings.

- [ ] **Step 5: Verify all `src-tauri/` hits inside `crates/backend/src/` are gone.**

```bash
rg -n "src-tauri" crates/backend/src/
```

Expected: zero hits.

- [ ] **Step 6: Run cargo test to verify no test broke (the test_file_patterns string literal could have been load-bearing).**

```bash
cargo test
```

Expected: green; test count matches the Task 0 baseline.

- [ ] **Step 7: Commit.**

```bash
git add crates/backend/src/
git commit -m "$(cat <<'EOF'
docs(rust): update src-tauri/ path references in crate doc-comments

Three files have doc-comments referencing the old src-tauri/ path;
one (test_file_patterns.rs:101) also has a string literal that may
be load-bearing for test path resolution:

- crates/backend/src/agent/adapter/base/transcript_state.rs:75
- crates/backend/src/agent/adapter/claude_code/test_runners/test_file_patterns.rs:98+101
- crates/backend/src/filesystem/tests/mod.rs:11
- crates/backend/src/agent/architecture.puml (path-shaped strings only;
  the `tauri::Runtime` text is preserved as a separate deferred concern)

Cargo test count matches baseline after the substitution; doc-comments
don't affect the test pass set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update project docs + crate README

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `ARCHITECT.md`
- Modify: `CLAUDE.md` (root)
- Modify: `docs/CLAUDE.md` and subdirectory CLAUDE.md indexes
- Modify: `docs/roadmap/progress.yaml`
- Modify: `docs/roadmap/tauri-migration-roadmap.md`
- Modify: `docs/superpowers/retros/2026-05-16-electron-migration.md`
- Modify: `docs/decisions/2026-05-16-in-repo-skills-setup.md`
- Modify: `rules/rust/coding-style.md:29`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.zh-CN.md`
- Rewrite: `crates/backend/README.md`

- [ ] **Step 1: Enumerate doc files with `src-tauri/` references.**

```bash
rg -nl "src-tauri" docs/ rules/ README.md README.zh-CN.md ARCHITECT.md CLAUDE.md CHANGELOG.md CHANGELOG.zh-CN.md 2>&1
```

Expected: the files listed under "Files" above, plus possibly a few docs/superpowers/specs/ and docs/superpowers/plans/ files (which are HISTORICAL and out-of-scope per spec §1.2).

- [ ] **Step 2: Update `README.md` project-structure tree.**

The current tree (post-PR-D3-wrap-up) shows:

```
src-tauri/                  # Rust sidecar crate (post-PR-D3; dir rename to backend/ is a deferred follow-up)
├── src/
│   ├── bin/
│   │   └── vimeflow-backend.rs  # Sidecar binary entry — stdin/stdout LSP-framed JSON IPC
│   ├── lib.rs              # Module declarations only (post-PR-D3 collapse)
│   ├── runtime/            # BackendState, IPC router, EventSink trait
│   ├── terminal/           # PTY commands (_inner helpers + BackendState methods)
│   ├── filesystem/         # List/read/write commands with scope validation
│   ├── git/                # Git status, diff, stage/unstage
│   └── agent/              # Agent detector, statusline watcher, transcript parser
├── Cargo.toml              # Rust dependencies (Tauri deps removed in PR-D3)
└── README.md               # Crate-level orientation
```

Replace with:

```
Cargo.toml                  # Workspace root manifest (members = ["crates/backend"])
Cargo.lock
target/                     # Cargo workspace build dir (gitignored)
crates/                     # Rust workspace members
└── backend/                # Renamed from src-tauri/ in <date>
    ├── src/
    │   ├── bin/
    │   │   └── vimeflow-backend.rs  # Sidecar binary entry — stdin/stdout LSP-framed JSON IPC
    │   ├── lib.rs                   # Module declarations only (post-PR-D3 collapse)
    │   ├── runtime/                 # BackendState, IPC router, EventSink trait
    │   ├── terminal/                # PTY commands (_inner helpers + BackendState methods)
    │   ├── filesystem/              # List/read/write commands with scope validation
    │   ├── git/                     # Git status, diff, stage/unstage
    │   └── agent/                   # Agent detector, statusline watcher, transcript parser
    ├── Cargo.toml                   # Crate manifest (Tauri deps removed in PR-D3)
    └── README.md                    # Crate-level orientation
```

The PR-D3 wrap-up's "deferred follow-up" note line goes away.

- [ ] **Step 3: Update `README.zh-CN.md` project-structure tree.**

Mirror Step 2's edit in Chinese. The tree itself is the same content; only the descriptive text after each entry is translated.

- [ ] **Step 4: Update `ARCHITECT.md`.**

```bash
grep -n "src-tauri" ARCHITECT.md
```

Substitute each `src-tauri/` → `crates/backend/` where the reference is a CURRENT path (not historical context).

- [ ] **Step 5: Update `CLAUDE.md` (root) index.**

```bash
grep -n "src-tauri" CLAUDE.md
```

Substitute current-path references.

- [ ] **Step 6: Update `docs/CLAUDE.md` + subdir indexes.**

```bash
rg -nl "src-tauri" docs/CLAUDE.md docs/*/CLAUDE.md
```

For each file, substitute current-path references. Subdirectory CLAUDE.md files may reference the old path in their indexes — update those.

- [ ] **Step 7: Update `docs/roadmap/progress.yaml`.**

Open the `electron-migration` phase entry. Find the deferred follow-up note that mentions `src-tauri/ → backend/` and mark it `done`. Add a commit pointer (will be backfilled at PR-merge time).

```yaml
# Before (somewhere in the electron-migration phase notes):
#   src-tauri/ -> backend/ directory rename (deferred per migration roadmap)
# After:
#   src-tauri/ -> crates/backend/ directory rename: done (PR <#>, commit <sha>)
```

The exact path through progress.yaml's `electron-migration` phase entry depends on whether PR #212's edits to that file have landed (Task 0 step 2 rebase). The substantive change is: the rename follow-up note moves from "deferred" to "done".

- [ ] **Step 8: Update `docs/roadmap/tauri-migration-roadmap.md`.**

The Current State table (post-PR-D3-wrap-up) has a row like:

```
| Rust backend crate  | **Done** — `src-tauri/` (directory rename to `backend/` is a deferred follow-up); ...
```

Replace with:

```
| Rust backend crate  | **Done** — `crates/backend/` (renamed from `src-tauri/` in <date>); ...
```

- [ ] **Step 9: Update `docs/superpowers/retros/2026-05-16-electron-migration.md`.**

The retro has a "Deferrals tracked" section listing the `src-tauri/` → `backend/` rename. Move it to a new "Resolved deferrals" subsection (or annotate the existing entry as resolved):

```markdown
## Resolved deferrals

- **`src-tauri/` → `crates/backend/` directory rename.** Closed by
  <PR #> on 2026-05-16. The Tauri-era directory name is gone; the
  crate now lives at `crates/backend/` with a Cargo workspace
  manifest at the repo root.
```

Remove the matching entry from "Deferrals tracked".

- [ ] **Step 10: Update `docs/decisions/2026-05-16-in-repo-skills-setup.md`.**

```bash
grep -n "src-tauri" docs/decisions/2026-05-16-in-repo-skills-setup.md
```

Substitute current-path references.

- [ ] **Step 11: Update `rules/rust/coding-style.md:29`.**

Find:

```markdown
- Feature-based directory structure under `src-tauri/src/`
```

Replace with:

```markdown
- Feature-based directory structure under `crates/backend/src/`
```

- [ ] **Step 12: Append a Changed bullet to `CHANGELOG.md`.**

Under the "Electron Migration" section (added by PR #212's wrap-up), in the `#### Changed` subsection, append:

```markdown
- Renamed Rust crate directory `src-tauri/` → `crates/backend/` and introduced a root Cargo workspace manifest (`./Cargo.toml`). Closes the PR-D3 deferred follow-up flagged in the retrospective; the post-rename grep across `src/`, `tests/`, `electron/`, `package.json`, CI workflows, and config files returns zero hits for `src-tauri`.
  ([#<PR>](https://github.com/winoooops/vimeflow/pull/<PR>), `<short-sha>`)
```

- [ ] **Step 13: Mirror the entry in `CHANGELOG.zh-CN.md`.**

Append a parallel Chinese-language Changed bullet to the same Electron Migration section.

- [ ] **Step 14: Rewrite `crates/backend/README.md`.**

Open the current file (it was added in PR-D3 specifically to defuse the `src-tauri/` confusion that this PR resolves). Replace its entire contents with:

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
(repo root). The directory was renamed from `src-tauri/` in <PR #>
after the May 2026 Electron migration; see
[`docs/superpowers/retros/2026-05-16-electron-migration.md`](../../docs/superpowers/retros/2026-05-16-electron-migration.md).
```

- [ ] **Step 15: Run the post-rename grep gate to verify zero non-doc hits.**

```bash
rg -n "src-tauri" --hidden \
  --glob '!docs/**' --glob '!**/*.md' \
  --glob '!target/**' --glob '!node_modules/**' \
  --glob '!**/bindings/**' --glob '!.git/**'
```

Expected: **zero hits**. If any hit remains, investigate the file (likely a configuration that wasn't grep'd in Task 0).

- [ ] **Step 16: Commit.**

```bash
git add README.md README.zh-CN.md ARCHITECT.md CLAUDE.md \
  docs/CLAUDE.md docs/roadmap/progress.yaml \
  docs/roadmap/tauri-migration-roadmap.md \
  docs/superpowers/retros/2026-05-16-electron-migration.md \
  docs/decisions/2026-05-16-in-repo-skills-setup.md \
  rules/rust/coding-style.md \
  CHANGELOG.md CHANGELOG.zh-CN.md \
  crates/backend/README.md
git commit -m "$(cat <<'EOF'
docs: update src-tauri/ path references across project docs + rewrite crate README

Closes the PR-D3 deferred follow-up: the directory has been renamed
from src-tauri/ to crates/backend/ in this PR's prior commits; this
commit propagates the path change through all project-level docs.

Modified:
- README.md + README.zh-CN.md: project-structure tree
- ARCHITECT.md: src-tauri/ mentions
- CLAUDE.md (root): index references
- docs/CLAUDE.md and subdir CLAUDE.md indexes
- docs/roadmap/progress.yaml: electron-migration phase entry — rename
  follow-up flipped from "deferred" to "done"
- docs/roadmap/tauri-migration-roadmap.md: Current State table
- docs/superpowers/retros/2026-05-16-electron-migration.md: moved
  the rename out of "Deferrals tracked" into a new "Resolved
  deferrals" subsection
- docs/decisions/2026-05-16-in-repo-skills-setup.md: path refs
- rules/rust/coding-style.md:29: src-tauri/src/ → crates/backend/src/
- CHANGELOG.md + CHANGELOG.zh-CN.md: appended a Changed bullet under
  the Electron Migration section

Rewritten:
- crates/backend/README.md: replaces the PR-D3-era "directory-name
  confusion defuser" framing with a 5-10-line "what's here" crate-
  orientation doc. The PR-D3 README's existence was a workaround for
  the misleading src-tauri/ name; that workaround is now obsolete.

Acceptance grep (excluding docs/, *.md, target/, node_modules/,
bindings/, .git/) returns zero hits for src-tauri.

Historical spec/plan/retro docs under docs/superpowers/{specs,plans}/
intentionally preserved verbatim (spec §1.2 out-of-scope).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Static gates.**

```bash
npm run format:check
npm run lint
npm run type-check
```

Expected: clean. `format:check` warnings stay restricted to the pre-existing `crates/backend/bindings/` set (formerly `src-tauri/bindings/`).

- [ ] **Step 2: Vitest.**

```bash
npm run test
```

Expected: total test count matches the Task 0 baseline exactly. (No source-logic changes; only paths moved.)

- [ ] **Step 3: Cargo test from repo root.**

```bash
cargo test
```

Expected: green; test count matches Task 0 baseline.

- [ ] **Step 4: Cargo test from inside the renamed crate (confirms cargo walks upward to find the workspace).**

```bash
(cd crates/backend && cargo test)
```

Expected: green; same test count.

- [ ] **Step 5: Acceptance grep — zero non-doc `src-tauri` hits.**

```bash
rg -n "src-tauri" --hidden \
  --glob '!docs/**' --glob '!**/*.md' \
  --glob '!target/**' --glob '!node_modules/**' \
  --glob '!**/bindings/**' --glob '!.git/**'
```

Expected: **zero hits**.

If any hit appears, investigate. The most likely categories: (a) a file we didn't grep at Task 0 (VS Code `.vscode/launch.json`?), (b) a `.envrc` direnv config, (c) a shell helper under `scripts/` we missed.

- [ ] **Step 6: Confirm cargo's target directory lands at repo root.**

```bash
cargo metadata --no-deps | jq -r '.target_directory'
```

Expected: absolute path to `<repo-root>/target`. NOT `crates/target` or `crates/backend/target`.

- [ ] **Step 7: Build + bundle the AppImage.**

```bash
npm run test:e2e:build
npm run electron:build
ls -la release/vimeflow-*.AppImage
```

Expected: green; AppImage produced at `release/vimeflow-0.1.0-x64.AppImage`.

- [ ] **Step 8: Verify the AppImage bundles the sidecar binary.**

```bash
mkdir -p /tmp/final-verify
cd /tmp/final-verify
rm -rf squashfs-root
/home/will/projects/vimeflow/release/vimeflow-*.AppImage --appimage-extract > /dev/null
find squashfs-root -path "*/resources/bin/vimeflow-backend" -executable -ls
cd /home/will/projects/vimeflow
rm -rf /tmp/final-verify
```

Expected: one match at `squashfs-root/resources/bin/vimeflow-backend`.

- [ ] **Step 9: Manual smoke (`npm run electron:dev`).**

```bash
timeout 20 npm run electron:dev > /tmp/electron-dev.log 2>&1 || true
grep -E "Local:|VITE.*ready|sidecar" /tmp/electron-dev.log | head -10
```

Expected: Vite dev server starts on 5173 and Electron's sidecar log line appears (matches the post-PR-D2 baseline). Verifies that the renamed `target/debug/vimeflow-backend` is spawnable from the new path in `electron/main.ts`.

- [ ] **Step 10: Commit-log review.**

```bash
git log --oneline $(git merge-base HEAD origin/dev)..HEAD
```

Expected: ~5 commits (Task 1 + 2 + 3 + 4 + 5 + 6 + 7 = 7 commits if each task commits separately, or fewer if some tasks chain). Each commit's subject uses a conventional-commits prefix: `refactor(...)` or `docs(...)`. No `Apply suggestion` / `WIP` / `fixup` commits.

- [ ] **Step 11: E2E suites (optional — run if local environment supports xvfb-run).**

```bash
npm run test:e2e
npm run test:e2e:terminal
npm run test:e2e:agent
```

Expected: each suite reports `passing` on every spec. CI will exercise these post-merge regardless.

No commit for this task — verification only. If everything passes, the PR is ready for review.

---

## PR Description Checklist

When opening the PR, the description must:

- [ ] State: "Closes the final deferred follow-up from the May 2026 Electron migration: renames `src-tauri/` → `crates/backend/` and introduces a root Cargo workspace manifest at `./Cargo.toml`."
- [ ] Link the spec: `docs/superpowers/specs/2026-05-16-src-tauri-to-crates-backend-design.md`.
- [ ] Link the plan: `docs/superpowers/plans/2026-05-16-src-tauri-to-crates-backend.md`.
- [ ] Link the migration retro that flagged this as deferred: `docs/superpowers/retros/2026-05-16-electron-migration.md`.
- [ ] List the new files (`./Cargo.toml`, `./Cargo.lock` is moved-not-new).
- [ ] List the renames (`src-tauri/` → `crates/backend/`, `src-tauri/Cargo.lock` → `Cargo.lock`).
- [ ] State explicitly: "Binary name `vimeflow-backend`, library name `vimeflow_lib`, and Cargo package name `vimeflow` all unchanged — only the directory path moves and the workspace shape gains a root manifest."
- [ ] Call out the §4.1 R3 empirical verification (TS_RS_EXPORT_DIR depth) and the final `../` count chosen.
- [ ] Note the deferred follow-up that's NOT closed by this PR: dropping the GTK/webkit2gtk apt deps from `ci-checks.yml` (the sidecar no longer link-pulls webkit2gtk-rs but the apt deps remain — out of scope here).
- [ ] Include the acceptance grep output:
  ```bash
  rg -n "src-tauri" --hidden \
    --glob '!docs/**' --glob '!**/*.md' --glob '!target/**' \
    --glob '!node_modules/**' --glob '!**/bindings/**' --glob '!.git/**'
  # (empty — zero hits)
  ```
- [ ] List the test plan results from Task 8.

---

## Risk Notes (cross-reference)

See spec §4 for the full risk breakdown. Plan-time TL;DR:

- **R1 — `git mv` history-follow regression.** Mitigated by running `git mv` once on the whole directory (Task 1 step 3) + the lockfile once on its own (Task 1 step 2). Verified by `git log --follow` (Task 1 step 5).
- **R2 — Sequencing collision with PR #212.** Mitigated by Task 0 step 2 rebase check.
- **R3 — `.cargo/config.toml` env path depth.** Mitigated by Task 2's empirical `cargo test export_bindings` verification before commit.
- **R4 — `.gitignore` patterns leaking output.** Mitigated by Task 5 step 7 + post-build `git status` check.
- **R5 — Tooling outside the grep'd set.** Mitigated by Task 8 step 5's comprehensive grep across hidden files.
- **R6 — Orphaned `src-tauri/gen/` / `src-tauri/target/`.** Mitigated by Task 0 step 5's `rm -rf` before the move.
- **R7 — Cargo target-dir cache invalidation.** Accepted; one-time ~30-60s cost on first build.
- **R8 — Doc-comments referencing the old path in historical reviews.** Accepted; historical specs preserved verbatim per spec §1.2.

---

## Self-Review Notes

Run-through against the spec's §1.1 In-Scope list:

| Spec area                                            | Plan task                      |
| ---------------------------------------------------- | ------------------------------ |
| `mkdir -p crates && git mv src-tauri crates/backend` | Task 1 steps 1-5               |
| `git mv src-tauri/Cargo.lock Cargo.lock`             | Task 1 step 2                  |
| New `./Cargo.toml` workspace manifest                | Task 1 step 6                  |
| `crates/backend/.cargo/config.toml` env path         | Task 2                         |
| `package.json` scripts (4 affected)                  | Task 4                         |
| `electron-builder.yml` `extraResources.from`         | Task 3 step 2                  |
| `electron/main.ts:39-52` `resolveSidecarBin`         | Task 3 step 1                  |
| `e2e.yml` path filters + rust-cache + diagnostics    | Task 5 steps 1-3               |
| `ci-checks.yml` rust-cache + working-directory       | Task 5 steps 4-5               |
| `.gitignore`                                         | Task 5 step 7                  |
| `cspell.config.yaml`                                 | Task 5 step 8                  |
| `eslint.config.js`                                   | Task 5 step 9                  |
| `init.sh`                                            | Task 5 step 10                 |
| `phase3-terminal-features.json`                      | Task 5 step 11                 |
| `tests/e2e/agent/specs/agent-detect-fake.spec.ts`    | Task 5 step 12                 |
| `src/features/agent-status/types/index.ts`           | Task 5 step 13                 |
| Rust source doc-comments (4 files)                   | Task 6                         |
| `crates/backend/architecture.puml`                   | Task 6 step 4                  |
| README + README.zh-CN                                | Task 7 steps 2-3               |
| ARCHITECT.md                                         | Task 7 step 4                  |
| CLAUDE.md (root) + docs/CLAUDE.md                    | Task 7 steps 5-6               |
| progress.yaml                                        | Task 7 step 7                  |
| tauri-migration-roadmap.md                           | Task 7 step 8                  |
| Retro                                                | Task 7 step 9                  |
| Decisions ADR                                        | Task 7 step 10                 |
| `rules/rust/coding-style.md:29`                      | Task 7 step 11                 |
| CHANGELOG + CHANGELOG.zh-CN                          | Task 7 steps 12-13             |
| `crates/backend/README.md` rewrite                   | Task 7 step 14                 |
| Acceptance grep zero-hits                            | Task 7 step 15 + Task 8 step 5 |

Every spec §1.1 item maps to a task. The acceptance gate in spec §1.3 is satisfied by Task 8's 11 steps.
