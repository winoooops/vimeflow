import { afterEach, describe, expect, test } from 'vitest'
import { DIALOG_SELECTOR } from './containerIds'

const appended: HTMLElement[] = []

const append = (el: HTMLElement): HTMLElement => {
  document.body.appendChild(el)
  appended.push(el)

  return el
}

afterEach(() => {
  appended.forEach((el) => el.remove())
  appended.length = 0
})

describe('DIALOG_SELECTOR', () => {
  test('matches a visible dialog', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')

    expect(document.querySelector(DIALOG_SELECTOR)).toBe(dialog)
  })

  test('ignores a plain aria-hidden dialog', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-hidden', 'true')

    expect(document.querySelector(DIALOG_SELECTOR)).toBeNull()
  })

  test('matches the aria-hidden placeholder of a native-active dialog', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-hidden', 'true')
    dialog.setAttribute('data-dialog-layer', 'true')
    dialog.setAttribute('data-native-overlay-active', 'true')

    expect(document.querySelector(DIALOG_SELECTOR)).toBe(dialog)
  })

  test('ignores a dismissed mounted dialog layer without native backing', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-hidden', 'true')
    dialog.setAttribute('data-dialog-layer', 'true')

    expect(document.querySelector(DIALOG_SELECTOR)).toBeNull()
  })
})
