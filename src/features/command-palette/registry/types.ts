export interface Command {
  id: string
  label: string
  description?: string
  icon: string
  // Key glyphs for a real single-combo global accelerator, e.g. ['⌘','N'].
  shortcut?: string[]
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
  navigateUp: () => void
  navigateDown: () => void
}

export interface UseCommandPaletteOptions {
  enabled?: boolean
}
