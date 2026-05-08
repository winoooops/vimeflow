import { describe, test, expect } from 'vitest'
import type {
  Session,
  SessionStatus,
  FileChange,
  ToolCall,
  TestResult,
  ContextWindowStatus,
} from './index'

describe('Session Types', () => {
  describe('SessionStatus', () => {
    test('defines valid session status values', () => {
      const validStatuses: SessionStatus[] = [
        'running',
        'paused',
        'completed',
        'errored',
      ]

      validStatuses.forEach((status) => {
        expect(status).toBeTruthy()
      })
    })
  })

  describe('Session', () => {
    test('creates valid session object', () => {
      const session: Session = {
        id: 'sess-1',
        projectId: 'proj-1',
        name: 'auth middleware',
        status: 'running',
        workingDirectory: '/home/user/my-project',
        agentType: 'claude-code',
        createdAt: '2026-04-07T00:00:00Z',
        lastActivityAt: '2026-04-07T00:01:00Z',
        activity: {
          fileChanges: [],
          toolCalls: [],
          testResults: [],
          contextWindow: {
            used: 50000,
            total: 200000,
            percentage: 25,
            emoji: '😊',
          },
          usage: {
            sessionDuration: 154,
            turnCount: 12,
            messages: { sent: 12, limit: 200 },
            tokens: { input: 30000, output: 20000, total: 50000 },
          },
        },
      }

      expect(session.id).toBe('sess-1')
      expect(session.agentType).toBe('claude-code')
    })
  })

  describe('FileChange', () => {
    test('creates valid file change object', () => {
      const fileChange: FileChange = {
        id: 'fc-1',
        path: 'src/auth/middleware.ts',
        type: 'modified',
        linesAdded: 5,
        linesRemoved: 1,
        timestamp: '2026-04-07T00:00:00Z',
      }

      expect(fileChange.type).toBe('modified')
      expect(fileChange.linesAdded).toBeGreaterThan(0)
    })
  })

  describe('ToolCall', () => {
    test('creates valid tool call object', () => {
      const toolCall: ToolCall = {
        id: 'tc-1',
        tool: 'Edit',
        args: 'src/auth/middleware.ts',
        status: 'done',
        timestamp: '2026-04-07T00:00:00Z',
        duration: 1200,
      }

      expect(toolCall.tool).toBe('Edit')
      expect(toolCall.status).toBe('done')
    })
  })

  describe('TestResult', () => {
    test('creates valid test result object', () => {
      const testResult: TestResult = {
        id: 'tr-1',
        file: 'src/auth/middleware.test.ts',
        passed: 4,
        failed: 1,
        total: 5,
        failures: [],
        timestamp: '2026-04-07T00:00:00Z',
      }

      expect(testResult.total).toBe(testResult.passed + testResult.failed)
    })
  })

  describe('ContextWindowStatus', () => {
    test('emoji reflects percentage correctly', () => {
      const fresh: ContextWindowStatus = {
        used: 50000,
        total: 200000,
        percentage: 25,
        emoji: '😊',
      }

      const moderate: ContextWindowStatus = {
        used: 130000,
        total: 200000,
        percentage: 65,
        emoji: '😐',
      }

      const high: ContextWindowStatus = {
        used: 170000,
        total: 200000,
        percentage: 85,
        emoji: '😟',
      }

      const critical: ContextWindowStatus = {
        used: 190000,
        total: 200000,
        percentage: 95,
        emoji: '🥵',
      }

      expect(fresh.emoji).toBe('😊')
      expect(moderate.emoji).toBe('😐')
      expect(high.emoji).toBe('😟')
      expect(critical.emoji).toBe('🥵')
    })
  })
})
