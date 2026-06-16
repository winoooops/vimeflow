import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'

export interface FooterProps {
  agent: Agent
  isFocused: boolean
  isIdle: boolean
  onClickFocus: () => void
  placeholder?: string
}

const derivePlaceholder = (
  agent: Agent,
  isFocused: boolean,
  isIdle: boolean
): string => {
  if (!isFocused) {
    return `click to focus ${agent.short.toLowerCase()}`
  }
  if (isIdle) {
    return 'idle'
  }

  return `message ${agent.short.toLowerCase()}...`
}

export const Footer = ({
  agent,
  isFocused,
  isIdle,
  onClickFocus,
  placeholder = undefined,
}: FooterProps): ReactElement => {
  const text = placeholder ?? derivePlaceholder(agent, isFocused, isIdle)

  return (
    <div
      data-testid="terminal-pane-footer"
      className="flex shrink-0 items-center gap-2 border-t border-outline-variant/20 bg-surface-container-lowest/55 px-3.5 py-1.5 font-mono text-[11px]"
    >
      <button
        type="button"
        aria-label="Focus terminal"
        onClick={(event) => {
          event.stopPropagation()
          onClickFocus()
        }}
        className="flex min-w-0 flex-1 cursor-text items-center gap-2 border-0 bg-transparent p-0 text-left font-mono text-[11px]"
      >
        <span style={{ color: agent.accent }}>{'>'}</span>
        <span className="min-w-0 flex-1 truncate text-on-surface-muted">
          {text}
        </span>
      </button>
    </div>
  )
}
