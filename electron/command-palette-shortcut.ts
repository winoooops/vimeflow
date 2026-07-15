// cspell:ignore Capslock Numlock Scrolllock numdec numadd numsub nummult numdiv
import { globalShortcut, type BrowserWindow } from 'electron'
import { COMMAND_PALETTE_TOGGLE } from './ipc-channels'

export interface CommandPaletteShortcutInput {
  type: string
  key: string
  code?: string
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

export type CommandPaletteShortcutSource = 'palette' | 'leader'

export interface CommandPaletteShortcutBindings {
  palette: string
  leader: string
}

export interface CommandPaletteShortcutConfig {
  modifier: CommandPaletteShortcutModifier
  code: string
  key: string
  alt: boolean
  shift: boolean
  globalAccelerators: readonly string[]
}

export interface CommandPaletteShortcutBindingsConfig {
  palette: CommandPaletteShortcutConfig
  leader: CommandPaletteShortcutConfig
}

interface CommandPaletteShortcutController {
  setBinding: (binding: string) => void
  setBindings: (bindings: CommandPaletteShortcutBindings) => void
  config: () => CommandPaletteShortcutBindingsConfig
}

type KeybindingMod = 'Mod' | 'Ctrl' | 'Alt' | 'Shift'

const KEYBINDING_MODS: ReadonlySet<string> = new Set([
  'Mod',
  'Ctrl',
  'Alt',
  'Shift',
])

const DEFAULT_COMMAND_PALETTE_CODE = 'Semicolon'

const CODE_TO_ACCELERATOR_KEY: ReadonlyMap<string, string> = new Map([
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Backquote', '`'],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Quote', "'"],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['Enter', 'Enter'],
  ['Escape', 'Escape'],
  ['Tab', 'Tab'],
  ['Space', 'Space'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Insert', 'Insert'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PageUp'],
  ['PageDown', 'PageDown'],
  ['CapsLock', 'Capslock'],
  ['NumLock', 'Numlock'],
  ['ScrollLock', 'Scrolllock'],
  ['PrintScreen', 'PrintScreen'],
  ['VolumeUp', 'VolumeUp'],
  ['VolumeDown', 'VolumeDown'],
  ['VolumeMute', 'VolumeMute'],
  ['MediaTrackNext', 'MediaNextTrack'],
  ['MediaTrackPrevious', 'MediaPreviousTrack'],
  ['MediaStop', 'MediaStop'],
  ['MediaPlayPause', 'MediaPlayPause'],
  ['NumpadDecimal', 'numdec'],
  ['NumpadAdd', 'numadd'],
  ['NumpadSubtract', 'numsub'],
  ['NumpadMultiply', 'nummult'],
  ['NumpadDivide', 'numdiv'],
])

const codeToAcceleratorKey = (code: string): string | null => {
  const mapped = CODE_TO_ACCELERATOR_KEY.get(code)
  if (mapped !== undefined) {
    return mapped
  }

  const digit = /^Digit(\d)$/.exec(code)
  if (digit !== null) {
    return digit[1]
  }

  const letter = /^Key([A-Z])$/.exec(code)
  if (letter !== null) {
    return letter[1]
  }

  const functionKey = /^F([1-9]|1\d|2[0-4])$/.exec(code)
  if (functionKey !== null) {
    return code
  }

  const numpadDigit = /^Numpad(\d)$/.exec(code)
  if (numpadDigit !== null) {
    return `num${numpadDigit[1]}`
  }

  return null
}

const codeToInputFallbackKey = (code: string): string =>
  codeToAcceleratorKey(code) ?? code

const parseKeybindingToken = (
  binding: string
): { code: string; mods: ReadonlySet<KeybindingMod> } | null => {
  const parts = binding.split('+')
  const code = parts.pop()

  if (code === undefined || code.length === 0) {
    return null
  }

  const mods = new Set<KeybindingMod>()
  for (const part of parts) {
    if (!KEYBINDING_MODS.has(part) || mods.has(part as KeybindingMod)) {
      return null
    }

    mods.add(part as KeybindingMod)
  }

  if (mods.has('Mod') === mods.has('Ctrl')) {
    return null
  }

  return { code, mods }
}

const acceleratorForConfig = (
  config: Omit<CommandPaletteShortcutConfig, 'globalAccelerators'>
): string | null => {
  const key = codeToAcceleratorKey(config.code)
  if (key === null) {
    return null
  }

  const parts = [
    config.modifier === 'command' ? 'Command' : 'Control',
    config.alt ? 'Alt' : null,
    config.shift ? 'Shift' : null,
    key,
  ].filter((part): part is string => part !== null)

  return parts.join('+')
}

const buildShortcutConfig = (
  platform: NodeJS.Platform,
  code: string,
  mods: ReadonlySet<KeybindingMod>
): CommandPaletteShortcutConfig => {
  const configWithoutAccelerators = {
    modifier: mods.has('Ctrl')
      ? 'control'
      : platform === 'darwin'
        ? 'command'
        : 'control',
    code,
    key: codeToInputFallbackKey(code),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
  } satisfies Omit<CommandPaletteShortcutConfig, 'globalAccelerators'>

  const accelerator = acceleratorForConfig(configWithoutAccelerators)

  return {
    ...configWithoutAccelerators,
    globalAccelerators: accelerator === null ? [] : [accelerator],
  }
}

export const commandPaletteShortcutConfigForPlatform = (
  platform: NodeJS.Platform,
  binding = 'Mod+Semicolon'
): CommandPaletteShortcutConfig => {
  const parsed = parseKeybindingToken(binding)

  if (parsed !== null) {
    const custom = buildShortcutConfig(platform, parsed.code, parsed.mods)

    return custom
  }

  return buildShortcutConfig(
    platform,
    DEFAULT_COMMAND_PALETTE_CODE,
    new Set(['Mod'])
  )
}

export const commandPaletteShortcutBindingsConfigForPlatform = (
  platform: NodeJS.Platform,
  bindings: CommandPaletteShortcutBindings = {
    palette: 'Mod+Semicolon',
    leader: 'Mod+Semicolon',
  }
): CommandPaletteShortcutBindingsConfig => ({
  palette: commandPaletteShortcutConfigForPlatform(platform, bindings.palette),
  leader: commandPaletteShortcutConfigForPlatform(platform, bindings.leader),
})

const acceleratorEntriesForConfig = (
  config: CommandPaletteShortcutBindingsConfig
): { source: CommandPaletteShortcutSource; accelerator: string }[] => {
  const entries = [
    ...config.leader.globalAccelerators.map((accelerator) => ({
      source: 'leader' as const,
      accelerator,
    })),
    ...config.palette.globalAccelerators.map((accelerator) => ({
      source: 'palette' as const,
      accelerator,
    })),
  ]
  const seen = new Set<string>()

  return entries.filter(({ accelerator }) => {
    if (seen.has(accelerator)) {
      return false
    }

    seen.add(accelerator)

    return true
  })
}

export const COMMAND_PALETTE_GLOBAL_ACCELERATORS = acceleratorEntriesForConfig(
  commandPaletteShortcutBindingsConfigForPlatform('linux')
).map(({ accelerator }) => accelerator)

const SHORTCUT_TOGGLE_DEDUPLICATION_MS = 100

export const isCommandPaletteShortcutInput = (
  input: CommandPaletteShortcutInput,
  config: CommandPaletteShortcutConfig = commandPaletteShortcutConfigForPlatform(
    process.platform
  )
): boolean =>
  input.type === 'keyDown' &&
  (config.modifier === 'command'
    ? input.meta && !input.control
    : input.control && !input.meta) &&
  input.alt === config.alt &&
  (input.shift === true) === config.shift &&
  !input.isAutoRepeat &&
  (input.code !== undefined
    ? input.code === config.code
    : input.key === config.key)

export const commandPaletteShortcutSourceForInput = (
  input: CommandPaletteShortcutInput,
  config: CommandPaletteShortcutBindingsConfig = commandPaletteShortcutBindingsConfigForPlatform(
    process.platform
  )
): CommandPaletteShortcutSource | null => {
  if (isCommandPaletteShortcutInput(input, config.leader)) {
    return 'leader'
  }

  if (isCommandPaletteShortcutInput(input, config.palette)) {
    return 'palette'
  }

  return null
}

const sendCommandPaletteToggle = (
  win: BrowserWindow,
  source: CommandPaletteShortcutSource
): void => {
  if (win.isDestroyed()) {
    return
  }

  win.webContents.send(COMMAND_PALETTE_TOGGLE, source)
}

const inputForShortcutConfig = (
  config: CommandPaletteShortcutConfig
): CommandPaletteShortcutInput => ({
  type: 'keyDown',
  key: config.key,
  code: config.code,
  control: config.modifier === 'control',
  meta: config.modifier === 'command',
  alt: config.alt,
  shift: config.shift,
})

const commandPaletteToggleDispatchers = new WeakMap<
  BrowserWindow,
  (source?: CommandPaletteShortcutSource) => void
>()
const captureActiveByWindow = new WeakMap<BrowserWindow, boolean>()

const commandPaletteShortcutControllers = new WeakMap<
  BrowserWindow,
  CommandPaletteShortcutController
>()

export const setKeymapCaptureActive = (
  win: BrowserWindow,
  active: boolean
): void => {
  captureActiveByWindow.set(win, active)
}

export const isKeymapCaptureActive = (win: BrowserWindow): boolean =>
  captureActiveByWindow.get(win) === true

const createCommandPaletteToggleDispatcher = (
  win: BrowserWindow
): ((source?: CommandPaletteShortcutSource) => void) => {
  let lastToggleAt = Number.NEGATIVE_INFINITY

  return (source = 'leader'): void => {
    const now = Date.now()

    if (now - lastToggleAt < SHORTCUT_TOGGLE_DEDUPLICATION_MS) {
      return
    }

    lastToggleAt = now
    sendCommandPaletteToggle(win, source)
  }
}

export const commandPaletteToggleDispatcherForWindow = (
  win: BrowserWindow
): ((source?: CommandPaletteShortcutSource) => void) => {
  const existing = commandPaletteToggleDispatchers.get(win)
  if (existing) {
    return existing
  }

  const dispatcher = createCommandPaletteToggleDispatcher(win)
  commandPaletteToggleDispatchers.set(win, dispatcher)

  return dispatcher
}

export const commandPaletteShortcutConfigForWindow = (
  win: BrowserWindow,
  source: CommandPaletteShortcutSource = 'leader'
): CommandPaletteShortcutConfig =>
  (commandPaletteShortcutControllers.get(win)?.config() ??
    commandPaletteShortcutBindingsConfigForPlatform(process.platform))[source]

export const commandPaletteShortcutBindingsConfigForWindow = (
  win: BrowserWindow
): CommandPaletteShortcutBindingsConfig =>
  commandPaletteShortcutControllers.get(win)?.config() ??
  commandPaletteShortcutBindingsConfigForPlatform(process.platform)

export const setCommandPaletteShortcutBinding = (
  win: BrowserWindow,
  binding: string
): void => {
  commandPaletteShortcutControllers.get(win)?.setBinding(binding)
}

export const setCommandPaletteShortcutBindings = (
  win: BrowserWindow,
  bindings: CommandPaletteShortcutBindings
): void => {
  commandPaletteShortcutControllers.get(win)?.setBindings(bindings)
}

export const dispatchCommandPaletteShortcutForWindow = (
  win: BrowserWindow,
  input: CommandPaletteShortcutInput,
  config: CommandPaletteShortcutBindingsConfig = commandPaletteShortcutBindingsConfigForWindow(
    win
  )
): boolean => {
  const source = commandPaletteShortcutSourceForInput(input, config)

  if (source === null || captureActiveByWindow.get(win)) {
    return false
  }

  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.focus()
    commandPaletteToggleDispatcherForWindow(win)(source)
  }

  return true
}

export const installCommandPaletteShortcutOverride = (
  win: BrowserWindow,
  options: CommandPaletteShortcutOverrideOptions = {}
): void => {
  const platform = options.platform ?? process.platform
  const shortcutRegistry = options.shortcutRegistry ?? globalShortcut
  let shortcutConfig = commandPaletteShortcutBindingsConfigForPlatform(platform)

  let registeredAccelerators: string[] = []

  const registerFocusedLinuxShortcuts = (): void => {
    if (platform !== 'linux' || registeredAccelerators.length > 0) {
      return
    }

    registeredAccelerators = acceleratorEntriesForConfig(shortcutConfig)
      .filter(({ accelerator, source }) =>
        shortcutRegistry.register(accelerator, () => {
          dispatchCommandPaletteShortcutForWindow(
            win,
            inputForShortcutConfig(shortcutConfig[source]),
            shortcutConfig
          )
        })
      )
      .map(({ accelerator }) => accelerator)
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

  const setBindings = (bindings: CommandPaletteShortcutBindings): void => {
    const wasRegistered = registeredAccelerators.length > 0

    unregisterFocusedLinuxShortcuts()
    shortcutConfig = commandPaletteShortcutBindingsConfigForPlatform(
      platform,
      bindings
    )

    if (wasRegistered || win.isFocused()) {
      registerFocusedLinuxShortcuts()
    }
  }

  const setBinding = (binding: string): void => {
    setBindings({ palette: binding, leader: binding })
  }

  commandPaletteShortcutControllers.set(win, {
    setBinding,
    setBindings,
    config: () => shortcutConfig,
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (dispatchCommandPaletteShortcutForWindow(win, input, shortcutConfig)) {
      event.preventDefault()
    }
  })

  win.on('focus', registerFocusedLinuxShortcuts)
  win.on('blur', unregisterFocusedLinuxShortcuts)
  win.on('closed', () => {
    unregisterFocusedLinuxShortcuts()
    commandPaletteShortcutControllers.delete(win)
  })

  if (win.isFocused()) {
    registerFocusedLinuxShortcuts()
  }
}
