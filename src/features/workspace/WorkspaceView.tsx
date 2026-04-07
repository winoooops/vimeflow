import { useState, type ReactElement } from 'react'
import type { ContextPanelType } from './types'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { TerminalZone } from './components/TerminalZone'
import AgentActivity from './components/AgentActivity'
import { mockProjects } from './data/mockProjects'
import { mockSessions } from './data/mockSessions'

export const WorkspaceView = (): ReactElement => {
  // State management
  // P1 Fix: Guard against empty project/session lists on init
  // Default to null if arrays are empty to prevent runtime crash
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    mockProjects.length > 0 ? mockProjects[0].id : null
  )

  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    mockSessions.length > 0 ? mockSessions[0].id : null
  )

  const [activeContextTab, setActiveContextTab] =
    useState<ContextPanelType>('files')

  // Get active session for AgentActivity panel
  const activeSession = activeSessionId
    ? mockSessions.find((s) => s.id === activeSessionId)
    : undefined

  // Filter sessions by active project
  // Handle null activeProjectId gracefully
  const projectSessions = activeProjectId
    ? mockSessions.filter((s) => s.projectId === activeProjectId)
    : []

  // Handlers
  const handleProjectClick = (projectId: string): void => {
    setActiveProjectId(projectId)

    // Switch to first session of the new project
    const firstSessionOfProject = mockSessions.find(
      (s) => s.projectId === projectId
    )
    if (firstSessionOfProject) {
      setActiveSessionId(firstSessionOfProject.id)
    } else {
      // Clear active session when project has no sessions
      setActiveSessionId(null)
    }
  }

  const handleSessionClick = (sessionId: string): void => {
    setActiveSessionId(sessionId)
  }

  const handleContextTabChange = (tab: ContextPanelType): void => {
    setActiveContextTab(tab)
  }

  const handleNewProject = (): void => {
    // Placeholder for new project creation
  }

  const handleSettings = (): void => {
    // Placeholder for settings modal
  }

  const handleNewTab = (): void => {
    // Placeholder for new tab creation
  }

  return (
    <div
      data-testid="workspace-view"
      className="grid h-screen grid-cols-[48px_260px_1fr_280px] overflow-hidden"
    >
      {/* Icon Rail - 48px */}
      <IconRail
        projects={mockProjects}
        activeProjectId={activeProjectId}
        onProjectClick={handleProjectClick}
        onNewProject={handleNewProject}
        onSettings={handleSettings}
      />

      {/* Sidebar - 260px */}
      <Sidebar
        sessions={projectSessions}
        activeSessionId={activeSessionId}
        onSessionClick={handleSessionClick}
        activeContextTab={activeContextTab}
        onContextTabChange={handleContextTabChange}
      />

      {/* Terminal Zone - flexible */}
      <TerminalZone
        sessions={projectSessions}
        activeSessionId={activeSessionId}
        onSessionChange={handleSessionClick}
        onNewTab={handleNewTab}
      />

      {/* Agent Activity - 280px */}
      <AgentActivity session={activeSession} />
    </div>
  )
}

export default WorkspaceView
