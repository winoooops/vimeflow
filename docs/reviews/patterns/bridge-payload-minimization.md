---
id: bridge-payload-minimization
category: security
created: 2026-06-20
last_updated: 2026-08-06
ref_count: 10
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

### 5. OpenCode assistant text snapshots were bounded only at flush time

- **Source:** github-codex-connector | PR #697 round 1 | 2026-07-15
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`
- **Finding:** The OpenCode bridge buffered each `message.part.updated` text snapshot in memory at full size and applied the 32 KiB tail cap only when `session.idle` flushed `assistant.text`. A large prompt or verbose assistant response could therefore grow plugin memory before the intended minimization boundary ran.
- **Fix:** Added a shared tail-clamp helper and applied it before storing text parts in `sessionTextParts`, while keeping the final joined `assistant.text` row tail-clamped as before. Added a bridge regression test that verifies large assistant text emits a bounded tail row.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Claude hook transport persisted raw stdin payloads

- **Source:** github-human | PR #785 round 1 | 2026-08-06
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/claude_code/bridge.rs`
- **Finding:** The generated Claude attention hook appended raw stdin for payloads below its size threshold, so unrelated prompt, body, and credential-shaped fields could enter the durable hook transport.
- **Fix:** Rebuilt the hook record from explicit bounded routing fields only and added a regression test proving secret-shaped and body fields are omitted from the JSONL transport.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Claude StopFailure minimization dropped provider details

- **Source:** local-codex | PR #785 focused fixer | 2026-08-06
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/claude_code/bridge.rs`
- **Finding:** The generated attention hook allowlisted routing metadata but
  omitted every provider error field, so StopFailure consumers could never
  receive the actionable failure body they were built to decode.
- **Fix:** Allowlisted one bounded, escaped `error_details` value for
  StopFailure only, with the provider error code as a fallback. Added a
  script-level regression that executes the hook and compares the complete
  minimized JSONL record.
- **Commit:** uncommitted (the focused fixer task prohibited commits)

### 8. Claude failure-body decoder outlived the safe hook payload

- **Source:** local-codex | PR #785 focused fixer | 2026-08-06
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/claude_code/bridge.rs`
- **Finding:** Replacing the generated Node parser with dependency-free constant hook records made `StopFailure` error fields unreachable, while the notification decoder and design contract still promised an actionable failure body.
- **Fix:** Explicitly adopted a title-only Claude failure contract, removed the unreachable decoder fields, and kept the generated hook's untrusted stdin discarded. Added a decoder regression proving even error-shaped input cannot become a persisted notification body.
- **Commit:** uncommitted (the focused fixer task prohibited commits)

### 9. Claude Stop minimization dropped transcript routing metadata

- **Source:** github-codex-connector | PR #785 focused fixer | 2026-08-06
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/claude_code/bridge.rs`
- **Finding:** Rebuilding every hook record from only the session ID and timestamp removed the Stop hook's transcript path, so the notification watcher could not recover the final assistant message.
- **Fix:** Preserved only a bounded, syntactically valid absolute JSONL path for Stop records, while the existing consumer retains canonical Claude-root validation. Added a script-level regression covering JSON escaping and proving other hook records still omit the path and unrelated payload fields.
- **Commit:** uncommitted (the focused fixer task prohibited commits)
