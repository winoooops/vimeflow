import { describe, expect, test, vi } from 'vitest'
import { COMMAND_PALETTE_TOGGLE } from './ipc-channels'
import {
  COMMAND_PALETTE_GLOBAL_ACCELERATORS,
  commandPaletteShortcutBindingsConfigForPlatform,
  commandPaletteShortcutConfigForWindow,
  commandPaletteShortcutConfigForPlatform,
  commandPaletteShortcutSourceForInput,
  type CommandPaletteShortcutOverrideOptions,
  dispatchCommandPaletteShortcutForWindow,
  installCommandPaletteShortcutOverride,
  isCommandPaletteShortcutInput,
  setCommandPaletteShortcutBinding,
  setCommandPaletteShortcutBindings,
  setKeymapCaptureActive,
} from './command-palette-shortcut'

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
  },
}))

type ShortcutInput = Parameters<typeof isCommandPaletteShortcutInput>[0]

type BeforeInputHandler = (
  event: { preventDefault: () => void },
  input: ShortcutInput
) => void

type WindowHandler = () => void

interface FakeWindowFixture {
  beforeInputHandlers: BeforeInputHandler[]
  focus: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  win: Parameters<typeof installCommandPaletteShortcutOverride>[0]
  windowHandlers: Map<string, WindowHandler[]>
}

interface ShortcutRegistryFixture {
  callbacks: Map<string, () => void>
  registry: NonNullable<
    CommandPaletteShortcutOverrideOptions['shortcutRegistry']
  >
}

const createFakeWindow = (focused = false): FakeWindowFixture => {
  const beforeInputHandlers: BeforeInputHandler[] = []
  const windowHandlers = new Map<string, WindowHandler[]>()
  const focus = vi.fn()
  const send = vi.fn()

  const webContentsOn = vi.fn(
    (eventName: string, nextHandler: BeforeInputHandler) => {
      expect(eventName).toBe('before-input-event')
      beforeInputHandlers.push(nextHandler)
    }
  )

  const on = vi.fn((eventName: string, nextHandler: WindowHandler) => {
    windowHandlers.set(eventName, [
      ...(windowHandlers.get(eventName) ?? []),
      nextHandler,
    ])
  })

  return {
    beforeInputHandlers,
    focus,
    send,
    win: {
      webContents: {
        focus,
        isDestroyed: vi.fn(() => false),
        on: webContentsOn,
        send,
      },
      on,
      isFocused: vi.fn(() => focused),
      isDestroyed: vi.fn(() => false),
    } as unknown as Parameters<typeof installCommandPaletteShortcutOverride>[0],
    windowHandlers,
  }
}

const createShortcutRegistry = (): ShortcutRegistryFixture => {
  const callbacks = new Map<string, () => void>()

  const register = vi.fn((accelerator: string, callback: () => void) => {
    callbacks.set(accelerator, callback)

    return true
  })

  const unregister = vi.fn((accelerator: string) => {
    callbacks.delete(accelerator)
  })

  return {
    callbacks,
    registry: { register, unregister },
  }
}

const emitWindowEvent = (
  windowHandlers: Map<string, WindowHandler[]>,
  eventName: string
): void => {
  const handlers = windowHandlers.get(eventName) ?? []

  handlers.forEach((handler) => {
    handler()
  })
}

describe('command palette shortcut override', () => {
  test('selects Command on macOS and Control elsewhere', () => {
    expect(commandPaletteShortcutConfigForPlatform('darwin').modifier).toBe(
      'command'
    )

    expect(commandPaletteShortcutConfigForPlatform('linux').modifier).toBe(
      'control'
    )

    expect(commandPaletteShortcutConfigForPlatform('win32').modifier).toBe(
      'control'
    )
  })

  test('builds platform accelerators from a resolved keybinding token', () => {
    expect(
      commandPaletteShortcutConfigForPlatform('linux', 'Mod+KeyK')
    ).toMatchObject({
      modifier: 'control',
      code: 'KeyK',
      key: 'K',
      alt: false,
      shift: false,
      globalAccelerators: ['Control+K'],
    })

    expect(
      commandPaletteShortcutConfigForPlatform('darwin', 'Mod+Shift+KeyK')
    ).toMatchObject({
      modifier: 'command',
      code: 'KeyK',
      key: 'K',
      alt: false,
      shift: true,
      globalAccelerators: ['Command+Shift+K'],
    })

    expect(
      commandPaletteShortcutConfigForPlatform('darwin', 'Ctrl+Backquote')
    ).toMatchObject({
      modifier: 'control',
      code: 'Backquote',
      key: '`',
      globalAccelerators: ['Control+`'],
    })

    expect(
      commandPaletteShortcutConfigForPlatform('linux', 'Mod+Slash')
    ).toMatchObject({
      modifier: 'control',
      code: 'Slash',
      key: '/',
      globalAccelerators: ['Control+/'],
    })
  })

  test('falls back to the default shortcut when the binding token is invalid', () => {
    expect(
      commandPaletteShortcutConfigForPlatform('linux', 'Mod+Ctrl+KeyK')
    ).toMatchObject({
      modifier: 'control',
      code: 'Semicolon',
      key: ';',
      globalAccelerators: ['Control+;'],
    })
  })

  test('prioritizes the leader source when default palette bindings overlap', () => {
    expect(
      commandPaletteShortcutBindingsConfigForPlatform('linux')
    ).toMatchObject({
      palette: { code: 'Semicolon', globalAccelerators: ['Control+;'] },
      leader: { code: 'Semicolon', globalAccelerators: ['Control+;'] },
    })

    expect(COMMAND_PALETTE_GLOBAL_ACCELERATORS).toEqual(['Control+;'])

    expect(
      commandPaletteShortcutSourceForInput(
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: false,
          alt: false,
        },
        commandPaletteShortcutBindingsConfigForPlatform('linux')
      )
    ).toBe('leader')
  })

  test('keeps a physical code binding even without an Electron accelerator spelling', () => {
    expect(
      commandPaletteShortcutConfigForPlatform('linux', 'Mod+NumpadEnter')
    ).toMatchObject({
      modifier: 'control',
      code: 'NumpadEnter',
      key: 'NumpadEnter',
      globalAccelerators: [],
    })

    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: 'Enter',
          code: 'NumpadEnter',
          control: true,
          meta: false,
          alt: false,
        },
        commandPaletteShortcutConfigForPlatform('linux', 'Mod+NumpadEnter')
      )
    ).toBe(true)
  })

  test('matches Ctrl+; keydown on Linux without meta or alt modifiers', () => {
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: false,
          alt: false,
        },
        commandPaletteShortcutConfigForPlatform('linux')
      )
    ).toBe(true)
  })

  test('matches rebound shortcuts by physical code when Electron supplies it', () => {
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: 'л',
          code: 'KeyK',
          control: true,
          meta: false,
          alt: false,
        },
        commandPaletteShortcutConfigForPlatform('linux', 'Mod+KeyK')
      )
    ).toBe(true)

    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          code: 'Semicolon',
          control: true,
          meta: false,
          alt: false,
        },
        commandPaletteShortcutConfigForPlatform('linux', 'Mod+KeyK')
      )
    ).toBe(false)
  })

  test('ignores Ctrl+Shift+; keydown on Linux', () => {
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: false,
          alt: false,
          shift: true,
        },
        commandPaletteShortcutConfigForPlatform('linux')
      )
    ).toBe(false)
  })

  test('matches Cmd+; keydown on macOS without control or alt modifiers', () => {
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          control: false,
          meta: true,
          alt: false,
        },
        commandPaletteShortcutConfigForPlatform('darwin')
      )
    ).toBe(true)
  })

  test('matches Cmd+; by physical Semicolon code from native key events', () => {
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: 'Semicolon',
          code: 'Semicolon',
          control: false,
          meta: true,
          alt: false,
        },
        commandPaletteShortcutConfigForPlatform('darwin')
      )
    ).toBe(true)
  })

  test('ignores Cmd+Shift+; keydown on macOS', () => {
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          control: false,
          meta: true,
          alt: false,
          shift: true,
        },
        commandPaletteShortcutConfigForPlatform('darwin')
      )
    ).toBe(false)
  })

  test('ignores non-toggle inputs', () => {
    const linuxConfig = commandPaletteShortcutConfigForPlatform('linux')

    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyUp',
          key: ';',
          control: true,
          meta: false,
          alt: false,
        },
        linuxConfig
      )
    ).toBe(false)

    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: true,
          alt: false,
        },
        linuxConfig
      )
    ).toBe(false)

    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ':',
          control: true,
          meta: false,
          alt: false,
        },
        linuxConfig
      )
    ).toBe(false)
  })

  test('ignores auto-repeat keydown (held-key flicker guard)', () => {
    // Electron's before-input-event fires isAutoRepeat=true keydown events
    // while a key is held. The renderer-side event.repeat guard never runs in
    // the packaged app (event.preventDefault suppresses the renderer keydown),
    // so the main-process matcher must reject auto-repeat itself — otherwise
    // the 100 ms deduplication dispatcher still leaks one toggle every
    // ~100 ms, flickering the palette open/closed while Ctrl+; is held.
    expect(
      isCommandPaletteShortcutInput(
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: false,
          alt: false,
          isAutoRepeat: true,
        },
        commandPaletteShortcutConfigForPlatform('linux')
      )
    ).toBe(false)
  })

  test('dispatches a matched shortcut through the shared window helper', () => {
    const { focus, send, win } = createFakeWindow()

    const handled = dispatchCommandPaletteShortcutForWindow(
      win,
      {
        type: 'keyDown',
        key: ';',
        control: false,
        meta: true,
        alt: false,
      },
      commandPaletteShortcutBindingsConfigForPlatform('darwin')
    )

    expect(handled).toBe(true)
    expect(focus).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE, 'leader')
  })

  test('does not dispatch unmatched shortcuts through the shared window helper', () => {
    const { focus, send, win } = createFakeWindow()

    const handled = dispatchCommandPaletteShortcutForWindow(
      win,
      {
        type: 'keyDown',
        key: '2',
        control: false,
        meta: true,
        alt: false,
      },
      commandPaletteShortcutBindingsConfigForPlatform('darwin')
    )

    expect(handled).toBe(false)
    expect(focus).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test('prevents renderer Ctrl+; keydown and sends palette toggle IPC on Linux', () => {
    const { beforeInputHandlers, send, win } = createFakeWindow()
    const preventDefault = vi.fn()

    installCommandPaletteShortcutOverride(win, { platform: 'linux' })

    const handler = beforeInputHandlers[0]

    if (handler === undefined) {
      throw new Error('before-input-event handler was not registered')
    }

    handler(
      { preventDefault },
      {
        type: 'keyDown',
        key: ';',
        control: true,
        meta: false,
        alt: false,
      }
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE, 'leader')
  })

  test('prevents renderer Cmd+; keydown and sends palette toggle IPC on macOS', () => {
    const { beforeInputHandlers, send, win } = createFakeWindow()
    const preventDefault = vi.fn()

    installCommandPaletteShortcutOverride(win, { platform: 'darwin' })

    const handler = beforeInputHandlers[0]

    if (handler === undefined) {
      throw new Error('before-input-event handler was not registered')
    }

    handler(
      { preventDefault },
      {
        type: 'keyDown',
        key: ';',
        control: false,
        meta: true,
        alt: false,
      }
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE, 'leader')
  })

  test('does not prevent renderer Cmd+Shift+; keydown on macOS', () => {
    const { beforeInputHandlers, send, win } = createFakeWindow()
    const preventDefault = vi.fn()

    installCommandPaletteShortcutOverride(win, { platform: 'darwin' })

    const handler = beforeInputHandlers[0]

    if (handler === undefined) {
      throw new Error('before-input-event handler was not registered')
    }

    handler(
      { preventDefault },
      {
        type: 'keyDown',
        key: ';',
        control: false,
        meta: true,
        alt: false,
        shift: true,
      }
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test('does not toggle on auto-repeat before-input-event keydown', () => {
    const { beforeInputHandlers, send, win } = createFakeWindow()
    const preventDefault = vi.fn()

    installCommandPaletteShortcutOverride(win, { platform: 'linux' })

    const handler = beforeInputHandlers[0]

    if (handler === undefined) {
      throw new Error('before-input-event handler was not registered')
    }

    handler(
      { preventDefault },
      {
        type: 'keyDown',
        key: ';',
        control: true,
        meta: false,
        alt: false,
        isAutoRepeat: true,
      }
    )

    // Auto-repeat must fall through the matcher: no preventDefault (so the
    // renderer still receives the event and its own repeat guard consumes it)
    // and no IPC toggle dispatched.
    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test('registers the Linux global override while the window is focused', () => {
    const { callbacks, registry } = createShortcutRegistry()
    const { send, win, windowHandlers } = createFakeWindow()

    installCommandPaletteShortcutOverride(win, {
      platform: 'linux',
      shortcutRegistry: registry,
    })

    emitWindowEvent(windowHandlers, 'focus')

    expect(registry.register).toHaveBeenCalledTimes(
      COMMAND_PALETTE_GLOBAL_ACCELERATORS.length
    )

    expect([...callbacks.keys()]).toEqual([
      ...COMMAND_PALETTE_GLOBAL_ACCELERATORS,
    ])

    callbacks.get('Control+;')?.()

    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE, 'leader')
  })

  test('syncing a new binding re-registers the focused Linux global override', () => {
    const { callbacks, registry } = createShortcutRegistry()
    const { send, win, windowHandlers } = createFakeWindow()

    installCommandPaletteShortcutOverride(win, {
      platform: 'linux',
      shortcutRegistry: registry,
    })

    emitWindowEvent(windowHandlers, 'focus')
    expect([...callbacks.keys()]).toEqual(['Control+;'])

    setCommandPaletteShortcutBinding(win, 'Mod+KeyK')

    expect(registry.unregister).toHaveBeenCalledWith('Control+;')
    expect([...callbacks.keys()]).toEqual(['Control+K'])
    expect(commandPaletteShortcutConfigForWindow(win).code).toBe('KeyK')

    callbacks.get('Control+;')?.()
    expect(send).not.toHaveBeenCalled()

    callbacks.get('Control+K')?.()
    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE, 'leader')
  })

  test('syncing split bindings registers direct palette and leader accelerators', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { callbacks, registry } = createShortcutRegistry()
    const { send, win, windowHandlers } = createFakeWindow()

    try {
      installCommandPaletteShortcutOverride(win, {
        platform: 'linux',
        shortcutRegistry: registry,
      })

      emitWindowEvent(windowHandlers, 'focus')
      setCommandPaletteShortcutBindings(win, {
        palette: 'Mod+KeyP',
        leader: 'Mod+KeyK',
      })

      expect(registry.unregister).toHaveBeenCalledWith('Control+;')
      expect([...callbacks.keys()]).toEqual(['Control+K', 'Control+P'])
      expect(commandPaletteShortcutConfigForWindow(win, 'leader').code).toBe(
        'KeyK'
      )

      expect(commandPaletteShortcutConfigForWindow(win, 'palette').code).toBe(
        'KeyP'
      )

      callbacks.get('Control+K')?.()
      expect(send).toHaveBeenLastCalledWith(COMMAND_PALETTE_TOGGLE, 'leader')

      vi.setSystemTime(1_200)

      callbacks.get('Control+P')?.()
      expect(send).toHaveBeenLastCalledWith(COMMAND_PALETTE_TOGGLE, 'palette')
    } finally {
      vi.useRealTimers()
    }
  })

  test('deduplicates a global shortcut and renderer keydown for one press', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    try {
      const { callbacks, registry } = createShortcutRegistry()

      const { beforeInputHandlers, send, win, windowHandlers } =
        createFakeWindow()
      const preventDefault = vi.fn()

      installCommandPaletteShortcutOverride(win, {
        platform: 'linux',
        shortcutRegistry: registry,
      })

      emitWindowEvent(windowHandlers, 'focus')

      callbacks.get('Control+;')?.()

      beforeInputHandlers[0]?.(
        { preventDefault },
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: false,
          alt: false,
        }
      )

      expect(preventDefault).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledTimes(1)

      vi.setSystemTime(1_200)

      beforeInputHandlers[0]?.(
        { preventDefault },
        {
          type: 'keyDown',
          key: ';',
          control: true,
          meta: false,
          alt: false,
        }
      )

      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('unregisters the Linux global override when the window blurs', () => {
    const { callbacks, registry } = createShortcutRegistry()
    const { win, windowHandlers } = createFakeWindow()

    installCommandPaletteShortcutOverride(win, {
      platform: 'linux',
      shortcutRegistry: registry,
    })

    emitWindowEvent(windowHandlers, 'focus')
    emitWindowEvent(windowHandlers, 'blur')

    expect(registry.unregister).toHaveBeenCalledTimes(
      COMMAND_PALETTE_GLOBAL_ACCELERATORS.length
    )
    expect([...callbacks.keys()]).toEqual([])
  })

  test('skips the global override outside Linux', () => {
    const { registry } = createShortcutRegistry()
    const { win, windowHandlers } = createFakeWindow()

    installCommandPaletteShortcutOverride(win, {
      platform: 'darwin',
      shortcutRegistry: registry,
    })

    emitWindowEvent(windowHandlers, 'focus')

    expect(registry.register).not.toHaveBeenCalled()
  })

  test('registers immediately when the Linux window is already focused', () => {
    const { registry } = createShortcutRegistry()
    const { win } = createFakeWindow(true)

    installCommandPaletteShortcutOverride(win, {
      platform: 'linux',
      shortcutRegistry: registry,
    })

    expect(registry.register).toHaveBeenCalledTimes(
      COMMAND_PALETTE_GLOBAL_ACCELERATORS.length
    )
  })

  test('suppresses toggle while keymap capture is active', () => {
    const { beforeInputHandlers, send, win } = createFakeWindow()
    const preventDefault = vi.fn()

    installCommandPaletteShortcutOverride(win, { platform: 'linux' })
    setKeymapCaptureActive(win, true)

    const handler = beforeInputHandlers[0]

    if (handler === undefined) {
      throw new Error('before-input-event handler was not registered')
    }

    handler(
      { preventDefault },
      {
        type: 'keyDown',
        key: ';',
        control: true,
        meta: false,
        alt: false,
      }
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
