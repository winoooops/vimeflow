import type { ReactElement } from 'react'
import { Dialog } from '@/components/Dialog'
import { CommandInput } from './components/CommandInput'
import { CommandResults } from './components/CommandResults'
import { CommandFooter } from './components/CommandFooter'
import type { Command, CommandPaletteState } from './registry/types'

export interface CommandPaletteProps {
  state: CommandPaletteState
  filteredResults: Command[]
  clampedSelectedIndex: number
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
  executeAt: (index: number) => void
}

// Guards the indexed lookup so a mismatched (clampedSelectedIndex, filteredResults) pair degrades to "no active descendant" instead of crashing — see docs/reviews/patterns/react-lifecycle.md §19.
const getActiveDescendantId = (
  clampedSelectedIndex: number,
  filteredResults: Command[]
): `command-${string}` | undefined => {
  const activeCommand =
    clampedSelectedIndex >= 0
      ? filteredResults[clampedSelectedIndex]
      : undefined

  return activeCommand ? `command-${activeCommand.id}` : undefined
}

const DIALOG_CLOSE_ON_ESCAPE = false

export const CommandPalette = ({
  state,
  filteredResults,
  clampedSelectedIndex,
  close,
  setQuery,
  selectIndex,
  executeAt,
}: CommandPaletteProps): ReactElement | null => (
  <Dialog
    open={state.isOpen}
    onOpenChange={(open): void => {
      if (!open) {
        close()
      }
    }}
    placement="top"
    size="lg"
    closeOnEscape={DIALOG_CLOSE_ON_ESCAPE}
    aria-label="Command palette"
    backdropTestId="command-palette-backdrop"
  >
    <CommandInput
      value={state.query}
      onChange={setQuery}
      activeDescendantId={getActiveDescendantId(
        clampedSelectedIndex,
        filteredResults
      )}
    />

    <div className="h-px bg-outline-variant/25" />

    <CommandResults
      filteredResults={filteredResults}
      selectedIndex={clampedSelectedIndex}
      onSelect={selectIndex}
      onExecute={executeAt}
    />

    <div className="h-px bg-outline-variant/25" />
    <CommandFooter />
  </Dialog>
)
