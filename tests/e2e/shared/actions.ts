/**
 * WebDriver action helpers for WebKitGTK.
 *
 * WebKitWebDriver does not implement the standard Actions API (`element/click`
 * → unsupported operation) on Linux. These helpers dispatch the underlying
 * DOM events via `browser.execute` so tests stay readable.
 */
// cspell:ignore menuitemcheckbox

export const clickBySelector = async (selector: string): Promise<void> => {
  const ok = await browser.execute((s: string) => {
    const el = document.querySelector<HTMLElement>(s)
    if (!el) {
      return false
    }

    el.click()

    return true
  }, selector)

  if (!ok) {
    throw new Error(`clickBySelector: no element for ${selector}`)
  }
}

export const clickButtonByText = async (text: string): Promise<void> => {
  const ok = await browser.execute((label: string) => {
    const normalizedLabel = label.trim()
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim().includes(normalizedLabel)
    )
    if (!button) {
      return false
    }

    button.click()

    return true
  }, text)

  if (!ok) {
    throw new Error(`clickButtonByText: no button with text ${text}`)
  }
}

export const createNewSession = async (): Promise<void> => {
  await clickBySelector('button[aria-label="New session"]')

  await browser.waitUntil(
    async () =>
      await browser.execute(
        () => document.querySelector('[role="dialog"]') !== null
      ),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'New session dialog did not open',
    }
  )

  await clickButtonByText('Create session')
}

const hasElement = async (selector: string): Promise<boolean> =>
  await browser.execute(
    (s: string) => document.querySelector<HTMLElement>(s) !== null,
    selector
  )

const waitForLayoutDisplayMenuItem = async (
  layoutName: string
): Promise<void> => {
  const menuSelector = '[role="menu"][aria-label="Displayed layouts"]'
  const itemSelector = layoutDisplayMenuItemSelector(layoutName)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await hasElement(itemSelector)) {
      return
    }

    if (!(await hasElement(menuSelector))) {
      await clickBySelector('button[aria-label="Configure displayed layouts"]')
    }

    try {
      await browser.waitUntil(
        async () =>
          (await hasElement(menuSelector)) && (await hasElement(itemSelector)),
        {
          timeout: 5_000,
          interval: 100,
          timeoutMsg: `layout display menu did not show ${layoutName}`,
        }
      )

      return
    } catch (error) {
      if (attempt === 1) {
        throw error
      }
    }
  }
}

export const clickLayoutButton = async (layoutName: string): Promise<void> => {
  const layoutButtonSelector = `[data-testid="layout-switcher"] button[aria-label="${layoutName}"]`

  if (!(await hasElement(layoutButtonSelector))) {
    await waitForLayoutDisplayMenuItem(layoutName)

    await clickBySelector(layoutDisplayMenuItemSelector(layoutName))

    await browser.waitUntil(
      async () => await hasElement(layoutButtonSelector),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: `${layoutName} layout button did not appear`,
      }
    )
  }

  await clickBySelector(layoutButtonSelector)
}

const clickVisibleButtonByName = async (name: string): Promise<boolean> =>
  browser.execute((accessibleName: string) => {
    const isVisible = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      )
    }

    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button')
    )
    const button = buttons.find((candidate) => {
      const label =
        candidate.getAttribute('aria-label') ?? candidate.textContent ?? ''

      return (
        label.trim().includes(accessibleName) &&
        !candidate.disabled &&
        isVisible(candidate)
      )
    })
    if (!button) return false
    button.click()

    return true
  }, name)

export const createNewSessionWithDefaults = async (): Promise<void> => {
  const opened = await browser.execute(() => {
    const isVisible = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      )
    }

    const button = document.querySelector<HTMLElement>(
      '[data-testid="sidebar-new-session"]'
    )
    if (!button || !isVisible(button)) return false
    button.click()

    return true
  })
  if (!opened) throw new Error('createNewSessionWithDefaults: no opener')

  await browser.waitUntil(
    async () => clickVisibleButtonByName('Create session'),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg:
        'createNewSessionWithDefaults: create button never became visible',
    }
  )
}

export const focusBySelector = async (selector: string): Promise<void> => {
  const ok = await browser.execute((s: string) => {
    const el = document.querySelector<HTMLElement>(s)
    if (!el) {
      return false
    }

    el.focus()

    return true
  }, selector)

  if (!ok) {
    throw new Error(`focusBySelector: no element for ${selector}`)
  }
}

const layoutDisplayMenuItemSelector = (layoutName: string): string =>
  `button[role="menuitemcheckbox"][aria-label="${layoutName}"]`
