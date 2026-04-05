import { type ChangeEvent, type ReactElement, useEffect, useRef } from 'react'

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  activeDescendantId?: string
}

export const CommandInput = ({
  value,
  onChange,
  activeDescendantId = undefined,
}: CommandInputProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.value)
  }

  return (
    <div className="px-5 py-4 flex items-center gap-3">
      {/* Search icon */}
      <span className="material-symbols-outlined text-primary-container text-xl">
        search
      </span>

      {/* Input field */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        className="flex-1 bg-transparent border-none outline-none text-on-surface font-medium text-lg"
        placeholder=":"
        role="combobox"
        aria-label="Command palette search"
        aria-expanded
        aria-controls="command-palette-listbox"
        aria-activedescendant={activeDescendantId}
      />

      {/* ESC badge */}
      <div className="bg-surface-container-highest/50 px-2 py-1 rounded text-[10px] font-bold text-on-surface/60 font-mono">
        ESC
      </div>
    </div>
  )
}
