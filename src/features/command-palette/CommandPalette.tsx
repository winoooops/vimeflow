import { AnimatePresence, motion } from 'framer-motion'
import type { ReactElement } from 'react'
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
}

export const CommandPalette = ({
  state,
  filteredResults,
  clampedSelectedIndex,
  close,
  setQuery,
  selectIndex,
}: CommandPaletteProps): ReactElement | null => (
  <AnimatePresence>
    {state.isOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      >
        {/* Backdrop */}
        <motion.div
          data-testid="command-palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 backdrop-blur-sm bg-black/40"
          onClick={close}
        />

        {/* Panel */}
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: -8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: -8 }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 30,
          }}
          className="relative w-full max-w-2xl mx-4 bg-[#1e1e2e]/90 glass-panel rounded-2xl border border-[#4a444f]/30 shadow-2xl overflow-hidden flex flex-col h-fit"
        >
          {/* Input section */}
          <CommandInput
            value={state.query}
            onChange={setQuery}
            activeDescendantId={((): `command-${string}` | undefined => {
              // Hoisting `useCommandPalette` into WorkspaceView made
              // `clampedSelectedIndex` and `filteredResults` independent
              // props instead of co-derived state. The hook still
              // guarantees `clampedSelectedIndex === -1` when
              // `filteredResults.length === 0`, but a future caller
              // wiring this component directly could break that
              // invariant. Guard against an undefined slot lookup so a
              // mismatched pair degrades to "no active descendant"
              // instead of crashing the workspace boundary.
              const activeCommand =
                clampedSelectedIndex >= 0
                  ? filteredResults[clampedSelectedIndex]
                  : undefined

              return activeCommand ? `command-${activeCommand.id}` : undefined
            })()}
          />

          {/* Divider */}
          <div className="h-px bg-surface-container-low/30" />

          {/* Results */}
          <CommandResults
            filteredResults={filteredResults}
            selectedIndex={clampedSelectedIndex}
            onSelect={selectIndex}
          />

          {/* Footer */}
          <div className="h-px bg-surface-container-low/30" />
          <CommandFooter />
        </motion.div>
      </div>
    )}
  </AnimatePresence>
)
