export type TerminalRendererMode = 'ghostty-wasm' | 'xterm'

export const resolveDefaultTerminalRendererMode = (): TerminalRendererMode => {
  const rawFlag: unknown = import.meta.env.VITE_RENDERER_GHOSTTY_WASM
  const flag = typeof rawFlag === 'string' ? rawFlag.toLowerCase() : undefined

  if (flag === '0' || flag === 'false') {
    return 'xterm'
  }

  if (import.meta.env.MODE === 'test') {
    return 'xterm'
  }

  return 'ghostty-wasm'
}
