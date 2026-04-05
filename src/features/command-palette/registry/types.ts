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
  filteredResults: Command[]
}
