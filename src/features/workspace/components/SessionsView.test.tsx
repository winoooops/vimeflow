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

  test('hidden prop applies to the testid root', () => {
    render(<SessionsView {...baseProps} hidden />)

    expect(screen.getByTestId('sessions-view')).toHaveAttribute('hidden')
  })

  test('hidden=false omits the hidden attribute', () => {
    const hidden = false as const

    render(<SessionsView {...baseProps} hidden={hidden} />)

    expect(screen.getByTestId('sessions-view')).not.toHaveAttribute('hidden')
  })

  test('hidden defaults to false', () => {
    render(<SessionsView {...baseProps} />)

    expect(screen.getByTestId('sessions-view')).not.toHaveAttribute('hidden')
  })
})
