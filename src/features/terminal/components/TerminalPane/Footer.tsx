import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import { StatusDot } from '../../../sessions/components/StatusDot'
import type { SessionStatus } from '../../../sessions/types'

export interface FooterProps {
  agent: Agent
  pipStatus: SessionStatus
  isFocused: boolean
  isPaused: boolean
  onClickFocus: () => void
  placeholder?: string
}

const derivePlaceholder = (
  agent: Agent,
  isFocused: boolean,
  isPaused: boolean
): string => {
  if (!isFocused) {
    return `click to focus ${agent.short.toLowerCase()}`
  }
  if (isPaused) {
    return 'paused'
  }

  return `message ${agent.short.toLowerCase()}...`
}

export const Footer = ({
  agent,
  pipStatus,
  isFocused,
  isPaused,
  onClickFocus,
  placeholder = undefined,
}: FooterProps): ReactElement => {
  const text = placeholder ?? derivePlaceholder(agent, isFocused, isPaused)

  return (
    <div
      data-testid="terminal-pane-footer"
      className="flex shrink-0 items-center gap-2 border-t border-outline-variant/20 bg-surface-container-lowest/55 px-3.5 py-1.5 font-mono text-[11px]"
    >
      <StatusDot status={pipStatus} size={6} aria-label={`pty ${pipStatus}`} />
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
