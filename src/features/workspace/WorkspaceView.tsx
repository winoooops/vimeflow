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
  const [activeProjectId, setActiveProjectId] = useState<string>(
    mockProjects[0].id
  )

  const [activeSessionId, setActiveSessionId] = useState<string>(
    mockSessions[0].id
  )

  const [activeContextTab, setActiveContextTab] =
    useState<ContextPanelType>('files')

  // Get active session for AgentActivity panel
  const activeSession =
    mockSessions.find((s) => s.id === activeSessionId) ?? mockSessions[0]

  // Filter sessions by active project
  const projectSessions = mockSessions.filter(
    (s) => s.projectId === activeProjectId
  )

  // Handlers
  const handleProjectClick = (projectId: string): void => {
    setActiveProjectId(projectId)

    // Switch to first session of the new project
    const firstSessionOfProject = mockSessions.find(
      (s) => s.projectId === projectId
    )
    if (firstSessionOfProject) {
      setActiveSessionId(firstSessionOfProject.id)
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
