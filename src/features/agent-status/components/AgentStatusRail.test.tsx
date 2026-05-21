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
      cacheHitRate={75}
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
      cacheHitRate={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: '#ff94a5',
  })
})

test('context bucket tone is warm coral between 75 and 90%', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={80}
      cacheHitRate={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: '#ffb4ab',
  })
})

test('hides context bucket when contextUsedPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitRate={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.queryByTestId('bucket-ctx')).not.toBeInTheDocument()
})

test('hides cache bucket when cacheHitRate is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitRate={null}
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
      cacheHitRate={85}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-cache-pct-glyph')).toHaveStyle({
    color: '#7defa1',
  })

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitRate={55}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-cache-pct-glyph')).toHaveStyle({
    color: '#e2c7ff',
  })

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitRate={20}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('bucket-cache-pct-glyph')).toHaveStyle({
    color: '#ff94a5',
  })
})

test('omits running dot when isRunning is false', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.codex}
      contextUsedPercentage={50}
      cacheHitRate={null}
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
      cacheHitRate={null}
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
      cacheHitRate={null}
      isRunning={notRunning}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('agent-status-rail')).toHaveStyle({ width: '44px' })
})
