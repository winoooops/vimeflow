---
id: type-contract-safety
category: code-quality
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 0
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
- **Commit:** _(this commit)

### 2. `areNativeSurfaceDescriptorsEqual` omits the `owner` field

- **Source:** github-claude | PR #467 round 4 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/overlays/OverlayStackProvider.tsx`
- **Finding:** `areNativeSurfaceDescriptorsEqual` compared `id`, `belowPlane`, and `getRect` but not `owner`. Because `NativeSurfaceOwner` is currently a singleton (`'browser-pane'`), the omission has no visible effect today. Once a second owner is added, a re-registered surface whose `owner` changes while its other fields stay the same would be treated as unchanged, leaving stale owner metadata in `nativeSurfaces`.
- **Fix:** Added `left.owner === right.owner` to `areNativeSurfaceDescriptorsEqual`, with the same `eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` suppression already used for the singleton owner comparison in `useNativeSurface.ts`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)_
