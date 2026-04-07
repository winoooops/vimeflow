import type { ReactElement } from 'react'
import type { Project } from '../types'

export interface IconRailProps {
  projects: Project[]
  activeProjectId: string | null
  onProjectClick: (projectId: string) => void
  onNewProject: () => void
  onSettings: () => void
}

export const IconRail = ({
  projects,
  activeProjectId,
  onProjectClick,
  onNewProject,
  onSettings,
}: IconRailProps): ReactElement => (
  <div
    className="flex h-full w-12 flex-col items-center justify-between bg-surface-container-low py-3"
    data-testid="icon-rail"
  >
    {/* Projects section (top) */}
    <div className="flex flex-col items-center gap-2">
      {projects.map((project) => {
        const isActive = project.id === activeProjectId

        return (
          <button
            key={project.id}
            type="button"
            onClick={() => onProjectClick(project.id)}
            className={`
              flex h-8 w-8 items-center justify-center
              rounded-lg font-label text-sm font-semibold
              text-on-surface transition-colors
              hover:bg-surface-container
              ${isActive ? 'bg-primary-container/20' : ''}
            `}
            aria-label={project.name}
            title={project.name}
          >
            {project.abbreviation}
          </button>
        )
      })}
    </div>

    {/* Actions section (bottom) */}
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onNewProject}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-on-surface transition-colors hover:bg-surface-container"
        aria-label="New project"
        title="New project"
      >
        +
      </button>

      <button
        type="button"
        onClick={onSettings}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-on-surface transition-colors hover:bg-surface-container"
        aria-label="Settings"
        title="Settings"
      >
        ⚙
      </button>
    </div>
  </div>
)
