import { globalShortcut, type BrowserWindow } from 'electron'
import { COMMAND_PALETTE_TOGGLE } from './ipc-channels'

interface ShortcutInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift?: boolean
  isAutoRepeat?: boolean
}

interface ShortcutRegistry {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
}

export interface CommandPaletteShortcutOverrideOptions {
  platform?: NodeJS.Platform
  shortcutRegistry?: ShortcutRegistry
}

type CommandPaletteShortcutModifier = 'control' | 'command'

export interface CommandPaletteShortcutConfig {
  modifier: CommandPaletteShortcutModifier
  globalAccelerators: readonly string[]
}

const CONTROL_ACCELERATORS = ['Control+;'] as const

const COMMAND_ACCELERATORS = ['Command+;'] as const

export const commandPaletteShortcutConfigForPlatform = (
  platform: NodeJS.Platform
): CommandPaletteShortcutConfig =>
  platform === 'darwin'
    ? { modifier: 'command', globalAccelerators: COMMAND_ACCELERATORS }
    : { modifier: 'control', globalAccelerators: CONTROL_ACCELERATORS }

export const COMMAND_PALETTE_GLOBAL_ACCELERATORS =
  commandPaletteShortcutConfigForPlatform('linux').globalAccelerators

const SHORTCUT_TOGGLE_DEDUPLICATION_MS = 100

export const isCommandPaletteShortcutInput = (
  input: ShortcutInput,
  config: CommandPaletteShortcutConfig = commandPaletteShortcutConfigForPlatform(
    process.platform
  )
): boolean =>
  input.type === 'keyDown' &&
  (config.modifier === 'command'
    ? input.meta && !input.control
    : input.control && !input.meta) &&
  !input.alt &&
  input.shift !== true &&
  !input.isAutoRepeat &&
  input.key === ';'

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
  const shortcutConfig = commandPaletteShortcutConfigForPlatform(platform)
  const dispatchCommandPaletteToggle = createCommandPaletteToggleDispatcher(win)
  let registeredAccelerators: string[] = []

  const registerFocusedLinuxShortcuts = (): void => {
    if (platform !== 'linux' || registeredAccelerators.length > 0) {
      return
    }

    registeredAccelerators = shortcutConfig.globalAccelerators.filter(
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
    if (!isCommandPaletteShortcutInput(input, shortcutConfig)) {
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
