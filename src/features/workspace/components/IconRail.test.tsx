import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { IconRail } from './IconRail'
import { mockProjects } from '../data/mockProjects'

describe('IconRail', () => {
  test('renders all project avatars', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    // Should show all project abbreviations
    expect(screen.getByText('Vf')).toBeInTheDocument()
    expect(screen.getByText('My')).toBeInTheDocument()
    expect(screen.getByText('Ag')).toBeInTheDocument()
  })

  test('displays project avatars with 32x32 rounded dimensions', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const avatar = screen.getByRole('button', { name: 'Vimeflow' })
    expect(avatar).toHaveClass('w-8') // 32px
    expect(avatar).toHaveClass('h-8') // 32px
    expect(avatar).toHaveClass('rounded-xl') // rounded corners
  })

  test('highlights active project with purple pill backlight', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const activeAvatar = screen.getByRole('button', { name: 'Vimeflow' })
    expect(activeAvatar).toHaveClass('bg-primary-container/20')
  })

  test('inactive projects have no backlight', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const inactiveAvatar = screen.getByRole('button', { name: 'My Portfolio' })
    expect(inactiveAvatar).not.toHaveClass('bg-primary-container/20')
  })

  test('calls onProjectClick when project avatar is clicked', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={handleClick}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const projectAvatar = screen.getByRole('button', { name: 'My Portfolio' })
    expect(projectAvatar).toBeInTheDocument()

    await user.click(projectAvatar)
    expect(handleClick).toHaveBeenCalledWith('proj-2')
  })

  test('renders new project button at bottom', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const newProjectButton = screen.getByRole('button', {
      name: /new project/i,
    })
    expect(newProjectButton).toBeInTheDocument()
    expect(newProjectButton).toHaveTextContent('+')
  })

  test('renders settings button at bottom', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const settingsButton = screen.getByRole('button', { name: /settings/i })
    expect(settingsButton).toBeInTheDocument()
    expect(settingsButton).toHaveTextContent('⚙')
  })

  test('calls onNewProject when new project button is clicked', async () => {
    const handleNewProject = vi.fn()
    const user = userEvent.setup()

    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={handleNewProject}
        onSettings={vi.fn()}
      />
    )

    const newProjectButton = screen.getByRole('button', {
      name: /new project/i,
    })
    await user.click(newProjectButton)

    expect(handleNewProject).toHaveBeenCalledTimes(1)
  })

  test('calls onSettings when settings button is clicked', async () => {
    const handleSettings = vi.fn()
    const user = userEvent.setup()

    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={handleSettings}
      />
    )

    const settingsButton = screen.getByRole('button', { name: /settings/i })
    await user.click(settingsButton)

    expect(handleSettings).toHaveBeenCalledTimes(1)
  })

  test('uses 48px fixed width container', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const rail = screen.getByTestId('icon-rail')
    expect(rail).toHaveClass('w-12') // 48px (12 * 4 = 48)
  })

  test('uses surface-container-low background', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const rail = screen.getByTestId('icon-rail')
    expect(rail).toHaveClass('bg-surface-container-low')
  })

  test('arranges projects at top and actions at bottom', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const newProjectButton = screen.getByRole('button', {
      name: /new project/i,
    })
    const settingsButton = screen.getByRole('button', { name: /settings/i })
    const projectAvatar = screen.getByRole('button', { name: 'Vimeflow' })

    // Projects should be before action buttons in DOM order
    const buttons = screen.getAllByRole('button')
    const projectIndex = buttons.indexOf(projectAvatar)
    const newProjectIndex = buttons.indexOf(newProjectButton)
    const settingsIndex = buttons.indexOf(settingsButton)

    expect(projectIndex).toBeLessThan(newProjectIndex)
    expect(newProjectIndex).toBeLessThan(settingsIndex)
  })

  test('renders with empty projects array', () => {
    render(
      <IconRail
        projects={[]}
        activeProjectId=""
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    // Should still render action buttons
    expect(
      screen.getByRole('button', { name: /new project/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /settings/i })
    ).toBeInTheDocument()
  })

  test('applies hover styles to project avatars', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const avatar = screen.getByRole('button', { name: 'Vimeflow' })
    expect(avatar).toHaveClass('hover:bg-surface-container')
  })

  test('applies hover styles to action buttons', () => {
    render(
      <IconRail
        projects={mockProjects}
        activeProjectId="proj-1"
        onProjectClick={vi.fn()}
        onNewProject={vi.fn()}
        onSettings={vi.fn()}
      />
    )

    const newProjectButton = screen.getByRole('button', {
      name: /new project/i,
    })
    expect(newProjectButton).toHaveClass('hover:bg-surface-container')
  })
})
