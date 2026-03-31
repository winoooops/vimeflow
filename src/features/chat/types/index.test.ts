import { describe, test, expect } from 'vitest'
import { isMessage, isCodeSnippet, isConversationItem } from './index'

describe('CodeSnippet type guard', () => {
  test('returns true for valid CodeSnippet', () => {
    const validSnippet = {
      language: 'typescript',
      filename: 'example.ts',
      code: 'const foo = "bar";',
    }

    expect(isCodeSnippet(validSnippet)).toBe(true)
  })

  test('returns false for object missing language', () => {
    const invalid = {
      filename: 'example.ts',
      code: 'const foo = "bar";',
    }

    expect(isCodeSnippet(invalid)).toBe(false)
  })

  test('returns false for object missing filename', () => {
    const invalid = {
      language: 'typescript',
      code: 'const foo = "bar";',
    }

    expect(isCodeSnippet(invalid)).toBe(false)
  })

  test('returns false for object missing code', () => {
    const invalid = {
      language: 'typescript',
      filename: 'example.ts',
    }

    expect(isCodeSnippet(invalid)).toBe(false)
  })

  test('returns false for null', () => {
    expect(isCodeSnippet(null)).toBe(false)
  })

  test('returns false for non-object', () => {
    expect(isCodeSnippet('not an object')).toBe(false)
  })
})

describe('Message type guard', () => {
  test('returns true for valid Message without codeSnippets', () => {
    const validMessage = {
      id: '1',
      sender: 'user',
      content: 'Hello world',
      timestamp: '2026-03-31T10:00:00Z',
      status: 'sent',
    }

    expect(isMessage(validMessage)).toBe(true)
  })

  test('returns true for valid Message with codeSnippets', () => {
    const validMessage = {
      id: '2',
      sender: 'agent',
      content: 'Here is some code',
      timestamp: '2026-03-31T10:01:00Z',
      codeSnippets: [
        {
          language: 'typescript',
          filename: 'test.ts',
          code: 'console.log("test");',
        },
      ],
      status: 'thinking',
    }

    expect(isMessage(validMessage)).toBe(true)
  })

  test('returns false for object missing id', () => {
    const invalid = {
      sender: 'user',
      content: 'Hello',
      timestamp: '2026-03-31T10:00:00Z',
    }

    expect(isMessage(invalid)).toBe(false)
  })

  test('returns false for object missing sender', () => {
    const invalid = {
      id: '1',
      content: 'Hello',
      timestamp: '2026-03-31T10:00:00Z',
    }

    expect(isMessage(invalid)).toBe(false)
  })

  test('returns false for object missing content', () => {
    const invalid = {
      id: '1',
      sender: 'user',
      timestamp: '2026-03-31T10:00:00Z',
    }

    expect(isMessage(invalid)).toBe(false)
  })

  test('returns false for object missing timestamp', () => {
    const invalid = {
      id: '1',
      sender: 'user',
      content: 'Hello',
    }

    expect(isMessage(invalid)).toBe(false)
  })

  test('returns false for invalid codeSnippets array', () => {
    const invalid = {
      id: '1',
      sender: 'user',
      content: 'Hello',
      timestamp: '2026-03-31T10:00:00Z',
      codeSnippets: [{ invalid: 'snippet' }],
    }

    expect(isMessage(invalid)).toBe(false)
  })

  test('returns false for null', () => {
    expect(isMessage(null)).toBe(false)
  })
})

describe('ConversationItem type guard', () => {
  test('returns true for valid ConversationItem', () => {
    const validItem = {
      id: '1',
      title: 'Conversation about TypeScript',
      timestamp: '2026-03-31T10:00:00Z',
      hasSubThreads: true,
      active: true,
    }

    expect(isConversationItem(validItem)).toBe(true)
  })

  test('returns true for inactive ConversationItem without sub-threads', () => {
    const validItem = {
      id: '2',
      title: 'Old conversation',
      timestamp: '2026-03-30T08:00:00Z',
      hasSubThreads: false,
      active: false,
    }

    expect(isConversationItem(validItem)).toBe(true)
  })

  test('returns false for object missing id', () => {
    const invalid = {
      title: 'Test',
      timestamp: '2026-03-31T10:00:00Z',
      hasSubThreads: false,
      active: true,
    }

    expect(isConversationItem(invalid)).toBe(false)
  })

  test('returns false for object missing title', () => {
    const invalid = {
      id: '1',
      timestamp: '2026-03-31T10:00:00Z',
      hasSubThreads: false,
      active: true,
    }

    expect(isConversationItem(invalid)).toBe(false)
  })

  test('returns false for object missing timestamp', () => {
    const invalid = {
      id: '1',
      title: 'Test',
      hasSubThreads: false,
      active: true,
    }

    expect(isConversationItem(invalid)).toBe(false)
  })

  test('returns false for object missing hasSubThreads', () => {
    const invalid = {
      id: '1',
      title: 'Test',
      timestamp: '2026-03-31T10:00:00Z',
      active: true,
    }

    expect(isConversationItem(invalid)).toBe(false)
  })

  test('returns false for object missing active', () => {
    const invalid = {
      id: '1',
      title: 'Test',
      timestamp: '2026-03-31T10:00:00Z',
      hasSubThreads: false,
    }

    expect(isConversationItem(invalid)).toBe(false)
  })

  test('returns false for null', () => {
    expect(isConversationItem(null)).toBe(false)
  })
})
