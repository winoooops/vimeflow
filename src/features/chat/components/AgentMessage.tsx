import type { ReactElement } from 'react'
import type { Message } from '../types'
import { StatusBadge } from './StatusBadge'
import { CodeBlock } from './CodeBlock'

interface AgentMessageProps {
  message: Message
}

/**
 * AgentMessage displays an agent's message with avatar, status badge, and code blocks.
 *
 * Design reference: docs/design/chat_or_main/code.html lines 253-278
 * Container: flex gap-4 max-w-3xl mx-auto
 * Avatar: w-10 h-10 rounded-full bg-primary-container/10 border border-primary-container/20
 * Bubble: bg-surface-container-low/40 border border-outline-variant/10 p-5 rounded-xl rounded-tl-none
 */
const AgentMessage = ({ message }: AgentMessageProps): ReactElement => (
  <div
    role="article"
    aria-label="Message from VIBM Agent"
    className="flex gap-4 max-w-3xl mx-auto"
  >
    {/* Agent Avatar */}
    <div
      aria-label="Agent avatar"
      className="w-10 h-10 rounded-full bg-primary-container/10 flex items-center justify-center shrink-0 border border-primary-container/20"
    >
      <span
        className="material-symbols-outlined text-primary-container"
        style={{ fontVariationSettings: "'FILL' 1" }}
        aria-hidden="true"
      >
        psychology
      </span>
    </div>

    {/* Message Content */}
    <div className="flex-1">
      {/* Header: Agent name + Status badge */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-semibold text-primary">VIBM Agent</span>
        {message.status && <StatusBadge status={message.status} />}
      </div>

      {/* Message Bubble */}
      <div
        data-testid="agent-message-bubble"
        className="bg-surface-container-low/40 border border-outline-variant/10 p-5 rounded-xl rounded-tl-none space-y-4"
      >
        {/* Message content - italic if thinking, normal otherwise */}
        <p
          className={`text-sm ${
            message.status === 'thinking'
              ? 'text-on-surface-variant italic'
              : 'text-on-surface'
          }`}
        >
          {message.content}
        </p>

        {/* Code blocks */}
        {message.codeSnippets?.map((snippet, index) => (
          <CodeBlock
            key={index}
            filename={snippet.filename}
            language={snippet.language}
            code={snippet.code}
          />
        ))}
      </div>
    </div>
  </div>
)

export default AgentMessage
