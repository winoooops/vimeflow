type ChordHandler = (event: KeyboardEvent) => boolean

const handlers = new Map<string, ChordHandler>()

export const registerChord = (key: string, fn: ChordHandler): (() => void) => {
  handlers.set(key, fn)

  return () => {
    if (handlers.get(key) === fn) {
      handlers.delete(key)
    }
  }
}

export const dispatch = (event: KeyboardEvent): boolean => {
  const handler = handlers.get(event.key)

  return handler ? handler(event) : false
}

export const _resetForTest = (): void => {
  handlers.clear()
}
