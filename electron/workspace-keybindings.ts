import type { BrowserWindow } from 'electron'
import {
  createWorkspaceKeybindingSnapshot,
  type WorkspaceKeybindingOverrides,
  type WorkspaceKeybindingSnapshot,
} from '../src/features/keymap/snapshot'

export { matchingWorkspaceKeybindings } from '../src/features/keymap/snapshot'

const MAX_CUSTOM_KEYBINDINGS = 256
const MAX_KEYBINDING_CHARS = 128

const hasValidKeybindingLength = (value: string): boolean => {
  const characters = value[Symbol.iterator]()

  for (let count = 0; count <= MAX_KEYBINDING_CHARS; count += 1) {
    if (characters.next().done === true) {
      return true
    }
  }

  return false
}

export const isWorkspaceKeybindingOverrides = (
  value: unknown
): value is WorkspaceKeybindingOverrides => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  let count = 0

  for (const command in record) {
    if (!Object.hasOwn(record, command)) {
      continue
    }

    count += 1
    if (count > MAX_CUSTOM_KEYBINDINGS) {
      return false
    }

    const binding = record[command]
    if (
      typeof binding !== 'string' ||
      !hasValidKeybindingLength(command) ||
      !hasValidKeybindingLength(binding)
    ) {
      return false
    }
  }

  return true
}

export const DEFAULT_WORKSPACE_KEYBINDING_SNAPSHOT =
  createWorkspaceKeybindingSnapshot({}, process.platform)

const snapshotsByWindow = new WeakMap<
  BrowserWindow,
  WorkspaceKeybindingSnapshot
>()

export const getWorkspaceKeybindingSnapshot = (
  win: BrowserWindow
): WorkspaceKeybindingSnapshot =>
  snapshotsByWindow.get(win) ?? DEFAULT_WORKSPACE_KEYBINDING_SNAPSHOT

export const setWorkspaceKeybindingSnapshot = (
  win: BrowserWindow,
  snapshot: WorkspaceKeybindingSnapshot
): void => {
  snapshotsByWindow.set(win, snapshot)
}

export const updateWorkspaceKeybindingsFromSettings = (
  win: BrowserWindow,
  customKeybindings: WorkspaceKeybindingOverrides,
  platform: string = process.platform
): WorkspaceKeybindingSnapshot => {
  const snapshot = createWorkspaceKeybindingSnapshot(
    customKeybindings,
    platform
  )

  setWorkspaceKeybindingSnapshot(win, snapshot)

  return snapshot
}
