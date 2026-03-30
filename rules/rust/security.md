# Rust Security

> This file extends [common/security.md](../common/security.md) with Rust-specific content.

## Unsafe Code Policy

- `unsafe` is forbidden in application code without explicit review
- Any `unsafe` block must include a `// SAFETY:` comment explaining the invariant being upheld
- Prefer safe abstractions; use `unsafe` only when there is no safe alternative and the performance gain is measured

## Dependency Security

- Run `cargo audit` before every release to check for known vulnerabilities
- Use `cargo deny` for license compliance and advisory checks
- Pin dependencies in `Cargo.lock` (committed to version control for applications)
- Review new dependencies before adding: check maintenance status, download count, and audit surface area

## File System Access

- Validate all file paths received via IPC are within the app's data directory
- Use Tauri's path resolver APIs (`app.path_resolver().app_data_dir()`) instead of hardcoded paths
- Never construct paths by concatenating user input — use `Path::join()` and canonicalize
- Prevent path traversal: reject paths containing `..` components from IPC inputs

## Tauri Allowlist

- Principle of least privilege: only enable APIs the app actually uses in `tauri.conf.json`
- Review the allowlist when adding new features; do not enable broad permissions preemptively
- Document why each enabled API is needed

## Process Execution

- Never pass user-supplied IPC arguments directly to `std::process::Command`
- If shell execution is required, use an explicit allowlist of permitted commands
- Prefer Tauri plugins or Rust libraries over shelling out

## Logging

- Never log secrets, tokens, or credentials
- Sanitize user data before logging
- Use structured logging (`tracing` crate preferred over `println!`)
