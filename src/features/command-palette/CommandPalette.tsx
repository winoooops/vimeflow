import { AnimatePresence, motion } from 'framer-motion'
import type { ReactElement } from 'react'
import { useCommandPalette } from './hooks/useCommandPalette'
import { CommandInput } from './components/CommandInput'
import { CommandResults } from './components/CommandResults'
import { CommandFooter } from './components/CommandFooter'
import type { Command } from './registry/types'

export interface CommandPaletteProps {
  commands?: Command[]
}

export const CommandPalette = ({
  commands,
}: CommandPaletteProps = {}): ReactElement | null => {
  const {
    state,
    filteredResults,
    clampedSelectedIndex,
    close,
    setQuery,
    selectIndex,
  } = useCommandPalette(commands)

  return (
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
              activeDescendantId={
                clampedSelectedIndex >= 0
                  ? `command-${filteredResults[clampedSelectedIndex].id}`
                  : undefined
              }
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
}
