/**
 * Cycle through a list of identifiable items and return the neighbor
 * `delta` positions away from the active one, wrapping around at both ends.
 * When `activeId` is not present in the list, the cycle starts at the first
 * item (for positive deltas) or the last item (for negative deltas) so the
 * shortcut always lands somewhere sensible.
 *
 * Returns `null` when the list is empty. Caller decides how to surface that
 * (e.g. an info toast); the pure function itself has no UI side effects so
 * it can be shared between the workspace hook and the command builder.
 */
export const cycleSession = <T extends { id: string }>(
  items: T[],
  activeId: string | null,
  delta: number
): T | null => {
  if (items.length === 0) {
    return null
  }

  const index = items.findIndex((item) => item.id === activeId)

  const nextIndex =
    index === -1
      ? delta > 0
        ? 0
        : items.length - 1
      : (((index + delta) % items.length) + items.length) % items.length

  return items[nextIndex]
}
