// Thin wrapper over the Electron folder-picker bridge. Returns null in
// non-Electron dev (no window.vimeflow.dialog), so callers no-op gracefully.
export const pickDirectory = async (): Promise<string | null> =>
  (await window.vimeflow?.dialog?.pickDirectory()) ?? null
