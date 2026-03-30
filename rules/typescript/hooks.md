---
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.js'
  - '**/*.jsx'
---

# TypeScript/JavaScript Hooks

> This file extends [common/hooks.md](../common/hooks.md) with TypeScript/JavaScript specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **Prettier**: Auto-format JS/TS files after edit (`npx prettier --write`)
- **ESLint**: Lint check after editing TS/JS files (`npx eslint --no-warn-ignored`)
- **TypeScript check**: Run `tsc --noEmit` after editing `.ts`/`.tsx` files

## Stop Hooks

- **ESLint audit**: Run `npx eslint .` on all source files before session ends
- **TypeScript check**: Run `npx tsc --noEmit` before session ends
