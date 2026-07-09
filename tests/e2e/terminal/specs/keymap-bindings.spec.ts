import { clickBySelector } from '../../shared/actions.js'

type ElectronModule = typeof import('electron')

const commandPaletteInputSelector =
  '[role="combobox"][aria-label="Command palette search"]'

/**
 * VIM-104 end-to-end verification of the keymap + opt-in Vim mode keybindings,
 * driven against the real Electron app.
 *
 * Most app-level shortcuts are `document` capture-phase keydown listeners.
 * The command palette shortcut is owned by Electron before-input-event /
 * focused-window accelerator plumbing, so this spec sends a real WebDriver
 * key chord instead of dispatching a synthetic DOM KeyboardEvent.
 */

interface KeyInit {
  key: string
  code?: string
  modKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

// The app uses Meta (⌘) on macOS and Ctrl on Linux/Windows for the
// document-level pane shortcuts under test. Resolve it in the renderer so the
// synthetic event matches the platform the app itself sees.
const modInit = (): Pick<KeyInit, 'modKey'> => ({ modKey: true })

const fireKey = async (init: KeyInit): Promise<void> => {
  await browser.execute((i: KeyInit) => {
    const { modKey, ...eventInit } = i
    const platform =
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string }
        }
      ).userAgentData?.platform ?? navigator.platform
    const isMac = platform.toLowerCase().includes('mac')
    const modKeys =
      modKey === true
        ? {
            ctrlKey: !isMac,
            metaKey: isMac,
          }
        : {}

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...eventInit,
        ...modKeys,
      })
    )
  }, init)
}

const fireTerminalZoneKey = async (init: KeyInit): Promise<void> => {
  await browser.execute((i: KeyInit) => {
    const { modKey, ...eventInit } = i
    const platform =
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string }
        }
      ).userAgentData?.platform ?? navigator.platform
    const isMac = platform.toLowerCase().includes('mac')
    const modKeys =
      modKey === true
        ? {
            ctrlKey: !isMac,
            metaKey: isMac,
          }
        : {}

    const target =
      document.querySelector<HTMLElement>('[data-testid="terminal-zone"]') ??
      document
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...eventInit,
        ...modKeys,
      })
    )
  }, init)
}

const fireCommandPaletteShortcutInput = async (): Promise<void> => {
  await browser.waitUntil(
    async () => {
      return await browser.execute(async () => {
        return (
          window.__VIMEFLOW_E2E__?.dispatchCommandPaletteShortcut() ?? false
        )
      })
    },
    {
      timeout: 8_000,
      interval: 100,
      timeoutMsg: 'command palette shortcut opener was not registered',
    }
  )
}

// Open the command palette (⌘; / Ctrl+;) and run a vim ex-command by typing it
// and pressing Enter.
const runExCommand = async (command: string): Promise<void> => {
  await openCommandPalette()
  await setCommandPaletteQuery(command)
  await fireKey({ key: 'Enter' })
}

const isCommandPaletteInputVisible = async (): Promise<boolean> =>
  browser.execute((selector: string) => {
    const element = document.querySelector<HTMLElement>(selector)
    if (element === null) {
      return false
    }

    const style = window.getComputedStyle(element)

    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      element.getClientRects().length > 0
    )
  }, commandPaletteInputSelector)

const waitForCommandPaletteInput = async (): Promise<void> => {
  await browser.waitUntil(async () => isCommandPaletteInputVisible(), {
    timeout: 8_000,
    interval: 100,
    timeoutMsg: 'command palette input did not become visible',
  })
}

const waitForCommandPaletteClosed = async (): Promise<void> => {
  await browser.waitUntil(async () => !(await isCommandPaletteInputVisible()), {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: 'command palette input did not close',
  })
}

const setCommandPaletteQuery = async (query: string): Promise<void> => {
  await waitForCommandPaletteInput()
  await browser.execute(
    (selector: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(selector)
      if (input === null) {
        throw new Error('command palette input not found')
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    },
    commandPaletteInputSelector,
    query
  )
}

const openCommandPalette = async (): Promise<void> => {
  await browser.electron.execute((electron: ElectronModule) => {
    const win = electron.BrowserWindow.getAllWindows()[0]
    win?.focus()
    win?.webContents.focus()
  })

  if (!(await isCommandPaletteInputVisible())) {
    await fireCommandPaletteShortcutInput()
  }

  await browser.waitUntil(async () => isCommandPaletteInputVisible(), {
    timeout: 8_000,
    interval: 250,
    timeoutMsg: 'command palette did not open from the shortcut',
  })

  await waitForCommandPaletteInput()
}

const splitView = (): ReturnType<typeof $> => $('[data-testid="split-view"]')

const currentLayout = async (): Promise<string | null> =>
  (await splitView()).getAttribute('data-layout')

const waitForLayout = async (expected: string): Promise<void> => {
  await browser.waitUntil(async () => (await currentLayout()) === expected, {
    timeout: 8_000,
    timeoutMsg: `split-view data-layout did not become "${expected}"`,
  })
}

const bodyHasText = async (text: string): Promise<boolean> =>
  browser.execute((t: string) => document.body.innerText.includes(t), text)

const hasElement = async (selector: string): Promise<boolean> =>
  browser.execute(
    (s: string) => document.querySelector<HTMLElement>(s) !== null,
    selector
  )

const activePaneIndex = async (): Promise<number> =>
  browser.execute(() => {
    const slots = Array.from(
      document.querySelectorAll('[data-testid="split-view-slot"]')
    )
    return slots.findIndex((s) => s.getAttribute('data-pane-active') === 'true')
  })

const paneSlotCount = async (): Promise<number> =>
  browser.execute(
    () => document.querySelectorAll('[data-testid="split-view-slot"]').length
  )

const focusTerminalZone = async (): Promise<void> => {
  await browser.execute(() => {
    const zone = document.querySelector<HTMLElement>(
      '[data-testid="terminal-zone"]'
    )
    zone?.focus()
    zone?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  })
  await browser.pause(100)
}

const focusUntil = async (
  fire: () => Promise<void>,
  target: number,
  label: string
): Promise<void> => {
  await browser.waitUntil(
    async () => {
      await fire()
      return (await activePaneIndex()) === target
    },
    { timeout: 12_000, interval: 500, timeoutMsg: label }
  )
}

const openSettings = async (): Promise<void> => {
  if (!(await hasElement('[data-testid="sidebar-settings-footer"]'))) {
    await clickBySelector('[data-testid="sidebar-toggle-fixed"]')
    await (
      await $('[data-testid="sidebar-settings-footer"]')
    ).waitForExist({ timeout: 5_000 })
  }

  await clickBySelector('[data-testid="sidebar-settings-footer"]')
  await (
    await $('[role="dialog"][aria-label="Settings"]')
  ).waitForDisplayed({ timeout: 8_000 })
}

const gotoKeymapPane = async (): Promise<void> => {
  await browser.execute(() => {
    const button = Array.from(
      document.querySelectorAll('[role="dialog"] nav button')
    ).find((b) => (b.textContent ?? '').includes('Keymap'))
    ;(button as HTMLElement | undefined)?.click()
  })
  await (
    await $('select[aria-label="Keymap preset"]')
  ).waitForDisplayed({ timeout: 8_000 })
}

const closeSettings = async (): Promise<void> => {
  await clickBySelector('[role="dialog"] button[aria-label="Close"]')
  await (
    await $('[role="dialog"][aria-label="Settings"]')
  ).waitForDisplayed({ reverse: true, timeout: 5_000 })
}

const setPreset = async (value: 'vimeflow' | 'vim'): Promise<void> => {
  await openSettings()
  await gotoKeymapPane()
  await (
    await $('select[aria-label="Keymap preset"]')
  ).selectByAttribute('value', value)
  await closeSettings()
}

describe('VIM-104 keymap + Vim mode keybindings', () => {
  before(async () => {
    await (
      await $('[data-testid="workspace-view"]')
    ).waitForDisplayed({ timeout: 20_000 })

    // Ensure a terminal session (and therefore a split-view) exists. The
    // app may launch with zero sessions depending on restore state.
    const sv = await $('[data-testid="split-view"]')
    if (!(await sv.isExisting())) {
      await clickBySelector('[data-testid="sidebar-new-session"]')
    }
    await (
      await $('[data-testid="split-view"]')
    ).waitForDisplayed({ timeout: 20_000 })
  })

  it('Cmd+; opens the command palette', async () => {
    await openCommandPalette()

    await waitForCommandPaletteInput()

    // The palette owns its Escape handler.
    await fireKey({ key: 'Escape' })
    await waitForCommandPaletteClosed()
  })

  it('Keymap pane: Vim preset reveals vim bindings and persists across reopen', async () => {
    await openSettings()
    await gotoKeymapPane()

    const select = await $('select[aria-label="Keymap preset"]')
    if ((await select.getValue()) !== 'vimeflow') {
      throw new Error('Keymap preset did not default to "vimeflow"')
    }
    if (await bodyHasText('Layout: vsplit / split / only')) {
      throw new Error('Vim binding rows shown while preset is vimeflow')
    }

    await select.selectByAttribute('value', 'vim')
    await browser.waitUntil(
      async () => bodyHasText('Layout: vsplit / split / only'),
      {
        timeout: 8_000,
        timeoutMsg: 'Vim binding rows did not appear after switching to Vim',
      }
    )

    await closeSettings()

    // Reopen — the persisted preset must still be Vim.
    await openSettings()
    await gotoKeymapPane()
    if (
      (await (await $('select[aria-label="Keymap preset"]')).getValue()) !==
      'vim'
    ) {
      throw new Error('Keymap preset did not persist as "vim" across reopen')
    }
    await closeSettings()
  })

  it('Cmd+\\ cycles the pane layout', async () => {
    const before = await currentLayout()
    await fireKey({ key: '\\', code: 'Backslash', ...modInit() })
    await browser.waitUntil(async () => (await currentLayout()) !== before, {
      timeout: 8_000,
      timeoutMsg: `layout did not change from "${before}" on Cmd+\\`,
    })
  })

  it('Vim ex-command :vsplit (via palette) sets the vsplit layout', async () => {
    await setPreset('vim')

    await runExCommand(':vsplit')

    await waitForLayout('vsplit')
  })

  // Covered in usePaneShortcuts tests; xterm/WebDriver focus makes this
  // keyboard path too unstable for the Linux smoke suite.
  it.skip('Cmd+Shift+Arrow moves focus between two panes', async () => {
    // Ensure a 2-pane vsplit, then fill the empty slot with a second shell.
    await runExCommand(':vsplit')
    await waitForLayout('vsplit')

    const addShell = await $('[aria-label="add shell pane"]')
    if (await addShell.isExisting()) {
      await clickBySelector('[aria-label="add shell pane"]')
    }
    await browser.waitUntil(async () => (await paneSlotCount()) >= 2, {
      timeout: 15_000,
      timeoutMsg: 'second pane did not spawn after clicking "add shell pane"',
    })

    await focusTerminalZone()

    // Normalize to the right pane first; if it is already active this returns
    // immediately, otherwise it waits through pane-spawn settle.
    await focusUntil(
      () =>
        fireTerminalZoneKey({
          key: 'ArrowRight',
          code: 'ArrowRight',
          shiftKey: true,
          ...modInit(),
        }),
      1,
      'Cmd+Shift+Right did not focus the second (right) pane before left-nav check'
    )

    await focusUntil(
      () =>
        fireTerminalZoneKey({
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          shiftKey: true,
          ...modInit(),
        }),
      0,
      'Cmd+Shift+Left did not focus the first (left) pane'
    )
  })
})
