# VIBM — App Specification

## Overview

Set up CI/CD infrastructure for the VIBM project: local git hooks (Husky + lint-staged + commitlint), Prettier formatting, GitHub Actions workflows for CI checks and Tauri cross-platform builds, and supporting configuration files. This is a tooling-only setup — no application code is being written.

## Tech Stack

- **Framework**: Tauri 2 (planned, not yet scaffolded)
- **Frontend**: React 19 + TypeScript (arrow-function components)
- **Backend**: Rust (Tauri commands, managed state)
- **Testing**: Vitest + Testing Library (frontend), cargo test (backend)
- **Linting**: ESLint flat config (already exists at `eslint.config.js`), cargo clippy
- **Formatting**: Prettier (frontend), cargo fmt (backend)
- **Spell check**: CSpell (already exists at `cspell.config.yaml`)
- **Git hooks**: Husky 9 + lint-staged + commitlint
- **CI/CD**: GitHub Actions
- **Node.js**: 24 (Active LTS)

## Core Features

### Phase 1: Project Initialization

- Initialize `package.json` with `npm init -y`, set `"type": "module"`, `"engines": { "node": ">=24" }`
- Create `.nvmrc` with content `24`
- Create `.npmrc` with content `engine-strict=true`
- Initialize git repository (`git init`) if not already initialized

### Phase 2: Install DevDependencies

Install all dev dependencies needed for linting, formatting, hooks, and testing:

```bash
npm install -D \
  husky@^9 \
  lint-staged@^15 \
  @commitlint/cli@^19 \
  @commitlint/config-conventional@^19 \
  prettier@^3 \
  typescript@^5 \
  vitest@^3 \
  eslint@^9 \
  typescript-eslint@^8 \
  eslint-plugin-react@^7 \
  eslint-plugin-react-hooks@^5 \
  eslint-plugin-import@^2 \
  eslint-plugin-promise@^7 \
  eslint-plugin-regex@^1 \
  eslint-plugin-vitest@^0 \
  eslint-plugin-testing-library@^7 \
  eslint-plugin-storybook@^0 \
  @stylistic/eslint-plugin@^4 \
  @cspell/eslint-plugin@^8 \
  eslint-config-prettier@^10 \
  globals@^16
```

### Phase 3: Configuration Files

- **Prettier config** (`.prettierrc`):

  ```json
  {
    "trailingComma": "es5",
    "tabWidth": 2,
    "semi": false,
    "singleQuote": true
  }
  ```

- **Prettier ignore** (`.prettierignore`):

  ```
  node_modules
  dist
  coverage
  src-tauri/target
  playwright-report
  *.min.js
  *.d.ts
  ```

- **lint-staged config** (`lint-staged.config.js`):

  ```js
  export default {
    '*.{js,jsx,ts,tsx}': ['eslint --max-warnings=0'],
    '*.{ts,tsx}': () => 'tsc --noEmit',
    '*.{js,mjs,jsx,ts,tsx,json,css,md,yaml,yml}': ['prettier --check'],
  }
  ```

- **Commitlint config** (`commitlint.config.mjs`):
  ```js
  export default { extends: ['@commitlint/config-conventional'] }
  ```

### Phase 4: Husky Git Hooks

- Run `npx husky init` to set up `.husky/` directory
- Ensure `"prepare": "husky"` script exists in `package.json`

- **Pre-commit hook** (`.husky/pre-commit`):

  ```sh
  npx lint-staged
  ```

- **Commit-msg hook** (`.husky/commit-msg`):

  ```sh
  npx --no -- commitlint --edit $1
  ```

- **Pre-push hook** (`.husky/pre-push`):
  ```sh
  npm test
  ```

### Phase 5: Package.json Scripts

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "prepare": "husky",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "type-check": "tsc -b",
    "test": "vitest"
  }
}
```

### Phase 6: GitHub Actions Workflows

- **CI Checks** (`.github/workflows/ci-checks.yml`):
  - Trigger: push to any branch except `main` + pull requests targeting `main`
  - Two parallel jobs:
    1. `code-check`: Node 24 setup with npm cache, then `npm run lint`, `npm run format:check`, `npm run type-check`
    2. `unit-test`: Node 24 setup with npm cache, then `npm test`
  - Environment: Ubuntu latest

- **Tauri Build** (`.github/workflows/tauri-build.yml`):
  - Trigger: push to `main` + pull requests targeting `main`
  - Matrix: Ubuntu (latest), macOS (latest), Windows (latest)
  - Steps:
    1. Checkout code
    2. Setup Node 24 with npm cache
    3. Setup Rust toolchain (stable) via `dtolnay/rust-toolchain@stable`
    4. Install system dependencies (Ubuntu only: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`)
    5. `npm ci`
    6. `npm run build` (frontend build)
    7. `npx tauri build` (Tauri desktop build)
    8. Upload artifacts using `actions/upload-artifact@v4`
  - Note: This workflow will function only after the Tauri project is scaffolded. Create it now so the pipeline is ready.

## Data Model

Not applicable — this specification covers CI/CD infrastructure only. No application data model is being defined.

## IPC Commands

Not applicable — no Tauri commands are being implemented in this specification.

## UI Screens

Not applicable — no UI is being implemented in this specification.

## User Flows

### Developer Commit Flow

1. Developer stages files with `git add`
2. Pre-commit hook triggers `npx lint-staged`
3. lint-staged runs ESLint, TypeScript check, and Prettier on staged files
4. If checks fail → commit is blocked, developer fixes issues
5. If checks pass → developer writes commit message
6. Commit-msg hook triggers commitlint
7. If message is non-conventional → commit is blocked
8. If message is valid → commit succeeds

### Developer Push Flow

1. Developer runs `git push`
2. Pre-push hook triggers `npm test`
3. If tests fail → push is blocked
4. If tests pass → push proceeds

### CI Pipeline Flow

1. Developer pushes to feature branch
2. GitHub Actions triggers ci-checks.yml
3. `code-check` job runs lint + format + type-check
4. `unit-test` job runs Vitest
5. Both must pass for green status
6. Developer opens PR to main
7. Both ci-checks.yml and tauri-build.yml trigger
8. Tauri build runs on 3 platforms
9. All checks must pass before merge

## Verification

After all features are implemented, verify:

1. `npm run lint` exits 0 (ESLint works)
2. `npm run format:check` exits 0 (Prettier works)
3. `npx husky` is installed (`.husky/` directory exists with 3 hooks)
4. `.github/workflows/` contains 2 workflow files
5. `commitlint.config.mjs` exists and is valid
6. `lint-staged.config.js` exists and is valid
7. `package.json` has all required scripts and devDependencies
