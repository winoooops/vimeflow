import { useState, type ReactElement } from 'react'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { TerminalZone } from './components/TerminalZone'
import AgentActivity from './components/AgentActivity'
import { mockNavigationItems, mockSettingsItem } from './data/mockNavigation'
import { mockSessions } from './data/mockSessions'

export const WorkspaceView = (): ReactElement => {
  // State management
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    mockSessions.length > 0 ? mockSessions[0].id : null
  )

  // Get active session for AgentActivity panel
  const activeSession = activeSessionId
    ? mockSessions.find((s) => s.id === activeSessionId)
    : undefined

  // Handlers
  const handleSessionClick = (sessionId: string): void => {
    setActiveSessionId(sessionId)
  }

  const handleNewInstance = (): void => {
    // Placeholder for new instance creation
  }

  const handleNewTab = (): void => {
    // Placeholder for new tab creation
  }

  return (
    <div
      data-testid="workspace-view"
      className="grid h-screen grid-cols-[64px_256px_1fr_320px] overflow-hidden"
    >
      {/* Icon Rail - 64px */}
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />

      {/* Sidebar - 256px */}
      <Sidebar
        sessions={mockSessions}
        activeSessionId={activeSessionId}
        onSessionClick={handleSessionClick}
        onNewInstance={handleNewInstance}
      />

      {/* Terminal Zone - flexible */}
      <TerminalZone
        sessions={mockSessions}
        activeSessionId={activeSessionId}
        onSessionChange={handleSessionClick}
        onNewTab={handleNewTab}
      />

      {/* Agent Activity - 320px */}
      <AgentActivity session={activeSession} />
    </div>
  )
}

export default WorkspaceView
