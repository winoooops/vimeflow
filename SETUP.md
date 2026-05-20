# Vimeflow Setup Guide

This guide covers the current local setup for the Electron desktop app,
`vimeflow-backend` Rust sidecar, frontend tooling, git hooks, and CI parity
checks.

## Prerequisites

- **Node.js >=22** - `package.json` permits Node 22+, while CI and `.nvmrc`
  use Node 24. Prefer `nvm use` before installing dependencies.
- **Rust stable** - required for `crates/backend/`, sidecar builds, Cargo
  tests, and binding generation.
- **Git** - required for hooks, Vite dev git APIs, and PR workflow.
- **Linux system packages** - `xvfb` is required for headless Electron E2E
  runs in CI. Electron ships Chromium, so the old Tauri WebKitGTK packages are
  no longer part of the normal setup.

## Install

```bash
nvm use
npm ci
npm run prepare
```

`npm run prepare` installs Husky hooks from `.husky/`.

## Verify Local Setup

Run the same core gates that `ci-checks.yml` runs:

```bash
npm run lint
npm run format:check
npm run type-check
npm test
cargo test --manifest-path crates/backend/Cargo.toml
```

When Rust types exported to `src/bindings/` change, also run:

```bash
npm run generate:bindings
```

For desktop build parity:

```bash
npm run build
npm run electron:build
```

For E2E parity, run the WebdriverIO Electron suites:

```bash
npm run test:e2e:build
npm run test:e2e:all
```

## Development Commands

```bash
npm run dev          # Vite dev server at localhost:5173
npm run electron:dev # Electron shell + Rust sidecar
npm run lint         # ESLint
npm run format       # Prettier write
npm run type-check   # tsc -b
npm test             # Vitest
```

On Linux dev hosts without a working Chromium sandbox, use:

```bash
VIMEFLOW_NO_SANDBOX=1 npm run electron:dev
```

## What Is Configured

### Project Tooling

- `package.json` - npm scripts, ESM mode, dependencies
- `.nvmrc` - Node 24 for CI parity
- `.npmrc` - `engine-strict=true`
- `.prettierrc` / `.prettierignore` - formatting rules
- `eslint.config.js` - flat ESLint config with TypeScript, React, Vitest,
  Testing Library, import, promise, regex, and CSpell rules
- `cspell.config.yaml` - project dictionary
- `commitlint.config.mjs` - conventional commit enforcement

### Git Hooks

- `.husky/pre-commit` - lint-staged checks on staged files
- `.husky/commit-msg` - commitlint
- `.husky/pre-push` - Vitest run

### GitHub Actions

- `.github/workflows/ci-checks.yml` - lint, format check, type check, Vitest,
  Rust tests, and generated binding verification
- `.github/workflows/e2e.yml` - Linux WebdriverIO + Electron smoke suites
  for app-affecting changes
- `.github/workflows/claude-review.yml` - Claude Code PR review
- `.github/workflows/codex-review.yml.disabled` - historical Codex workflow,
  disabled because of quota pressure

## Troubleshooting

### Husky hooks are not running

```bash
npm run prepare
git config core.hooksPath .husky
```

### Vite port conflicts

Electron dev mode expects Vite's default port (`http://localhost:5173`). If
Vite falls back to another port because 5173 is occupied, stop the conflicting
process before running `npm run electron:dev`.

### Linux AppImage will not launch

On dev hosts without a SUID Chromium sandbox, launch with `--no-sandbox` or
set `VIMEFLOW_NO_SANDBOX=1` during development. On hosts without `libfuse2`,
use AppImage's `--appimage-extract-and-run --no-sandbox` fallback.

### Generated bindings are out of date

Run:

```bash
npm run generate:bindings
git diff -- src/bindings
```

Commit the resulting `src/bindings/*.ts` changes with the Rust type changes
that caused them.
