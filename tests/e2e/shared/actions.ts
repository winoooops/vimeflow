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

const hasElement = async (selector: string): Promise<boolean> =>
  await browser.execute(
    (s: string) => document.querySelector<HTMLElement>(s) !== null,
    selector
  )

export const clickLayoutButton = async (layoutName: string): Promise<void> => {
  const layoutButtonSelector = `[data-testid="layout-switcher"] button[aria-label="${layoutName}"]`

  if (!(await hasElement(layoutButtonSelector))) {
    await clickBySelector('button[aria-label="Configure displayed layouts"]')

    await browser.waitUntil(
      async () =>
        await hasElement(
          `button[role="menuitemcheckbox"][aria-label="${layoutName}"]`
        ),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: `layout display menu did not show ${layoutName}`,
      }
    )

    await clickBySelector(
      `button[role="menuitemcheckbox"][aria-label="${layoutName}"]`
    )

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

export const focusBySelector = async (selector: string): Promise<void> => {
  const ok = await browser.execute((s: string) => {
    const el = document.querySelector<HTMLElement>(s)
    if (!el) return false
    el.focus()
    return true
  }, selector)
  if (!ok) throw new Error(`focusBySelector: no element for ${selector}`)
}
