const retainedAgentWatcherPtyIds = new Set<string>()

export const retainAgentWatcher = (ptyId: string): void => {
  retainedAgentWatcherPtyIds.add(ptyId)
}

export const releaseAgentWatcher = (ptyId: string): void => {
  retainedAgentWatcherPtyIds.delete(ptyId)
}

export const isAgentWatcherRetained = (ptyId: string): boolean =>
  retainedAgentWatcherPtyIds.has(ptyId)
