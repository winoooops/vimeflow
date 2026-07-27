import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import {
  ACTIVITY_CARD_SURFACE,
  NativeOverlayActivityCard,
} from './NativeOverlayActivityCard'

const setClipboard = (clipboard: Clipboard): void => {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

describe('NativeOverlayActivityCard', () => {
  test('renders a bash trace card and copies details', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText } as unknown as Clipboard)

    render(
      <div className={ACTIVITY_CARD_SURFACE}>
        <NativeOverlayActivityCard
          event={{
            id: 'activity-1',
            kind: 'bash',
            timestamp: '2026-07-10T12:00:00.000Z',
            status: 'done',
            body: 'npm test',
            tool: 'Bash',
            label: 'BASH',
            durationMs: 1200,
          }}
          now={new Date('2026-07-10T12:01:00.000Z')}
        />
      </div>
    )

    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.getByText('npm test')).toBeInTheDocument()
    expect(screen.getByText('$')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Show diff' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy trace details' }))

    expect(writeText).toHaveBeenCalledWith('npm test')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  test('shows the tool-specific label and body for a semantic trace kind', () => {
    render(
      <div className={ACTIVITY_CARD_SURFACE}>
        <NativeOverlayActivityCard
          event={{
            id: 'activity-2',
            kind: 'wait',
            timestamp: '2026-07-10T12:00:00.000Z',
            status: 'done',
            body: 'task-42',
            tool: 'TaskOutput',
            label: 'TASK OUTPUT',
            durationMs: 1200,
          }}
          now={new Date('2026-07-10T12:01:00.000Z')}
        />
      </div>
    )

    expect(screen.getByText('task output')).toBeInTheDocument()
    expect(screen.getByText('task-42')).toBeInTheDocument()
    expect(screen.queryByText('$')).not.toBeInTheDocument()
  })

  test('shows the only footer action when a diff can be opened', async () => {
    const user = userEvent.setup()
    const onShowDiff = vi.fn()

    render(
      <div className={ACTIVITY_CARD_SURFACE}>
        <NativeOverlayActivityCard
          event={{
            id: 'activity-3',
            kind: 'edit',
            timestamp: '2026-07-10T12:00:00.000Z',
            status: 'done',
            body: 'src/App.tsx',
            tool: 'Edit',
            label: 'EDIT',
            durationMs: 1200,
          }}
          now={new Date('2026-07-10T12:01:00.000Z')}
          onShowDiff={onShowDiff}
          showDiffShortcut="⌘G"
          showDiffAriaShortcut="Meta+g"
        />
      </div>
    )

    const showDiff = screen.getByRole('button', { name: 'Show diff' })
    expect(showDiff).toHaveAttribute('aria-keyshortcuts', 'Meta+g')
    expect(showDiff).toHaveTextContent('⌘G')
    expect(screen.queryByText('open file')).not.toBeInTheDocument()
    expect(screen.queryByText('esc')).not.toBeInTheDocument()

    await user.click(showDiff)

    expect(onShowDiff).toHaveBeenCalledOnce()
  })
})
