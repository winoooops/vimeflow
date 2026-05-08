import { describe, test, expect } from 'vitest'
import type {
  Project,
  ContextPanelType,
  Terminal,
  WorkspaceState,
} from './index'

describe('Workspace Types', () => {
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
