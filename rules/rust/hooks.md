# Rust Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Rust-specific content.

## PostToolUse Hooks

After editing `*.rs` files:

### Auto-format

```json
{
  "event": "PostToolUse",
  "tools": ["Edit", "Write"],
  "pattern": "**/*.rs",
  "command": "cargo fmt --check"
}
```

### Lint Check

```json
{
  "event": "PostToolUse",
  "tools": ["Edit", "Write"],
  "pattern": "**/*.rs",
  "command": "cargo clippy --quiet -- -D warnings"
}
```

## Stop Hooks

Before session ends, verify no regressions:

```json
{
  "event": "Stop",
  "command": "cargo test --quiet"
}
```
