# Development

## Commands

```bash
npm run lint          # ESLint (flat config, type-checked)
npm run lint:fix      # ESLint with auto-fix
npm run format:check  # Prettier check
npm run format        # Prettier write
npm run type-check    # tsc -b
npm run test          # Vitest
npm run test:coverage # Vitest coverage
npm run dev           # Vite dev server, no Rust sidecar required
npm run electron:dev  # Electron shell + vimeflow-backend sidecar
npm run electron:build # Linux AppImage packaging
npm run test:e2e:all  # WebdriverIO + @wdio/electron-service E2E suites
cargo test --manifest-path crates/backend/Cargo.toml
```

## Runtime Env Flags

Set on `npm run electron:dev` (all opt-in; unset = default behavior).

| Env var                                 | Effect                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VIMEFLOW_USER_DATA_DIR=<dir>`          | Redirect Electron's userData to `<dir>` for a **clean dev env**. Dev otherwise shares the prod `~/Library/Application Support/vibm` dir — same sessions, settings, and agent state as the installed app. Only userData is redirected; `HOME` is left alone (faking it breaks Claude auth). |
| `VIMEFLOW_NO_SANDBOX=1`                 | Disable the Chromium renderer sandbox — Linux dev hosts without a working SUID sandbox.                                                                                                                                                                                                    |
| `VIMEFLOW_REMOTE_DEBUGGING_PORT=<port>` | Expose a renderer DevTools endpoint at `http://127.0.0.1:<port>/json/list` (unpackaged only).                                                                                                                                                                                              |

### Ghostty native runtime (macOS)

The native Ghostty terminal path is opt-in in dev. Use the wrapper script or set the flags yourself:

```bash
npm run electron:dev:ghostty   # = VITE_GHOSTTY_NATIVE_MACOS_PARENT=1 VITE_NATIVE_OVERLAY=1 on port 5174
```

| Env var                              | Effect                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `VITE_GHOSTTY_NATIVE_MACOS_PARENT=1` | Enable the native Ghostty parent-window surface (the macOS backbone; always on when packaged).  |
| `VITE_NATIVE_OVERLAY=1`              | Enable native overlay layering used with the parent surface.                                    |
| `VITE_GHOSTTY_NATIVE_MACOS=1`        | Deprecated alias for `VITE_GHOSTTY_NATIVE_MACOS_PARENT=1`; the separate helper path is retired. |
| `GHOSTTY_RESIZE_THROTTLE_MS=<ms>`    | Override the resize throttle for the native parent surface.                                     |

Run dev alongside the installed prod app with the native terminal and a clean profile:

```bash
VIMEFLOW_USER_DATA_DIR=/tmp/vimeflow-dev npm run electron:dev:ghostty
```

## Tech Stack

- **Desktop**: Electron shell + Rust `vimeflow-backend` sidecar
- **Frontend**: React + TypeScript (arrow-function components only)
- **Testing**: Vitest + Testing Library (unit/integration), WebdriverIO + `@wdio/electron-service` (E2E), Cargo tests (Rust backend)
- **Linting**: ESLint flat config (`eslint.config.js`), Prettier, CSpell
- **Git hooks**: Husky — pre-commit (lint-staged), commit-msg (commitlint), pre-push (vitest)
- **CI**: GitHub Actions — `ci-checks.yml`, `e2e.yml`, `claude-review.yml`
- **Node**: `package.json` permits >=22; use Node 24 from `.nvmrc` for CI parity. ESM-only (`"type": "module"`)

## Code Style (Enforced)

- **No semicolons**, single quotes, trailing commas (es5) — `.prettierrc`
- **Explicit return types** on all public functions
- **Arrow-function components** only
- **No `console.log`**
- **Conventional commits** — `feat|fix|refactor|docs|test|chore|perf|ci: description`
