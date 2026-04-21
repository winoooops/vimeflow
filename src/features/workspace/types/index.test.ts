import { describe, test, expect } from 'vitest'
import type {
  Project,
  Session,
  SessionStatus,
  ActivityEventType,
  ActivityEvent,
  ActivityEventBadge,
  FileChange,
  ToolCall,
  TestResult,
  ContextWindowStatus,
  ContextPanelType,
  Terminal,
  WorkspaceState,
} from './index'

describe('Workspace Types', () => {
  describe('SessionStatus', () => {
    test('defines valid session status values', () => {
      const validStatuses: SessionStatus[] = [
        'running',
        'awaiting',
        'completed',
        'errored',
        'idle',
      ]

      validStatuses.forEach((status) => {
        expect(status).toBeTruthy()
      })
    })

    test('aligns with UNIFIED.md five-state model', () => {
      // Per UNIFIED.md §4.1, SessionStatus must support exactly these five states
      const expectedStates: SessionStatus[] = [
        'running',
        'awaiting',
        'completed',
        'errored',
        'idle',
      ]

      expect(expectedStates).toHaveLength(5)
    })
  })

  describe('Project', () => {
    test('creates valid project object', () => {
      const project: Project = {
        id: 'proj-1',
        name: 'My Project',
        abbreviation: 'My',
        path: '/home/user/my-project',
        sessions: [],
        createdAt: '2026-04-07T00:00:00Z',
        lastAccessedAt: '2026-04-07T00:00:00Z',
      }

      expect(project.id).toBe('proj-1')
      expect(project.abbreviation).toHaveLength(2)
    })

    test('accepts optional color field', () => {
      const project: Project = {
        id: 'proj-1',
        name: 'My Project',
        abbreviation: 'My',
        path: '/home/user/my-project',
        color: '#e2c7ff',
        sessions: [],
        createdAt: '2026-04-07T00:00:00Z',
        lastAccessedAt: '2026-04-07T00:00:00Z',
      }

      expect(project.color).toBe('#e2c7ff')
    })
  })

  describe('ActivityEventType', () => {
    test('defines valid activity event types', () => {
      const validTypes: ActivityEventType[] = [
        'edit',
        'bash',
        'read',
        'think',
        'user',
      ]

      validTypes.forEach((type) => {
        expect(type).toBeTruthy()
      })
    })

    test('aligns with UNIFIED.md §5.2 event types', () => {
      const expectedTypes: ActivityEventType[] = [
        'edit',
        'bash',
        'read',
        'think',
        'user',
      ]

      expect(expectedTypes).toHaveLength(5)
    })
  })

  describe('ActivityEventBadge', () => {
    test('creates valid badge object', () => {
      const badge: ActivityEventBadge = {
        kind: 'live',
        text: 'LIVE',
      }

      expect(badge.kind).toBe('live')
      expect(badge.text).toBe('LIVE')
    })

    test('supports all four badge kinds', () => {
      const badges: ActivityEventBadge[] = [
        { kind: 'live', text: 'LIVE' },
        { kind: 'ok', text: 'OK' },
        { kind: 'failed', text: 'FAILED 1/4' },
        { kind: 'diff', text: '+12 -2' },
      ]

      expect(badges).toHaveLength(4)
      badges.forEach((badge) => {
        expect(['live', 'ok', 'failed', 'diff']).toContain(badge.kind)
      })
    })
  })

  describe('ActivityEvent', () => {
    test('creates valid activity event object', () => {
      const event: ActivityEvent = {
        id: 'evt-1',
        type: 'edit',
        body: 'src/features/workspace/types/index.ts',
        at: '2026-04-21T01:20:00Z',
        badge: {
          kind: 'diff',
          text: '+12 -2',
        },
      }

      expect(event.id).toBe('evt-1')
      expect(event.type).toBe('edit')
      expect(event.body).toBeTruthy()
      expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    test('badge field is optional', () => {
      const eventWithoutBadge: ActivityEvent = {
        id: 'evt-2',
        type: 'read',
        body: 'docs/design/UNIFIED.md',
        at: '2026-04-21T01:10:00Z',
      }

      expect(eventWithoutBadge.badge).toBeUndefined()
    })

    test('supports all event types', () => {
      const events: ActivityEvent[] = [
        {
          id: 'e1',
          type: 'edit',
          body: 'file.ts',
          at: '2026-04-21T01:00:00Z',
        },
        {
          id: 'e2',
          type: 'bash',
          body: 'npm test',
          at: '2026-04-21T01:01:00Z',
        },
        {
          id: 'e3',
          type: 'read',
          body: 'docs.md',
          at: '2026-04-21T01:02:00Z',
        },
        {
          id: 'e4',
          type: 'think',
          body: 'considering approach',
          at: '2026-04-21T01:03:00Z',
        },
        {
          id: 'e5',
          type: 'user',
          body: 'user message',
          at: '2026-04-21T01:04:00Z',
        },
      ]

      expect(events).toHaveLength(5)
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

  describe('ContextPanelType', () => {
    test('defines valid context panel types', () => {
      const validTypes: ContextPanelType[] = ['files', 'editor', 'diff']

      validTypes.forEach((type) => {
        expect(type).toBeTruthy()
      })
    })
  })

  describe('Terminal', () => {
    test('creates valid terminal object', () => {
      const terminal: Terminal = {
        id: 'term-1',
        sessionId: 'sess-1',
        type: 'agent',
        label: '🤖 auth middleware',
        createdAt: '2026-04-07T00:00:00Z',
      }

      expect(terminal.type).toBe('agent')
      expect(terminal.label).toContain('🤖')
    })
  })

  describe('WorkspaceState', () => {
    test('creates valid workspace state object', () => {
      const state: WorkspaceState = {
        activeProjectId: 'proj-1',
        activeSessionId: 'sess-1',
        activeTerminalId: 'term-1',
        sidebarCollapsed: false,
        activityPanelCollapsed: false,
        contextPanel: {
          active: 'files',
          sidebarWidth: 260,
          isExpanded: false,
        },
      }

      expect(state.activeProjectId).toBe('proj-1')
      expect(state.contextPanel.sidebarWidth).toBe(260)
    })
  })
})
