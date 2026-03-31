/**
 * Represents a code snippet within a message.
 */
export interface CodeSnippet {
  language: string
  filename: string
  code: string
}

/**
 * Represents a message in a conversation.
 */
export interface Message {
  id: string
  sender: 'user' | 'agent'
  content: string
  timestamp: string
  codeSnippets?: CodeSnippet[]
  status?: 'sent' | 'thinking' | 'completed' | 'error'
}

/**
 * Represents a conversation item in the sidebar.
 */
export interface ConversationItem {
  id: string
  title: string
  timestamp: string
  hasSubThreads: boolean
  active: boolean
}

/**
 * Type guard to check if an unknown value is a valid CodeSnippet.
 */
export const isCodeSnippet = (value: unknown): value is CodeSnippet => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj.language === 'string' &&
    typeof obj.filename === 'string' &&
    typeof obj.code === 'string'
  )
}

/**
 * Type guard to check if an unknown value is a valid Message.
 */
export const isMessage = (value: unknown): value is Message => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Check required fields
  if (
    typeof obj.id !== 'string' ||
    typeof obj.sender !== 'string' ||
    typeof obj.content !== 'string' ||
    typeof obj.timestamp !== 'string'
  ) {
    return false
  }

  // Validate optional codeSnippets array
  if (obj.codeSnippets !== undefined) {
    if (!Array.isArray(obj.codeSnippets)) {
      return false
    }
    // All items must be valid CodeSnippets
    if (!obj.codeSnippets.every(isCodeSnippet)) {
      return false
    }
  }

  // Validate optional status
  if (obj.status !== undefined) {
    if (
      typeof obj.status !== 'string' ||
      !['sent', 'thinking', 'completed', 'error'].includes(obj.status)
    ) {
      return false
    }
  }

  return true
}

/**
 * Type guard to check if an unknown value is a valid ConversationItem.
 */
export const isConversationItem = (value: unknown): value is ConversationItem => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.hasSubThreads === 'boolean' &&
    typeof obj.active === 'boolean'
  )
}
