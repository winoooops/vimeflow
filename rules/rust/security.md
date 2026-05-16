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
- The sidecar receives its app-data directory via the `--app-data-dir <path>` CLI argument (passed by Electron's `app.getPath('userData')` in `electron/main.ts`); store the resolved `PathBuf` on `BackendState` and validate every IPC path is descended from it (see `src-tauri/src/filesystem/scope.rs` for the canonical check).
- Never construct paths by concatenating user input — use `Path::join()` and `canonicalize()`
- Prevent path traversal: reject paths containing `..` components from IPC inputs

## IPC method allowlist

- Principle of least privilege: only methods registered in `electron/backend-methods.ts` are forwarded to the sidecar. The allowlist is enforced in `electron/main.ts`'s `ipcMain.handle(BACKEND_INVOKE, ...)` before the request frame is sent.
- E2E-only methods (e.g., `list_active_pty_sessions`) are gated by both the renderer `VITE_E2E=1` build flag AND the Cargo `e2e-test` feature; they MUST NOT be reachable from production builds.
- Review the allowlist when adding new sidecar methods; do not enable broad surface preemptively. Document why each enabled method is needed.

## Process Execution

- Never pass user-supplied IPC arguments directly to `std::process::Command`
- If shell execution is required, use an explicit allowlist of permitted commands
- Prefer Rust libraries over shelling out (`portable-pty` for PTY, `git2` / `simple-git` callers for git, `notify` for file watching)

## Logging

- Never log secrets, tokens, or credentials
- Sanitize user data before logging
- Use structured logging (`tracing` crate preferred over `println!`)
