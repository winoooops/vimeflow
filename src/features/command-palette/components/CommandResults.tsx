import { motion } from 'framer-motion'
import { type ReactElement, useEffect } from 'react'
import type { Command } from '../types'
import { CommandResultItem } from './CommandResultItem'

interface CommandResultsProps {
  filteredResults: Command[]
  selectedIndex: number
  onSelect: (index: number) => void
  onExecute: (index: number) => void
}

export const CommandResults = ({
  filteredResults,
  selectedIndex,
  onSelect,
  onExecute,
}: CommandResultsProps): ReactElement => {
  // Keep the active row visible within the listbox only, never the page.
  useEffect(() => {
    if (selectedIndex < 0 || selectedIndex >= filteredResults.length) {
      return
    }

    const activeCommand = filteredResults[selectedIndex]
    const activeEl = document.getElementById(`command-${activeCommand.id}`)

    activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedIndex, filteredResults])

  return (
    <div
      id="command-palette-listbox"
      role="listbox"
      className="p-2 overflow-y-auto max-h-[60vh]"
    >
      {filteredResults.map((command, index) => (
        <motion.div
          key={command.id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.15,
            delay: Math.min(index * 0.03, 0.18),
          }}
        >
          <CommandResultItem
            id={`command-${command.id}`}
            command={command}
            isSelected={index === selectedIndex}
            onSelect={() => {
              onSelect(index)
            }}
            onExecute={() => {
              onExecute(index)
            }}
          />
        </motion.div>
      ))}
    </div>
  )
}
