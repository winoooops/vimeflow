// Workspace shell types — navigation, projects, panels, terminals.
// Session domain types live in src/features/sessions/types/.

import type { Session } from '../../sessions/types'

// ============================================================================
// Navigation Types (Phase 2v2)
// ============================================================================

export interface NavigationItem {
  id: string
  name: string
  icon: string // Material Symbols icon name
  color: string // Tailwind color class (e.g., 'bg-emerald-500')
  onClick: () => void
}

// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: string
  name: string
  abbreviation: string // 2-letter abbreviation for icon rail
  path: string // working directory path
  color?: string // optional custom color for avatar
  sessions: Session[]
  createdAt: string
  lastAccessedAt: string
}

// ============================================================================
// Context Panel Types
// ============================================================================

export type ContextPanelType = 'files' | 'editor' | 'diff'

export interface ContextPanelState {
  active: ContextPanelType
  sidebarWidth: number // 260px default, can be resized
  isExpanded: boolean // true when using full-width overlay
}

// ============================================================================
// Terminal Types
// ============================================================================

export interface Terminal {
  id: string
  sessionId: string
  type: 'agent' | 'shell'
  label: string // tab label
  pid?: number
  createdAt: string
}

// ============================================================================
// UI State Types
// ============================================================================

export interface WorkspaceState {
  activeProjectId: string | null
  activeSessionId: string | null
  activeTerminalId: string | null
  sidebarCollapsed: boolean
  activityPanelCollapsed: boolean
  contextPanel: ContextPanelState
}
