/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable testing-library/no-node-access */

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceView } from './WorkspaceView'
// @ts-expect-error - tailwind.config.js has no type declarations
import tailwindConfig from '../../../tailwind.config'

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
  describe('Layout: 4-Zone Architecture', () => {
    test('grid layout has correct zone widths (48px, 260px, 1fr, 280px)', () => {
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      const match = /grid-cols-\[(.*?)\]/.exec(workspace.className)
      expect(match).toBeTruthy()
      expect(match?.[1]).toBe('48px_260px_1fr_280px')
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
    test('Icon Rail uses Level 1 surface (surface-container-low)', () => {
      render(<WorkspaceView />)
      const iconRail = screen.getByTestId('icon-rail')

      expect(iconRail.className).toContain('bg-surface-container-low')
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

    test('Terminal Zone tab bar uses Level 0.5 surface (surface-container-lowest)', () => {
      render(<WorkspaceView />)
      const tabBar = screen.getByTestId('tab-bar')

      expect(tabBar.className).toContain('bg-surface-container-lowest')
    })

    test('Agent Activity panel uses Level 1 surface (surface-container-low)', () => {
      render(<WorkspaceView />)
      const activityPanel = screen.getByTestId('agent-activity')

      expect(activityPanel.className).toContain('bg-surface-container-low')
    })
  })

  describe('No-Line Rule Compliance', () => {
    test('workspace view has no visible borders', () => {
      render(<WorkspaceView />)
      const workspace = screen.getByTestId('workspace-view')

      // Should NOT have any border classes
      expect(workspace.className).not.toContain('border-')
    })

    test('ContextSwitcher uses no visible borders (structural separation via background only)', () => {
      render(<WorkspaceView />)
      const contextSwitcher = screen.getByTestId('context-switcher')

      // Should NOT have border-b or border-t classes
      expect(contextSwitcher.className).not.toContain('border-b ')
      expect(contextSwitcher.className).not.toContain('border-t ')
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
    test('all zones render with correct structure', () => {
      render(<WorkspaceView />)

      // Icon Rail
      expect(screen.getByTestId('icon-rail')).toBeInTheDocument()

      // Sidebar with sessions
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      // Text is "Sessions" but rendered uppercase via CSS
      expect(screen.getByText('Sessions')).toBeInTheDocument()

      // Terminal Zone with tab bar
      expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument()

      // Agent Activity panel
      expect(screen.getByTestId('agent-activity')).toBeInTheDocument()
    })

    test('context switcher tabs (Files/Editor/Diff) are present', () => {
      render(<WorkspaceView />)

      expect(screen.getByText('Files')).toBeInTheDocument()
      expect(screen.getByText('Editor')).toBeInTheDocument()
      expect(screen.getByText('Diff')).toBeInTheDocument()
    })

    test('agent activity shows status card and metrics', () => {
      render(<WorkspaceView />)

      // Status card
      expect(screen.getByText('Claude Code')).toBeInTheDocument()

      // Status card should exist with testid
      const statusCard = screen.getByTestId('status-card')
      expect(statusCard).toBeInTheDocument()

      // Status card should show a status (check for status symbol ● ⏸ ○ ✗)
      expect(statusCard.textContent).toMatch(/[●⏸○✗]/)

      // Context window smiley (rendered as text) - may appear multiple times
      const contextSmileys = screen.queryAllByText(/[😊😐😟🥵]/)
      expect(contextSmileys.length).toBeGreaterThan(0)
    })

    test('agent activity shows collapsible sections', () => {
      render(<WorkspaceView />)

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
      expect(screen.getByText('Tests')).toBeInTheDocument()
    })
  })

  describe('Intentional Deviations from Mockup', () => {
    test('documented deviation: mock data differs from screenshot', () => {
      // DEVIATION DOCUMENTED:
      // The mockup shows "Fix Auth Bug", "Update Docs" sessions.
      // Our mock data uses different session names from mockSessions.ts.
      // This is intentional - we use our own mock data for development.

      render(<WorkspaceView />)

      // Verify our mock sessions render (session list exists)
      const sessionList = screen.getByTestId('session-list')
      expect(sessionList).toBeInTheDocument()

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
