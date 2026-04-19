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

export const focusBySelector = async (selector: string): Promise<void> => {
  const ok = await browser.execute((s: string) => {
    const el = document.querySelector<HTMLElement>(s)
    if (!el) return false
    el.focus()
    return true
  }, selector)
  if (!ok) throw new Error(`focusBySelector: no element for ${selector}`)
}
