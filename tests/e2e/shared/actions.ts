/**
 * WebDriver action helpers for WebKitGTK.
 *
 * WebKitWebDriver does not implement the standard Actions API (`element/click`
 * → unsupported operation) on Linux. These helpers dispatch the underlying
 * DOM events via `browser.execute` so tests stay readable.
 */

export const clickBySelector = async (selector: string): Promise<void> => {
  const ok = await browser.execute((s: string) => {
    const el = document.querySelector<HTMLElement>(s)
    if (!el) return false
    el.click()
    return true
  }, selector)
  if (!ok) throw new Error(`clickBySelector: no element for ${selector}`)
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
    if (!el) return false
    el.focus()
    return true
  }, selector)
  if (!ok) throw new Error(`focusBySelector: no element for ${selector}`)
}
