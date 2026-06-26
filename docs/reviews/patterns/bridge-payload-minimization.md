---
id: bridge-payload-minimization
category: security
created: 2026-06-20
last_updated: 2026-06-26
ref_count: 4
---

# Bridge Payload Minimization

## Summary

Agent bridge plugins sit on high-volume event streams that can carry raw tool inputs, outputs, file contents, commands, and permission metadata. If the bridge persists raw event payloads, it bypasses any narrower hook-specific preview/excerpt logic and turns an observability channel into a data sink for sensitive material. Persisted bridge records should be rebuilt from explicit allowlists, with tool arguments previewed, outputs excerpted, and unrelated payload fields omitted.

## Findings

### 1. OpenCode tool-part events persisted raw properties

- **Source:** github-codex-connector | PR #585 round 2 | 2026-06-20
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`
- **Finding:** `message.part.updated` handling filtered to tool/step parts but then wrote the entire `properties` object as event `data`. Tool parts can contain full read/write/bash inputs and outputs, bypassing the bridge's dedicated `previewArgs` and `excerptOutput` minimization used by tool hooks.
- **Fix:** Added explicit event sanitizers and changed event writes to persist sanitized shapes only. Tool parts now keep identifiers, previewed args, excerpted output, bounded metadata, and timing/status fields instead of the raw event payload.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. OpenCode custom tool previews copied credential-shaped scalar args

- **Source:** github-codex-connector | PR #590 round 1 | 2026-06-21
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`
- **Finding:** The widened opencode `previewArgs` path kept every scalar arg except a small content-field denylist. Custom tools with fields such as `token`, `password`, `apiKey`, or `authorization` could therefore persist credential values into the durable bridge JSONL.
- **Fix:** Added credential-shaped arg-name detection and redacted matching fields before serializing previews, while still preserving bounded non-sensitive scalar args.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. OpenCode credential-key arg fields escaped redaction

- **Source:** github-codex-connector | PR #590 round 2 | 2026-06-21
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`
- **Finding:** The opencode bridge normalized arg names before checking the sensitive-field denylist, but it only matched token, secret, password, and similar suffixes. Credential key fields such as `secretAccessKey`, `accessKey`, `secretKey`, `signingKey`, and `encryptionKey` could therefore still be written to durable bridge JSONL.
- **Fix:** Added targeted normalized key compounds to the sensitive-field set and covered them with a bridge JSONL regression test that preserves a benign key label while redacting credential key values.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. OpenCode prefixed credential-key args escaped redaction

- **Source:** github-claude | PR #590 round 3 | 2026-06-21
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`
- **Finding:** The opencode bridge redacted exact normalized credential-key names but did not match namespaced custom-tool args such as `apiSecretKey`, `myAccessKey`, or `awsSecretAccessKey`. Those scalar credential values could still be persisted in local bridge JSONL.
- **Fix:** Added targeted compound suffix matching for access, secret, signing, and encryption key field names, and extended the bridge JSONL regression test with prefixed variants while preserving a benign key label.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Xterm sessions decoded Ghostty-only raw PTY bytes

- **Source:** github-claude | PR #626 round 1 | 2026-06-26
- **Severity:** HIGH
- **File:** `src/features/terminal/services/desktopTerminalService.ts`
- **Finding:** The Electron terminal bridge decoded `dataBytesBase64` for every PTY chunk, so default xterm sessions paid per-chunk base64 decode and allocation overhead even though only Ghostty WASM consumes raw bytes.
- **Fix:** Added per-session raw-byte consumer registration and decode only when the emitted session is registered by a Ghostty renderer. The xterm path now receives string data without decoding the optional base64 payload.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Malformed Ghostty raw-byte payload aborted PTY chunk delivery

- **Source:** github-claude | PR #626 round 2 | 2026-06-26
- **Severity:** HIGH
- **File:** `src/features/terminal/services/desktopTerminalService.ts`
- **Finding:** `decodeBase64Bytes` called `atob()` without guarding malformed `dataBytesBase64` payloads. A bad raw-byte field for a registered Ghostty session could throw inside the PTY event listener before callbacks received the fallback string data.
- **Fix:** Wrapped the base64 decode in a try/catch that returns `undefined` on invalid payloads, preserving the existing string-data callback path for that chunk.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Xterm sessions received Ghostty-only raw PTY bytes

- **Source:** github-codex-connector | PR #626 round 3 | 2026-06-26
- **Severity:** HIGH
- **File:** `crates/backend/src/terminal/commands.rs`
- **Finding:** The backend always base64-encoded every PTY chunk into `data_bytes_base64`, so default xterm sessions paid per-chunk allocation, encode cost, and larger IPC payloads for a Ghostty WASM renderer that was not active.
- **Fix:** Added a per-session raw-byte capability toggled by the active renderer. The PTY read loop now leaves `data_bytes_base64` absent unless the session has an active Ghostty WASM raw-byte consumer.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
