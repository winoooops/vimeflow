/**
 * Maps workspace session IDs to PTY session metadata.
 *
 * The workspace (useSessionManager) assigns its own IDs (e.g., "sess-1")
 * while the PTY service generates separate UUIDs on spawn. This module
 * bridges the two so features like agent detection can look up the PTY
 * session ID and status file path from a workspace session ID.
 */

interface PtySessionInfo {
  ptySessionId: string
  cwd: string
}

const ptySessionMap = new Map<string, PtySessionInfo>()

/** Register a workspace → PTY session mapping */
export const registerPtySession = (
  workspaceSessionId: string,
  ptySessionId: string,
  cwd: string
): void => {
  ptySessionMap.set(workspaceSessionId, { ptySessionId, cwd })
}

/** Unregister a mapping when a session is disposed */
export const unregisterPtySession = (workspaceSessionId: string): void => {
  ptySessionMap.delete(workspaceSessionId)
}

/** Look up the PTY session ID for a workspace session */
export const getPtySessionId = (
  workspaceSessionId: string
): string | undefined => ptySessionMap.get(workspaceSessionId)?.ptySessionId

/** Clear all mappings (for testing) */
export const clearPtySessionMap = (): void => {
  ptySessionMap.clear()
}

/** List all registered PTY session IDs (E2E bridge only) */
export const getAllPtySessionIds = (): string[] =>
  Array.from(ptySessionMap.values()).map((v) => v.ptySessionId)
