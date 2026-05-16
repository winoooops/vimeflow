/**
 * Environment detection utilities for VIBM.
 *
 * Provides functions to detect the runtime environment (Electron desktop
 * vs browser). Post-PR-D3, "desktop" means Electron only.
 */

/**
 * True when the renderer is running inside the Electron desktop host
 * (the Electron preload script sets `window.vimeflow`). Uses `!= null`
 * so an explicit `window.vimeflow = undefined` does not trip the check.
 */
export const isDesktop = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.vimeflow != null
}

/** True when the renderer is in a browser / Vitest context. */
export const isBrowser = (): boolean => !isDesktop()

/** 'desktop' covers Electron; 'browser' is everything else. */
export const getEnvironment = (): 'desktop' | 'browser' =>
  isDesktop() ? 'desktop' : 'browser'

export const isTest = (): boolean => import.meta.env.MODE === 'test'
