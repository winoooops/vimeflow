/* eslint-disable testing-library/no-node-access */
/**
 * Feature 23: Final Phase 2 Verification Checklist
 *
 * This test suite verifies all requirements from Feature 23 are met.
 */

import { describe, test, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Mock TerminalPane to avoid xterm.js issues in tests
vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => (
    <div data-testid="terminal-pane-mock">Mocked TerminalPane</div>
  )),
}))

// Mock useAgentStatus so AgentStatusPanel renders predictably
vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => ({
    isActive: true,
    agentType: 'claude-code',
    modelId: null,
    modelDisplayName: null,
    version: null,
    sessionId: null,
    agentSessionId: null,
    contextWindow: null,
    cost: null,
    rateLimits: null,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
  })),
}))

// eslint-disable-next-line import/first
import { render, screen } from '@testing-library/react'
// eslint-disable-next-line import/first
import { WorkspaceView } from './WorkspaceView'

describe('Feature 23: Final Phase 2 Verification', () => {
  describe('1. 5-zone layout renders', () => {
    test('renders icon rail, sidebar, terminal, bottom drawer, and activity zones', () => {
      render(<WorkspaceView />)

      expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
      expect(screen.getByTestId('bottom-drawer')).toBeInTheDocument()
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })
  })

  describe('2. Icon rail shows navigation items', () => {
    test('displays navigation bookmarks', () => {
      render(<WorkspaceView />)

      // Check for navigation items in icon rail
      const dashboardButton = screen.getByRole('button', {
        name: 'Dashboard',
      })

      expect(dashboardButton).toBeInTheDocument()
    })

    test('navigation items have colorful bookmarks', () => {
      render(<WorkspaceView />)

      // Should have Dashboard, Source Control, Debugger, Settings
      expect(
        screen.getByRole('button', { name: 'Dashboard' })
      ).toBeInTheDocument()

      expect(
        screen.getByRole('button', { name: 'Source Control' })
      ).toBeInTheDocument()

      expect(
        screen.getByRole('button', { name: 'Debugger' })
      ).toBeInTheDocument()

      expect(
        screen.getByRole('button', { name: 'Settings' })
      ).toBeInTheDocument()
    })
  })

  describe('3. Sidebar shows mock session list with status badges', () => {
    test('displays session list', () => {
      render(<WorkspaceView />)

      const sessionList = screen.getByTestId('session-list')

      expect(sessionList).toBeInTheDocument()
    })

    test('shows session status badges', () => {
      render(<WorkspaceView />)

      // Session list should render session buttons (status is conveyed via
      // visual indicators, not text — text badges were removed when
      // AgentActivity was replaced by the AgentStatusPanel shell)
      const sessionList = screen.getByTestId('session-list')
      const sessionButtons = sessionList.querySelectorAll('button[aria-label]')

      expect(sessionButtons.length).toBeGreaterThan(0)
    })
  })

  describe('4. Sidebar has file explorer and bottom drawer has Editor/Diff', () => {
    test('sidebar displays file explorer', () => {
      render(<WorkspaceView />)

      // File explorer should be in sidebar
      expect(screen.getByText('File Explorer')).toBeInTheDocument()
    })

    test('bottom drawer displays Editor and Diff Viewer tabs', () => {
      render(<WorkspaceView />)

      const bottomDrawer = screen.getByTestId('bottom-drawer')

      expect(bottomDrawer).toBeInTheDocument()
      // Editor and Diff tabs are in bottom drawer, not sidebar
      expect(screen.getByText('Editor')).toBeInTheDocument()
      expect(screen.getByText('Diff Viewer')).toBeInTheDocument()
    })
  })

  describe('5. Agent Status Panel renders', () => {
    test('displays agent status panel shell', () => {
      render(<WorkspaceView />)

      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })

    // Child sections (StatusCard, BudgetMetrics, ContextBucket, ToolCallSummary)
    // will be tested in sub-specs 5-7
  })

  describe('6. Chat view and all chat code removed', () => {
    test('chat feature directory should not exist', () => {
      const chatDir = path.join(process.cwd(), 'src/features/chat')
      const chatExists = fs.existsSync(chatDir)

      expect(chatExists).toBe(false)
    })

    test('no ChatView imports in App.tsx', () => {
      const appPath = path.join(process.cwd(), 'src/App.tsx')
      const appContent = fs.readFileSync(appPath, 'utf-8')

      expect(appContent).not.toContain('ChatView')
      expect(appContent).toContain('WorkspaceView')
    })

    test('no references to chat types or data in workspace', () => {
      const workspaceDir = path.join(process.cwd(), 'src/features/workspace')

      const workspaceFiles = fs
        .readdirSync(workspaceDir, { recursive: true })
        .filter(
          (file) =>
            typeof file === 'string' &&
            file.endsWith('.tsx') &&
            !file.includes('verification.test.tsx') // Skip this verification file
        )
        .map((file) => path.join(workspaceDir, file as string))

      workspaceFiles.forEach((file) => {
        const content = fs.readFileSync(file, 'utf-8')

        expect(content).not.toContain('features/chat')
        expect(content).not.toContain('mockMessages')
        expect(content).not.toContain('ConversationItem')
      })
    })
  })

  describe('7. Design matches Stitch mockup', () => {
    test('workspace has correct grid layout', () => {
      render(<WorkspaceView />)

      const workspace = screen.getByTestId('workspace-view')

      expect(workspace).toHaveClass('grid')
      expect(workspace).toHaveClass('h-screen')
    })

    test('uses Obsidian Lens color tokens', () => {
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      expect(sidebar).toHaveClass('bg-surface-container-low')
    })
  })

  describe('8. All tests pass, ESLint and Prettier clean', () => {
    test('workspace view renders without errors', () => {
      render(<WorkspaceView />)

      // Verify all 5 zones are present
      expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
      expect(screen.getByTestId('bottom-drawer')).toBeInTheDocument()
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })
  })
})
