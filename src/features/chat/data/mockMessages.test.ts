import { describe, test, expect } from 'vitest'
import {
  mockMessages,
  mockConversations,
  mockAgentStatus,
  mockRecentActions,
} from './mockMessages'
import { isMessage, isConversationItem } from '../types'

describe('mockMessages', () => {
  test('should export an array of messages', () => {
    expect(Array.isArray(mockMessages)).toBe(true)
    expect(mockMessages.length).toBeGreaterThan(0)
  })

  test('all messages should match Message type', () => {
    mockMessages.forEach((message) => {
      expect(isMessage(message)).toBe(true)
    })
  })

  test('should include at least one user message', () => {
    const userMessages = mockMessages.filter((msg) => msg.sender === 'user')
    expect(userMessages.length).toBeGreaterThanOrEqual(1)
  })

  test('should include at least one agent message', () => {
    const agentMessages = mockMessages.filter((msg) => msg.sender === 'agent')
    expect(agentMessages.length).toBeGreaterThanOrEqual(1)
  })

  test('should include at least one message with code snippets', () => {
    const messagesWithCode = mockMessages.filter(
      (msg) => msg.codeSnippets && msg.codeSnippets.length > 0
    )
    expect(messagesWithCode.length).toBeGreaterThanOrEqual(1)
  })

  test('should include at least one agent message with thinking status', () => {
    const thinkingMessages = mockMessages.filter(
      (msg) => msg.sender === 'agent' && msg.status === 'thinking'
    )
    expect(thinkingMessages.length).toBeGreaterThanOrEqual(1)
  })

  test('user messages should not have status field', () => {
    const userMessages = mockMessages.filter((msg) => msg.sender === 'user')
    userMessages.forEach((msg) => {
      expect(msg.status).toBeUndefined()
    })
  })

  test('code snippets should have valid structure', () => {
    const messagesWithCode = mockMessages.filter(
      (msg) => msg.codeSnippets && msg.codeSnippets.length > 0
    )

    messagesWithCode.forEach((msg) => {
      msg.codeSnippets?.forEach((snippet) => {
        expect(typeof snippet.language).toBe('string')
        expect(snippet.language.length).toBeGreaterThan(0)
        expect(typeof snippet.filename).toBe('string')
        expect(snippet.filename.length).toBeGreaterThan(0)
        expect(typeof snippet.code).toBe('string')
        expect(snippet.code.length).toBeGreaterThan(0)
      })
    })
  })
})

describe('mockConversations', () => {
  test('should export an array of conversations', () => {
    expect(Array.isArray(mockConversations)).toBe(true)
    expect(mockConversations.length).toBeGreaterThan(0)
  })

  test('all conversations should match ConversationItem type', () => {
    mockConversations.forEach((conversation) => {
      expect(isConversationItem(conversation)).toBe(true)
    })
  })

  test('should include at least one active conversation', () => {
    const activeConversations = mockConversations.filter((conv) => conv.active)
    expect(activeConversations.length).toBeGreaterThanOrEqual(1)
  })

  test('should include conversations with and without sub-threads', () => {
    const withSubThreads = mockConversations.filter(
      (conv) => conv.hasSubThreads
    )

    const withoutSubThreads = mockConversations.filter(
      (conv) => !conv.hasSubThreads
    )

    expect(withSubThreads.length).toBeGreaterThan(0)
    expect(withoutSubThreads.length).toBeGreaterThan(0)
  })

  test('conversation titles should be non-empty strings', () => {
    mockConversations.forEach((conv) => {
      expect(typeof conv.title).toBe('string')
      expect(conv.title.length).toBeGreaterThan(0)
    })
  })

  test('timestamps should be valid ISO 8601 strings', () => {
    mockConversations.forEach((conv) => {
      const date = new Date(conv.timestamp)
      expect(date.toString()).not.toBe('Invalid Date')
    })
  })
})

describe('mockAgentStatus', () => {
  test('should export an object with agent status data', () => {
    expect(typeof mockAgentStatus).toBe('object')
    expect(mockAgentStatus).not.toBeNull()
  })

  test('should have modelName property', () => {
    expect(typeof mockAgentStatus.modelName).toBe('string')
    expect(mockAgentStatus.modelName.length).toBeGreaterThan(0)
  })

  test('should have progress between 0 and 100', () => {
    expect(typeof mockAgentStatus.progress).toBe('number')
    expect(mockAgentStatus.progress).toBeGreaterThanOrEqual(0)
    expect(mockAgentStatus.progress).toBeLessThanOrEqual(100)
  })

  test('should have valid latency value', () => {
    expect(typeof mockAgentStatus.latency).toBe('string')
    expect(mockAgentStatus.latency).toMatch(/^\d+ms$/)
  })

  test('should have valid tokens value', () => {
    expect(typeof mockAgentStatus.tokens).toBe('string')
    expect(mockAgentStatus.tokens).toMatch(/^[\d,]+$/)
  })

  test('should have valid system health status', () => {
    expect(typeof mockAgentStatus.systemHealth).toBe('string')
    expect(['online', 'offline', 'warning']).toContain(
      mockAgentStatus.systemHealth
    )
  })
})

describe('mockRecentActions', () => {
  test('should export an array of recent actions', () => {
    expect(Array.isArray(mockRecentActions)).toBe(true)
    expect(mockRecentActions.length).toBeGreaterThan(0)
  })

  test('all actions should have required properties', () => {
    mockRecentActions.forEach((action) => {
      expect(typeof action.id).toBe('string')
      expect(action.id.length).toBeGreaterThan(0)

      expect(typeof action.action).toBe('string')
      expect(action.action.length).toBeGreaterThan(0)

      expect(typeof action.timestamp).toBe('string')
      const date = new Date(action.timestamp)
      expect(date.toString()).not.toBe('Invalid Date')

      expect(typeof action.status).toBe('string')
      expect(['success', 'pending', 'error']).toContain(action.status)
    })
  })

  test('should include actions with different statuses', () => {
    const statuses = new Set(mockRecentActions.map((action) => action.status))
    expect(statuses.size).toBeGreaterThan(1)
  })
})
