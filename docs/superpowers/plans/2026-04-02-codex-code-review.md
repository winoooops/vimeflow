# Codex Code Review Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated code review via OpenAI Codex — manual local trigger (`npm run review`) and automatic GitHub Action on every PR (advisory, non-blocking).

**Architecture:** Shared review prompt and output schema used by both the local Codex CLI script and the `openai/codex-action@v1` GitHub Action. An `AGENTS.md` file at repo root gives Codex project-specific context. Local output goes to terminal + `.codex-reviews/latest.md` (gitignored).

**Tech Stack:** OpenAI Codex CLI, `openai/codex-action@v1`, GitHub Actions, Bash, gpt-5.2-codex model.

**Spec:** `docs/superpowers/specs/2026-04-02-codex-code-review-design.md`

---

## File Map

| File                                     | Action | Responsibility                                                      |
| ---------------------------------------- | ------ | ------------------------------------------------------------------- |
| `AGENTS.md`                              | Create | Codex project context — architecture, code style, review guidelines |
| `.github/codex/prompts/review.md`        | Create | Shared review prompt for both local and CI                          |
| `.github/codex/codex-output-schema.json` | Create | Structured JSON schema for review findings                          |
| `.github/workflows/codex-review.yml`     | Create | GitHub Action that runs Codex on every PR                           |
| `scripts/review.sh`                      | Create | Local review script wrapping `codex exec`                           |
| `package.json`                           | Edit   | Add `"review"` npm script                                           |
| `.gitignore`                             | Edit   | Add `.codex-reviews/`                                               |

---

### Task 0: Create feature branch

- [ ] **Step 1: Create and checkout feature branch**

```bash
git checkout -b feat/codex-code-review
```

---

### Task 1: Create AGENTS.md

Codex reads `AGENTS.md` at repo root for project-specific review context. This is the Codex equivalent of `CLAUDE.md`.

**Files:**

- Create: `AGENTS.md`

- [ ] **Step 1: Create AGENTS.md**

```markdown
# AGENTS.md

Project context for OpenAI Codex code review.

## Project

Vimeflow is a Tauri desktop application (Rust backend + React/TypeScript frontend) for managing conversations with AI coding agents.

**Phase:** Early implementation. The Tauri/Rust backend (`src-tauri/`) does not exist yet — current focus is frontend.

## Architecture
```

src/
├── main.tsx # React entry point
├── App.tsx # Root component
├── index.css # Tailwind + global styles
├── components/layout/ # Shared layout shells
└── features/chat/ # Chat feature module
├── ChatView.tsx # Page assembly
├── components/ # Chat-specific components
├── data/mockMessages.ts # Mock conversation data
└── types/index.ts # Chat domain types

```

- **Feature-based organization**: code lives under `src/features/<name>/` with co-located components, types, and data
- **Test co-location**: every `.tsx`/`.ts` file has a sibling `.test.tsx`/`.test.ts`
- **Shared layout**: `src/components/layout/` for cross-feature layout shells

## Code Style (enforced by ESLint + Prettier)

- No semicolons, single quotes, trailing commas (es5)
- Arrow-function components only
- Explicit return types on all exported functions
- No `console.log` (eslint `no-console: error`)
- `test()` not `it()` in Vitest
- CSpell spell-checking enabled
- ESM-only (`"type": "module"`)

## Design System

"The Obsidian Lens" — dark atmospheric UI on Catppuccin Mocha palette. Semantic color tokens defined in `tailwind.config.js` (e.g. `bg-surface-container`, `text-on-surface`, `text-primary`). No visible borders — use tonal depth and glassmorphism.

## Review Guidelines

- Focus only on issues **introduced by the PR diff** — do not flag pre-existing problems
- Reference `rules/` directory for detailed coding standards
- Severity levels: CRITICAL (security/data loss), HIGH (bugs), MEDIUM (maintainability), LOW (style)
- Flag any hardcoded secrets, `console.log` statements, or `any` types
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add AGENTS.md for Codex code review context"
```

---

### Task 2: Create review prompt

The shared prompt instructs Codex how to review. Used by both local CLI and GitHub Action.

**Files:**

- Create: `.github/codex/prompts/review.md`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p .github/codex/prompts
```

- [ ] **Step 2: Create `.github/codex/prompts/review.md`**

```markdown
# Code Review Instructions

You are a senior code reviewer for Vimeflow, a Tauri desktop application (React/TypeScript frontend, Rust backend planned). Review the pull request diff and report actionable findings.

## Scope

- Review ONLY changes introduced by this PR — do not flag pre-existing issues
- Read `AGENTS.md` at the repo root for project context, architecture, and code style conventions
- Read `rules/` directory files for detailed coding standards when available

## Review Focus Areas

### 1. Code Quality

- Functions must be under 50 lines; files under 800 lines
- No deep nesting (max 4 levels) — use early returns
- Meaningful, descriptive naming (variables, functions, components)
- Immutable patterns preferred — create new objects, never mutate existing ones
- No `console.log` or debug statements (ESLint enforces `no-console: error`)
- Arrow-function components only (no function declarations for React components)
- No dead code, unused imports, or commented-out blocks

### 2. Security (OWASP Top 10)

- No hardcoded secrets (API keys, passwords, tokens, connection strings)
- Input validation at system boundaries (user input, API responses, file content)
- XSS prevention — sanitize any user-provided content rendered as HTML
- CSRF protection on state-changing endpoints
- SQL injection prevention — parameterized queries only
- Path traversal prevention — validate and sanitize file paths
- No sensitive data in error messages or logs

### 3. Architecture

- Feature-based organization: code under `src/features/<name>/` with co-located components, types, data
- Test co-location: every `.tsx`/`.ts` file must have a sibling `.test.tsx`/`.test.ts`
- Shared layout components in `src/components/layout/` only
- Clean separation of concerns — no business logic in UI components
- Proper TypeScript types — no `any`, explicit return types on exports, strict mode

### 4. TypeScript Specific

- Explicit return types on all exported functions (`@typescript-eslint/explicit-function-return-type`)
- No `any` type — use `unknown` and narrow, or define proper types
- Proper error handling — never silently swallow errors
- ESM imports only (no CommonJS `require`)
- Consistent use of `type` imports for type-only imports

## Severity Levels

- **CRITICAL**: Security vulnerability or data loss risk — must fix before merge
- **HIGH**: Bug, incorrect behavior, or significant quality issue — should fix before merge
- **MEDIUM**: Maintainability concern, code smell, or minor architectural issue — consider fixing
- **LOW**: Style suggestion, naming improvement, or minor optimization — optional

## Output Format

For each finding, provide:

1. A short title (max 80 characters)
2. A clear explanation of the issue and how to fix it
3. The severity level
4. Your confidence score (0.0 to 1.0)
5. The exact file path and line range

End with an overall assessment: is the patch correct or does it have issues? Explain briefly and give an overall confidence score.
```

- [ ] **Step 3: Commit**

```bash
git add .github/codex/prompts/review.md
git commit -m "docs: add Codex review prompt for PR and local review"
```

---

### Task 3: Create output schema

The JSON schema enforces structured, parseable review output from Codex.

**Files:**

- Create: `.github/codex/codex-output-schema.json`

- [ ] **Step 1: Create `.github/codex/codex-output-schema.json`**

```json
{
  "type": "object",
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 80
          },
          "body": {
            "type": "string"
          },
          "severity": {
            "type": "string",
            "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
          },
          "confidence_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "code_location": {
            "type": "object",
            "properties": {
              "absolute_file_path": {
                "type": "string"
              },
              "line_range": {
                "type": "object",
                "properties": {
                  "start": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "end": {
                    "type": "integer",
                    "minimum": 1
                  }
                },
                "required": ["start", "end"]
              }
            },
            "required": ["absolute_file_path", "line_range"]
          }
        },
        "required": [
          "title",
          "body",
          "severity",
          "confidence_score",
          "code_location"
        ]
      }
    },
    "overall_correctness": {
      "type": "string",
      "enum": ["patch is correct", "patch has issues"]
    },
    "overall_explanation": {
      "type": "string"
    },
    "overall_confidence_score": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    }
  },
  "required": [
    "findings",
    "overall_correctness",
    "overall_explanation",
    "overall_confidence_score"
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add .github/codex/codex-output-schema.json
git commit -m "chore: add Codex structured output schema for code review"
```

---

### Task 4: Create GitHub Action workflow

The workflow runs Codex review automatically on every PR. Advisory only — posts comments but does not block merge.

**Files:**

- Create: `.github/workflows/codex-review.yml`

- [ ] **Step 1: Create `.github/workflows/codex-review.yml`**

```yaml
name: Codex PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  codex-review:
    name: Codex Code Review
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout PR merge ref
        uses: actions/checkout@v5
        with:
          ref: refs/pull/${{ github.event.pull_request.number }}/merge

      - name: Run Codex review
        id: codex
        uses: openai/codex-action@v1
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          prompt-file: .github/codex/prompts/review.md
          output-schema-file: .github/codex/codex-output-schema.json
          sandbox: read-only
          model: gpt-5.2-codex
          safety-strategy: drop-sudo
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/codex-review.yml
git commit -m "ci: add Codex PR review workflow (advisory, non-blocking)"
```

---

### Task 5: Create local review script

A bash script that runs Codex locally using the same prompt and schema as CI. Outputs to both terminal and `.codex-reviews/latest.md`.

**Files:**

- Create: `scripts/review.sh`
- Edit: `package.json` (add `review` script)
- Edit: `.gitignore` (add `.codex-reviews/`)

- [ ] **Step 1: Create scripts directory**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Create `scripts/review.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REVIEW_DIR=".codex-reviews"
OUTPUT_FILE="$REVIEW_DIR/latest.md"
PROMPT_FILE=".github/codex/prompts/review.md"
SCHEMA_FILE=".github/codex/codex-output-schema.json"

# Verify Codex CLI is installed
if ! command -v codex &> /dev/null; then
  echo "Error: codex CLI not found. Install with: npm i -g @openai/codex"
  exit 1
fi

# Verify prompt and schema exist
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Review prompt not found at $PROMPT_FILE"
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Error: Output schema not found at $SCHEMA_FILE"
  exit 1
fi

mkdir -p "$REVIEW_DIR"

echo "Running Codex code review..."
echo ""

codex exec \
  --prompt-file "$PROMPT_FILE" \
  --output-schema "$SCHEMA_FILE" \
  --sandbox read-only \
  --model gpt-5.2-codex \
  | tee "$OUTPUT_FILE"

echo ""
echo "Review saved to $OUTPUT_FILE"
```

- [ ] **Step 3: Make script executable**

```bash
chmod +x scripts/review.sh
```

- [ ] **Step 4: Add `review` script to `package.json`**

In `package.json`, add this line to the `"scripts"` object after the `"test"` entry:

```json
"review": "bash scripts/review.sh"
```

The scripts section should look like:

```json
"scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "prepare": "husky",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "type-check": "tsc -b",
    "test": "vitest --passWithNoTests",
    "review": "bash scripts/review.sh"
}
```

- [ ] **Step 5: Add `.codex-reviews/` to `.gitignore`**

Append to the end of `.gitignore`:

```
# Codex review output (local only)
.codex-reviews/
```

- [ ] **Step 6: Commit**

```bash
git add scripts/review.sh package.json .gitignore
git commit -m "feat: add local Codex review script (npm run review)"
```

---

### Task 6: Verify and document

Final checks and documentation update.

**Files:**

- Verify: all created files exist and are well-formed
- No test files needed — these are config/docs/scripts, not application code

- [ ] **Step 1: Verify all files exist**

```bash
ls -la AGENTS.md
ls -la .github/codex/prompts/review.md
ls -la .github/codex/codex-output-schema.json
ls -la .github/workflows/codex-review.yml
ls -la scripts/review.sh
```

All five files should exist.

- [ ] **Step 2: Verify JSON schema is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('.github/codex/codex-output-schema.json', 'utf8')); console.log('Schema is valid JSON')"
```

Expected output: `Schema is valid JSON`

- [ ] **Step 3: Verify package.json is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('package.json is valid JSON')"
```

Expected output: `package.json is valid JSON`

- [ ] **Step 4: Verify review script is executable**

```bash
test -x scripts/review.sh && echo "Script is executable" || echo "Script is NOT executable"
```

Expected output: `Script is executable`

- [ ] **Step 5: Verify .gitignore contains codex-reviews entry**

```bash
grep -q '.codex-reviews/' .gitignore && echo "Entry found" || echo "Entry NOT found"
```

Expected output: `Entry found`

- [ ] **Step 6: Run lint and type-check to confirm nothing is broken**

```bash
npm run lint && npm run type-check
```

Expected: both pass (no application code was changed).

---

## Setup Notes (for the developer, not automated)

After implementation, the following manual steps are needed:

1. **Add `OPENAI_API_KEY` GitHub secret**: Go to the repo's Settings > Secrets and variables > Actions > New repository secret. Add `OPENAI_API_KEY` with your OpenAI API key.

2. **Install Codex CLI locally** (for `npm run review`): `npm i -g @openai/codex`

3. **Test locally**: Run `npm run review` on a branch with changes to verify the script works end-to-end.

4. **Test CI**: Open a PR to verify the GitHub Action triggers and posts review comments.
