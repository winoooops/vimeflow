# Vimeflow Tauri Migration Roadmap

> Created: 2026-04-06
> Status: Draft — pending team review
> Contributors: Architect agent, Planner agent, Security reviewer agent

## Overview

This roadmap transforms Vimeflow from a pure React web app (with Vite API plugins simulating a backend) into a full Tauri 2 desktop application with Rust backend, IPC-based service layer, global state management, and AI agent integration.

## Current State

| Component        | Status                                                           |
| ---------------- | ---------------------------------------------------------------- |
| Chat view        | UI shell + mock data, no input processing                        |
| Diff view        | Wired — real git ops via Vite API plugin (`/api/git/*`)          |
| Editor view      | Wired — file tree + content via Vite API plugin (`/api/files/*`) |
| Command Palette  | UI shell + mock commands                                         |
| Tauri backend    | Does not exist (`src-tauri/` missing)                            |
| State management | None — prop drilling + `useState` in `App.tsx`                   |
| CI               | `tauri-build.yml` exists but blocked (no `src-tauri/`)           |

### Key Architecture Points

- **Service factory pattern** already exists for git: `GitService` interface with `MockGitService` / `HttpGitService` + factory `createGitService()` switching on `import.meta.env.MODE`
- **File service** uses bare functions (no interface/factory) — needs refactoring to match git pattern
- **73 test files** with Vitest + Testing Library

---

## Phase 1: Tauri Scaffold + CI Green

**Scope: Medium | Est: 3–5 days**

### Goal

Bootstrap `src-tauri/` so the app runs as a Tauri window while the existing Vite dev workflow continues unchanged. No IPC commands yet — just the shell.

### Steps

1. Run `npx tauri init` to scaffold `src-tauri/` (`tauri.conf.json`, `Cargo.toml`, `src/main.rs`, `src/lib.rs`)
2. Configure `tauri.conf.json`: `devUrl` → `http://localhost:5173`, `frontendDist` → `../dist`
3. Add `"tauri:dev"` and `"tauri:build"` npm scripts (keep existing `dev`/`build` unchanged)
4. Create `src/lib/environment.ts` — `isTauri()` detection via `window.__TAURI_INTERNALS__`
5. Update CI `tauri-build.yml` — add `src/**` trigger, Rust caching
6. Add `.gitignore` entries for `src-tauri/target/`, `src-tauri/gen/`

### Definition of Done

- [ ] `npm run tauri:dev` opens a native window showing the existing React app
- [ ] `npm run dev` still works as standalone Vite dev server (no regression)
- [ ] CI `tauri-build.yml` passes on macOS, Windows, Linux
- [ ] All existing test files still pass

### Risks

- **WSL2**: No native window — need WSLg or Windows-side cargo
- **Tauri 2 config**: Online tutorials mix v1/v2 patterns; use only official v2 docs

---

## Phase 2: IPC Layer + Service Abstraction

**Scope: Large | Est: 5–8 days**

### Goal

Build Rust-side Tauri commands replicating the Vite API plugins, plus TypeScript `TauriGitService` and `TauriFileService` implementations. Service factories switch automatically based on environment.

### Rust Command Structure

```
src-tauri/src/
  commands/
    git.rs       # git_status, git_diff, git_stage, git_unstage, git_discard
    files.rs     # file_tree, file_content
    mod.rs       # re-exports
  lib.rs         # register all command handlers
```

### IPC Mapping

| Vite Route                      | Tauri Command  | Pattern |
| ------------------------------- | -------------- | ------- |
| `GET /api/git/status`           | `git_status`   | invoke  |
| `GET /api/git/diff?file=X`      | `git_diff`     | invoke  |
| `POST /api/git/stage`           | `git_stage`    | invoke  |
| `POST /api/git/discard`         | `git_discard`  | invoke  |
| `GET /api/files/tree`           | `file_tree`    | invoke  |
| `GET /api/files/content?path=X` | `file_content` | invoke  |

### Steps

1. Define shared IPC type contracts (`src/shared/ipc-types.ts`)
2. Implement Rust git commands using `git2` crate
3. Implement Rust file commands using `walkdir` + `tokio::fs`
4. Register commands in `src-tauri/src/lib.rs`
5. Refactor file service to interface/factory pattern (match git service)
6. Create `TauriGitService` using `@tauri-apps/api/core` `invoke()`
7. Create `TauriFileService` using `invoke()`
8. Update factories: test → mock, tauri → IPC, fallback → HTTP

### Dual-Mode Service Layer

```
GitService (interface)
  ├── MockGitService      (tests)
  ├── HttpGitService      (npm run dev — uses Vite plugin)
  └── TauriGitService     (npm run tauri dev — uses invoke)

FileService (interface)
  ├── MockFileService     (tests)
  ├── HttpFileService     (npm run dev — uses Vite plugin)
  └── TauriFileService    (npm run tauri dev — uses invoke)
```

Detection in factory:

```typescript
if (import.meta.env.MODE === 'test') return new MockGitService()
if (window.__TAURI_INTERNALS__) return new TauriGitService()
return new HttpGitService()
```

### Definition of Done

- [ ] Diff + Editor views work identically in browser and Tauri
- [ ] All Rust commands validate inputs (path traversal prevention)
- [ ] Rust commands have unit tests
- [ ] Vite API plugins remain functional (dev fallback)

### Risks

- **`git2` diff parsing**: Differs from `simple-git`/`diff2html` — start with raw diff + frontend parsing
- **Decision point**: Return structured `FileDiff` from Rust (preferred) or raw unified diff (simpler)

---

## Phase 3: Global State Management

**Scope: Medium | Est: 4–6 days**

### Goal

Introduce Zustand to replace prop drilling and enable cross-feature communication.

### Why Zustand

- 1KB gzipped, no providers or context wrappers
- Selective subscriptions (components re-render only on their slice)
- `persist` middleware for settings storage
- Framework-agnostic core (works in tests without React)

### Store Structure

```
src/stores/
  appStore.ts       # activeTab, contextPanelOpen, commandPaletteOpen
  diffStore.ts      # changedFiles, selectedFile, currentDiff
  editorStore.ts    # fileTree, openTabs, activeTab, cursorPosition
  chatStore.ts      # conversations, activeConversation, messages, streamingMessage
```

### Steps

1. Install Zustand, create store architecture doc
2. Create `appStore` — migrate state from `App.tsx`
3. Create `diffStore` — migrate from DiffView local state
4. Create `editorStore` — migrate from EditorView local state
5. Create `chatStore` — prepare shape for Phase 4 (streaming fields)
6. Refactor views to use stores (one view at a time)
7. Update tests for store-based components

### Definition of Done

- [ ] Zero prop drilling from `App.tsx` to views
- [ ] Cross-feature navigation works (e.g., "open in diff" from editor)
- [ ] All existing tests pass

### Risks

- Large refactor touches every view — migrate one at a time, separate PRs

---

## Phase 4: Chat Backend + AI Integration

**Scope: Large | Est: 8–12 days**

### Goal

Wire Chat to a real AI backend with streaming responses, conversation persistence, and secure API key storage.

### Architecture

- **Streaming**: Tauri events (`app.emit` / `listen`), not invoke responses
- **Persistence**: SQLite via `rusqlite` in `app_data_dir()`
- **First provider**: Anthropic API via `reqwest` + SSE
- **Credentials**: OS keychain via `keyring` crate — **never in frontend**

### Steps

1. Design AI backend architecture (`docs/architecture/ai-backend.md`)
2. Implement Rust chat commands: `create_conversation`, `send_message`, `get_conversations`
3. Implement conversation persistence (SQLite: `conversations` + `messages` tables)
4. Create `ChatService` interface + `TauriChatService` + `MockChatService`
5. Build streaming message UI component
6. Implement Anthropic provider (`reqwest` + SSE → Tauri events)
7. Add settings system (API keys via keychain, model selection, provider choice)

### Definition of Done

- [ ] User sends message → streaming AI response → persists across restarts
- [ ] API keys stored in OS keychain (not plaintext)
- [ ] Mock mode works for development without API keys
- [ ] Error states handled (network failure, rate limit, invalid key)

### Risks

- Streaming over Tauri events may have ordering issues — add sequence numbers
- Scope creep — one provider end-to-end first, multi-provider is Phase 6

---

## Phase 5: Desktop Polish (parallel with Phase 6)

**Scope: Medium | Est: 4–6 days**

- Window state persistence (`tauri-plugin-window-state`)
- Native menu bar (platform-specific conventions)
- System tray with show/hide and quit
- Global keyboard shortcuts (`tauri-plugin-global-shortcut`)
- Auto-updater (`tauri-plugin-updater` + GitHub releases)
- Platform-specific title bar (macOS traffic lights, Windows controls)
- Bundle fonts (Manrope, Inter, JetBrains Mono) — no CDN dependency

---

## Phase 6: Advanced Features (parallel with Phase 5)

**Scope: Large | Est: 8–12 days**

- Multi-provider support (OpenAI)
- Agent process management (spawn/monitor Claude Code, Codex CLI)
- Conversation branching/forking
- Workspace/project model (associate conversations with directories)
- Export/import conversations

---

## Dependency Graph

```
Phase 1: Tauri Scaffold
    │
    ▼
Phase 2: IPC Layer + Services ─────────┐
    │                                   │
    ▼                                   │
Phase 3: State Management              │
    │                                   │
    ▼                                   ▼
Phase 4: Chat + AI  ◄── (Phase 2 IPC patterns proven)
    │
    ├───────┬────────┐
    ▼       ▼        ▼
Phase 5  Phase 6   (parallel)
```

---

## Key Architectural Decisions

| Decision        | Recommendation                                        | Rationale                                                       |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| IPC design      | Per-feature command modules                           | Type-safe, avoids unbounded match arms                          |
| State mgmt      | Zustand in Phase 3                                    | Too early = premature abstraction; too late = messy migration   |
| Dev coexistence | `window.__TAURI_INTERNALS__` in factory               | `npm run dev` (web) and `npm run tauri:dev` (desktop) both work |
| Type contracts  | Rust structs + `specta`/`ts-rs`                       | Eliminates drift between Rust and TypeScript types              |
| Fonts           | Bundled, not CDN                                      | Desktop app must not depend on network for rendering            |
| Diff parsing    | Raw diff from Rust, `diff2html` on frontend (Phase 2) | Simpler Rust, reuses existing frontend logic; optimize later    |

---

## Security Findings

> Full report: security review conducted 2026-04-06

### Pre-Migration (fix before starting Phase 1)

| Severity | Issue                                                    | Action                                                    |
| -------- | -------------------------------------------------------- | --------------------------------------------------------- |
| MEDIUM   | If local `.env` uses plain HTTP for `ANTHROPIC_BASE_URL` | Rotate keys, switch to `https://` (verify in your `.env`) |
| HIGH     | `baseBranch` param unvalidated in `vite.config.ts:62`    | Add `[a-zA-Z0-9/_.\-]+` allowlist, reject leading `-`     |
| HIGH     | `hunkIndex` not type-checked in `vite.config.ts:219,301` | Rust `usize` in serde struct eliminates this structurally |

### Migration Architecture

| Concern            | Approach                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------ |
| API key storage    | OS keychain via `keyring` crate — never localStorage, never plaintext files                |
| IPC security       | Typed Rust structs (serde) — no unbounded body reads                                       |
| Path traversal     | `std::fs::canonicalize` + root boundary check in Rust                                      |
| CSP                | `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (Shiki needs it); no `unsafe-eval` |
| Error messages     | Map to typed app errors in Rust — don't leak filesystem paths                              |
| Tauri capabilities | Minimum permissions: scoped `fs:allow-read-file`, no blanket `$HOME` access                |

---

## Timeline Summary

| Phase             | Scope  | Est. Days | Key Deliverable                    |
| ----------------- | ------ | --------- | ---------------------------------- |
| 1. Tauri Scaffold | Medium | 3–5       | Native window + CI green           |
| 2. IPC Layer      | Large  | 5–8       | Git + file ops via Tauri IPC       |
| 3. State Mgmt     | Medium | 4–6       | Zustand stores, zero prop drilling |
| 4. Chat + AI      | Large  | 8–12      | Streaming AI conversations         |
| 5. Desktop Polish | Medium | 4–6       | Tray, menus, auto-update           |
| 6. Advanced       | Large  | 8–12      | Multi-provider, agent mgmt         |

**Total: ~32–49 days** (critical path ~25–35 days with parallel work)
