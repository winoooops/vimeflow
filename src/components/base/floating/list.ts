// Ring-1 re-export of @floating-ui/react's DOM-ordered list primitives, mirroring
// useFloatingSurface/SurfacePanel: only base/floating may import @floating-ui, so
// Menu composes FloatingList + useListItem from here. FloatingList sorts rows by
// document position and hands each useListItem its live DOM index, so menus whose
// item set changes while open stay correctly indexed (no stale counter).
export { FloatingList, useListItem, useMergeRefs } from '@floating-ui/react'
