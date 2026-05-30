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
