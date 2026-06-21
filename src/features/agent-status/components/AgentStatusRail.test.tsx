import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { AGENTS } from '../../../agents/registry'
import { AgentStatusRail } from './AgentStatusRail'
import { ctxTone } from '../utils/contextTone'

test('renders glyph chip, context meter, and cache meter', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={42}
      cacheHitPercentage={75}
      onExpand={() => undefined}
    />
  )

  const glyphChip = screen.getByTestId('agent-glyph-chip')
  // eslint-disable-next-line testing-library/no-node-access -- claude renders an svg brand mark
  const brandMark = glyphChip.querySelector('svg')

  expect(brandMark).toBeInTheDocument()
  expect(screen.getByRole('meter', { name: 'CTX' })).toHaveAttribute(
    'aria-valuenow',
    '42'
  )

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '75'
  )
})

// The context meter shares the continuous ctxTone sweep with the expanded
// reservoir card so the context color agrees across collapsed + expanded
// states — no more tiered token swaps.
test('context meter color follows the shared ctxTone sweep', () => {
  const { rerender } = render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={92}
      cacheHitPercentage={null}
      onExpand={() => undefined}
    />
  )

  expect(
    within(screen.getByRole('meter', { name: 'CTX' })).getByText('%')
  ).toHaveStyle({ color: ctxTone(92).base })

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={40}
      cacheHitPercentage={null}
      onExpand={() => undefined}
    />
  )

  expect(
    within(screen.getByRole('meter', { name: 'CTX' })).getByText('%')
  ).toHaveStyle({ color: ctxTone(40).base })
})

test('hides context meter when contextUsedPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={null}
      onExpand={() => undefined}
    />
  )

  expect(screen.queryByRole('meter', { name: 'CTX' })).not.toBeInTheDocument()
})

test('hides cache meter when cacheHitPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      onExpand={() => undefined}
    />
  )

  expect(screen.queryByRole('meter', { name: 'CACHE' })).not.toBeInTheDocument()
})

test('cache ring tone is mint at >=70%, lavender 40-70%, coral <40%', () => {
  const { rerender } = render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={85}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-success-muted)'
  )

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={55}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-primary)'
  )

  rerender(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={20}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-tertiary)'
  )
})

test('renders the cache rate as a ring, not the liquid bar', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={42}
      cacheHitPercentage={75}
      onExpand={() => undefined}
    />
  )

  const cacheMeter = screen.getByRole('meter', { name: 'CACHE' })

  expect(within(cacheMeter).getByTestId('cache-ring-arc')).toBeInTheDocument()
  expect(
    within(cacheMeter).queryByTestId('liquid-base')
  ).not.toBeInTheDocument()
})

test('drops the visible CACHE caption from the rail ring', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      cacheHitPercentage={75}
      onExpand={() => undefined}
    />
  )

  // The label now lives only in the tooltip + accessible name, not on the ring.
  expect(
    within(screen.getByRole('meter', { name: 'CACHE' })).queryByText('CACHE')
  ).not.toBeInTheDocument()
})

test('chevron expand button fires onExpand', async () => {
  const onExpand = vi.fn()

  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={10}
      cacheHitPercentage={null}
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
      onExpand={() => undefined}
    />
  )

  const rail = screen.getByTestId('agent-status-rail')

  expect(rail.className).toContain('bg-surface')
  expect(rail.className).not.toContain('bg-surface-container')
})

test('adds macOS drag coverage while keeping expand clickable', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      onExpand={() => undefined}
      reserveWindowControls
    />
  )

  expect(screen.getByTestId('agent-status-rail')).toHaveClass(
    'vf-app-drag-region'
  )

  expect(
    screen.getByRole('button', { name: /expand activity panel/i })
  ).toHaveClass('vf-app-no-drag')
})

test('does not add rail drag coverage when native controls are not reserved', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      onExpand={() => undefined}
    />
  )

  expect(screen.getByTestId('agent-status-rail')).not.toHaveClass(
    'vf-app-drag-region'
  )
})
