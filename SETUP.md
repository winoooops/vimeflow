# Vimeflow Setup Guide

This guide covers the current local setup for the Tauri desktop app, frontend
tooling, git hooks, and CI parity checks.

## Prerequisites

- **Node.js >=22** - `package.json` permits Node 22+, while CI and `.nvmrc`
  use Node 24. Prefer `nvm use` before installing dependencies.
- **Rust stable** - required for `src-tauri/`, `cargo test`, Tauri dev, and
  binding generation.
- **Git** - required for hooks, Vite dev git APIs, and PR workflow.
- **Linux system packages** - required for Tauri build/test on Linux:
  `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`,
  `librsvg2-dev`, and `patchelf`.

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
cd src-tauri && cargo test
```

When Rust types exported to `src/bindings/` change, also run:

```bash
npm run generate:bindings
```

For desktop build parity:

```bash
npm run build
npm run tauri:build
```

For E2E parity, install `tauri-driver` and run the WebdriverIO suites:

```bash
cargo install tauri-driver
npm run test:e2e:build
npm run test:e2e:all
```

## Development Commands

```bash
npm run dev          # Vite dev server at localhost:5173
npm run tauri:dev    # Tauri shell + Rust backend
npm run lint         # ESLint
npm run format       # Prettier write
npm run type-check   # tsc -b
npm test             # Vitest
```

`npm run tauri:dev` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` for Linux/Wayland
WebKitGTK stability.

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
- `.github/workflows/tauri-build.yml` - macOS, Windows, and Ubuntu Tauri builds
  for app-affecting changes
- `.github/workflows/e2e.yml` - Linux WebdriverIO + tauri-driver smoke suites
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

### Vite and Tauri use different ports

The Tauri config points at `http://localhost:5173`, matching Vite's default
port. If Vite falls back to another port because 5173 is occupied, stop the
conflicting process before running `npm run tauri:dev`.

### Linux Tauri build fails with missing WebKitGTK packages

Install the Linux packages listed under prerequisites. The GitHub Actions
workflows are the authoritative package list for CI.

### Generated bindings are out of date

Run:

```bash
npm run generate:bindings
git diff -- src/bindings
```

Commit the resulting `src/bindings/*.ts` changes with the Rust type changes
that caused them.
