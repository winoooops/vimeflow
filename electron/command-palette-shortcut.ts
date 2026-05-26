import { globalShortcut, type BrowserWindow } from 'electron'
import { COMMAND_PALETTE_TOGGLE } from './ipc-channels'

interface ShortcutInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
}

interface ShortcutRegistry {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
}

export interface CommandPaletteShortcutOverrideOptions {
  platform?: NodeJS.Platform
  shortcutRegistry?: ShortcutRegistry
}

export const COMMAND_PALETTE_GLOBAL_ACCELERATORS = [
  'Control+:',
  'Control+Shift+;',
  'Control+;',
] as const

const SHORTCUT_TOGGLE_DEDUPLICATION_MS = 100

export const isCommandPaletteShortcutInput = (input: ShortcutInput): boolean =>
  input.type === 'keyDown' &&
  input.control &&
  !input.meta &&
  !input.alt &&
  input.key === ':'

const sendCommandPaletteToggle = (win: BrowserWindow): void => {
  if (win.isDestroyed()) {
    return
  }

  win.webContents.send(COMMAND_PALETTE_TOGGLE)
}

const createCommandPaletteToggleDispatcher = (
  win: BrowserWindow
): (() => void) => {
  let lastToggleAt = Number.NEGATIVE_INFINITY

  return (): void => {
    const now = Date.now()

    if (now - lastToggleAt < SHORTCUT_TOGGLE_DEDUPLICATION_MS) {
      return
    }

    lastToggleAt = now
    sendCommandPaletteToggle(win)
  }
}

export const installCommandPaletteShortcutOverride = (
  win: BrowserWindow,
  options: CommandPaletteShortcutOverrideOptions = {}
): void => {
  const platform = options.platform ?? process.platform
  const shortcutRegistry = options.shortcutRegistry ?? globalShortcut
  const dispatchCommandPaletteToggle = createCommandPaletteToggleDispatcher(win)
  let registeredAccelerators: string[] = []

  const registerFocusedLinuxShortcuts = (): void => {
    if (platform !== 'linux' || registeredAccelerators.length > 0) {
      return
    }

    registeredAccelerators = COMMAND_PALETTE_GLOBAL_ACCELERATORS.filter(
      (accelerator) =>
        shortcutRegistry.register(accelerator, dispatchCommandPaletteToggle)
    )
  }

  const unregisterFocusedLinuxShortcuts = (): void => {
    if (registeredAccelerators.length === 0) {
      return
    }

    registeredAccelerators.forEach((accelerator) => {
      shortcutRegistry.unregister(accelerator)
    })
    registeredAccelerators = []
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (!isCommandPaletteShortcutInput(input)) {
      return
    }

    event.preventDefault()
    dispatchCommandPaletteToggle()
  })

  win.on('focus', registerFocusedLinuxShortcuts)
  win.on('blur', unregisterFocusedLinuxShortcuts)
  win.on('closed', unregisterFocusedLinuxShortcuts)

  if (win.isFocused()) {
    registerFocusedLinuxShortcuts()
  }
}
