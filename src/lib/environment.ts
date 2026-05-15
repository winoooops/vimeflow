/**
 * Environment detection utilities for VIBM
 *
 * Provides functions to detect the runtime environment (desktop app
 * vs browser). "Desktop" covers both the current Tauri host AND the
 * Electron host introduced in PR-D — see spec §2.4.
 */

interface TauriInternals {
  metadata?: {
    currentWindow?: {
      label?: string
    }
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

/**
 * True when the renderer is running inside a desktop host (Tauri today,
 * Electron in PR-D). Uses `!= null` (not `in`) so an explicit
 * `window.vimeflow = undefined` does NOT trip the check.
 */
export const isDesktop = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.__TAURI_INTERNALS__ != null || window.vimeflow != null
}

/** True when the renderer is in a browser / Vitest context. */
export const isBrowser = (): boolean => !isDesktop()

/** 'desktop' covers both Tauri and Electron; 'browser' is everything else. */
export const getEnvironment = (): 'desktop' | 'browser' =>
  isDesktop() ? 'desktop' : 'browser'

export const isTest = (): boolean => import.meta.env.MODE === 'test'
