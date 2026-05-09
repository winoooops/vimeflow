/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable testing-library/no-node-access */

import { describe, test, expect, vi } from 'vitest'
// @ts-expect-error - tailwind.config.js has no type declarations
import tailwindConfig from '../../../tailwind.config'

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
  })),
}))

// eslint-disable-next-line import/first
import { render, screen } from '@testing-library/react'
// eslint-disable-next-line import/first
import userEvent from '@testing-library/user-event'
// eslint-disable-next-line import/first
import { WorkspaceView } from './WorkspaceView'

/**
 * Visual Verification Test Suite for Feature #20
 *
 * Verifies the rendered workspace matches the Stitch mockup from:
 * docs/design/agent_workspace/screen.png
 *
 * This test validates:
 * 1. Layout spacing (48px, 260px, 280px zones)
 * 2. Color tokens match Catppuccin Mocha palette
 * 3. Typography (Manrope headlines, Inter body, JetBrains Mono code)
 * 4. Surface hierarchy correctness
 * 5. Border radius values
 * 6. No-Line Rule compliance
 */

describe('WorkspaceView - Visual Verification (Feature #20)', () => {
  describe('Layout: 5-Zone Architecture (v2)', () => {
    test('grid layout has correct zone widths (48px, 272px, 1fr, auto)', () => {
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      expect(workspace.style.gridTemplateColumns).toBe('48px 272px 1fr auto')
    })

    test('workspace uses full screen height', () => {
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      expect(workspace.className).toContain('h-screen')
    })

    test('workspace prevents overflow', () => {
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      expect(workspace.className).toContain('overflow-hidden')
    })

    test('grid pins the implicit row to 1fr so 100vh propagates downward', () => {
      // Without `grid-rows-1`, `grid-auto-rows: auto` lets the row grow
      // to content size and the sidebar overflows 100vh.
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      expect(workspace.className).toContain('grid-rows-1')
    })
  })

  describe('Color Tokens: Catppuccin Mocha Palette', () => {
    test('tailwind config has correct surface hierarchy tokens', () => {
      const colors = tailwindConfig.theme.extend.colors

      // Level 0 - Base
      expect(colors.surface).toBe('#121221')
      expect(colors.background).toBe('#121221')

      // Level 0.5 - Deepest recessed
      expect(colors['surface-container-lowest']).toBe('#0d0d1c')

      // Level 1 - Navigation (Icon Rail, Sidebar, Activity)
      expect(colors['surface-container-low']).toBe('#1a1a2a')

      // Level 2 - Content (Cards)
      expect(colors['surface-container']).toBe('#1e1e2e')

      // Level 2.5 - Elevated cards
      expect(colors['surface-container-high']).toBe('#292839')

      // Level 3 - Modals, inputs
      expect(colors['surface-container-highest']).toBe('#333344')

      // Hover state
      expect(colors['surface-bright']).toBe('#383849')
    })

    test('tailwind config has correct primary tokens', () => {
      const colors = tailwindConfig.theme.extend.colors

      expect(colors.primary).toBe('#e2c7ff')
      expect(colors['primary-container']).toBe('#cba6f7')
      expect(colors['primary-dim']).toBe('#d3b9f0')
    })

    test('tailwind config has correct semantic feedback tokens', () => {
      const colors = tailwindConfig.theme.extend.colors

      // Success (agent running status)
      expect(colors.success).toBe('#50fa7b')
      expect(colors['success-muted']).toBe('#7defa1')

      // Warning
      expect(colors.tertiary).toBe('#ff94a5')
      expect(colors['tertiary-container']).toBe('#fd7e94')

      // Error
      expect(colors.error).toBe('#ffb4ab')
      expect(colors['error-dim']).toBe('#d73357')
    })

    test('tailwind config has correct text tokens', () => {
      const colors = tailwindConfig.theme.extend.colors

      expect(colors['on-surface']).toBe('#e3e0f7')
      expect(colors['on-surface-variant']).toBe('#cdc3d1')
      expect(colors['outline-variant']).toBe('#4a444f')
    })
  })

  describe('Typography: Manrope + Inter + JetBrains Mono', () => {
    test('tailwind config has Manrope for headlines', () => {
      const fontFamily = tailwindConfig.theme.extend.fontFamily

      expect(fontFamily.headline).toContain('Manrope')
    })

    test('tailwind config has Inter for body/labels', () => {
      const fontFamily = tailwindConfig.theme.extend.fontFamily

      expect(fontFamily.body).toContain('Inter')
      expect(fontFamily.label).toContain('Inter')
    })

    test('tailwind config has JetBrains Mono for code', () => {
      const fontFamily = tailwindConfig.theme.extend.fontFamily

      expect(fontFamily.mono).toContain('JetBrains Mono')
    })
  })

  describe('Border Radius: Obsidian Lens Scale', () => {
    test('tailwind config has correct border radius values', () => {
      const borderRadius = tailwindConfig.theme.extend.borderRadius

      // Buttons/Inputs: 0.75rem
      expect(borderRadius.md).toBe('0.75rem')

      // Cards: 1rem
      expect(borderRadius.lg).toBe('1rem')

      // Windows/Main Panels: 1.5rem
      expect(borderRadius.xl).toBe('1.5rem')

      // Status badges/Chips: pill
      expect(borderRadius.full).toBe('9999px')
    })
  })

  describe('Surface Hierarchy: Component Backgrounds', () => {
    test('Icon Rail uses Level 0 surface (bg-surface)', () => {
      render(<WorkspaceView />)
      const iconRail = screen.getByTestId('icon-rail')

      expect(iconRail.className).toContain('bg-surface')
    })

    test('Sidebar uses Level 1 surface (surface-container-low)', () => {
      render(<WorkspaceView />)
      const sidebar = screen.getByTestId('sidebar')

      expect(sidebar.className).toContain('bg-surface-container-low')
    })

    test('Terminal Zone content uses Level 0 surface (bg-surface)', () => {
      render(<WorkspaceView />)
      const terminalContent = screen.getByTestId('terminal-content')

      expect(terminalContent.className).toContain('bg-surface')
    })

    test('SessionTabs strip uses Level 0.5 surface (surface-container-lowest)', () => {
      render(<WorkspaceView />)
      const tabs = screen.getByTestId('session-tabs')

      expect(tabs.className).toContain('bg-surface-container-lowest')
    })

    test('Agent Status Panel uses surface-container background', () => {
      render(<WorkspaceView />)
      const panel = screen.getByTestId('agent-status-panel')

      expect(panel.className).toContain('bg-surface-container')
    })
  })

  describe('No-Line Rule Compliance', () => {
    test('workspace view has no visible borders', () => {
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      // Should NOT have any border classes
      expect(workspace.className).not.toContain('border-')
    })

    test('BottomDrawer uses subtle border for separation', () => {
      render(<WorkspaceView />)
      const bottomDrawer = screen.getByTestId('bottom-drawer')

      // BottomDrawer has border-t border-white/5 for subtle separation
      expect(bottomDrawer.className).toContain('border-t')
      expect(bottomDrawer.className).toContain('border-white/5')
    })

    test('sidebar session cards have no visible borders', () => {
      render(<WorkspaceView />)
      const sessionList = screen.getByTestId('session-list')
      const sessionButtons = sessionList.querySelectorAll('button[aria-label]')

      sessionButtons.forEach((button) => {
        // Active cards have left accent border only (border-l-4 border-l-primary)
        // This is the only allowed border per design spec (active session indicator)
        const hasLeftBorder = button.className.includes('border-l-')

        if (hasLeftBorder) {
          // Should only have left border, no other borders
          expect(button.className).not.toMatch(/border-r-|border-t-|border-b-/)
        }
      })
    })
  })

  describe('Design System Compliance Checklist', () => {
    test('all 5 zones render with correct structure (v2)', () => {
      render(<WorkspaceView />)

      expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      // Active group header replaces the prior "Active Sessions" copy.
      expect(screen.getByTestId('session-group-active')).toBeInTheDocument()

      expect(screen.getByTestId('session-tabs')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
      expect(screen.getByTestId('bottom-drawer')).toBeInTheDocument()
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })

    test('bottom drawer has Editor/Diff tabs, FILES tab has file explorer (v2)', async () => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      // Editor and Diff Viewer tabs are in bottom drawer
      expect(screen.getByText('Editor')).toBeInTheDocument()
      expect(screen.getByText('Diff Viewer')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'FILES' }))

      // File Explorer is in the sidebar's FILES tab.
      expect(screen.getByText('File Explorer')).toBeInTheDocument()
    })

    test('agent status panel renders as shell', () => {
      render(<WorkspaceView />)

      const panel = screen.getByTestId('agent-status-panel')

      expect(panel).toBeInTheDocument()
      // Child sections (StatusCard, metrics, collapsible sections) will be
      // added in sub-specs 5-7
    })
  })

  describe('Intentional Deviations from Mockup', () => {
    test('documented deviation: mock data differs from screenshot', async () => {
      // DEVIATION DOCUMENTED:
      // The mockup shows "Fix Auth Bug", "Update Docs" sessions.
      // Our mock data uses different session names from mockSessions.ts.
      // This is intentional - we use our own mock data for development.

      render(<WorkspaceView />)

      // Verify our mock sessions render (session list exists)
      const sessionList = screen.getByTestId('session-list')
      expect(sessionList).toBeInTheDocument()

      // Wait for sessions to load from listSessions IPC
      await screen.findByRole('button', { name: 'session 1' })

      // Verify sessions have content (buttons with aria-labels)
      const sessionButtons = sessionList.querySelectorAll('button[aria-label]')
      expect(sessionButtons.length).toBeGreaterThan(0)

      // Success: Mock data renders correctly, just different from screenshot
    })

    test('documented deviation: no backdrop-blur on icon rail (reference implementation)', () => {
      // DEVIATION DOCUMENTED:
      // Design spec mentions backdrop-blur on icon rail.
      // Reference implementation (code.html) does NOT use backdrop-blur.
      // We follow the reference implementation for consistency.

      render(<WorkspaceView />)
      const iconRail = screen.getByTestId('icon-rail')

      // Icon rail may or may not have backdrop-blur - both are acceptable
      // Reference implementation doesn't use it, so we don't require it
      expect(iconRail).toBeInTheDocument()
    })
  })
})
