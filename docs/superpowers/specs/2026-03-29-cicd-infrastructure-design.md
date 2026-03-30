# VIBM CI/CD Infrastructure Design

## Overview

Set up automated code quality enforcement and CI/CD pipelines for the VIBM project. This includes local git hooks (Husky + lint-staged + commitlint), Prettier formatting, GitHub Actions workflows for CI checks and Tauri cross-platform builds, and supporting project configuration files.

Reference implementation: [JR-x-Melfish-P3/Let-s-GO](https://github.com/JR-x-Melfish-P3/Let-s-GO)

## Scope

CI/CD tooling only. No app scaffolding, no Tauri project initialization. The existing `eslint.config.js` and `cspell.config.yaml` are preserved as-is.

## Tech Stack

- Node.js 24 (Active LTS, supported until April 2028)
- Husky 9 (git hooks)
- lint-staged (staged file checks)
- commitlint (conventional commit enforcement)
- Prettier 3 (formatting)
- GitHub Actions (CI/CD)

## 1. Local Git Hooks (Husky)

Three hooks in `.husky/`:

### Pre-commit (`.husky/pre-commit`)

```sh
npx lint-staged
```

Runs ESLint, TypeScript type-check, and Prettier format-check on staged files only.

### Commit-msg (`.husky/commit-msg`)

```sh
npx --no -- commitlint --edit $1
```

Validates commit messages against the conventional commits specification. Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `style`, `build`, `revert`.

### Pre-push (`.husky/pre-push`)

```sh
npm test
```

Runs the full Vitest test suite before allowing pushes. Prevents pushing broken code.

## 2. lint-staged Configuration

File: `lint-staged.config.js`

```js
export default {
  '*.{js,jsx,ts,tsx}': ['eslint --max-warnings=0'],
  '*.{ts,tsx}': () => 'tsc --noEmit',
  '*.{js,mjs,jsx,ts,tsx,json,css,md,yaml,yml}': ['prettier --check'],
}
```

- ESLint runs on staged JS/TS files with zero-warning policy
- TypeScript type-check runs on staged TS files (returns command string to avoid file list in tsc)
- Prettier format-check runs on all supported file types

## 3. Prettier Configuration

File: `.prettierrc`

```json
{
  "trailingComma": "es5",
  "tabWidth": 2,
  "semi": false,
  "singleQuote": true
}
```

File: `.prettierignore`

```
node_modules
dist
coverage
src-tauri/target
playwright-report
*.min.js
*.d.ts
```

Matches ESLint ignore patterns plus Rust build artifacts.

## 4. Commitlint Configuration

File: `commitlint.config.mjs`

```js
export default { extends: ['@commitlint/config-conventional'] }
```

Enforces conventional commit format. No custom rules beyond the standard convention.

## 5. GitHub Actions Workflows

### CI Checks (`.github/workflows/ci-checks.yml`)

- **Trigger**: Push to any branch except `main` + pull requests targeting `main`
- **Jobs** (run in parallel):
  1. `code-check`: ESLint (`npm run lint`), Prettier (`npm run format:check`), TypeScript (`npm run type-check`)
  2. `unit-test`: Vitest (`npm test`)
- **Environment**: Ubuntu latest, Node 24, npm cache

### Tauri Build (`.github/workflows/tauri-build.yml`)

- **Trigger**: Push to `main` + pull requests targeting `main`
- **Matrix**: Ubuntu (latest), macOS (latest), Windows (latest)
- **Steps**:
  1. Checkout code
  2. Setup Node 24 with npm cache
  3. Setup Rust toolchain (stable)
  4. Install system dependencies (Ubuntu: libwebkit2gtk, libgtk-3, etc.)
  5. `npm ci`
  6. `npm run build` (frontend build)
  7. `npx tauri build` (Tauri build)
  8. Upload artifacts (platform-specific binaries)
- **Note**: This workflow will only work once the Tauri project is scaffolded. It validates the build pipeline is ready.

## 6. Package.json

New file with devDependencies and scripts only (no app dependencies yet):

### Scripts

```json
{
  "prepare": "husky",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "type-check": "tsc -b",
  "test": "vitest"
}
```

### DevDependencies

- `husky` (^9)
- `lint-staged` (^15)
- `@commitlint/cli` (^19)
- `@commitlint/config-conventional` (^19)
- `prettier` (^3)
- All ESLint plugins already referenced in `eslint.config.js`
- `typescript` (^5)
- `vitest` (^3)

## 7. Supporting Files

| File     | Content              | Purpose                                            |
| -------- | -------------------- | -------------------------------------------------- |
| `.nvmrc` | `24`                 | Pin Node version for nvm/fnm users                 |
| `.npmrc` | `engine-strict=true` | Enforce Node version in package.json engines field |

## 8. Files Created/Modified

### New files (12)

1. `package.json`
2. `.prettierrc`
3. `.prettierignore`
4. `lint-staged.config.js`
5. `commitlint.config.mjs`
6. `.husky/pre-commit`
7. `.husky/commit-msg`
8. `.husky/pre-push`
9. `.github/workflows/ci-checks.yml`
10. `.github/workflows/tauri-build.yml`
11. `.nvmrc`
12. `.npmrc`

### Existing files (unchanged)

- `eslint.config.js` — already configured, no changes needed
- `cspell.config.yaml` — already configured, no changes needed

## 9. Decisions

| Decision            | Choice                               | Rationale                                   |
| ------------------- | ------------------------------------ | ------------------------------------------- |
| Node version        | 24                                   | Active LTS, supported until 2028            |
| Prettier style      | No semi, single quotes, trailing ES5 | Matches reference repo                      |
| ESLint zero-warning | Yes                                  | Enforces clean code in staged files         |
| Pre-push hook       | Full test suite                      | Prevents pushing broken code                |
| Tauri build matrix  | 3 platforms                          | Desktop app needs cross-platform validation |
| commitlint rules    | Standard conventional                | No custom overrides needed                  |
