import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockSessions } from '../data/mockSessions'
import { SessionsView } from './SessionsView'

const noop = (): void => undefined

const baseProps = {
  sessions: mockSessions,
  activeSessionId: mockSessions[0]?.id ?? null,
  onSessionClick: noop,
  onCreateSession: noop,
  onRemoveSession: noop,
  onRenameSession: noop,
  onReorderSessions: noop,
}

describe('SessionsView', () => {
  test('renders the sessions List', () => {
    render(<SessionsView {...baseProps} />)

    expect(screen.getByTestId('sessions-view')).toBeInTheDocument()
    expect(screen.getByTestId('session-list')).toBeInTheDocument()
  })

  test('New Instance button fires onCreateSession on click', async () => {
    const onCreateSession = vi.fn()
    const user = userEvent.setup()

    render(<SessionsView {...baseProps} onCreateSession={onCreateSession} />)
    await user.click(screen.getByRole('button', { name: 'New Instance' }))

    expect(onCreateSession).toHaveBeenCalledTimes(1)
  })

  test('hidden=true applies the `hidden` Tailwind utility class on the testid root', () => {
    render(<SessionsView {...baseProps} hidden />)

    const root = screen.getByTestId('sessions-view')
    expect(root).toHaveClass('hidden')
    expect(root).not.toHaveClass('flex')
  })

  test('hidden=false applies the `flex` utility instead', () => {
    const hidden = false as const

    render(<SessionsView {...baseProps} hidden={hidden} />)

    const root = screen.getByTestId('sessions-view')
    expect(root).toHaveClass('flex')
    expect(root).not.toHaveClass('hidden')
  })

  test('hidden defaults to false (flex applied)', () => {
    render(<SessionsView {...baseProps} />)

    const root = screen.getByTestId('sessions-view')
    expect(root).toHaveClass('flex')
    expect(root).not.toHaveClass('hidden')
  })
})
