/**
 * Coordinates final state saves before renderer-owned workspaces are torn down.
 *
 * Features register an asynchronous save function here. The workspace shutdown
 * path runs every registered function and waits for all of them, giving debounced
 * edits time to reach disk before the backend records the final workspace shape.
 */

export type RendererTeardownFlush = () => Promise<void>

const flushes = new Set<RendererTeardownFlush>()

export const registerRendererTeardownFlush = (
  flush: RendererTeardownFlush
): (() => void) => {
  flushes.add(flush)

  return (): void => {
    flushes.delete(flush)
  }
}

export const flushRendererTeardownState = async (): Promise<void> => {
  await Promise.all([...flushes].map(async (flush) => flush()))
}
