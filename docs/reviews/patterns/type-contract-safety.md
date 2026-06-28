---
id: type-contract-safety
category: code-quality
created: 2026-06-15
last_updated: 2026-06-28
ref_count: 7
---

# Type Contract Safety

## Summary

Use the type system to make invalid API states unrepresentable. When a field is
load-bearing for only one variant of a union, encode that requirement in a
discriminated union so callers get a compile-time error instead of a silent
runtime no-op. Optional fields that are harmless for some cases but required for
others train callers to omit them and create latent bugs that only surface in
future consumers.

Equality helpers that decide whether a stored descriptor needs to be updated
must also treat every load-bearing field as significant — especially fields
whose type is currently a singleton union. Omitting such a field because it
has only one value today creates a stale-state trap the moment the union
expands.

## Findings

### 1. `OverlayDescriptor` allows `nativeOcclusion: 'intersects'` without `getRect`

- **Source:** github-claude | PR #467 round 3 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/overlays/OverlayStackProvider.tsx`
- **Finding:** `OverlayDescriptor.getRect` was optional for every `NativeOcclusionPolicy`. When `nativeOcclusion === 'intersects'`, `overlayOccludesNativeSurface` evaluated `rectsIntersect(overlay.getRect?.() ?? null, surface.getRect())`, which always returned `false` if `getRect` was omitted. A future consumer calling `registerOverlayDescriptor` directly with an `'intersects'` descriptor would silently get no native occlusion.
- **Fix:** Changed `OverlayDescriptor` from a single interface with an optional `getRect` into a discriminated union where `'intersects'` requires `getRect` and `'none'` / `'global'` keep it optional. Updated `useOverlayRegistration` to preserve the union when forwarding descriptors to the provider.
- **Commit:** \_(this commit)

### 2. `areNativeSurfaceDescriptorsEqual` omits the `owner` field

- **Source:** github-claude | PR #467 round 4 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/overlays/OverlayStackProvider.tsx`
- **Finding:** `areNativeSurfaceDescriptorsEqual` compared `id`, `belowPlane`, and `getRect` but not `owner`. Because `NativeSurfaceOwner` is currently a singleton (`'browser-pane'`), the omission has no visible effect today. Once a second owner is added, a re-registered surface whose `owner` changes while its other fields stay the same would be treated as unchanged, leaving stale owner metadata in `nativeSurfaces`.
- **Fix:** Added `left.owner === right.owner` to `areNativeSurfaceDescriptorsEqual`, with the same `eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` suppression already used for the singleton owner comparison in `useNativeSurface.ts`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)\_

### 3. useOverlayRegistration proxy: `as OverlayDescriptor` silences union safety

- **Source:** github-claude | PR #474 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/workspace/overlays/useOverlayRegistration.ts`
- **Finding:** The proxy object in `useLayoutEffect` is cast to `OverlayDescriptor` via `as` (line 27) rather than satisfying the discriminated union. Because `get nativeOcclusion()` reads `latestDescriptorRef.current.nativeOcclusion` live, the runtime variant can shift from `'none'`/`'global'` to `'intersects'` without re-running the effect (only `id` and `plane` changes trigger a re-run). When that shift occurs, `overlayOccludesNativeSurface` branches into `rectsIntersect` but `overlay.getRect()` returns `null` (the proxy calls `latestDescriptorRef.current.getRect?.() ?? null`), so the overlay silently fails to occlude. Fix: include `nativeOcclusion` in the effect deps so re-registration fires on variant changes, or close over it in the proxy to hold it stable.
- **Fix:** Added nativeOcclusion to the useLayoutEffect dependency array so the proxy re-registers when the occlusion variant changes.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Duplicate `PersistedBrowserPane` interface declarations silently merge

- **Source:** github-claude | PR #531 round 1 | 2026-06-18
- **Severity:** HIGH
- **File:** `electron/workspace-layout-types.ts`
- **Finding:** The shape-only DTO pane interface was renamed to `PersistedBrowserPane`, but a `PersistedBrowserPane` store pane interface already existed in the same file. TypeScript merges the two declarations, so the merged type requires `tabs: PersistedTab[]` even for the shape-only DTO. This erased the distinction between the persisted store pane type and the shape-only DTO type, causing `tsc` errors wherever a browser shape was constructed without tabs.
- **Fix:** Renamed the shape-only interfaces to `PersistedShellPaneShape` and `PersistedBrowserPaneShape`, then updated `PersistedWorkspacePaneShape` to reference the new names so it no longer merges with the store-side types.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Renderer bridge shape-only pane types share names with electron store-side types

- **Source:** github-claude | PR #531 round 2 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/sessions/workspaceLayoutBridge.ts`
- **Finding:** The renderer-side bridge exported `PersistedShellPane`, `PersistedBrowserPane`, and `PersistedWorkspacePane` as the shape-only DTO types. In `electron/workspace-layout-types.ts` those same identifiers belonged to the full persisted-store types (where `PersistedBrowserPane` carries `tabs: PersistedTab[]`). The structural mismatch made the two definitions of `PersistedBrowserPane` incompatible across the IPC boundary, and a future developer adding resume/reopen fields would have to update both files in lockstep without a clear naming signal.
- **Fix:** Renamed the renderer bridge's shape-only pane leaf types to `PersistedShellPaneShape`, `PersistedBrowserPaneShape`, and `PersistedWorkspacePaneShape` to match the electron-side shape-only naming convention, then updated the three consumer files (`useSessionRestore.ts`, `groupSessionsFromInfos.ts`, `usePushWorkspaceGrouping.ts`) and the co-located test fixture to import the new names.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Shape-only browser pane type not distinct from full persisted pane type

- **Source:** github-codex-connector | PR #531 round 2 | 2026-06-18
- **Severity:** P1 / HIGH
- **File:** `electron/workspace-layout-types.ts`
- **Finding:** The shape-only DTO browser pane was named `PersistedBrowserPane`, identical to the full persisted-store pane type that includes `tabs: PersistedTab[]`. TypeScript declaration merging meant `PersistedWorkspacePaneShape` required `tabs` even though shape DTOs intentionally strip browser tab/history, breaking `paneToShape` and round-trip test fixtures that construct browser shapes without tabs.
- **Fix:** Same rename as finding 5: the renderer bridge's browser shape type is now `PersistedBrowserPaneShape`, so the shape-only DTO and the full persisted-store type are distinct identifiers and no longer merge.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. `PersistedPaneLayoutDefinition` uses `Record<string, unknown>`

- **Source:** github-human | PR #542 round 2 | 2026-06-19
- **Severity:** HUMAN
- **File:** `electron/workspace-layout-types.ts` L46
- **Finding:** `PersistedPaneLayoutDefinition` was declared as `Record<string, unknown>`, which erased the concrete shape of persisted custom pane layouts. The loose type made it easy to pass malformed data across the Electron persistence boundary without compile-time feedback.
- **Fix:** Replaced the `Record<string, unknown>` alias with a concrete `PersistedPaneLayoutDefinition` interface and supporting `PersistedTrackSpec`, `PersistedPaneSlotRect`, and `PersistedPaneSlotSpec` types that mirror the renderer-side `PaneLayoutDefinition` shape using plain strings for the persisted boundary.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. `Menu.closeSignal` accepts reference-unstable sentinels

- **Source:** github-claude | PR #569 round 5 | 2026-06-20
- **Severity:** LOW
- **File:** `src/components/Menu.tsx` L276
- **Finding:** `closeSignal?: unknown` allowed callers to pass object or array values even though the close effect compares the value by strict equality. Reference-unstable values could close the menu on every render or fail to communicate the intended numeric counter semantics.
- **Fix:** Narrowed the public prop to `number | undefined`, matching the only supported usage pattern: incrementing a primitive counter when a consumer needs to request a close.
- **Commit:** same commit as this entry

### 9. Generic IPC payload guard returned implicit undefined for future variants

- **Source:** github-claude | PR #630 round 1 | 2026-06-28
- **Severity:** LOW
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** `isNativePayload` covered every current Ghostty payload kind but had no default arm. If a new kind were added without updating the guard and `noImplicitReturns` did not catch it, the runtime path would return `undefined` and reject otherwise valid payloads with a misleading invalid-payload error.
- **Fix:** Added an explicit `default: return false` branch so unknown or future kinds fail closed at runtime.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. Shared Ghostty string guard conflated identity and cwd semantics

- **Source:** github-claude | PR #630 round 5 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-shared.ts`
- **Finding:** The shared `isString` guard rejected empty strings and was reused for both identity fields and `cwd` in native Ghostty IPC update payloads. A valid startup update with `cwd: ''` could be rejected, causing the renderer to mark native Ghostty unavailable and fall back to xterm for that pane.
- **Fix:** Split the guard into plain `isString` for path-like fields and `isNonEmptyString` for `sessionId`/`paneId`, then updated both helper and parent payload validators with regression coverage for empty cwd.
- **Commit:** same commit as this entry

### 11. Replay summary recent-call status cast trusted a backend invariant without a runtime guard

- **Source:** github-claude | PR #630 round 6 | 2026-06-28
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** Replay-summary recent tool calls narrowed the generated
  `AgentToolCallEvent.status` union with `as 'done' | 'failed'`. If the backend
  accidentally emitted a `running` entry, the renderer would construct an invalid
  `RecentToolCall` state object with no warning or fallback.
- **Fix:** Replace the unchecked cast with a small runtime normalizer that maps failed
  to failed and all other replay-summary statuses to done, with regression coverage
  for a malformed running entry.
- **Commit:** same commit as this entry

### 12. Native Ghostty bridge singleton ignored mismatched dylib paths

- **Source:** github-claude | PR #630 round 6 | 2026-06-28
- **Severity:** LOW
- **File:** `native/ghostty-parent/ghostty_native_parent.cc`
- **Finding:** `EnsureBridge` cached the first loaded dylib handle but returned success
  for all later calls regardless of the requested path. A dev hot-reload or build
  artifact refresh could pass a new path while the addon silently kept using the old
  bridge functions.
- **Fix:** Store the loaded dylib path beside the handle and throw if a later request
  asks for a different path, preserving the singleton while making the API contract
  explicit.
- **Commit:** same commit as this entry

### 13. Preload exposed optional native IPC handlers when the main process had not registered them

- **Source:** github-claude | PR #630 round 7 | 2026-06-28
- **Severity:** LOW
- **File:** `electron/preload.ts`
- **Finding:** `window.vimeflow.ghosttyNative` was exposed unconditionally even
  though the main process registers the native Ghostty IPC handlers only when a
  native Ghostty feature flag is enabled. Current callers were guarded, but the
  bridge contract allowed future callers to discover an API that could only
  reject with a generic "No handler registered" IPC error.
- **Fix:** Build the optional `ghosttyNative` preload bridge only when either
  `VITE_GHOSTTY_NATIVE_MACOS` or `VITE_GHOSTTY_NATIVE_MACOS_PARENT` is enabled,
  matching the main-process registration guard.
- **Commit:** same commit as this entry
