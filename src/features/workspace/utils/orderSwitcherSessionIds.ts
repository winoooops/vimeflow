// MRU reorders only on committed activation, while the active id flips
// optimistically; hoisting the active id keeps a quick second tap bouncing
// back even when it beats the first activation's IPC settlement.
export const orderSwitcherSessionIds = (
  mruSessionIds: readonly string[],
  switchableIds: readonly string[],
  activeSessionId: string | null
): string[] => {
  const switchable = new Set(switchableIds)
  const inMru = mruSessionIds.filter((id) => switchable.has(id))
  const missing = switchableIds.filter((id) => !inMru.includes(id))
  const merged = [...inMru, ...missing]

  if (activeSessionId === null || !switchable.has(activeSessionId)) {
    return merged
  }

  return [activeSessionId, ...merged.filter((id) => id !== activeSessionId)]
}
