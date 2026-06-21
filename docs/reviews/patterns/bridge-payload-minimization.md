---
id: bridge-payload-minimization
category: security
created: 2026-06-20
last_updated: 2026-06-21
ref_count: 1
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
