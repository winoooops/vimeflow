const refs = new Map<string, HTMLElement>()

export const register = (ptyId: string, el: HTMLElement): void => {
  refs.set(ptyId, el)
}

export const unregister = (ptyId: string): void => {
  refs.delete(ptyId)
}

export const get = (ptyId: string): HTMLElement | undefined => refs.get(ptyId)
