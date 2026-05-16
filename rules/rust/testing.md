# Rust Testing

> This file extends [common/testing.md](../common/testing.md) with Rust-specific content.

## Unit Tests

- Place unit tests in a `#[cfg(test)] mod tests` block at the bottom of each source file
- Use `#[test]` attribute; `#[tokio::test]` for async tests
- Test naming: `test_<function>_<scenario>_<expected>`

## Integration Tests

- Place in `src-tauri/tests/` as separate files (the directory keeps the `src-tauri` name post-PR-D3; rename to `backend/` is a deferred follow-up)
- Each file is compiled as its own crate; use `use vimeflow_lib::...` to import from the library
- Test command handlers by calling the `#[cfg(test)] pub fn xxx(...)` aliases co-located next to each `_inner` helper, or call `BackendState` methods directly with a `FakeEventSink`. Do NOT try to spin up a real runtime — the sidecar `main()` (in `src/bin/vimeflow-backend.rs`) is the only production entry point.

## Coverage

- Target: 80% minimum (aligned with common testing rule)
- Tool: `cargo-llvm-cov` (preferred) or `cargo-tarpaulin`
- Run: `cargo llvm-cov --html` for reports

## Mocking

- Use `mockall` for trait-based mocking
- Define traits for external dependencies (file system, network, APIs) to enable test doubles
- Prefer dependency injection over global state for testability

## Test Commands

```bash
cargo test                          # Run all tests
cargo test <test_name>              # Run a single test
cargo test --lib                    # Unit tests only
cargo test --test <integration>     # Single integration test
cargo llvm-cov --html               # Coverage report
```
