import type { ReactElement } from 'react'
import type { Message } from '../types'
import UserMessage from './UserMessage'
import AgentMessage from './AgentMessage'

interface MessageThreadProps {
  messages: Message[]
}

const MessageThread = ({ messages }: MessageThreadProps): ReactElement => (
  <section
    className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar"
    data-testid="message-thread"
  >
    {messages.map((message) => (
      <div
        key={message.id}
        className="max-w-3xl mx-auto"
        data-testid={`message-container-${message.id}`}
      >
        {message.sender === 'user' ? (
          <UserMessage message={message} />
        ) : (
          <AgentMessage message={message} />
        )}
      </div>
    ))}
  </section>
)

export default MessageThread
