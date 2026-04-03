# Codex Code Review Agent — Design Spec

**Date**: 2026-04-02
**Status**: Draft
**Approach**: Codex CLI Local + Official GitHub Action (Approach C)

## Problem

The Vimeflow harness workflow generates code autonomously, but review is manual.
Adding a cross-vendor automated review (OpenAI Codex) provides a second-opinion
gate that catches blind spots a same-model review misses — and runs server-side,
keeping local dev fast.

## Decisions

| Decision      | Choice                                    | Rationale                                                                     |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Review agent  | OpenAI Codex CLI                          | Cross-vendor second opinion; native GitHub integration; server-side execution |
| Local trigger | Manual (`npm run review`)                 | Non-blocking; developer chooses when to review                                |
| PR trigger    | GitHub Action (`openai/codex-action@v1`)  | Automatic on every PR; consistent with CI                                     |
| Enforcement   | Advisory (comments only)                  | Start advisory, upgrade to required check once prompts are tuned              |
| Review scope  | Full (quality + security + architecture)  | Comprehensive review matching existing agent specs                            |
| Local output  | Terminal + `.codex-reviews/latest.md`     | Both; file enables future Claude Code ingestion via tmux                      |
| Future phase  | Claude Code detects/ingests Codex results | Deferred until tmux integration is ready                                      |

## Architecture

```
┌─────────────────────────────────────────────┐
│ Shared Review Configuration                 │
│ .github/codex/prompts/review.md             │
│ .github/codex/codex-output-schema.json      │
│ AGENTS.md (repo-level review guidelines)    │
└──────────┬──────────────┬───────────────────┘
           │              │
    ┌──────▼──────┐  ┌───▼──────────────────┐
    │ Local CLI   │  │ GitHub Action         │
    │ npm run     │  │ codex-action@v1       │
    │ review      │  │ on: pull_request      │
    │             │  │                       │
    │ Terminal +  │  │ PR comment with       │
    │ .codex-     │  │ inline findings       │
    │ reviews/    │  │ (advisory, not        │
    │ latest.md   │  │ blocking)             │
    └─────────────┘  └───────────────────────┘
```

Both local and CI use the same prompt and output schema for consistency.

## Component 1: GitHub Action Workflow

**File**: `.github/workflows/codex-review.yml`

```yaml
name: Codex PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  codex-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v5
        with:
          ref: refs/pull/${{ github.event.pull_request.number }}/merge

      - uses: openai/codex-action@v1
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          prompt-file: .github/codex/prompts/review.md
          output-schema-file: .github/codex/codex-output-schema.json
          sandbox: read-only
          model: gpt-5.2-codex
          safety-strategy: drop-sudo
```

**Key choices**:

- **`read-only` sandbox**: Review does not modify files
- **`drop-sudo`**: Default safety — no elevated privileges for Codex
- **Triggers**: `opened`, `synchronize`, `reopened` — covers new PRs and force-pushes
- **No branch filter**: Reviews all PRs to main (add path filters later if noisy)
- **Advisory**: No `required: true` status check — Codex posts comments but never blocks merge

**Required GitHub secret**: `OPENAI_API_KEY`

## Component 2: Review Prompt

**File**: `.github/codex/prompts/review.md`

The prompt instructs Codex to act as a senior code reviewer. Review focus areas:

1. **Code quality** — naming, complexity (<50 line functions, <800 line files), dead code,
   immutability patterns, no `console.log`, arrow-function components
2. **Security** — OWASP Top 10, hardcoded secrets, input validation, XSS/CSRF,
   SQL injection, path traversal
3. **Architecture** — feature-based organization (`src/features/<name>/`),
   co-located tests, separation of concerns, proper TypeScript types
4. **TypeScript-specific** — type safety, explicit return types on exports,
   no `any`, proper error handling, ESM imports

The prompt references `AGENTS.md` for project-specific context and tells Codex
to focus only on issues introduced by the PR diff — not pre-existing problems.

Severity levels match the project's existing code review standards:

- **CRITICAL**: Security vulnerability or data loss risk — must fix
- **HIGH**: Bug or significant quality issue — should fix
- **MEDIUM**: Maintainability concern — consider fixing
- **LOW**: Style or minor suggestion — optional

## Component 3: Output Schema

**File**: `.github/codex/codex-output-schema.json`

Structured JSON enforcing consistent review output:

```json
{
  "type": "object",
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "maxLength": 80 },
          "body": { "type": "string" },
          "severity": {
            "type": "string",
            "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
          },
          "confidence_score": { "type": "number", "minimum": 0, "maximum": 1 },
          "code_location": {
            "type": "object",
            "properties": {
              "absolute_file_path": { "type": "string" },
              "line_range": {
                "type": "object",
                "properties": {
                  "start": { "type": "integer", "minimum": 1 },
                  "end": { "type": "integer", "minimum": 1 }
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
    "overall_explanation": { "type": "string" },
    "overall_confidence_score": { "type": "number", "minimum": 0, "maximum": 1 }
  },
  "required": [
    "findings",
    "overall_correctness",
    "overall_explanation",
    "overall_confidence_score"
  ]
}
```

## Component 4: Local Review Script

**File**: `scripts/review.sh`
**npm script**: `"review": "bash scripts/review.sh"`

```bash
#!/usr/bin/env bash
set -euo pipefail

REVIEW_DIR=".codex-reviews"
OUTPUT_FILE="$REVIEW_DIR/latest.md"
PROMPT_FILE=".github/codex/prompts/review.md"
SCHEMA_FILE=".github/codex/codex-output-schema.json"

mkdir -p "$REVIEW_DIR"

echo "Running Codex code review..."
codex exec \
  --prompt-file "$PROMPT_FILE" \
  --output-schema "$SCHEMA_FILE" \
  --sandbox read-only \
  --model gpt-5.2-codex \
  | tee "$OUTPUT_FILE"

echo ""
echo "Review saved to $OUTPUT_FILE"
```

- Uses same prompt and schema as CI
- `tee` sends output to both terminal and file
- `.codex-reviews/` added to `.gitignore`

## Component 5: AGENTS.md

**File**: `AGENTS.md` (repo root)

Codex reads this file for project-specific review context. Contents:

- **Project description**: Vimeflow is a Tauri desktop app (Rust + React/TypeScript)
  for managing AI coding agent conversations
- **Architecture**: Feature-based organization under `src/features/`, shared layout
  in `src/components/layout/`, test co-location
- **Code style**: No semicolons, single quotes, arrow-function components,
  explicit return types, no `console.log`, CSpell spell-checking
- **Design system**: "The Obsidian Lens" — Catppuccin Mocha palette, semantic tokens,
  glassmorphism, no visible borders
- **Current phase**: Early implementation — no `src-tauri/` yet, focus on frontend
- **Review guidelines**: Reference to `rules/` directory for detailed standards;
  focus on issues introduced by the PR, not pre-existing problems

## File Changes Summary

| File                                     | Action | Purpose                     |
| ---------------------------------------- | ------ | --------------------------- |
| `.github/workflows/codex-review.yml`     | Create | GitHub Action for PR review |
| `.github/codex/prompts/review.md`        | Create | Shared review prompt        |
| `.github/codex/codex-output-schema.json` | Create | Structured output schema    |
| `scripts/review.sh`                      | Create | Local review script         |
| `AGENTS.md`                              | Create | Codex project context       |
| `package.json`                           | Edit   | Add `review` npm script     |
| `.gitignore`                             | Edit   | Add `.codex-reviews/`       |

## Future Phases (Out of Scope)

1. **Claude Code ingestion**: After tmux setup, Claude Code auto-detects
   `.codex-reviews/latest.md` and incorporates findings
2. **Required check**: Once review prompts are tuned and false-positive rate
   is acceptable, upgrade from advisory to required status check
3. **Harness integration**: Codex review as a step in the autonomous harness loop
   (after Coder agent completes a feature, before marking it done)

## Dependencies

- OpenAI API key stored as GitHub secret (`OPENAI_API_KEY`)
- Codex CLI installed locally (`npm i -g @openai/codex` or equivalent)
- Node >= 24 (already required by project)

## Sources

- [GitHub Action docs](https://developers.openai.com/codex/github-action)
- [GitHub integration guide](https://developers.openai.com/codex/integrations/github)
- [Code review cookbook](https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk)
- [openai/codex-action repo](https://github.com/openai/codex-action)
