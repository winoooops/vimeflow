/**
 * jsdom exposes the `inert` attribute but does not suppress activation of
 * inert subtrees. This helper installs/removes a capture-phase click listener
 * that calls `stopImmediatePropagation()` for clicks inside `[inert]`
 * subtrees so tests can assert real-browser non-interactivity behavior.
 */

const inertClickHandler = (event: MouseEvent): void => {
  const target = event.target as Element | null
  if (target !== null && target.closest('[inert]') !== null) {
    event.stopImmediatePropagation()
    event.preventDefault()
  }
}

export const installInertClickPolyfill = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  document.addEventListener('click', inertClickHandler, true)
}

export const removeInertClickPolyfill = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  document.removeEventListener('click', inertClickHandler, true)
}
