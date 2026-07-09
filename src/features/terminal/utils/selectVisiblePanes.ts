import type { Pane } from '../../sessions/types'

/** Pick the panes that should be rendered for `capacity` slots.
 *  Normally the prefix slice; if the active pane is beyond the slice,
 *  the active pane replaces the last visible slot so focus/agent/cwd
 *  signals stay reachable from the UI. This is a valid runtime state
 *  when a user switches from a larger layout to a smaller one. Exported
 *  for unit testing and for directional-shortcut resolution. */
export const selectVisiblePanes = (
  panes: readonly Pane[],
  capacity: number
): Pane[] => {
  const sliced = panes.slice(0, capacity)
  const activeIdx = panes.findIndex((p) => p.active)
  if (activeIdx >= capacity) {
    return [...sliced.slice(0, capacity - 1), panes[activeIdx]]
  }

  return sliced
}
