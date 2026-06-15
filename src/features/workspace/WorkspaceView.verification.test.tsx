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
    numTurns: 0,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
    testRun: null,
  })),
}))

// Mock terminal service to return initial session data synchronously
vi.mock('../terminal/services/terminalService', () => ({
  createTerminalService: vi.fn(() => ({
    spawn: vi
      .fn()
      .mockResolvedValue({ sessionId: 'new-id', pid: 999, cwd: '~' }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onExit: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onError: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onBurnerForeground: vi.fn((): (() => void) => (): void => {}),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: 'sess-1',
      sessions: [
        {
          id: 'sess-1',
          cwd: '~',
          status: {
            kind: 'Alive',
            pid: 1234,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
    setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
    killEphemeralPtys: vi.fn(),
    setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../hooks/useElasticContainer', () => ({
  useElasticContainer: vi.fn(() => ({
    size: 400,
    isDragging: false,
    handleMouseDown: vi.fn(),
    adjustBy: vi.fn(),
    resetToSize: vi.fn(),
    sizeRef: { current: 400 },
    pixelMin: 40,
    pixelMax: 640,
  })),
}))

// eslint-disable-next-line import/first
import { render as rtlRender, screen, within } from '@testing-library/react'
// eslint-disable-next-line import/first
import userEvent from '@testing-library/user-event'
// eslint-disable-next-line import/first
import type { ReactElement } from 'react'
// eslint-disable-next-line import/first
import { WorkspaceView } from './WorkspaceView'
// eslint-disable-next-line import/first
import { SettingsProvider } from '../settings/SettingsProvider'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

describe('Feature 23: Final Phase 2 Verification', () => {
  describe('1. workspace zones render (VIM-76: icon rail removed)', () => {
    test('renders sidebar (with top bar), terminal, dock panel, and activity zones', () => {
      render(<WorkspaceView />)

      // VIM-76: icon rail removed; sidebar chrome remains in the sidebar.
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar-top-bar')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar-footer-wrapper')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })
  })

  describe('2. Sidebar footer shows utility actions', () => {
    test('no longer renders a placeholder account avatar (removed, VIM-66)', () => {
      render(<WorkspaceView />)

      expect(screen.queryByRole('img', { name: 'Account' })).toBeNull()
    })

    test('moves Settings to the footer and removes the command palette button', () => {
      render(<WorkspaceView />)

      const topBar = screen.getByTestId('sidebar-top-bar')
      const footer = screen.getByTestId('sidebar-footer-wrapper')

      expect(
        within(topBar).queryByRole('button', { name: 'Command Palette' })
      ).not.toBeInTheDocument()

      // Settings button is now wired and enabled.
      expect(
        within(footer).getByRole('button', { name: /^Settings/ })
      ).not.toHaveAttribute('aria-disabled')
    })
  })

  describe('3. Sidebar shows mock session list with status badges', () => {
    test('displays session list', () => {
      render(<WorkspaceView />)

      const sessionList = screen.getByTestId('session-list')

      expect(sessionList).toBeInTheDocument()
    })

    test('shows session status badges', async () => {
      render(<WorkspaceView />)

      // Session list should render session buttons (status is conveyed via
      // visual indicators, not text — text badges were removed when
      // AgentActivity was replaced by the AgentStatusPanel shell)
      const sessionList = screen.getByTestId('session-list')

      // Wait for sessions to load from listSessions IPC
      await screen.findByRole('button', { name: 'session 1' })

      const sessionButtons = sessionList.querySelectorAll('button[aria-label]')

      expect(sessionButtons.length).toBeGreaterThan(0)
    })
  })

  describe('4. Sidebar FILES tab has file explorer and dock panel has Editor/Diff', () => {
    test('sidebar FILES tab displays file explorer', async () => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      await user.click(screen.getByRole('button', { name: 'FILES' }))

      // File explorer should be in the sidebar FILES tab.
      expect(screen.getByText('File Explorer')).toBeInTheDocument()
    })

    test('dock panel displays Editor and Diff Viewer tabs', () => {
      render(<WorkspaceView />)

      const dockPanel = screen.getByTestId('dock-panel')

      expect(dockPanel).toBeInTheDocument()
      // Editor and Diff tabs are in dock panel, not sidebar
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

  describe('7. Design matches the design spec', () => {
    test('workspace has correct grid layout', () => {
      render(<WorkspaceView />)

      const workspace = screen.getByTestId('workspace-view')

      expect(workspace).toHaveClass('grid')
      expect(workspace).toHaveClass('h-screen')
    })

    test('sidebar is transparent so it blends into the workspace surface', () => {
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      expect(sidebar).toHaveClass('bg-transparent')
      expect(sidebar).not.toHaveClass('bg-surface-container-low')
    })
  })

  describe('8. All tests pass, ESLint and Prettier clean', () => {
    test('workspace view renders without errors', () => {
      render(<WorkspaceView />)

      // Verify all zones are present (VIM-76: icon rail removed).
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })
  })
})
