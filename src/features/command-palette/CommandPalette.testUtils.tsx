import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { CommandPalette } from './CommandPalette'
import type { CommandPaletteState, Command } from './registry/types'

export interface RenderPaletteOptions {
  state?: Partial<CommandPaletteState>
  filteredResults?: Command[]
  clampedSelectedIndex?: number
}

const defaultState: CommandPaletteState = {
  isOpen: true,
  query: ':',
  selectedIndex: 0,
  currentNamespace: null,
}

export const renderPalette = (
  options: RenderPaletteOptions = {}
): {
  close: ReturnType<typeof vi.fn>
  setQuery: ReturnType<typeof vi.fn>
  selectIndex: ReturnType<typeof vi.fn>
} => {
  const close = vi.fn()
  const setQuery = vi.fn()
  const selectIndex = vi.fn()

  render(
    <CommandPalette
      state={{ ...defaultState, ...options.state }}
      filteredResults={options.filteredResults ?? []}
      clampedSelectedIndex={options.clampedSelectedIndex ?? -1}
      close={close}
      setQuery={setQuery}
      selectIndex={selectIndex}
    />
  )

  return { close, setQuery, selectIndex }
}
