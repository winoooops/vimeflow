import { motion } from 'framer-motion'
import type { ReactElement } from 'react'
import type { Command } from '../types'
import { CommandResultItem } from './CommandResultItem'

interface CommandResultsProps {
  filteredResults: Command[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export const CommandResults = ({
  filteredResults,
  selectedIndex,
  onSelect,
}: CommandResultsProps): ReactElement => (
  <div
    role="listbox"
    aria-activedescendant={
      filteredResults[selectedIndex]
        ? `command-${filteredResults[selectedIndex].id}`
        : undefined
    }
    className="p-2 overflow-y-auto max-h-96"
  >
    {filteredResults.map((command, index) => (
      <motion.div
        key={command.id}
        id={`command-${command.id}`}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.15,
          delay: index * 0.03, // 30ms stagger
        }}
      >
        <CommandResultItem
          command={command}
          isSelected={index === selectedIndex}
          onSelect={() => {
            onSelect(index)
          }}
        />
      </motion.div>
    ))}
  </div>
)
