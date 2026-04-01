import { describe, test, expect } from 'vitest'
import { isMessage, isCodeSnippet, isConversationItem } from './index'

describe('CodeSnippet type guard', () => {
  test('returns true for valid CodeSnippet', () => {
    expect(
      isCodeSnippet({
        language: 'typescript',
        filename: 'example.ts',
        code: 'const foo = "bar";',
      })
    ).toBe(true)
  })

  test('returns false for object missing language', () => {
    expect(
      isCodeSnippet({ filename: 'example.ts', code: 'const foo = "bar";' })
    ).toBe(false)
  })

  test('returns false for object missing filename', () => {
    expect(
      isCodeSnippet({ language: 'typescript', code: 'const foo = "bar";' })
    ).toBe(false)
  })

  test('returns false for object missing code', () => {
    expect(
      isCodeSnippet({ language: 'typescript', filename: 'example.ts' })
    ).toBe(false)
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
    expect(
      isMessage({
        id: '1',
        sender: 'user',
        content: 'Hello world',
        timestamp: '2026-03-31T10:00:00Z',
        status: 'sent',
      })
    ).toBe(true)
  })

  test('returns true for valid Message with codeSnippets', () => {
    expect(
      isMessage({
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
      })
    ).toBe(true)
  })

  test('returns false for object missing id', () => {
    expect(
      isMessage({
        sender: 'user',
        content: 'Hello',
        timestamp: '2026-03-31T10:00:00Z',
      })
    ).toBe(false)
  })

  test('returns false for object missing sender', () => {
    expect(
      isMessage({
        id: '1',
        content: 'Hello',
        timestamp: '2026-03-31T10:00:00Z',
      })
    ).toBe(false)
  })

  test('returns false for object missing content', () => {
    expect(
      isMessage({
        id: '1',
        sender: 'user',
        timestamp: '2026-03-31T10:00:00Z',
      })
    ).toBe(false)
  })

  test('returns false for object missing timestamp', () => {
    expect(
      isMessage({
        id: '1',
        sender: 'user',
        content: 'Hello',
      })
    ).toBe(false)
  })

  test('returns false for invalid codeSnippets array', () => {
    expect(
      isMessage({
        id: '1',
        sender: 'user',
        content: 'Hello',
        timestamp: '2026-03-31T10:00:00Z',
        codeSnippets: [{ invalid: 'snippet' }],
      })
    ).toBe(false)
  })

  test('returns false for null', () => {
    expect(isMessage(null)).toBe(false)
  })
})

describe('ConversationItem type guard', () => {
  test('returns true for valid ConversationItem', () => {
    expect(
      isConversationItem({
        id: '1',
        title: 'Conversation about TypeScript',
        timestamp: '2026-03-31T10:00:00Z',
        hasSubThreads: true,
        active: true,
      })
    ).toBe(true)
  })

  test('returns true for inactive ConversationItem without sub-threads', () => {
    expect(
      isConversationItem({
        id: '2',
        title: 'Old conversation',
        timestamp: '2026-03-30T08:00:00Z',
        hasSubThreads: false,
        active: false,
      })
    ).toBe(true)
  })

  test('returns false for object missing id', () => {
    expect(
      isConversationItem({
        title: 'Test',
        timestamp: '2026-03-31T10:00:00Z',
        hasSubThreads: false,
        active: true,
      })
    ).toBe(false)
  })

  test('returns false for object missing title', () => {
    expect(
      isConversationItem({
        id: '1',
        timestamp: '2026-03-31T10:00:00Z',
        hasSubThreads: false,
        active: true,
      })
    ).toBe(false)
  })

  test('returns false for object missing timestamp', () => {
    expect(
      isConversationItem({
        id: '1',
        title: 'Test',
        hasSubThreads: false,
        active: true,
      })
    ).toBe(false)
  })

  test('returns false for object missing hasSubThreads', () => {
    expect(
      isConversationItem({
        id: '1',
        title: 'Test',
        timestamp: '2026-03-31T10:00:00Z',
        active: true,
      })
    ).toBe(false)
  })

  test('returns false for object missing active', () => {
    expect(
      isConversationItem({
        id: '1',
        title: 'Test',
        timestamp: '2026-03-31T10:00:00Z',
        hasSubThreads: false,
      })
    ).toBe(false)
  })

  test('returns false for null', () => {
    expect(isConversationItem(null)).toBe(false)
  })
})
