# Rust Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Rust-specific content.

## Ownership and Borrowing

- Prefer borrowing (`&T`, `&mut T`) over cloning; add a comment justifying any `.clone()`
- Use `&str` over `String` in function parameters when ownership is not needed
- Prefer `impl AsRef<str>` for flexible string-accepting APIs

## Error Handling

- Use `Result<T, E>` for all fallible operations
- `thiserror` for library/domain error types with structured variants
- `anyhow` for application-level error propagation where specific types aren't needed
- Never `unwrap()` in production code; use `expect("reason")` only when the invariant is documented
- Propagate errors with `?` operator; avoid manual `match` on `Result` when `?` suffices

## Naming Conventions

- `snake_case` for functions, variables, modules
- `PascalCase` for types, traits, enums
- `SCREAMING_SNAKE_CASE` for constants and statics
- Prefix unused variables with `_`

## File Organization

- One module per file; use `mod.rs` or named module files
- Feature-based directory structure under `src-tauri/src/`
- Keep files under 400 lines; extract submodules when approaching the limit
- Group `use` statements: std → external crates → internal modules, separated by blank lines

## Immutability

- Rust defaults to immutable (`let`); only use `let mut` when mutation is necessary
- Prefer iterator chains (`.map()`, `.filter()`, `.collect()`) over mutable accumulator loops
- Use `Cow<'_, T>` when a function may or may not need to allocate

## Type Annotations

- Annotate public function signatures explicitly (arguments and return types)
- Let the compiler infer types for local variables unless clarity demands annotation
- Use `impl Trait` in argument position for generic functions; reserve `dyn Trait` for dynamic dispatch
