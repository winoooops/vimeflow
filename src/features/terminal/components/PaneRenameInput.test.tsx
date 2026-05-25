import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import type { Pane } from '../../sessions/types'
import {
  _resetForTest as resetPaneHeaderRefsForTest,
  register as registerPaneHeaderRef,
} from '../paneHeaderRefs'
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
  afterEach(() => {
    resetPaneHeaderRefsForTest()
  })

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

  test('dismisses external error when editing after an external error', () => {
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

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('clicking outside cancels when an external error is visible', () => {
    const onCancel = vi.fn()
    render(
      <PaneRenameInput
        pane={makePane()}
        initialValue="valid-title"
        onSubmit={vi.fn()}
        onCancel={onCancel}
        externalError="failed to send /rename: pty write failed"
      />
    )

    fireEvent.pointerDown(document.body)

    expect(onCancel).toHaveBeenCalled()
  })

  test('clicking inside does not cancel when an external error is visible', () => {
    const onCancel = vi.fn()
    render(
      <PaneRenameInput
        pane={makePane()}
        initialValue="valid-title"
        onSubmit={vi.fn()}
        onCancel={onCancel}
        externalError="failed to send /rename: pty write failed"
      />
    )

    fireEvent.pointerDown(screen.getByRole('textbox'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  test('tracks pane header position when layout changes', () => {
    const anchor = document.createElement('div')

    const getBoundingClientRect = vi
      .fn()
      .mockReturnValueOnce({
        top: 12,
        left: 24,
        width: 180,
        height: 28,
      })
      .mockReturnValue({
        top: 40,
        left: 64,
        width: 220,
        height: 32,
      })
    anchor.getBoundingClientRect = getBoundingClientRect
    registerPaneHeaderRef('pty-1', anchor)

    render(
      <PaneRenameInput
        pane={makePane()}
        initialValue="valid-title"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const frame = screen.getByTestId('pane-rename-frame')
    expect(frame).toHaveStyle({
      top: '12px',
      left: '24px',
      width: '180px',
      minHeight: '28px',
    })

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(frame).toHaveStyle({
      top: '40px',
      left: '64px',
      width: '220px',
      minHeight: '32px',
    })
  })
})
