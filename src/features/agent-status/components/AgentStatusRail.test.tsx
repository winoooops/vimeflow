import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { AGENTS } from '../../../agents/registry'
import { AgentStatusRail } from './AgentStatusRail'

const notRunning = false

test('renders glyph chip, context bucket, cache bucket, and running dot when running', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={42}
      cacheHitPercentage={75}
      isRunning
      onExpand={() => undefined}
    />
  )

  expect(screen.getByText('∴')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-ctx')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-ctx-pct')).toHaveTextContent('42%')
  expect(screen.getByTestId('bucket-cache')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-cache-pct')).toHaveTextContent('75%')
  expect(screen.getByTestId('running-dot')).toBeInTheDocument()
})

test('context bucket tone shifts to coral above 90%', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={92}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: 'var(--color-tertiary)',
  })
})

test('context bucket tone is warm coral between 75 and 90%', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={80}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: 'var(--color-error)',
  })
})

test('hides context bucket when contextUsedPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.queryByTestId('bucket-ctx')).not.toBeInTheDocument()
})

test('hides cache bucket when cacheHitPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.queryByTestId('bucket-cache')).not.toBeInTheDocument()
})

test('cache bucket tone is mint at >=70%, lavender 40-70%, coral <40%', () => {
  const { rerender } = render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={85}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-cache-pct-glyph')).toHaveStyle({
    color: 'var(--color-success-muted)',
  })

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={55}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-cache-pct-glyph')).toHaveStyle({
    color: 'var(--color-primary)',
  })

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={20}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-cache-pct-glyph')).toHaveStyle({
    color: 'var(--color-tertiary)',
  })
})

test('omits running dot when isRunning is false', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.codex}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
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
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={onExpand}
    />
  )

  await userEvent.click(
    screen.getByRole('button', { name: /expand activity panel/i })
  )
  expect(onExpand).toHaveBeenCalledTimes(1)
})

test('rail is 44px wide', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('agent-status-rail')).toHaveStyle({ width: '44px' })
})
