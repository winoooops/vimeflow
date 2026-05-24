import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import type { Pane } from '../../sessions/types'
import { PaneRenameInput } from './PaneRenameInput'

const makePane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-1',
  cwd: '/tmp',
  agentType: 'claude-code',
  status: 'running',
  active: true,
  ...overrides,
})

describe('PaneRenameInput', () => {
  test('renders pre-filled with pane.agentTitle when present', () => {
    render(
      <PaneRenameInput
        pane={makePane({ agentTitle: 'old' })}
        initialValue="old"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Pane name' })).toHaveValue(
      'old'
    )
  })

  test('falls back to session.name when no agentTitle', () => {
    render(
      <PaneRenameInput
        pane={makePane()}
        initialValue="fallback-name"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('fallback-name')
  })

  test('Enter on a valid title calls onSubmit with sanitized value', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PaneRenameInput
        pane={makePane({ agentTitle: 'old' })}
        initialValue="old"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'new-title')
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledWith('new-title')
  })

  test('Escape calls onCancel and does not call onSubmit', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    render(
      <PaneRenameInput
        pane={makePane()}
        initialValue="fallback-name"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    screen.getByRole('textbox').focus()
    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('shows only one alert when editing after an external error', () => {
    const ControlledRenameInput = (): ReactElement => {
      const [externalError, setExternalError] = useState<string | null>(
        'failed to send /rename: pty write failed'
      )

      return (
        <PaneRenameInput
          pane={makePane()}
          initialValue="valid-title"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          externalError={externalError}
          onExternalErrorDismiss={() => setExternalError(null)}
        />
      )
    }

    render(<ControlledRenameInput />)

    const input = screen.getByRole('textbox')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'failed to send /rename: pty write failed'
    )

    fireEvent.change(input, { target: { value: 'bad\u0007' } })

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'control characters are not allowed'
    )
  })
})
