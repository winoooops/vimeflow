import type { ReactElement } from 'react'
import type { Message } from '../types'

interface UserMessageProps {
  message: Message
}

/**
 * Parses message content and wraps backtick-enclosed text in <code> elements
 */
const parseInlineCode = (content: string): ReactElement[] => {
  const parts: ReactElement[] = []
  const regex = /`([^`]+)`/g
  let lastIndex = 0
  let match
  let key = 0

  while ((match = regex.exec(content)) !== null) {
    // Add text before the code
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${key++}`}>
          {content.slice(lastIndex, match.index)}
        </span>
      )
    }

    // Add the code element
    parts.push(
      <code
        key={`code-${key++}`}
        className="font-label bg-surface-container-highest px-1.5 py-0.5 rounded text-secondary"
      >
        {match[1]}
      </code>
    )

    lastIndex = regex.lastIndex
  }

  // Add remaining text after the last code block
  if (lastIndex < content.length) {
    parts.push(<span key={`text-${key++}`}>{content.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key="text-0">{content}</span>]
}

/**
 * Formats ISO 8601 timestamp to time string (e.g., "10:42 AM")
 * Uses UTC time to display the timestamp as-is without timezone conversion
 */
const formatTimestamp = (isoString: string): string => {
  const date = new Date(isoString)
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const meridiem = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  const displayMinutes = minutes.toString().padStart(2, '0')

  return `${displayHours}:${displayMinutes} ${meridiem}`
}

const UserMessage = ({ message }: UserMessageProps): ReactElement => (
  <div
    role="article"
    aria-label="Message from You"
    className="flex gap-4 max-w-3xl mx-auto"
  >
    {/* Avatar */}
    <div
      className="w-10 h-10 rounded-full overflow-hidden shrink-0 border-2 border-surface-container-highest"
      data-testid="user-avatar-container"
    >
      <img
        alt="User avatar"
        className="w-full h-full object-cover"
        src="https://lh3.googleusercontent.com/aida-public/AB6AXuDezo4OJtN8ihltDEe3rfOo_tcwRaorxqxO2drME3RdFm2-XMzbnG-3dVHxRKddjEpLdLwoz5uKWTI6yVqEj7cU_qs_sHxG2C028olFFCt44zXEmglidLHxTIHh1FW2eqzIKlN59foFac12XsKgYsJJQiiiCXW25bEuXTE0H7_FCMTrV_7Uz5W0botvDH8ZUBVYVAUfTjvH3_OsND9gP7lO2YhsTO9hHLjwt5uXs2gXGjjcCnjJeawFJMj83LNctrTfeLn5gH4IWUs"
      />
    </div>

    {/* Message Content */}
    <div className="flex-1">
      {/* Header: Name + Timestamp */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-semibold text-on-surface">You</span>
        <span className="text-[10px] text-on-surface-variant/60 font-label uppercase">
          {formatTimestamp(message.timestamp)}
        </span>
      </div>

      {/* Message Bubble */}
      <div
        className="bg-surface-container p-4 rounded-xl rounded-tl-none text-sm text-on-surface leading-relaxed shadow-sm"
        data-testid="user-message-bubble"
      >
        {parseInlineCode(message.content)}
      </div>
    </div>
  </div>
)

export default UserMessage
