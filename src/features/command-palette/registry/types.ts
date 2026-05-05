export interface Command {
  id: string
  label: string
  description?: string
  icon: string
  children?: Command[]
  execute?: (args: string) => void
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
