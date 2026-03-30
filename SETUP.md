# VIBM Setup Guide

This guide documents the manual steps needed to complete the CI/CD infrastructure setup.

## Prerequisites

- **Node.js 24+** - Install via [nvm](https://github.com/nvm-sh/nvm) or from [nodejs.org](https://nodejs.org/)
- **Git** - For version control
- **Rust** (optional, for future Tauri development) - Install from [rustup.rs](https://rustup.rs/)

## Setup Steps

### 1. Initialize Git Repository

```bash
git init
```

### 2. Make Scripts Executable

```bash
chmod +x init.sh
chmod +x .husky/pre-commit
chmod +x .husky/commit-msg
chmod +x .husky/pre-push
```

### 3. Install Dependencies

```bash
npm install
```

This will install all devDependencies listed in `package.json`:

- Husky 9 (git hooks)
- lint-staged 15 (pre-commit checks)
- commitlint 19 (commit message validation)
- Prettier 3 (code formatting)
- ESLint 9 (code linting)
- TypeScript 5 (type checking)
- Vitest 3 (testing)
- And all ESLint plugins

### 4. Initialize Husky

```bash
npm run prepare
```

This creates the `.husky/_/husky.sh` file needed by the git hooks.

### 5. Verify Installation

Run the following commands to ensure everything is set up correctly:

```bash
# Check linting works
npm run lint

# Check formatting
npm run format:check

# Check TypeScript configuration (will error if no TS files exist yet)
npm run type-check

# Run tests (will pass with no tests for now)
npm test
```

### 6. Create Initial Commit

```bash
git add .
git commit -m "chore: initial CI/CD infrastructure setup"
```

This will trigger the pre-commit and commit-msg hooks for the first time.

## What's Been Set Up

### Configuration Files

- ✅ `package.json` - Node 24+, all scripts, all devDependencies
- ✅ `.nvmrc` - Node version 24
- ✅ `.npmrc` - engine-strict=true
- ✅ `.prettierrc` - Prettier configuration (no semis, single quotes)
- ✅ `.prettierignore` - Ignore patterns
- ✅ `lint-staged.config.js` - Pre-commit checks configuration
- ✅ `commitlint.config.mjs` - Conventional commits configuration
- ✅ `eslint.config.js` - Already exists in project root
- ✅ `cspell.config.yaml` - Already exists in project root

### Git Hooks (.husky/)

- ✅ `pre-commit` - Runs lint-staged (ESLint, TypeScript, Prettier)
- ✅ `commit-msg` - Validates commit message format
- ✅ `pre-push` - Runs all tests

### GitHub Actions Workflows (.github/workflows/)

- ✅ `ci-checks.yml` - Code quality and unit tests (runs on feature branches)
- ✅ `tauri-build.yml` - Cross-platform Tauri builds (runs on main branch)

### Utility Scripts

- ✅ `init.sh` - Environment initialization script
- ✅ `feature_list.json` - Autonomous development roadmap

## Troubleshooting

### Husky hooks not running

If git hooks aren't executing:

```bash
npm run prepare
git config core.hooksPath .husky
```

### ESLint errors

The project has `eslint.config.js` already. If you see errors about missing plugins, ensure you ran `npm install`.

### TypeScript errors

TypeScript configuration will need `tsconfig.json` when you start writing TypeScript code. This will be added in the next phase.

### Prettier conflicts with ESLint

The `eslint-config-prettier` package is installed to disable conflicting ESLint rules.

## Next Steps

After completing this setup:

1. **Verify all checks pass**: Run `npm run lint`, `npm run format:check`, `npm test`
2. **Test git hooks**: Make a test commit to verify hooks trigger
3. **Review feature_list.json**: See the full development roadmap
4. **Start Phase 2**: Begin implementing the actual Tauri application

## Feature Progress

All features in this phase (CI/CD infrastructure) are tracked in `feature_list.json`. Use the autonomous harness or manual implementation to work through the list.

Current status: **Infrastructure complete, awaiting dependency installation and verification**
