import type { WTerm } from '@wterm/dom'
import type { TerminalTheme } from '../../types'
import type { TerminalIo } from '../../hooks/useTerminal'
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  loadTerminalFonts,
} from './terminalFont'

export type WtermGhosttyTerminal = TerminalIo & {
  focus: () => void
  destroy: () => void
}

interface CreateWtermGhosttyTerminalOptions {
  element: HTMLElement
  cols: number
  rows: number
  theme: TerminalTheme
  onResize: (cols: number, rows: number) => void
}

const applyTheme = (element: HTMLElement, theme: TerminalTheme): void => {
  element.style.setProperty('--term-fg', theme.foreground)
  element.style.setProperty('--term-bg', theme.background)
  element.style.setProperty('--term-cursor', theme.cursor)
  element.style.setProperty('--term-color-0', theme.black)
  element.style.setProperty('--term-color-1', theme.red)
  element.style.setProperty('--term-color-2', theme.green)
  element.style.setProperty('--term-color-3', theme.yellow)
  element.style.setProperty('--term-color-4', theme.blue)
  element.style.setProperty('--term-color-5', theme.magenta)
  element.style.setProperty('--term-color-6', theme.cyan)
  element.style.setProperty('--term-color-7', theme.white)
  element.style.setProperty('--term-color-8', theme.brightBlack)
  element.style.setProperty('--term-color-9', theme.brightRed)
  element.style.setProperty('--term-color-10', theme.brightGreen)
  element.style.setProperty('--term-color-11', theme.brightYellow)
  element.style.setProperty('--term-color-12', theme.brightBlue)
  element.style.setProperty('--term-color-13', theme.brightMagenta)
  element.style.setProperty('--term-color-14', theme.brightCyan)
  element.style.setProperty('--term-color-15', theme.brightWhite)
  element.style.setProperty('--term-font-family', TERMINAL_FONT_FAMILY)
  element.style.setProperty('--term-font-size', `${TERMINAL_FONT_SIZE}px`)
}

export const createWtermGhosttyTerminal = async ({
  element,
  cols,
  rows,
  theme,
  onResize,
}: CreateWtermGhosttyTerminalOptions): Promise<WtermGhosttyTerminal> => {
  const fontsLoaded = loadTerminalFonts()
  if (fontsLoaded) {
    try {
      await fontsLoaded
    } catch {
      // Use the available fallback font stack.
    }
  }

  const [{ WTerm }, { GhosttyCore }] = await Promise.all([
    import('@wterm/dom'),
    import('@wterm/ghostty'),
  ])

  applyTheme(element, theme)

  const inputCallbacks = new Set<(data: string) => void>()
  let terminal: WTerm | null = new WTerm(element, {
    core: await GhosttyCore.load({ scrollbackLimit: 10000 }),
    cols,
    rows,
    autoResize: true,
    cursorBlink: true,
    onData: (data): void => {
      inputCallbacks.forEach((callback) => callback(data))
    },
    onResize,
  })

  await terminal.init()

  return {
    get cols(): number {
      return terminal?.cols ?? cols
    },
    get rows(): number {
      return terminal?.rows ?? rows
    },
    clear: (): void => {
      terminal?.write('\x1b[2J\x1b[H')
    },
    write: (data, callback): void => {
      if (!terminal) {
        return
      }

      terminal.write(data)
      queueMicrotask(() => callback?.())
    },
    onData: (callback): { dispose: () => void } => {
      inputCallbacks.add(callback)

      return {
        dispose: (): void => {
          inputCallbacks.delete(callback)
        },
      }
    },
    focus: (): void => {
      terminal?.focus()
    },
    destroy: (): void => {
      inputCallbacks.clear()
      terminal?.destroy()
      terminal = null
    },
  }
}
