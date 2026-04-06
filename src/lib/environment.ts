/**
 * Environment detection utilities for VIBM
 *
 * Provides functions to detect the runtime environment (Tauri desktop app vs browser)
 */

/**
 * Tauri internals interface for environment detection
 */
interface TauriInternals {
  metadata?: {
    currentWindow?: {
      label?: string
    }
  }
  // Add other properties as needed
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

/**
 * Check if the application is running in a Tauri desktop environment
 *
 * @returns true if running in Tauri, false if running in browser
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Check if the application is running in a browser environment
 *
 * @returns true if running in browser, false if running in Tauri
 */
export const isBrowser = (): boolean => !isTauri()

/**
 * Get the current environment name
 *
 * @returns 'tauri' if running in Tauri, 'browser' if running in browser
 */
export const getEnvironment = (): 'tauri' | 'browser' =>
  isTauri() ? 'tauri' : 'browser'
