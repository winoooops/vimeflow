---
id: type-contract-safety
category: code-quality
created: 2026-06-15
last_updated: 2026-06-18
ref_count: 2
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
