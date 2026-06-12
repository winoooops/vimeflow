export const shouldQuitOnAllWindowsClosed = (
  onLastWindowClosed: string,
  platform: NodeJS.Platform
): boolean => {
  if (onLastWindowClosed === 'quit') {
    return true
  }

  return platform !== 'darwin'
}
