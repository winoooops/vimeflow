---
id: ipc-sender-validation
category: security
created: 2026-06-30
last_updated: 2026-06-30
ref_count: 1
---

# IPC Sender Validation

## Summary

Electron IPC handlers that mutate window-owned state must authorize the sender, not just validate payload shape. Renderer-generated identifiers are observable and often low entropy, so a handler that accepts any renderer with a plausible id lets unrelated windows affect another window's resources. Validate that the sender is the owning `webContents`, an explicitly allowed companion surface, or another documented caller before performing the mutation.

## Findings

### 1. Native overlay close accepted requests from unrelated renderers

- **Source:** github-claude | PR #635 round 1 | 2026-06-30
- **Severity:** MEDIUM
- **File:** `electron/native-overlay.ts`
- **Finding:** `handleReady` and `handleAction` verified that IPC came from the overlay `BrowserWindow`, but `handleClose` accepted any renderer that supplied a valid `surfaceId`. Because surface ids are renderer-generated tokens, an unrelated renderer with the preload could dismiss another window's active overlay.
- **Fix:** Added `surfaceFromCloseSender`, allowing close requests only from the owning renderer or the overlay host `webContents`. A short comment documents the intentional dual-caller design, and tests cover both owner close and unrelated-renderer rejection.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
