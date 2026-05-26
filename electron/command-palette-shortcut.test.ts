import { describe, expect, test, vi } from 'vitest'
import { COMMAND_PALETTE_TOGGLE } from './ipc-channels'
import {
  COMMAND_PALETTE_GLOBAL_ACCELERATORS,
  commandPaletteShortcutConfigForPlatform,
  type CommandPaletteShortcutOverrideOptions,
  installCommandPaletteShortcutOverride,
  isCommandPaletteShortcutInput,
} from './command-palette-shortcut'

type ShortcutInput = Parameters<typeof isCommandPaletteShortcutInput>[0]

type BeforeInputHandler = (
  event: { preventDefault: () => void },
  input: ShortcutInput
) => void

type WindowHandler = () => void

interface FakeWindowFixture {
  beforeInputHandlers: BeforeInputHandler[]
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
    send,
    win: {
      webContents: { on: webContentsOn, send },
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
    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE)
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
    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE)
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

    expect(send).toHaveBeenCalledWith(COMMAND_PALETTE_TOGGLE)
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
})
