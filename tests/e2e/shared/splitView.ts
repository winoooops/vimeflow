import { clickBySelector } from './actions.js'

/** Open a menu whose trigger listens on pointer events rather than `click`.
 *  A bare `HTMLElement.click()` never opens those, and the WebDriver Actions
 *  API is unavailable on the Linux runner, so synthesize the sequence. */
const pressBySelector = async (selector: string): Promise<void> => {
  const ok = await browser.execute((target: string) => {
    const element = document.querySelector<HTMLElement>(target)
    if (!element) {
      return false
    }

    const init = { bubbles: true, cancelable: true, button: 0 }
    element.dispatchEvent(new PointerEvent('pointerdown', init))
    element.dispatchEvent(new MouseEvent('mousedown', init))
    element.dispatchEvent(new PointerEvent('pointerup', init))
    element.dispatchEvent(new MouseEvent('mouseup', init))
    element.click()

    return true
  }, selector)

  if (!ok) {
    throw new Error(`pressBySelector: no element for ${selector}`)
  }
}

export const waitForPaneCount = async (expected: number): Promise<void> => {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (count: number) =>
          document.querySelectorAll('[data-testid="split-view-slot"]')
            .length === count,
        expected
      ),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `split view did not reach ${expected} panes`,
    }
  )
}

const PALETTE_INPUT = '[aria-label="Command palette search"]'

/** Run a `:command` through the command palette.
 *
 *  Preferred over clicking layout pills: the pills a workspace shows are
 *  persisted per profile, and the "displayed layouts" menu opens on pointer
 *  events a synthesized click does not reproduce.
 */
export const runPaletteCommand = async (command: string): Promise<void> => {
  // The shortcut TOGGLES, and the palette can still be open from a previous
  // command — firing it blindly would close it instead. The input's presence
  // is the reliable open/closed signal; the dialog container lingers.
  const alreadyOpen = await browser.execute(
    (selector: string) => document.querySelector(selector) !== null,
    PALETTE_INPUT
  )
  if (!alreadyOpen) {
    // On the native Ghostty path the terminal is an NSView outside the web
    // contents. Once it holds focus the palette closes the instant it opens,
    // so pull focus back into the document first.
    await browser.execute(() => {
      window.focus()
      document.body.focus()
    })

    // The bridge opener goes through main, which is what the real
    // accelerator does. A synthesized keydown on `document` does not reach it.
    await browser.execute(
      async () =>
        await window.__VIMEFLOW_E2E__?.dispatchCommandPaletteShortcut()
    )
  }

  await (await $(PALETTE_INPUT)).waitForDisplayed({ timeout: 5_000 })
  // Set the value programmatically rather than typing: WebDriver keystrokes
  // go to whatever holds focus, and a pane or resize handle often still does.
  // React only reacts to the native setter plus an `input` event.
  await browser.execute(
    (selector: string, text: string) => {
      const element = document.querySelector<HTMLInputElement>(selector)
      if (!element) {
        return
      }

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(element, text)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    },
    PALETTE_INPUT,
    command
  )

  // Filtering is async — pressing Enter before a result exists commits
  // nothing and silently leaves the workspace unchanged.
  await browser
    .waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelectorAll(String.raw`[role="option"]`).length > 0
        ),
      { timeout: 5_000, interval: 100 }
    )
    .catch(async (): Promise<never> => {
      const state = await browser.execute((selector: string) => ({
        value: document.querySelector<HTMLInputElement>(selector)?.value,
        body: document.body.innerText.slice(0, 200),
      }))

      throw new Error(
        `command palette matched nothing for ${command}: ${JSON.stringify(state)}`
      )
    })

  await browser.execute((selector: string) => {
    const element = document.querySelector<HTMLInputElement>(selector)
    element?.focus()
    element?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    )
  }, PALETTE_INPUT)

  // Best effort — the dialog container lingers after close and its exit is
  // animated, so it is not a reliable gate. Callers assert on the command's
  // actual effect instead.
  await browser
    .waitUntil(
      async () =>
        await browser.execute(
          (selector: string) => document.querySelector(selector) === null,
          PALETTE_INPUT
        ),
      { timeout: 3_000, interval: 100 }
    )
    .catch(() => undefined)
}

/** Click a layout pill, revealing it from the "displayed layouts" menu first
 *  when the workspace has it hidden. */
export const switchToLayout = async (
  menuLabel: string,
  pillLabel = menuLabel
): Promise<void> => {
  const clickedVisiblePill = await browser.execute((layoutLabel: string) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${layoutLabel}"]`
    )
    if (button === null) {
      return false
    }

    button.click()

    return true
  }, pillLabel)

  if (clickedVisiblePill) {
    return
  }

  await pressBySelector('button[aria-label="Configure displayed layouts"]')

  // The menu mounts into a portal a tick after the click.
  await browser.waitUntil(
    async () =>
      await browser.execute(
        () => document.querySelectorAll('[role^="menuitem"]').length > 0
      ),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'layout display menu never opened',
    }
  )

  const revealed = await browser.execute((layoutLabel: string) => {
    // Rows carry the layout name on `aria-label`; the visible text is an
    // icon-first label that does not always contain it.
    const row = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')
    ).find(
      (candidate) =>
        candidate.getAttribute('aria-label') === layoutLabel ||
        (candidate.textContent ?? '').includes(layoutLabel)
    )

    if (row === undefined) {
      return false
    }

    if (row.getAttribute('aria-checked') !== 'true') {
      row.click()
    }

    return true
  }, menuLabel)

  if (!revealed) {
    const present = await browser.execute(() =>
      Array.from(document.querySelectorAll('[role^="menuitem"]')).map(
        (row) => ({
          role: row.getAttribute('role'),
          label: row.getAttribute('aria-label'),
          text: (row.textContent ?? '').trim().slice(0, 40),
        })
      )
    )

    throw new Error(
      `layout display menu had no ${menuLabel} row; present: ${JSON.stringify(present)}`
    )
  }

  await browser.execute(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
  })

  await browser.waitUntil(
    async () =>
      await browser.execute(
        (layoutLabel: string) =>
          document.querySelector(`button[aria-label="${layoutLabel}"]`) !==
          null,
        pillLabel
      ),
    {
      timeout: 3_000,
      interval: 100,
      timeoutMsg: `${pillLabel} layout pill did not become visible`,
    }
  )

  await clickBySelector(`button[aria-label="${pillLabel}"]`)
}
