// cspell:ignore Ghostty ghostty GHOSTTY
// Renderer/preload -> Electron main IPC channels for either Ghostty native host.
export const GHOSTTY_NATIVE_UPDATE = 'ghostty-native:update'

export const GHOSTTY_NATIVE_DATA = 'ghostty-native:data'

export const GHOSTTY_NATIVE_FOCUS = 'ghostty-native:focus'

export const GHOSTTY_NATIVE_DESTROY = 'ghostty-native:destroy'

/** Test-only: read a pane's visible grid as text. The native surface paints
 *  through Metal into an NSView, so it is invisible to the DOM and to
 *  WebDriver screenshots — this is the only way a test can assert on what
 *  the terminal actually holds. */
export const GHOSTTY_NATIVE_READ_GRID = 'ghostty-native:read-grid'

/** Test-only: fingerprint of the frame Core Animation is presenting. */
export const GHOSTTY_NATIVE_PRESENTATION_PROBE =
  'ghostty-native:presentation-probe'

export const GHOSTTY_NATIVE_SECONDARY_ATTACH = 'ghostty-native:secondary-attach'

export const GHOSTTY_NATIVE_SECONDARY_DATA = 'ghostty-native:secondary-data'

export const GHOSTTY_NATIVE_SECONDARY_FOCUS = 'ghostty-native:secondary-focus'

export const GHOSTTY_NATIVE_SECONDARY_REMOVE = 'ghostty-native:secondary-remove'

export const GHOSTTY_NATIVE_SECONDARY_VISIBLE =
  'ghostty-native:secondary-visible'
