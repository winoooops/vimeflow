import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { AGENTS } from '../../../agents/registry'
import { AgentStatusRail } from './AgentStatusRail'
import { ctxTone } from '../utils/contextTone'

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

// The context bucket shares the continuous ctxTone sweep with the expanded
// reservoir card so the context color agrees across collapsed + expanded
// states — no more tiered token swaps.
test('context bucket color follows the shared ctxTone sweep', () => {
  const { rerender } = render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={92}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: ctxTone(92).base,
  })

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={40}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: ctxTone(40).base,
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

test('rail sits on the canvas surface token', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  const rail = screen.getByTestId('agent-status-rail')

  expect(rail.className).toContain('bg-surface')
  expect(rail.className).not.toContain('bg-surface-container')
})
