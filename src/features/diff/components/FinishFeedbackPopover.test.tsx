import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FinishFeedbackPopover } from './FinishFeedbackPopover'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'

const createAnchor = (): HTMLDivElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)

  return el
}

const makePane = (overrides: Partial<PaneCandidate> = {}): PaneCandidate => ({
  paneId: 'pane-1',
  ptyId: 'pty-1',
  tabName: 'Tab 1',
  agentLabel: 'Claude Code',
  cwd: '/repo',
  status: 'running',
  isFocused: false,
  ...overrides,
})

test('kind none shows no-agent message and Dismiss button calls onCancel', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onCancel = vi.fn()
  const onSend = vi.fn()

  render(
    <FinishFeedbackPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      commentCount={0}
      fileCount={0}
      onSend={onSend}
      onCancel={onCancel}
    />
  )

  expect(
    screen.getByRole('dialog', { name: 'Finish feedback' })
  ).toBeInTheDocument()

  expect(
    screen.getByText(/No coding agent is active in this workspace/)
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onSend).not.toHaveBeenCalled()

  anchor.remove()
})

test('kind one shows pane info, correct copy, and buttons work', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onCancel = vi.fn()
  const onSend = vi.fn()
  const pane = makePane({ tabName: 'claude', agentLabel: 'Claude Code' })

  render(
    <FinishFeedbackPopover
      anchor={anchor}
      result={{ kind: 'one', pane } as ResolveResult}
      commentCount={5}
      fileCount={2}
      onSend={onSend}
      onCancel={onCancel}
    />
  )

  expect(
    screen.getByText(
      /Send 5 comments across 2 files to claude \(Claude Code\)\?/
    )
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onSend).toHaveBeenCalledTimes(1)
  expect(onSend).toHaveBeenCalledWith(pane)

  onSend.mockClear()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onSend).not.toHaveBeenCalled()

  anchor.remove()
})

test('kind many renders row per candidate and sends to correct pane', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onCancel = vi.fn()
  const onSend = vi.fn()

  const paneA = makePane({
    paneId: 'pane-a',
    ptyId: 'pty-a',
    tabName: 'claude-a',
    agentLabel: 'Claude Code',
  })

  const paneB = makePane({
    paneId: 'pane-b',
    ptyId: 'pty-b',
    tabName: 'codex-b',
    agentLabel: 'Codex',
  })

  render(
    <FinishFeedbackPopover
      anchor={anchor}
      result={{ kind: 'many', candidates: [paneA, paneB] } as ResolveResult}
      commentCount={3}
      fileCount={1}
      onSend={onSend}
      onCancel={onCancel}
    />
  )

  expect(
    screen.getByText(/Multiple agents in this workspace\. Pick one:/)
  ).toBeInTheDocument()
  expect(screen.getByText('claude-a (Claude Code)')).toBeInTheDocument()
  expect(screen.getByText('codex-b (Codex)')).toBeInTheDocument()

  const sendButtons = screen.getAllByRole('button', { name: 'Send' })
  expect(sendButtons).toHaveLength(2)

  await user.click(sendButtons[1])
  expect(onSend).toHaveBeenCalledTimes(1)
  expect(onSend).toHaveBeenCalledWith(paneB)

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledTimes(1)

  anchor.remove()
})

test('pluralization uses singular for 1 comment and 1 file', () => {
  const anchor = createAnchor()
  const pane = makePane()

  render(
    <FinishFeedbackPopover
      anchor={anchor}
      result={{ kind: 'one', pane } as ResolveResult}
      commentCount={1}
      fileCount={1}
      onSend={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  expect(screen.getByText(/Send 1 comment across 1 file/)).toBeInTheDocument()

  anchor.remove()
})

test('pluralization uses plural for multiple comments and files', () => {
  const anchor = createAnchor()
  const pane = makePane()

  render(
    <FinishFeedbackPopover
      anchor={anchor}
      result={{ kind: 'one', pane } as ResolveResult}
      commentCount={3}
      fileCount={2}
      onSend={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  expect(screen.getByText(/Send 3 comments across 2 files/)).toBeInTheDocument()

  anchor.remove()
})
