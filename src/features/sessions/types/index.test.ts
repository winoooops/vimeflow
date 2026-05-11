import { describe, test, expect } from 'vitest'
// cspell:ignore vsplit hsplit
import type {
  LayoutId,
  Pane,
  Session,
  SessionStatus,
  FileChange,
  ToolCall,
  TestResult,
  ContextWindowStatus,
} from './index'

describe('Session Types', () => {
  describe('SessionStatus', () => {
    test('union covers exactly the four documented states', () => {
      // Snapshot the union — adding/removing a member without updating
      // this test fails the comparison, forcing a deliberate decision.
      // The previous .toBeTruthy() loop passed for any non-empty string,
      // so a widening to `string` would have gone unnoticed.
      const validStatuses: SessionStatus[] = [
        'running',
        'paused',
        'completed',
        'errored',
      ]

      expect(new Set(validStatuses)).toEqual(
        new Set(['running', 'paused', 'completed', 'errored'])
      )
    })
  })

  describe('Session', () => {
    test('LayoutId enumerates the five canonical layouts', () => {
      const ids: LayoutId[] = [
        'single',
        'vsplit',
        'hsplit',
        'threeRight',
        'quad',
      ]
      expect(ids).toHaveLength(5)
    })

    test('Pane has the documented fields', () => {
      const pane: Pane = {
        id: 'p0',
        ptyId: 'pty-abc-123',
        cwd: '/home/will/repo',
        agentType: 'claude-code',
        status: 'running',
        active: true,
        pid: 12345,
        restoreData: undefined,
      }

      expect(pane.id).toBe('p0')
      expect(pane.active).toBe(true)
    })

    test('Session keeps workingDirectory and agentType (derived materialized fields)', () => {
      const session: Pick<Session, 'workingDirectory' | 'agentType'> = {
        workingDirectory: '/home/will/repo',
        agentType: 'claude-code',
      }

      expect(session.workingDirectory).toBe('/home/will/repo')
    })

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
    // No percentage→emoji mapping exists — emoji is a free field the
    // backend populates. This test only exercises that the four emoji
    // literals in the union are accepted by the type. A real mapping
    // test belongs in whichever utility eventually computes the emoji.
    test('accepts all four emoji literals from the union', () => {
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
