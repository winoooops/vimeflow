import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { AGENTS } from '../../../agents/registry'
import { AgentStatusRail } from './AgentStatusRail'

const notRunning = false

test('renders glyph chip, vendor mark, context bar, context label, and running dot when running', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={42}
      isRunning
      onExpand={() => undefined}
    />
  )
  expect(screen.getByText('∴')).toBeInTheDocument()
  expect(screen.getByTestId('vendor-mark')).toBeInTheDocument()
  expect(screen.getByTestId('context-bar-fill')).toHaveStyle({
    height: '42%',
  })
  expect(screen.getByTestId('context-pct-label')).toHaveTextContent('42% ctx')
  expect(screen.getByTestId('running-dot')).toBeInTheDocument()
})

test('switches to bg-error when context exceeds 85%', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={91}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )
  const fill = screen.getByTestId('context-bar-fill')
  expect(fill).toHaveClass('bg-error')
  expect(fill).not.toHaveAttribute(
    'style',
    expect.stringMatching(/background:/)
  )
})

test('renders no fill bar and "--" label when contextUsedPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )
  expect(screen.queryByTestId('context-bar-fill')).not.toBeInTheDocument()
  expect(screen.getByTestId('context-pct-label')).toHaveTextContent('-- ctx')
})

test('omits vendor mark for shell agent', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.shell}
      contextUsedPercentage={10}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )
  expect(screen.queryByTestId('vendor-mark')).not.toBeInTheDocument()
})

test('omits running dot when isRunning is false', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.codex}
      contextUsedPercentage={50}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )
  expect(screen.queryByTestId('running-dot')).not.toBeInTheDocument()
})

test('chevron expand button fires onExpand', async () => {
  const onExpand = vi.fn()
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={10}
      isRunning={notRunning}
      onExpand={onExpand}
    />
  )

  await userEvent.click(
    screen.getByRole('button', { name: /expand activity panel/i })
  )
  expect(onExpand).toHaveBeenCalledTimes(1)
})
