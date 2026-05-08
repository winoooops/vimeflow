import type { Session } from '../types'

/**
 * Pure helper used by `List.handleActiveReorder` to bubble a full
 * sessions array up to `onReorderSessions` after framer-motion's
 * `Reorder.Group.onReorder` fires with a reordered active subset.
 *
 * Concatenation only — does NOT deduplicate. Correctness across
 * mid-drag status transitions depends on `List` mirroring `recent`
 * synchronously via `recentGroupRef`; see the spec's "Mid-drag
 * transition invariant" subsection.
 */
export const mediateReorder = (
  reorderedActive: Session[],
  recent: Session[]
): Session[] => [...reorderedActive, ...recent]
