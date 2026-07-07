import { type ChangeEvent, type ReactElement, useEffect, useRef } from 'react'
import { KeyCap } from './KeyCap'

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  activeDescendantId?: string
  argumentPlaceholder?: string
}

export const CommandInput = ({
  value,
  onChange,
  activeDescendantId = undefined,
  argumentPlaceholder = undefined,
}: CommandInputProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null)

  const shouldShowArgumentPlaceholder =
    argumentPlaceholder !== undefined && value.endsWith(' ')

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.value)
  }

  return (
    <div className="flex items-center gap-[10px] px-[16px] py-[14px]">
      {/* Terminal glyph in accent, per the handoff input row */}
      <span className="material-symbols-outlined text-[16px] text-primary-container">
        terminal
      </span>

      <div className="relative flex-1 min-w-0">
        {shouldShowArgumentPlaceholder && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center font-mono text-[13.5px] leading-[18px]"
          >
            <span className="whitespace-pre text-on-surface">{value}</span>
            <span className="text-on-surface-muted">{argumentPlaceholder}</span>
          </span>
        )}

        {/* Input field - monospace, matching the handoff */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          className={`relative w-full flex-1 bg-transparent border-none p-0 outline-none font-mono text-[13.5px] leading-[18px] placeholder:text-on-surface-muted ${
            shouldShowArgumentPlaceholder
              ? 'text-transparent caret-on-surface'
              : 'text-on-surface'
          }`}
          placeholder="type a command, : prefix, or search files…"
          role="combobox"
          aria-label="Command palette search"
          aria-expanded
          aria-controls="command-palette-listbox"
          aria-activedescendant={activeDescendantId}
        />
      </div>

      {/* ESC keycap */}
      <KeyCap size="md">ESC</KeyCap>
    </div>
  )
}
