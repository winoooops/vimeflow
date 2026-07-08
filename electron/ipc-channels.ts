// Shared channel names used by Electron main and preload. Centralized to
// avoid ad hoc channel strings.

export const BACKEND_INVOKE = 'backend:invoke'

export const BACKEND_EVENT = 'backend:event'

export const COMMAND_PALETTE_TOGGLE = 'command-palette:toggle'

export const COMMAND_PALETTE_BINDING = 'command-palette:binding'

export const KEYMAP_CAPTURE_ACTIVE = 'keymap:capture-active'

export const E2E_COMMAND_PALETTE_SHORTCUT = 'e2e:command-palette-shortcut'

export const SETTINGS_OPEN_FILE = 'settings:open-file'

export const SETTINGS_OPEN_WINDOW = 'settings:open-window'

export const SETTINGS_SYNC_SNAPSHOT = 'settings:sync-snapshot'

export const SETTINGS_CHANGED = 'settings:changed'

export const DIALOG_PICK_DIRECTORY = 'dialog:pick-directory'
