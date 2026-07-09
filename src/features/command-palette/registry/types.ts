export interface Command {
  id: string
  label: string
  description?: string
  // Dim tertiary detail shown after the label, mirroring the handoff anatomy.
  hint?: string
  icon: string
  // Key glyphs for a real single-combo global accelerator, e.g. ['⌘','N'].
  shortcut?: string[]
  // Palette execution requires a non-empty args string; direct execute callers
  // still validate their own input.
  requiresArgument?: boolean
  argumentPlaceholder?: string
  children?: Command[]
  execute?: (args: string) => void
  preview?: () => void
  match?: (query: string) => number
}

export interface CommandPaletteState {
  isOpen: boolean
  query: string
  selectedIndex: number
  currentNamespace: Command | null
}

export interface UseCommandPaletteReturn {
  state: CommandPaletteState
  filteredResults: Command[]
  clampedSelectedIndex: number
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
  executeSelected: () => void
  executeAt: (index: number) => void
  navigateUp: () => void
  navigateDown: () => void
}

export interface UseCommandPaletteOptions {
  enabled?: boolean
  isPaletteToggleEvent?: (event: KeyboardEvent) => boolean
  isLeaderEvent?: (event: KeyboardEvent) => boolean
  isToggleEvent?: (event: KeyboardEvent) => boolean
}
