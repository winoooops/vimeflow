export type TerminalRendererMode = 'ghostty-wasm' | 'xterm'

export const resolveDefaultTerminalRendererMode = (): TerminalRendererMode => {
  const rawFlag: unknown = import.meta.env.VITE_RENDERER_GHOSTTY_WASM
  const flag = typeof rawFlag === 'string' ? rawFlag.toLowerCase() : undefined

  if (flag === '1' || flag === 'true') {
    return 'ghostty-wasm'
  }

  return 'xterm'
}
