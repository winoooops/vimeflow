export const isExpectedNonAgentRenameFailure = (message: string): boolean =>
  message.includes('no live agent') ||
  message.includes('does not support /rename')
