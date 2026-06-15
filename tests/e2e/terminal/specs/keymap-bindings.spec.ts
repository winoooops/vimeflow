import { clickBySelector } from '../../shared/actions.js'

/**
 * VIM-104 end-to-end verification of the keymap + opt-in Vim mode keybindings,
 * driven against the real Electron app.
 *
 * App-level shortcuts are `document` capture-phase keydown listeners, so we
 * trigger them by dispatching synthetic KeyboardEvents to `document` (the same
 * shape the unit tests use).
 */

interface KeyInit {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

// The app uses Meta (⌘) on macOS and Ctrl on Linux/Windows for the
// document-level pane shortcuts under test. Drive the events with the same
// modifier the running binary expects so the suite passes on CI runners for
// both platforms.
const isMac = process.platform === 'darwin'
const modInit = (): Pick<KeyInit, 'metaKey' | 'ctrlKey'> =>
  isMac ? { metaKey: true } : { ctrlKey: true }

const fireKey = async (init: KeyInit): Promise<void> => {
  await browser.execute((i: KeyInit) => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...i,
      })
    )
  }, init)
}

// Open the command palette (⌘; / Ctrl+;) and run a vim ex-command by typing it
// and pressing Enter.
const runExCommand = async (command: string): Promise<void> => {
  await fireKey({ key: ';', ...modInit() })
  const input = await $(
    '[role="combobox"][aria-label="Command palette search"]'
  )
  await input.waitForDisplayed({ timeout: 8_000 })
  await input.setValue(command)
  await fireKey({ key: 'Enter' })
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

// Re-fire a focus key until the expected pane becomes active. addPane holds a
// short "pane op in flight" lock during PTY spawn, and setSessionActivePane
// intentionally no-ops while it is held — so a single dispatch immediately
// after adding a pane can be dropped. Retrying absorbs that settle window
// without masking a genuinely broken binding (it still times out if focus
// never moves at all).
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
    await fireKey({ key: ';', ...modInit() })

    const palette = await $(
      '[role="combobox"][aria-label="Command palette search"]'
    )
    await palette.waitForDisplayed({ timeout: 8_000 })

    // The palette owns its Escape handler.
    await fireKey({ key: 'Escape' })
    await palette.waitForDisplayed({ reverse: true, timeout: 5_000 })
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

  it('Cmd+Arrow moves focus between two panes', async () => {
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

    // Cmd+Left lands on the leftmost pane (pane 0) from either pane. The
    // directional handler is shift-agnostic and terminal-gated; plain ⌘+Arrow
    // just moves to the active pane's neighbour.
    await focusUntil(
      () =>
        fireKey({
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          ...modInit(),
        }),
      0,
      'Cmd+Left did not focus the first (left) pane'
    )

    // Cmd+Right → the right (second) pane.
    await focusUntil(
      () =>
        fireKey({
          key: 'ArrowRight',
          code: 'ArrowRight',
          ...modInit(),
        }),
      1,
      'Cmd+Right did not focus the second (right) pane'
    )
  })
})
